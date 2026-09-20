import argparse
import atexit
import base64
import importlib
import importlib.util
import json
import os
import queue
import signal
import subprocess
import sys
import threading
import time
import uuid
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional, Tuple, Union

import cv2
import numpy as np
import psutil
import requests
import torch
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

HAS_PSUTIL = True

CURRENT_DIR = Path(__file__).resolve().parent
FRONTEND_ROOT = CURRENT_DIR.parent
PARENT_ROOT = FRONTEND_ROOT.parent
PARENT_ROOT1 = PARENT_ROOT.parent
DEFAULT_DUAL_REPO = PARENT_ROOT1 / "YOLO_MM_20260302"
PROJECT_ROOT = Path(__file__).resolve().parents[1] if len(Path(__file__).resolve().parents) > 1 else CURRENT_DIR
load_dotenv(PROJECT_ROOT / ".env")

UPLOAD_DIR = PROJECT_ROOT / "backend" / "uploads"
WEB_DIR = PROJECT_ROOT
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

USER_DB_FILE = PROJECT_ROOT / "backend" / "users.json"
SINGLE_MODEL_PATH = (PROJECT_ROOT / "yolo11n.pt").resolve()
DEFAULT_DUAL_MODEL_PATH = Path(os.getenv("YOLO_MODEL_PATH", "")).resolve() if os.getenv("YOLO_MODEL_PATH", "").strip() else (PROJECT_ROOT / "yolo11.pt").resolve()
USE_SIMOTM = os.getenv("USE_SIMOTM", "RGBIR6C").strip() or "RGBIR6C"

GATEWAY_PORT = int(os.getenv("GATEWAY_PORT", "8000"))
SINGLE_BACKEND_PORT = int(os.getenv("SINGLE_BACKEND_PORT", "8001"))
DUAL_BACKEND_PORT = int(os.getenv("DUAL_BACKEND_PORT", "8002"))
GATEWAY_BASE = f"http://127.0.0.1:{GATEWAY_PORT}"
SINGLE_BACKEND_BASE = f"http://127.0.0.1:{SINGLE_BACKEND_PORT}"
DUAL_BACKEND_BASE = f"http://127.0.0.1:{DUAL_BACKEND_PORT}"


def _build_multimodal_input(rgb_bgr: np.ndarray, ir_bgr: np.ndarray, mode: str = "RGBIR6C") -> np.ndarray:
    h, w = rgb_bgr.shape[:2]
    if ir_bgr.shape[:2] != (h, w):
        ir_bgr = cv2.resize(ir_bgr, (w, h), interpolation=cv2.INTER_LINEAR)

    if mode == "RGBIR6C":
        return np.concatenate([rgb_bgr, ir_bgr], axis=2)
    if mode == "RGBT":
        ir_gray = cv2.cvtColor(ir_bgr, cv2.COLOR_BGR2GRAY)
        ir_gray = ir_gray[:, :, None]
        return np.concatenate([rgb_bgr, ir_gray], axis=2)
    raise HTTPException(status_code=400, detail=f"不支持的 USE_SIMOTM: {mode}")


def _read_upload_to_bgr(upload_file: UploadFile) -> np.ndarray:
    file_bytes = upload_file.file.read()
    nparr = np.frombuffer(file_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail=f"无法读取文件: {upload_file.filename}")
    return img


def _clean_counts(counts: Counter, limit: int = 20) -> dict[str, int]:
    return dict(counts.most_common(limit))


def _format_detection_summary(counts: dict[str, int]) -> str:
    if not counts:
        return "未检测到明显目标。"
    ordered_items = sorted(counts.items(), key=lambda item: item[1], reverse=True)
    return "，".join([f"{name}{count}个" for name, count in ordered_items])


def _is_invalid_qwen_key(api_key: str) -> bool:
    normalized = api_key.strip()
    placeholder_values = {"", "YOUR-API-KEY", "your-api-key", "YOUR_API_KEY"}
    return normalized in placeholder_values or len(normalized) < 20


def _compress_image_for_qwen(image: np.ndarray, max_side: int = 960, quality: int = 72) -> str:
    height, width = image.shape[:2]
    longest_side = max(height, width)
    if longest_side > max_side:
        scale = max_side / float(longest_side)
        image = cv2.resize(image, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_AREA)
    ok, buffer = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError("图片压缩失败")
    return base64.b64encode(buffer).decode("utf-8")


def _infer_scene_focus(user_text: str, counts: dict[str, int]) -> str:
    text = (user_text or "").lower()
    vehicle_total = sum(counts.get(name, 0) for name in ["car", "bus", "truck", "motorcycle", "bicycle"])
    person_total = counts.get("person", 0)

    if any(keyword in text for keyword in ["交通", "车流", "道路", "拥堵", "车辆"]) or vehicle_total > 0:
        return "交通巡检"
    if any(keyword in text for keyword in ["人流", "人员", "聚集", "行人"]) or person_total > 0:
        return "人群观察"
    return "综合巡检"


def _build_local_scene_reply(user_text: str, counts: dict[str, int]) -> str:
    if not counts and user_text:
        return "结论：当前只收到了文字问题，未附带监控画面，因此无法做场景判读。\n建议：请上传图片或补充具体巡检目标，我再给出聚焦结论。"

    focus = _infer_scene_focus(user_text, counts)
    vehicle_total = sum(counts.get(name, 0) for name in ["car", "bus", "truck", "motorcycle", "bicycle"])
    person_total = counts.get("person", 0)
    summary = _format_detection_summary(counts)

    if focus == "交通巡检":
        if vehicle_total >= 18:
            density = "高"
            judgement = "道路车流量较大，画面中已有明显拥挤趋势。"
        elif vehicle_total >= 8:
            density = "中"
            judgement = "道路车流量中等，当前通行压力偏高但尚可流动。"
        elif vehicle_total > 0:
            density = "低"
            judgement = "道路车流量较低，当前未见明显拥堵。"
        else:
            density = "低"
            judgement = "当前画面未识别到明显车辆，暂无法判断道路压力。"
        advice = "建议持续关注车道排队长度和车辆停滞时长，必要时再结合连续视频确认是否形成拥堵。"
        return f"结论：{judgement}\n依据：检测到{summary}，综合判断车流密度为{density}。\n建议：{advice}"

    if focus == "人群观察":
        if person_total >= 15:
            judgement = "当前人群密度偏高，存在聚集风险。"
        elif person_total > 0:
            judgement = "当前可见少量人员活动，未见明显拥挤。"
        else:
            judgement = "当前画面未识别到明显人员目标。"
        advice = "建议关注人群是否持续聚拢、停留时间是否增加，以及周边车辆和通道是否受影响。"
        return f"结论：{judgement}\n依据：检测到{summary}。\n建议：{advice}"

    return (
        f"结论：当前画面可先按综合巡检理解，暂未见必须立刻处置的异常。\n"
        f"依据：检测到{summary}。\n"
        "建议：如需更精准判断，请补充具体任务目标，例如交通、人员聚集或异常目标排查。"
    )


def _extract_qwen_reply(data: dict[str, Any]) -> str:
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return ""

    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        text_parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                text_parts.append(str(item.get("text", "")).strip())
            elif isinstance(item, str):
                text_parts.append(item.strip())
        return "\n".join([part for part in text_parts if part]).strip()
    return str(content).strip()


def _is_model_identity_query(user_text: str) -> bool:
    normalized = (user_text or "").strip().lower()
    keywords = [
        "你是什么模型", "你是啥模型", "是不是qwen", "是qwen吗", "是不是千问", "是千问吗",
        "是否调用api", "有没有走api", "是否走api", "api吗", "qwen api", "模型名",
        "what model", "which model", "are you qwen", "using api"
    ]
    return any(keyword in normalized for keyword in keywords)


def _is_infrared_request(user_text: str) -> bool:
    normalized = (user_text or "").strip().lower()
    keywords = ["红外图", "红外", "热力图", "热成像", "伪红外", "伪彩", "热图", "infrared", "thermal", "heatmap"]
    return any(keyword in normalized for keyword in keywords)


