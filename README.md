# 项目部署与启动指南

本指南将帮助您从零开始配置**深瞳锐巡系统**的运行环境，并顺利启动本地服务。

## 0. 代码文件构成

**深瞳锐巡系统**的代码构成如下：

- **核心检测算法**代码放在 `algorithm`  中
- **Web前端**代码放在 `web/frontend`  中，包括了HTML、CSS、JS、icomoon等格式的文件
- **Web后端**代码放在 `web/frontend/backend` 中 

## 1. 配置环境

接下来请按照以下步骤依次进行操作：

在开始之前，请确保您的计算机上已经安装了 Anaconda 或 Miniconda。本项目建议使用 Python 3.11，并且依赖于兼容 CUDA 11.8 的 PyTorch。

请打开 Anaconda Prompt ，依次执行以下命令：

```powershell
# 1. 创建虚拟环境，Python 版本为 3.11
conda create -n your_env_name python=3.11 -y

# 2. 激活虚拟环境
conda activate your_env_name

# 3. 安装 PyTorch 2.2.2 及相关库 (CUDA 11.8)
pip install torch==2.2.2 torchvision==0.17.2 torchaudio==2.2.2 --index-url https://download.pytorch.org/whl/cu118

# 4. 安装项目中 requiremnts.txt 列出的所有依赖包
pip install -r requirements.txt
```

## 2. 修改环境变量

定位到 `web/frontend` 文件夹，可以看到文件 `.env` ，点击进去修改以下两条内容：

```powershell
# 1. 定位到对应的 best.pt 文件
YOLO_MODEL_PATH=./algorithm/runs/data_name/Yolov13_MMD_LIF2/weights/best.pt
# 2. 更换为您的 Qwen API
QWEN_API_KEY=YOUR_API_KEY
```

## 3. 启动服务

环境依赖安装完成后，即可直接启动后端服务运行深瞳锐巡。

> ⚠️ **重要提示：**在运行启动命令之前，**请务必确保您的终端当前工作目录切换到了 frontend 文件夹**。如果路径不正确，程序可能会因找不到相关文件而启动失败。

请在终端中执行以下命令：

```powershell
# 激活环境
conda activate your_env_name

# 切换到 frontend 目录
cd ../web/frontend 

# 启动服务，绑定所有可用 IP 并监听 8000 端口
python backend/main.py --host 0.0.0.0 --port 8000
```

## 4. 访问网站

当终端输出以下的提示信息时，说明服务已成功启动：

```verilog
INFO:     Started server process [2464]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)

INFO:     Started server process [27156]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8001 (Press CTRL+C to quit)
    
INFO:     Started server process [17532]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8002 (Press CTRL+C to quit)
```

此时，您可以打开浏览器，访问以下本地地址来查看和使用我们的**深瞳锐巡系统**：

🌐 **http://127.0.0.1:8000**