def _is_image_generation_request(user_text: str) -> bool:
    normalized = (user_text or "").strip().lower()
    keywords = [
        "生成图片", "生成一张图", "生成一下", "出图", "改图", "重绘", "编辑图片",
        "变成", "转成", "红外图", "热成像", "效果图", "海报", "渲染图",
        "generate image", "edit image", "image edit", "infrared", "thermal"
    ]
    return any(keyword in normalized for keyword in keywords)


def _build_qwen_image_prompt(user_text: str) -> str:
    user_text = (user_text or "").strip()
    if _is_infrared_request(user_text):
        return (
            "请基于输入图片做真实感更强的红外/热成像风格改图。"
            "保持原始道路、车辆、建筑和镜头视角基本一致，不要改变场景布局。"
            "让车辆、路面和高温区域呈现清晰的热成像层次，整体效果接近专业巡检热成像画面。"
            "不要添加无关目标，不要卡通化，不要文字水印。"
        )
    return (
        "请基于输入图片完成图像编辑，尽量保持原始场景主体、构图和视角稳定。"
        f"编辑要求：{user_text}"
    )


def _download_remote_image(image_url: str, target_path: Path) -> None:
    response = requests.get(image_url, timeout=60)
    response.raise_for_status()
    with target_path.open("wb") as file_obj:
        file_obj.write(response.content)


def load_users() -> dict[str, str]:
    if not USER_DB_FILE.exists():
        default_db = {"admin": "123456789"}
        save_users(default_db)
        return default_db
    try:
        with open(USER_DB_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"admin": "123456789"}


def save_users(db: dict[str, str]) -> None:
    USER_DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(USER_DB_FILE, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=4)


class AuthRequest(BaseModel):
    username: str
    password: str


@dataclass
class EngineState:
    lock: threading.Lock = field(default_factory=threading.Lock)
    running: bool = False
    stop_event: Optional[threading.Event] = None
    worker_thread: Optional[threading.Thread] = None
    latest_jpeg: Optional[bytes] = None
    current_counts: Counter = field(default_factory=Counter)
    total_counts: Counter = field(default_factory=Counter)
    fps_ema: float = 0.0
    frame_id: int = -1
    dropped_frames: int = 0
    started_at: float = 0.0
    source_desc: str = ""
    settings: dict[str, Any] = field(default_factory=dict)
    uploaded_file: Optional[Path] = None
    scenario: str = "traffic"
    video_time: float = 0.0
    last_stats_update: float = 0.0
    last_error: str = ""

@dataclass
class DualVideoState:
    lock: threading.Lock = field(default_factory=threading.Lock)
    running: bool = False
    stop_event: Optional[threading.Event] = None
    worker_thread: Optional[threading.Thread] = None
    latest_jpeg_rgb: Optional[bytes] = None
    latest_jpeg_ir: Optional[bytes] = None
    current_counts: Counter = field(default_factory=Counter)
    total_counts: Counter = field(default_factory=Counter)
    fps_ema: float = 0.0
    frame_id: int = -1
    dropped_frames: int = 0
    started_at: float = 0.0
    source_desc: str = ""
    settings: dict[str, Any] = field(default_factory=dict)
    uploaded_rgb: Optional[Path] = None
    uploaded_ir: Optional[Path] = None
    video_time: float = 0.0
    last_stats_update: float = 0.0
    last_error: str = ""

class SingleVideoEngine:
    def __init__(self, yolo_cls) -> None:
        if not SINGLE_MODEL_PATH.exists():
            raise RuntimeError(f"未找到单模态模型文件: {SINGLE_MODEL_PATH}")
        self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        if self.device.startswith("cuda"):
            torch.backends.cudnn.benchmark = True
            torch.set_float32_matmul_precision("high")
        self.model = yolo_cls(str(SINGLE_MODEL_PATH))
        self.model.to(self.device)
        self.state = EngineState()

    def start(self, source: Union[str, int], source_desc: str, conf: float, iou: float, imgsz: int, scenario: str, uploaded_file: Optional[Path]) -> None:
        with self.state.lock:
            if self.state.running:
                raise RuntimeError("检测任务已在运行，请先停止当前任务。")
            self.state.running = True
            self.state.stop_event = threading.Event()
            self.state.latest_jpeg = None
            self.state.current_counts = Counter()
            self.state.total_counts = Counter()
            self.state.fps_ema = 0.0
            self.state.frame_id = -1
            self.state.last_error = ""
            self.state.dropped_frames = 0
            self.state.started_at = time.time()
            self.state.source_desc = source_desc
            self.state.settings = {"conf": conf, "iou": iou, "imgsz": imgsz}
            self.state.uploaded_file = uploaded_file
            self.state.scenario = scenario
            self.state.video_time = 0.0
            self.state.last_stats_update = time.perf_counter()
            worker = threading.Thread(target=self._run_loop, args=(source,), daemon=True)
            self.state.worker_thread = worker
            worker.start()

    def stop(self) -> None:
        thread_to_join = None
        uploaded_to_remove: Optional[Path] = None
        with self.state.lock:
            if not self.state.running:
                return
            if self.state.stop_event:
                self.state.stop_event.set()
            thread_to_join = self.state.worker_thread
            uploaded_to_remove = self.state.uploaded_file
        if thread_to_join and thread_to_join.is_alive():
            thread_to_join.join(timeout=4)
        with self.state.lock:
            self.state.running = False
            self.state.worker_thread = None
            self.state.stop_event = None
            self.state.uploaded_file = None
        if uploaded_to_remove and uploaded_to_remove.exists():
            try:
                uploaded_to_remove.unlink()
            except OSError:
                pass

    def status(self) -> dict[str, Any]:
        with self.state.lock:
            uptime = max(0.0, time.time() - self.state.started_at) if self.state.started_at else 0.0
            mem_pct = psutil.virtual_memory().percent if HAS_PSUTIL else 0.0
            return {
                "running": self.state.running,
                "video_time": self.state.video_time,
                "source": self.state.source_desc,
                "fps": round(self.state.fps_ema, 2),
                "memory_percent": mem_pct,
                "frame_id": self.state.frame_id,
                "uptime_sec": round(uptime, 1),
                "dropped_frames": self.state.dropped_frames,
                "current_counts": _clean_counts(self.state.current_counts, 30),
                "total_counts": _clean_counts(self.state.total_counts, 30),
                "total_objects": int(sum(self.state.current_counts.values())),
                "settings": self.state.settings,
                "device": self.device,
                "scenario": self.state.scenario,
                "last_error": self.state.last_error,
            }

    def latest_frame_with_id(self) -> Tuple[Optional[bytes], int, bool]:
        with self.state.lock:
            return self.state.latest_jpeg, self.state.frame_id, self.state.running

    def generate_report(self) -> str:
        with self.state.lock:
            summary = {
                "source": self.state.source_desc,
                "fps": round(self.state.fps_ema, 2),
                "uptime_sec": round(max(0.0, time.time() - self.state.started_at), 1),
                "total_counts": _clean_counts(self.state.total_counts, 30),
                "scenario": self.state.scenario,
            }
        counts_text = ", ".join([f"{k}:{v}" for k, v in summary["total_counts"].items()]) or "无有效目标"
        return (
            f"# 无人机监控报告\n- 场景: {summary['scenario']}\n- 视频源: {summary['source']}\n"
            f"- 平均FPS: {summary['fps']}\n- 运行时长: {summary['uptime_sec']} 秒\n"
            f"- 累计目标统计: {counts_text}\n- 状态: 实时监控中。"
        )

    def _capture_thread(self, cap, q, stop_event, is_file):
        while not stop_event.is_set() and cap.isOpened():
            ok, frame = cap.read()
            if not ok:
                break
            current_vtime = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
            if is_file:
                q.put((frame, current_vtime))
            else:
                if q.full():
                    try:
                        q.get_nowait()
                    except queue.Empty:
                        pass
                q.put((frame, current_vtime))
        cap.release()

    def _run_loop(self, source) -> None:
        cap = cv2.VideoCapture(source)
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)
            cap.set(cv2.CAP_PROP_FPS, 60)
        except Exception:
            pass
        if not cap.isOpened():
            with self.state.lock:
                self.state.last_error = "视频源打开失败，请检查视频文件是否损坏，或编码格式是否被 OpenCV 支持。"
                self.state.running = False
            return

        original_fps = cap.get(cv2.CAP_PROP_FPS)
        target_delay = 1.0 / original_fps if original_fps > 0 else 0.0333
        is_file = isinstance(source, str) and os.path.isfile(source)
        frame_queue = queue.Queue(maxsize=5 if is_file else 2)
        capture_worker = threading.Thread(target=self._capture_thread, args=(cap, frame_queue, self.state.stop_event, is_file), daemon=True)
        capture_worker.start()
        prev_ts = time.perf_counter()

        while True:
            loop_start = time.perf_counter()
            with self.state.lock:
                stop_event = self.state.stop_event
                cfg = dict(self.state.settings)
                running = self.state.running
            if not running or (stop_event and stop_event.is_set()):
                break
            try:
                frame, current_vtime = frame_queue.get(timeout=0.1)
            except queue.Empty:
                if not capture_worker.is_alive():
                    with self.state.lock:
                        if not self.state.last_error:
                            self.state.last_error = "视频读取结束或未解码到有效帧。"
                        self.state.running = False
                    break
                continue

            if frame is None or not isinstance(frame, np.ndarray) or frame.size == 0:
                with self.state.lock:
                    self.state.last_error = f"读取到空帧: type={type(frame)}"
                    self.state.running = False
                break
            if frame.ndim == 2:
                frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
            elif frame.ndim == 3 and frame.shape[2] == 4:
                frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)
            elif frame.ndim != 3 or frame.shape[2] < 3:
                with self.state.lock:
                    self.state.last_error = f"非法帧 shape={getattr(frame, 'shape', None)}"
                    self.state.running = False
                break
            frame = np.ascontiguousarray(frame[:, :, :3])

            start_infer = time.perf_counter()
            try:
                result = self.model.predict(
                    frame,
                    conf=cfg["conf"],
                    iou=cfg["iou"],
                    imgsz=cfg["imgsz"],
                    verbose=False,
                    device=self.device,
                    half=self.device.startswith("cuda"),
                )[0]
            except Exception as e:
                import traceback
                traceback.print_exc()
                with self.state.lock:
                    self.state.last_error = f"单模态推理失败: {repr(e)}"
                    self.state.running = False
                break

            frame_counts = Counter()
            if result.boxes is not None and len(result.boxes) > 0:
                for cls_id in result.boxes.cls.tolist():
                    cls_name = self.model.names.get(int(cls_id), str(int(cls_id)))
                    frame_counts[cls_name] += 1

            annotated = result.plot(line_width=2, labels=True, conf=True)
            ok_jpg, jpg = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 65])
            if not ok_jpg:
                continue

            now = time.perf_counter()
            delta = max(1e-6, now - prev_ts)
            prev_ts = now
            inst_fps = 1.0 / delta
            infer_elapsed = max(1e-6, now - start_infer)
            if infer_elapsed > 0.25:
                with self.state.lock:
                    self.state.dropped_frames += 1
            with self.state.lock:
                self.state.video_time = current_vtime
                self.state.current_counts = frame_counts
                if now - self.state.last_stats_update >= 3.0:
                    self.state.total_counts.update(frame_counts)
                    self.state.last_stats_update = now
                self.state.latest_jpeg = jpg.tobytes()
                self.state.frame_id += 1
                if self.state.fps_ema <= 0:
                    self.state.fps_ema = inst_fps
                else:
                    self.state.fps_ema = 0.85 * self.state.fps_ema + 0.15 * inst_fps

            if is_file:
                elapsed = time.perf_counter() - loop_start
                if elapsed < target_delay:
                    time.sleep(target_delay - elapsed)

        if capture_worker.is_alive():
            capture_worker.join(timeout=1)
        with self.state.lock:
            self.state.running = False


class SingleSessionManager:
    def __init__(self, yolo_cls) -> None:
        self.yolo_cls = yolo_cls
        self.lock = threading.Lock()
        self.engines: dict[str, SingleVideoEngine] = {}

    def _get_or_create(self, session_id: str) -> SingleVideoEngine:
        with self.lock:
            engine = self.engines.get(session_id)
            if engine is None:
                engine = SingleVideoEngine(self.yolo_cls)
                self.engines[session_id] = engine
            return engine

    def start(
        self,
        session_id: str,
        source: Union[str, int],
        source_desc: str,
        conf: float,
        iou: float,
        imgsz: int,
        scenario: str,
        uploaded_file: Optional[Path],
    ) -> None:
        engine = self._get_or_create(session_id)
        # 同一个 session 重启前先停旧任务；不影响别的 session
        if engine.status().get("running"):
            engine.stop()
        engine.start(
            source=source,
            source_desc=source_desc,
            conf=conf,
            iou=iou,
            imgsz=imgsz,
            scenario=scenario,
            uploaded_file=uploaded_file,
        )

    def stop(self, session_id: str) -> None:
        with self.lock:
            engine = self.engines.get(session_id)
        if engine is not None:
            engine.stop()

    def stop_all(self) -> None:
        with self.lock:
            engines = list(self.engines.values())
        for engine in engines:
            engine.stop()

    def status(self, session_id: str) -> dict[str, Any]:
        with self.lock:
            engine = self.engines.get(session_id)
        if engine is None:
            return {
                "running": False,
                "video_time": 0.0,
                "source": "",
                "fps": 0,
                "memory_percent": psutil.virtual_memory().percent if HAS_PSUTIL else 0.0,
                "frame_id": -1,
                "uptime_sec": 0,
                "dropped_frames": 0,
                "current_counts": {},
                "total_counts": {},
                "total_objects": 0,
                "settings": {},
                "device": "cuda:0" if torch.cuda.is_available() else "cpu",
                "scenario": "",
                "last_error": "",
            }
        return engine.status()

    def latest_frame_with_id(self, session_id: str) -> Tuple[Optional[bytes], int, bool]:
        with self.lock:
            engine = self.engines.get(session_id)
        if engine is None:
            return None, -1, False
        return engine.latest_frame_with_id()

    def generate_report(self, session_id: str) -> str:
        with self.lock:
            engine = self.engines.get(session_id)
        if engine is None:
            return "# 无人机监控报告\n- 状态: 当前 session 不存在。"
        return engine.generate_report()


class DualVideoEngine:
    def __init__(self, yolo_cls, dual_model_path: Path) -> None:
        if not dual_model_path.exists():
            raise RuntimeError(f"未找到双模态模型文件: {dual_model_path}")
        self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        if self.device.startswith("cuda"):
            torch.backends.cudnn.benchmark = True
            torch.set_float32_matmul_precision("high")
        self.model = yolo_cls(str(dual_model_path))
        self.model.to(self.device)
        self.state = DualVideoState()

    def start(self, rgb_source: str, ir_source: str, source_desc: str,
              conf: float, iou: float, imgsz: int,
              uploaded_rgb: Optional[Path], uploaded_ir: Optional[Path]) -> None:
        with self.state.lock:
            if self.state.running:
                raise RuntimeError("双模态视频检测任务已在运行，请先停止当前任务。")
            self.state.running = True
            self.state.stop_event = threading.Event()
            self.state.latest_jpeg_rgb = None
            self.state.latest_jpeg_ir = None
            self.state.current_counts = Counter()
            self.state.total_counts = Counter()
            self.state.fps_ema = 0.0
            self.state.frame_id = -1
            self.state.last_error = ""
            self.state.dropped_frames = 0
            self.state.started_at = time.time()
            self.state.source_desc = source_desc
            self.state.settings = {"conf": conf, "iou": iou, "imgsz": imgsz}
            self.state.uploaded_rgb = uploaded_rgb
            self.state.uploaded_ir = uploaded_ir
            self.state.video_time = 0.0
            self.state.last_stats_update = time.perf_counter()
            worker = threading.Thread(
                target=self._run_loop,
                args=(rgb_source, ir_source),
                daemon=True
            )
            self.state.worker_thread = worker
            worker.start()

    def stop(self) -> None:
        thread_to_join = None
        uploaded_rgb = None
        uploaded_ir = None
        with self.state.lock:
            if not self.state.running:
                return
            if self.state.stop_event:
                self.state.stop_event.set()
            thread_to_join = self.state.worker_thread
            uploaded_rgb = self.state.uploaded_rgb
            uploaded_ir = self.state.uploaded_ir

        if thread_to_join and thread_to_join.is_alive():
            thread_to_join.join(timeout=4)

        with self.state.lock:
            self.state.running = False
            self.state.worker_thread = None
            self.state.stop_event = None
            self.state.uploaded_rgb = None
            self.state.uploaded_ir = None

        for p in [uploaded_rgb, uploaded_ir]:
            if p and p.exists():
                try:
                    p.unlink()
                except OSError:
                    pass

    def status(self) -> dict[str, Any]:
        with self.state.lock:
            uptime = max(0.0, time.time() - self.state.started_at) if self.state.started_at else 0.0
            mem_pct = psutil.virtual_memory().percent if HAS_PSUTIL else 0.0
            return {
                "running": self.state.running,
                "video_time": self.state.video_time,
                "source": self.state.source_desc,
                "fps": round(self.state.fps_ema, 2),
                "memory_percent": mem_pct,
                "frame_id": self.state.frame_id,
                "uptime_sec": round(uptime, 1),
                "dropped_frames": self.state.dropped_frames,
                "current_counts": _clean_counts(self.state.current_counts, 30),
                "total_counts": _clean_counts(self.state.total_counts, 30),
                "total_objects": int(sum(self.state.current_counts.values())),
                "settings": self.state.settings,
                "device": self.device,
                "last_error": self.state.last_error,
            }

    def latest_pair_with_id(self) -> Tuple[Optional[bytes], Optional[bytes], int, bool]:
        with self.state.lock:
            return (
                self.state.latest_jpeg_rgb,
                self.state.latest_jpeg_ir,
                self.state.frame_id,
                self.state.running,
            )

    def _run_loop(self, rgb_source: str, ir_source: str) -> None:
        cap_rgb = cv2.VideoCapture(rgb_source)
        cap_ir = cv2.VideoCapture(ir_source)

        if not cap_rgb.isOpened():
            with self.state.lock:
                self.state.last_error = "RGB视频源打开失败。"
                self.state.running = False
            return

        if not cap_ir.isOpened():
            with self.state.lock:
                self.state.last_error = "IR视频源打开失败。"
                self.state.running = False
            return

        prev_ts = time.perf_counter()

        while True:
            with self.state.lock:
                stop_event = self.state.stop_event
                cfg = dict(self.state.settings)
                running = self.state.running

            if not running or (stop_event and stop_event.is_set()):
                break

            ok_rgb, frame_rgb = cap_rgb.read()
            ok_ir, frame_ir = cap_ir.read()

            if not ok_rgb or not ok_ir:
                break

            h, w = frame_rgb.shape[:2]
            if frame_ir.shape[:2] != (h, w):
                frame_ir = cv2.resize(frame_ir, (w, h), interpolation=cv2.INTER_LINEAR)

            model_input = _build_multimodal_input(frame_rgb, frame_ir, USE_SIMOTM)

            try:
                result = self.model.predict(
                    model_input,
                    conf=cfg["conf"],
                    iou=cfg["iou"],
                    imgsz=cfg["imgsz"],
                    verbose=False,
                    device=self.device,
                    half=self.device.startswith("cuda"),
                )[0]
            except Exception as e:
                import traceback
                traceback.print_exc()
                with self.state.lock:
                    self.state.last_error = f"双模态推理失败: {repr(e)}"
                    self.state.running = False
                break

            counts = Counter()
            annotated_rgb = frame_rgb.copy()
            annotated_ir = frame_ir.copy()

            if result.boxes is not None and len(result.boxes) > 0:
                names = self.model.names
                for box, cls_id, conf in zip(
                    result.boxes.xyxy.cpu().numpy(),
                    result.boxes.cls.cpu().numpy(),
                    result.boxes.conf.cpu().numpy(),
                ):
                    cls_name = names.get(int(cls_id), str(int(cls_id)))
                    counts[cls_name] += 1

                    x1, y1, x2, y2 = map(int, box)
                    label = f"{cls_name} {conf:.2f}"

                    cv2.rectangle(annotated_rgb, (x1, y1), (x2, y2), (0, 255, 0), 2)
                    cv2.putText(annotated_rgb, label, (x1, max(20, y1 - 5)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

                    cv2.rectangle(annotated_ir, (x1, y1), (x2, y2), (0, 255, 0), 2)
                    cv2.putText(annotated_ir, label, (x1, max(20, y1 - 5)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

            ok1, jpg_rgb = cv2.imencode(".jpg", annotated_rgb, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
            ok2, jpg_ir = cv2.imencode(".jpg", annotated_ir, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
            if not ok1 or not ok2:
                continue

            now = time.perf_counter()
            delta = max(1e-6, now - prev_ts)
            prev_ts = now
            inst_fps = 1.0 / delta

            with self.state.lock:
                self.state.current_counts = counts
                if now - self.state.last_stats_update >= 3.0:
                    self.state.total_counts.update(counts)
                    self.state.last_stats_update = now
                self.state.latest_jpeg_rgb = jpg_rgb.tobytes()
                self.state.latest_jpeg_ir = jpg_ir.tobytes()
                self.state.frame_id += 1
                if self.state.fps_ema <= 0:
                    self.state.fps_ema = inst_fps
                else:
                    self.state.fps_ema = 0.85 * self.state.fps_ema + 0.15 * inst_fps

        cap_rgb.release()
        cap_ir.release()
        with self.state.lock:
            self.state.running = False
    
class DualVideoSessionManager:
    def __init__(self, yolo_cls, dual_model_path: Path) -> None:
        self.yolo_cls = yolo_cls
        self.dual_model_path = dual_model_path
        self.lock = threading.Lock()
        self.engines: dict[str, DualVideoEngine] = {}

    def _get_or_create(self, session_id: str) -> DualVideoEngine:
        with self.lock:
            engine = self.engines.get(session_id)
            if engine is None:
                engine = DualVideoEngine(self.yolo_cls, self.dual_model_path)
                self.engines[session_id] = engine
            return engine

    def start(self, session_id: str, rgb_source: str, ir_source: str,
              source_desc: str, conf: float, iou: float, imgsz: int,
              uploaded_rgb: Optional[Path], uploaded_ir: Optional[Path]) -> None:
        engine = self._get_or_create(session_id)
        if engine.status().get("running"):
            engine.stop()
        engine.start(rgb_source, ir_source, source_desc, conf, iou, imgsz, uploaded_rgb, uploaded_ir)

    def stop(self, session_id: str) -> None:
        with self.lock:
            engine = self.engines.get(session_id)
        if engine is not None:
            engine.stop()

    def status(self, session_id: str) -> dict[str, Any]:
        with self.lock:
            engine = self.engines.get(session_id)
        if engine is None:
            return {
                "running": False,
                "video_time": 0.0,
                "source": "",
                "fps": 0,
                "memory_percent": psutil.virtual_memory().percent if HAS_PSUTIL else 0.0,
                "frame_id": -1,
                "uptime_sec": 0,
                "dropped_frames": 0,
                "current_counts": {},
                "total_counts": {},
                "total_objects": 0,
                "settings": {},
                "device": "cuda:0" if torch.cuda.is_available() else "cpu",
                "last_error": "",
            }
        return engine.status()

    def latest_pair_with_id(self, session_id: str):
        with self.lock:
            engine = self.engines.get(session_id)
        if engine is None:
            return None, None, -1, False
        return engine.latest_pair_with_id()

class SingleImageEngine:
    def __init__(self, yolo_cls) -> None:
        if not SINGLE_MODEL_PATH.exists():
            raise RuntimeError(f"未找到单模态模型文件: {SINGLE_MODEL_PATH}")
        self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        if self.device.startswith("cuda"):
            torch.backends.cudnn.benchmark = True
            torch.set_float32_matmul_precision("high")
        self.model = yolo_cls(str(SINGLE_MODEL_PATH))
        self.model.to(self.device)

    def process_image(self, image_file: UploadFile) -> dict[str, Any]:
        start_time = time.perf_counter()
        rgb_img = _read_upload_to_bgr(image_file)
        height, width = rgb_img.shape[:2]

        results = self.model.predict(
            rgb_img,
            conf=0.35,
            iou=0.45,
            device=self.device,
            half=self.device.startswith("cuda"),
            verbose=False,
        )
        result = results[0]

        counts = Counter()
        if result.boxes is not None and len(result.boxes) > 0:
            for cls_id in result.boxes.cls.tolist():
                cls_name = self.model.names.get(int(cls_id), str(int(cls_id)))
                counts[cls_name] += 1

        annotated = rgb_img.copy()
        if result.boxes is not None and len(result.boxes) > 0:
            names = self.model.names
            for box, cls_id, conf in zip(
                result.boxes.xyxy.cpu().numpy(),
                result.boxes.cls.cpu().numpy(),
                result.boxes.conf.cpu().numpy()
            ):
                x1, y1, x2, y2 = map(int, box)
                cls_name = names.get(int(cls_id), str(int(cls_id)))
                label = f"{cls_name} {conf:.2f}"
                cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.putText(annotated, label, (x1, max(20, y1 - 5)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

        ok, jpg = cv2.imencode(".jpg", annotated)
        if not ok:
            raise HTTPException(status_code=500, detail="结果图片编码失败")

        infer_time_ms = int((time.perf_counter() - start_time) * 1000)
        return {
            "ok": True,
            "modality_mode": "single",
            "resolution": f"{width}x{height}",
            "total_objects": int(sum(counts.values())),
            "infer_time_ms": infer_time_ms,
            "counts": dict(counts),
            "annotated_image_b64": base64.b64encode(jpg.tobytes()).decode("utf-8"),
        }

class DualImageEngine:
    def __init__(self, yolo_cls, dual_model_path: Path) -> None:
        if not dual_model_path.exists():
            raise RuntimeError(f"未找到双模态模型文件: {dual_model_path}")
        self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        if self.device.startswith("cuda"):
            torch.backends.cudnn.benchmark = True
            torch.set_float32_matmul_precision("high")
        self.model = yolo_cls(str(dual_model_path))
        self.model.to(self.device)

    def process_image(self, image_file: UploadFile, image_file_ir: UploadFile) -> dict[str, Any]:
        start_time = time.perf_counter()
        rgb_img = _read_upload_to_bgr(image_file)
        ir_img = _read_upload_to_bgr(image_file_ir)
        model_input = _build_multimodal_input(rgb_img, ir_img, USE_SIMOTM)
        height, width = rgb_img.shape[:2]
        results = self.model.predict(
            model_input,
            conf=0.35,
            iou=0.45,
            device=self.device,
            half=self.device.startswith("cuda"),
            verbose=False,
        )
        result = results[0]
        counts = Counter()
        if result.boxes is not None and len(result.boxes) > 0:
            for cls_id in result.boxes.cls.tolist():
                cls_name = self.model.names.get(int(cls_id), str(int(cls_id)))
                counts[cls_name] += 1

        annotated = rgb_img.copy()
        annotated_ir = ir_img.copy()
        if result.boxes is not None and len(result.boxes) > 0:
            names = self.model.names
            for box, cls_id, conf in zip(result.boxes.xyxy.cpu().numpy(), result.boxes.cls.cpu().numpy(), result.boxes.conf.cpu().numpy()):
                x1, y1, x2, y2 = map(int, box)
                cls_name = names.get(int(cls_id), str(int(cls_id)))
                label = f"{cls_name} {conf:.2f}"
                cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.putText(annotated, label, (x1, max(20, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
                cv2.rectangle(annotated_ir, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.putText(annotated_ir, label, (x1, max(20, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

        ok, jpg = cv2.imencode(".jpg", annotated)
        ok_ir, jpg_ir = cv2.imencode(".jpg", annotated_ir)
        if not ok or not ok_ir:
            raise HTTPException(status_code=500, detail="结果图片编码失败")
        infer_time_ms = int((time.perf_counter() - start_time) * 1000)
        return {
            "ok": True,
            "resolution": f"{width}x{height}",
            "total_objects": int(sum(counts.values())),
            "infer_time_ms": infer_time_ms,
            "counts": dict(counts),
            "annotated_image_b64": base64.b64encode(jpg.tobytes()).decode("utf-8"),
            "annotated_image_ir_b64": base64.b64encode(jpg_ir.tobytes()).decode("utf-8"),
        }

def import_single_yolo_class():
    dual_repo = os.getenv("DUAL_YOLO_REPO", str(DEFAULT_DUAL_REPO))
    sys.path = [p for p in sys.path if Path(p).resolve() != Path(dual_repo).resolve()]
    if "ultralytics" in sys.modules:
        del sys.modules["ultralytics"]
    import ultralytics as ul  # type: ignore
    return ul.YOLO


def import_dual_yolo_class():
    dual_repo = Path(os.getenv("DUAL_YOLO_REPO", str(DEFAULT_DUAL_REPO))).resolve()
    if str(dual_repo) not in sys.path:
        sys.path.insert(0, str(dual_repo))
    if "ultralytics" in sys.modules:
        del sys.modules["ultralytics"]
    spec = importlib.util.find_spec("ultralytics")
    if spec is None:
        raise RuntimeError(f"未找到双模态 ultralytics 仓库: {dual_repo}")
    ul = importlib.import_module("ultralytics")
    return ul.YOLO


def create_common_app(title: str) -> FastAPI:
    app = FastAPI(title=title, version="2.0.0")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    return app


def create_gateway_app() -> FastAPI:
    app = create_common_app("Drone YOLO Gateway")

    for folder in ["css", "js", "fonts", "icomoon", "images", "data", "backend"]:
        folder_path = WEB_DIR / folder
        if folder_path.exists():
            app.mount(f"/{folder}", StaticFiles(directory=folder_path), name=folder)

    @app.get("/")
    def serve_index() -> FileResponse:
        page = WEB_DIR / "login.html"
        if not page.exists():
            raise HTTPException(status_code=404, detail="根目录下的 login.html 不存在。")
        return FileResponse(page)

    @app.get("/{filename}.html")
    def serve_html_pages(filename: str) -> FileResponse:
        page = WEB_DIR / f"{filename}.html"
        if not page.exists():
            raise HTTPException(status_code=404, detail=f"{filename}.html 不存在。")
        return FileResponse(page)
    
    @app.get("/logo.png")
    def serve_logo() -> FileResponse:
        logo_path = WEB_DIR / "logo.png"
        if not logo_path.exists():
            raise HTTPException(status_code=404, detail="logo.png 不存在。")
        return FileResponse(logo_path)

    @app.post("/api/auth/register")
    def api_register(req: AuthRequest):
        if not req.username or not req.password:
            return JSONResponse({"code": 400, "message": "用户名或密码不能为空"}, status_code=400)
        db = load_users()
        if req.username in db:
            return JSONResponse({"code": 400, "message": "注册失败，用户名已存在！"}, status_code=400)
        db[req.username] = req.password
        save_users(db)
        return {"code": 200, "message": "注册成功"}

    @app.post("/api/auth/login")
    def api_login(req: AuthRequest):
        db = load_users()
        if req.username not in db or db[req.username] != req.password:
            return JSONResponse({"code": 401, "message": "登录失败，请检查账号密码！"}, status_code=401)
        return {
            "code": 200,
            "data": {
                "accessToken": f"mock-token-for-{req.username}",
                "userInfo": {"username": req.username, "role": "admin" if req.username == "admin" else "user"},
            },
        }

    def _proxy_json(method: str, url: str, **kwargs) -> Response:
        try:
            resp = requests.request(method, url, timeout=300, **kwargs)
        except requests.RequestException as exc:
            return JSONResponse({"ok": False, "detail": f"后端服务不可用: {exc}"}, status_code=502)
        content_type = resp.headers.get("content-type", "application/json")
        return Response(content=resp.content, status_code=resp.status_code, media_type=content_type)

    def _build_files_for_proxy(file: Optional[UploadFile], field_name: str):
        if file is None:
            return None
        data = file.file.read()
        file.file.seek(0)
        return (field_name, (file.filename or field_name, data, file.content_type or "application/octet-stream"))

    @app.get("/api/health")
    def gateway_health() -> dict[str, Any]:
        health = {"ok": True, "gateway": True}
        try:
            health["single"] = requests.get(f"{SINGLE_BACKEND_BASE}/api/health", timeout=5).json()
        except Exception as exc:
            health["single"] = {"ok": False, "detail": str(exc)}
        try:
            health["dual"] = requests.get(f"{DUAL_BACKEND_BASE}/api/health", timeout=5).json()
        except Exception as exc:
            health["dual"] = {"ok": False, "detail": str(exc)}
        return health

    @app.post("/api/session/start")
    async def gateway_start_session(
        session_id: str = Form(...),
        source_type: str = Form("webcam"),
        rtsp_url: Optional[str] = Form(None),
        conf: float = Form(0.35),
        iou: float = Form(0.45),
        imgsz: int = Form(640),
        scenario: str = Form("traffic"),
        modality_mode: str = Form("single"),
        video_file: Optional[UploadFile] = File(None),
        video_file_ir: Optional[UploadFile] = File(None),
    ):
        files = []
        if video_file is not None:
            item = _build_files_for_proxy(video_file, "video_file")
            if item:
                files.append(item)
        
        if modality_mode == "dual" and video_file_ir is not None:
            item = _build_files_for_proxy(video_file_ir, "video_file_ir")
            if item:
                files.append(item)
        
        data = {
            "session_id": session_id,
            "source_type": source_type,
            "rtsp_url": rtsp_url or "",
            "conf": str(conf),
            "iou": str(iou),
            "imgsz": str(imgsz),
            "scenario": scenario,
            "modality_mode": modality_mode,
        }
        
        if modality_mode == "dual":
            return _proxy_json("POST", f"{DUAL_BACKEND_BASE}/api/session/start_video_dual", data=data, files=files or None)
        
        return _proxy_json("POST", f"{SINGLE_BACKEND_BASE}/api/session/start", data=data, files=files or None)

    @app.post("/api/session/stop")
    def gateway_stop_session(session_id: str = Form(...)):
        return _proxy_json("POST", f"{SINGLE_BACKEND_BASE}/api/session/stop", data={"session_id": session_id})

    @app.get("/api/session/status")
    def gateway_session_status(session_id: str):
        return _proxy_json("GET", f"{SINGLE_BACKEND_BASE}/api/session/status", params={"session_id": session_id})

    @app.get("/api/session/frame")
    def gateway_session_frame(session_id: str):
        return _proxy_json("GET", f"{SINGLE_BACKEND_BASE}/api/session/frame", params={"session_id": session_id})

    @app.get("/api/session/stream")
    def gateway_session_stream(session_id: str):
        try:
            upstream = requests.get(
                f"{SINGLE_BACKEND_BASE}/api/session/stream",
                params={"session_id": session_id},
                stream=True,
                timeout=(5, 3600),
            )
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"单模态后端不可用: {exc}")

        def generate():
            try:
                for chunk in upstream.iter_content(chunk_size=8192):
                    if chunk:
                        yield chunk
            finally:
                upstream.close()

        return StreamingResponse(generate(), media_type=upstream.headers.get("content-type", "multipart/x-mixed-replace; boundary=frame"))

    @app.post("/api/report/generate")
    def gateway_generate_report():
        return _proxy_json("POST", f"{SINGLE_BACKEND_BASE}/api/report/generate")

    @app.post("/api/session/stop_video_dual")
    def gateway_stop_video_dual(session_id: str = Form(...)):
        return _proxy_json("POST", f"{DUAL_BACKEND_BASE}/api/session/stop_video_dual", data={"session_id": session_id})
    
    @app.get("/api/session/status_video_dual")
    def gateway_status_video_dual(session_id: str):
        return _proxy_json("GET", f"{DUAL_BACKEND_BASE}/api/session/status_video_dual", params={"session_id": session_id})
    
    @app.get("/api/session/frame_pair_dual")
    def gateway_frame_pair_dual(session_id: str):
        return _proxy_json("GET", f"{DUAL_BACKEND_BASE}/api/session/frame_pair_dual", params={"session_id": session_id})

    @app.post("/api/session/image")
    async def gateway_process_image(
        image_file: UploadFile = File(...),
        image_file_ir: Optional[UploadFile] = File(None),
        modality_mode: str = Form("single"),
    ):
        files = []
        item = _build_files_for_proxy(image_file, "image_file")
        if item:
            files.append(item)
    
        if modality_mode == "single":
            return _proxy_json(
                "POST",
                f"{SINGLE_BACKEND_BASE}/api/session/image_single",
                files=files
            )
    
        if modality_mode == "dual":
            if image_file_ir is None:
                return JSONResponse({"ok": False, "detail": "双模态检测需要同时上传红外图片。"}, status_code=400)
            item = _build_files_for_proxy(image_file_ir, "image_file_ir")
            if item:
                files.append(item)
            return _proxy_json(
                "POST",
                f"{DUAL_BACKEND_BASE}/api/session/image",
                data={"modality_mode": "dual"},
                files=files
            )
    
        return JSONResponse({"ok": False, "detail": "modality_mode 只能是 single 或 dual。"}, status_code=400)

    @app.post("/api/chat/qwen")
    async def gateway_chat_qwen(
        text: str = Form(""),
        image: Optional[UploadFile] = File(None),
        image_ir: Optional[UploadFile] = File(None),
    ):
        files = []
        if image is not None:
            item = _build_files_for_proxy(image, "image")
            if item:
                files.append(item)
        if image_ir is not None:
            item = _build_files_for_proxy(image_ir, "image_ir")
            if item:
                files.append(item)
        data = {"text": text}
        return _proxy_json("POST", f"{DUAL_BACKEND_BASE}/api/chat/qwen", data=data, files=files or None)

    return app


def create_single_backend_app() -> FastAPI:
    yolo_cls = import_single_yolo_class()
    manager = SingleSessionManager(yolo_cls)
    single_image_engine = SingleImageEngine(yolo_cls)
    app = create_common_app("Drone YOLO Single Backend")

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {
            "ok": True,
            "backend": "single",
            "model_path": str(SINGLE_MODEL_PATH),
            "device": "cuda:0" if torch.cuda.is_available() else "cpu",
        }

    @app.post("/api/session/start")
    async def start_session(
        session_id: str = Form(...),
        source_type: str = Form("webcam"),
        rtsp_url: Optional[str] = Form(None),
        conf: float = Form(0.35),
        iou: float = Form(0.45),
        imgsz: int = Form(640),
        scenario: str = Form("traffic"),
        video_file: Optional[UploadFile] = File(None),
    ) -> dict[str, Any]:
        if conf <= 0 or conf >= 1:
            raise HTTPException(status_code=400, detail="conf 建议在 (0,1) 范围内。")
        if iou <= 0 or iou >= 1:
            raise HTTPException(status_code=400, detail="iou 建议在 (0,1) 范围内。")
        if imgsz < 320 or imgsz > 1280:
            raise HTTPException(status_code=400, detail="imgsz 范围建议 320-1280。")
        source: Union[str, int]
        source_desc = ""
        uploaded_path: Optional[Path] = None

        if source_type == "webcam":
            source = 0
            source_desc = "本机摄像头"
        elif source_type == "rtsp":
            if not rtsp_url:
                raise HTTPException(status_code=400, detail="RTSP 需要 rtsp_url。")
            source = rtsp_url
            source_desc = f"RTSP: {rtsp_url}"
        elif source_type == "file":
            if not video_file:
                raise HTTPException(status_code=400, detail="文件模式需要上传视频。")
            suffix = Path(video_file.filename or "upload.mp4").suffix or ".mp4"
            uploaded_path = UPLOAD_DIR / f"{uuid.uuid4().hex}_single{suffix}"
            with uploaded_path.open("wb") as f:
                while True:
                    chunk = await video_file.read(1024 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
            source = str(uploaded_path)
            source_desc = f"单模态视频文件: {video_file.filename}"
        else:
            raise HTTPException(status_code=400, detail="source_type 必须是 webcam/rtsp/file。")

        try:
            manager.start(
                session_id=session_id,
                source=source,
                source_desc=source_desc,
                conf=conf,
                iou=iou,
                imgsz=imgsz,
                scenario=scenario,
                uploaded_file=uploaded_path,
            )
            return {"ok": True, "message": "单模态检测已启动", "source": source_desc, "session_id": session_id}
        except RuntimeError as exc:
            if uploaded_path and uploaded_path.exists():
                try:
                    uploaded_path.unlink()
                except OSError:
                    pass
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        
    @app.post("/api/session/image_single")
    async def process_single_image(
        image_file: UploadFile = File(...),
    ) -> dict[str, Any]:
        return single_image_engine.process_image(image_file)

    @app.post("/api/session/stop")
    def stop_session(session_id: str = Form(...)) -> dict[str, Any]:
        manager.stop(session_id)
        return {"ok": True, "message": "检测已停止"}

    @app.get("/api/session/status")
    def session_status(session_id: str) -> dict[str, Any]:
        return manager.status(session_id)

    @app.get("/api/session/frame")
    def session_frame(session_id: str) -> Response:
        jpg, _, _ = manager.latest_frame_with_id(session_id)
        if not jpg:
            return Response(status_code=204)
        return Response(content=jpg, media_type="image/jpeg")

    @app.get("/api/session/stream")
    def session_stream(session_id: str) -> StreamingResponse:
        boundary = b"--frame\r\n"

        def generate():
            last_id = -1
            while True:
                jpg, frame_id, running = manager.latest_frame_with_id(session_id)
                if not jpg:
                    if not running:
                        break
                    time.sleep(0.008)
                    continue
                if frame_id == last_id:
                    if not running:
                        break
                    time.sleep(0.008)
                    continue
                last_id = frame_id
                yield boundary + b"Content-Type: image/jpeg\r\n" + f"Content-Length: {len(jpg)}\r\n\r\n".encode("utf-8") + jpg + b"\r\n"

        return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame", headers={"Cache-Control": "no-cache"})

    @app.post("/api/report/generate")
    def generate_report(session_id: str = Form(...)) -> JSONResponse:
        return JSONResponse({"ok": True, "report": manager.generate_report(session_id)})

    return app


def create_dual_backend_app() -> FastAPI:
    dual_yolo_cls = import_dual_yolo_class()
    dual_model_path = Path(os.getenv("YOLO_MODEL_PATH", str(DEFAULT_DUAL_MODEL_PATH))).resolve()
    dual_image_engine = DualImageEngine(dual_yolo_cls, dual_model_path)
    dual_video_manager = DualVideoSessionManager(dual_yolo_cls, dual_model_path)

    app = create_common_app("Drone YOLO Dual Backend")

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {
            "ok": True,
            "backend": "dual",
            "model_path": str(dual_model_path),
            "device": dual_image_engine.device,
            "use_simotm": USE_SIMOTM
        }
    
    @app.post("/api/session/start_video_dual")
    async def start_video_dual(
        session_id: str = Form(...),
        conf: float = Form(0.35),
        iou: float = Form(0.45),
        imgsz: int = Form(640),
        video_file: UploadFile = File(...),
        video_file_ir: UploadFile = File(...),
    ):
        suffix_rgb = Path(video_file.filename or "upload_rgb.mp4").suffix or ".mp4"
        uploaded_rgb = UPLOAD_DIR / f"{uuid.uuid4().hex}_rgb{suffix_rgb}"
        with uploaded_rgb.open("wb") as f:
            while True:
                chunk = await video_file.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)
    
        suffix_ir = Path(video_file_ir.filename or "upload_ir.mp4").suffix or ".mp4"
        uploaded_ir = UPLOAD_DIR / f"{uuid.uuid4().hex}_ir{suffix_ir}"
        with uploaded_ir.open("wb") as f:
            while True:
                chunk = await video_file_ir.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)
    
        dual_video_manager.start(
            session_id=session_id,
            rgb_source=str(uploaded_rgb),
            ir_source=str(uploaded_ir),
            source_desc=f"双模态视频文件: {video_file.filename} + {video_file_ir.filename}",
            conf=conf,
            iou=iou,
            imgsz=imgsz,
            uploaded_rgb=uploaded_rgb,
            uploaded_ir=uploaded_ir,
        )
        return {"ok": True, "message": "双模态视频检测已启动", "session_id": session_id}
    
    @app.post("/api/session/stop_video_dual")
    def stop_video_dual(session_id: str = Form(...)):
        dual_video_manager.stop(session_id)
        return {"ok": True, "message": "双模态视频检测已停止"}
    
    @app.get("/api/session/status_video_dual")
    def status_video_dual(session_id: str):
        return dual_video_manager.status(session_id)
    
    @app.get("/api/session/frame_pair_dual")
    def frame_pair_dual(session_id: str):
        rgb_jpg, ir_jpg, frame_id, running = dual_video_manager.latest_pair_with_id(session_id)
        if rgb_jpg is None or ir_jpg is None:
            return {"ok": True, "running": running, "frame_id": frame_id, "rgb_b64": None, "ir_b64": None}
    
        return {
            "ok": True,
            "running": running,
            "frame_id": frame_id,
            "rgb_b64": base64.b64encode(rgb_jpg).decode("utf-8"),
            "ir_b64": base64.b64encode(ir_jpg).decode("utf-8"),
        }

    @app.post("/api/session/image")
    async def process_image(
        image_file: UploadFile = File(...),
        image_file_ir: UploadFile = File(...),
        modality_mode: str = Form("dual"),
    ) -> dict[str, Any]:
        if modality_mode != "dual":
            raise HTTPException(status_code=400, detail="双模态图片接口仅支持 dual 模式。")
        return dual_image_engine.process_image(image_file, image_file_ir)

    @app.post("/api/chat/qwen")
    async def chat_with_qwen(text: str = Form(""), image: UploadFile = File(None), image_ir: UploadFile = File(None)):
        text = (text or "").strip()
        img_b64 = None
        yolo_result_text = ""
        annotated_image_url = None
        generated_image_url = None
        user_image_url = None
        user_image_url_ir = None
        counts: dict[str, int] = {}

        if image:
            uid = uuid.uuid4().hex
            img_bytes = await image.read()
            orig_filename = f"chat_orig_rgb_{uid}.jpg"
            orig_filepath = UPLOAD_DIR / orig_filename
            with open(orig_filepath, "wb") as f:
                f.write(img_bytes)
            user_image_url = f"/backend/uploads/{orig_filename}"
            img_cv = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
            if img_cv is None:
                raise HTTPException(status_code=400, detail="无法读取上传图片")

            if image_ir is not None:
                ir_bytes = await image_ir.read()
                orig_filename_ir = f"chat_orig_ir_{uid}.jpg"
                orig_filepath_ir = UPLOAD_DIR / orig_filename_ir
                with open(orig_filepath_ir, "wb") as f:
                    f.write(ir_bytes)
                user_image_url_ir = f"/backend/uploads/{orig_filename_ir}"
                ir_cv = cv2.imdecode(np.frombuffer(ir_bytes, np.uint8), cv2.IMREAD_COLOR)
                if ir_cv is None:
                    raise HTTPException(status_code=400, detail="无法读取红外图片")
                model_input = _build_multimodal_input(img_cv, ir_cv, USE_SIMOTM)
            else:
                model_input = img_cv

            results = dual_image_engine.model.predict(model_input, conf=0.35, iou=0.45, device=dual_image_engine.device, half=dual_image_engine.device.startswith("cuda"), verbose=False)
            annotated = img_cv.copy()
            result = results[0]
            if result.boxes is not None and len(result.boxes) > 0:
                names = dual_image_engine.model.names
                for box, cls_id, conf in zip(result.boxes.xyxy.cpu().numpy(), result.boxes.cls.cpu().numpy(), result.boxes.conf.cpu().numpy()):
                    cls_name = names.get(int(cls_id), str(int(cls_id)))
                    counts[cls_name] = counts.get(cls_name, 0) + 1
                    x1, y1, x2, y2 = map(int, box)
                    label = f"{cls_name} {conf:.2f}"
                    cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 0), 2)
                    cv2.putText(annotated, label, (x1, max(20, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

            yolo_result_text = "【本地YOLO检测结果】" + (_format_detection_summary(counts) if counts else "未检测到明显目标。")
            anno_filename = f"chat_anno_{uid}.jpg"
            anno_filepath = UPLOAD_DIR / anno_filename
            cv2.imwrite(str(anno_filepath), annotated)
            annotated_image_url = f"/backend/uploads/{anno_filename}"
            img_b64 = _compress_image_for_qwen(annotated)

        qwen_api_key = os.getenv("QWEN_API_KEY", "").strip()
        local_reply = _build_local_scene_reply(text, counts)
        if _is_invalid_qwen_key(qwen_api_key):
            return {
                "reply": local_reply + "\n\n系统提示：请在项目根目录 .env 文件中配置有效的 QWEN_API_KEY。",
                "user_image_url": user_image_url,
                "user_image_url_ir": user_image_url_ir,
                "annotated_image_url": annotated_image_url,
                "generated_image_url": generated_image_url,
            }

        qwen_base_url = os.getenv("QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1").rstrip("/")
        qwen_text_model = os.getenv("QWEN_TEXT_MODEL", "qwen-plus").strip() or "qwen-plus"
        qwen_vision_model = os.getenv("QWEN_VISION_MODEL", os.getenv("QWEN_MODEL", "qwen-vl-plus")).strip() or "qwen-vl-plus"
        qwen_timeout_sec = float(os.getenv("QWEN_TIMEOUT_SEC", "18") or "18")
        qwen_image_edit_model = os.getenv("QWEN_IMAGE_EDIT_MODEL", "qwen-image-2.0").strip() or "qwen-image-2.0"

        if _is_model_identity_query(text) and not image:
            return {
                "reply": (
                    "是的，当前问答后端配置的是 Qwen API。\n"
                    f"纯文本默认模型：`{qwen_text_model}`。\n"
                    f"图片问答默认模型：`{qwen_vision_model}`。\n"
                    f"图片编辑默认模型：`{qwen_image_edit_model}`。"
                ),
                "user_image_url": user_image_url,
                "user_image_url_ir": user_image_url_ir,
                "annotated_image_url": annotated_image_url,
                "generated_image_url": generated_image_url,
            }

        headers = {"Authorization": f"Bearer {qwen_api_key}", "Content-Type": "application/json"}
        if image and _is_image_generation_request(text):
            image_edit_payload = {
                "model": qwen_image_edit_model,
                "input": {"messages": [{"role": "user", "content": [{"image": f"data:image/jpeg;base64,{img_b64}"}, {"text": _build_qwen_image_prompt(text)}]}]},
                "parameters": {
                    "n": 1,
                    "watermark": False,
                    "negative_prompt": "cartoon, fake thermal overlay, text watermark, distorted vehicle, extra objects",
                    "prompt_extend": True,
                },
            }
            try:
                image_edit_resp = requests.post("https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation", json=image_edit_payload, headers=headers, timeout=(10, 120))
                image_edit_resp.raise_for_status()
                image_edit_data = image_edit_resp.json()
                remote_image_url = image_edit_data["output"]["choices"][0]["message"]["content"][0]["image"]
                generated_filename = f"chat_gen_{uuid.uuid4().hex}.png"
                generated_filepath = UPLOAD_DIR / generated_filename
                _download_remote_image(remote_image_url, generated_filepath)
                generated_image_url = f"/backend/uploads/{generated_filename}"
                return {
                    "reply": "已调用 Qwen 图像编辑模型完成出图，下面是生成结果。",
                    "user_image_url": user_image_url,
                    "user_image_url_ir": user_image_url_ir,
                    "annotated_image_url": annotated_image_url,
                    "generated_image_url": generated_image_url,
                }
            except requests.HTTPError as exc:
                status_code = exc.response.status_code if exc.response is not None else "unknown"
                return {
                    "reply": f"Qwen 图像编辑调用失败，HTTP {status_code}。当前已取消本地伪生成，不再返回假图。",
                    "user_image_url": user_image_url,
                    "user_image_url_ir": user_image_url_ir,
                    "annotated_image_url": annotated_image_url,
                    "generated_image_url": None,
                }
            except Exception as exc:
                return {
                    "reply": f"Qwen 图像编辑调用异常：{str(exc)}。当前已取消本地伪生成，不再返回假图。",
                    "user_image_url": user_image_url,
                    "user_image_url_ir": user_image_url_ir,
                    "annotated_image_url": annotated_image_url,
                    "generated_image_url": None,
                }

        scene_focus = _infer_scene_focus(text, counts)
        system_prompt = (
            "你是无人机巡检与视频监控助手。请先在内部完成必要分析，但不要输出推理过程。"
            "回答必须聚焦当前任务场景，优先给结论，不要寒暄，不要泛泛解释。"
            "请控制在3段以内，每段1句，尽量短。"
            "优先回答交通流量、拥堵程度、人员聚集、异常风险和处置建议。"
            "如果证据不足，要明确写‘仅基于当前画面’或‘当前信息不足’。"
            "禁止编造不存在的画面细节、YOLO结果、系统元数据或接口状态。"
        )
        messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": []}]
        model_name = qwen_text_model
        if img_b64:
            model_name = qwen_vision_model
            messages[1]["content"].append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}})
        user_task = text or "请分析当前画面，并给出最关键的任务结论。"
        user_prompt = f"当前任务场景：{scene_focus}。\n用户问题：{user_task}\n"
        if img_b64:
            user_prompt += f"{yolo_result_text}\n输出要求：\n1. 先给结论。\n2. 再给1句依据，可结合YOLO结果。\n3. 如有必要，再给1句建议。\n4. 不要输出思维链，不要铺垫，不要客套。"
        else:
            user_prompt += "当前没有图片，也没有YOLO检测结果。\n输出要求：\n1. 只根据用户文字回答。\n2. 如果信息不足，直接说明，不要脑补监控细节。\n3. 回答保持简短。"
        messages[1]["content"].append({"type": "text", "text": user_prompt})
        payload = {"model": model_name, "messages": messages, "temperature": 0.2, "max_tokens": 220, "top_p": 0.8}
        try:
            resp = requests.post(f"{qwen_base_url}/chat/completions", json=payload, headers=headers, timeout=(5, qwen_timeout_sec))
            resp.raise_for_status()
            reply = _extract_qwen_reply(resp.json()) or local_reply
        except requests.Timeout:
            reply = local_reply + "\n\n系统提示：Qwen 响应超时，已先返回本地快速分析结果。"
        except requests.HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else "unknown"
            if status_code == 401:
                reply = local_reply + "\n\n系统提示：Qwen API Key 校验失败，请检查 QWEN_API_KEY 是否有效且已开通模型调用权限。"
            else:
                reply = local_reply + f"\n\n系统提示：Qwen 服务调用失败，HTTP {status_code}。"
        except Exception as exc:
            reply = local_reply + f"\n\n系统提示：Qwen 调用异常，已回退到本地分析。{str(exc)}"

        return {
            "reply": reply,
            "user_image_url": user_image_url,
            "user_image_url_ir": user_image_url_ir,
            "annotated_image_url": annotated_image_url,
            "generated_image_url": generated_image_url,
        }

    return app


def launch_workers(host: str, single_port: int, dual_port: int) -> list[subprocess.Popen]:
    env_single = os.environ.copy()
    env_single["PYTHONPATH"] = env_single.get("PYTHONPATH", "")
    env_dual = os.environ.copy()
    env_dual["DUAL_YOLO_REPO"] = env_dual.get("DUAL_YOLO_REPO", str(DEFAULT_DUAL_REPO))
    children = [
        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--role", "single", "--host", host, "--port", str(single_port)], env=env_single),
        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--role", "dual", "--host", host, "--port", str(dual_port)], env=env_dual),
    ]
    return children


def terminate_children(children: list[subprocess.Popen]) -> None:
    for child in children:
        if child.poll() is None:
            child.terminate()
    for child in children:
        if child.poll() is None:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Split single/dual backend launcher")
    parser.add_argument("--role", choices=["all", "gateway", "single", "dual"], default="all")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=GATEWAY_PORT)
    parser.add_argument("--single-port", type=int, default=SINGLE_BACKEND_PORT)
    parser.add_argument("--dual-port", type=int, default=DUAL_BACKEND_PORT)
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    if args.role == "single":
        uvicorn.run(create_single_backend_app(), host=args.host, port=args.port)
    elif args.role == "dual":
        uvicorn.run(create_dual_backend_app(), host=args.host, port=args.port)
    elif args.role == "gateway":
        uvicorn.run(create_gateway_app(), host=args.host, port=args.port)
    else:
        children = launch_workers(args.host, args.single_port, args.dual_port)
        atexit.register(lambda: terminate_children(children))
        try:
            uvicorn.run(create_gateway_app(), host=args.host, port=args.port)
        finally:
            terminate_children(children)
