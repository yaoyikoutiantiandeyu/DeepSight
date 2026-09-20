// ==========================================
// 1. 全局变量与配置
// ==========================================
const API_BASE = "http://127.0.0.1:8000";
let pieChartInstance = null;
let statusInterval = null;
let currentVideoUrl = null;
let globalLiveCounts = { f1_box_1: {}, f1_box_2: {}, f1_box_3: {}, f1_box_4: {}, f2_session: {} };

let activeTabTarget = 'live-card'; 
let moduleCounts = {
  'live-card': {},
  'video-card': {},
  'image-card': {}
};

const BASE_TODAY = 0;
const BASE_WEEK = 128275;

function aggregateLiveStats() {
  let f1Counts = { 'car': 0, 'truck': 0, 'bus': 0, 'person': 0, 'motorcycle': 0, 'bicycle': 0 };
  let f2Counts = { 'car': 0, 'truck': 0, 'bus': 0, 'person': 0, 'motorcycle': 0, 'bicycle': 0 };

  for (let sessionId in globalLiveCounts) {
    if (sessionId.startsWith('f1')) {
      for (let type in globalLiveCounts[sessionId]) {
        if (f1Counts[type] !== undefined) f1Counts[type] += globalLiveCounts[sessionId][type];
      }
    } else if (sessionId.startsWith('f2')) {
      for (let type in globalLiveCounts[sessionId]) {
        if (f2Counts[type] !== undefined) f2Counts[type] += globalLiveCounts[sessionId][type];
      }
    }
  }

  moduleCounts['live-card'] = f1Counts;
  moduleCounts['video-card'] = f2Counts;

  renderCurrentTabCharts();
}

function renderCurrentTabCharts() {
  const chartCounts = moduleCounts[activeTabTarget] || {};
  updateDashboardData(chartCounts);

  const vehicleCounts = moduleCounts['live-card'] || {};
  let currentActiveVehicles = 0;

  for (let type in vehicleCounts) {
    if (['car', 'truck', 'bus', 'motorcycle'].includes(type)) {
      currentActiveVehicles += vehicleCounts[type];
    }
  }

  const cyanNum = document.querySelector('.num-cyan');
  const yellowNum = document.querySelector('.num-yellow');
  if (cyanNum) cyanNum.innerText = BASE_TODAY + currentActiveVehicles;
  if (yellowNum) yellowNum.innerText = BASE_WEEK + currentActiveVehicles;
}

const labelMap = {
  'car': '汽车', 'truck': '货车', 'bus': '公交车',
  'person': '人员', 'motorcycle': '摩托车', 'bicycle': '自行车'
};


// ==========================================
// 2. 基础视觉特效与用户信息
// ==========================================
function initBackground() {
    const canvas = document.getElementById('bg-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let width, height;
    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    let bgParticles = [];
    const particleCount = 150;
    const connectionDistance = 120;
    const mouseDistance = 150;
    let mouse = { x: null, y: null };

    window.addEventListener('mousemove', (e) => { mouse.x = e.x; mouse.y = e.y; });
    window.addEventListener('mouseout', () => { mouse.x = null; mouse.y = null; });

    class BgParticle {
        constructor() {
            this.x = Math.random() * width;
            this.y = Math.random() * height;
            this.vx = (Math.random() - 0.5) * 1.5;
            this.vy = (Math.random() - 0.5) * 1.5;
            this.size = Math.random() * 2 + 1;
            const colors = ['#00F0FF', '#1E6FF2', '#FFFFFF'];
            this.color = colors[Math.floor(Math.random() * colors.length)];
            this.density = (Math.random() * 30) + 1;
        }
        update() {
            if (mouse.x != null) {
                let dx = mouse.x - this.x;
                let dy = mouse.y - this.y;
                let distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < mouseDistance) {
                    const force = (mouseDistance - distance) / mouseDistance;
                    this.x -= (dx / distance) * force * this.density;
                    this.y -= (dy / distance) * force * this.density;
                }
            }
            this.x += this.vx;
            this.y += this.vy;
            
            if (this.x < 0 || this.x > width) this.vx *= -1;
            if (this.y < 0 || this.y > height) this.vy *= -1;
        }
        draw() {
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.rect(this.x, this.y, this.size, this.size);
            ctx.fill();
        }
    }

    for (let i = 0; i < particleCount; i++) {
        bgParticles.push(new BgParticle());
    }

    function drawGrid() {
        const gridSize = 50;
        ctx.strokeStyle = 'rgba(30, 111, 242, 0.05)';
        ctx.lineWidth = 1;
        for (let x = 0; x < width; x += gridSize) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
        }
        for (let y = 0; y < height; y += gridSize) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
        }
    }

    function animate() {
        ctx.clearRect(0, 0, width, height);
        drawGrid();
        for (let i = 0; i < bgParticles.length; i++) {
            let p = bgParticles[i];
            p.update(); 
            p.draw();
            
            for (let j = i; j < bgParticles.length; j++) {
                let p2 = bgParticles[j];
                let dist = Math.sqrt(Math.pow(p.x - p2.x, 2) + Math.pow(p.y - p2.y, 2));
                if (dist < connectionDistance) {
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(0, 240, 255, ${(1 - dist / connectionDistance) * 0.4})`;
                    ctx.lineWidth = 0.5;
                    ctx.moveTo(p.x, p.y); 
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                }
            }
        }

      requestAnimationFrame(animate);
    }
    animate();
}

function initUser() {
  const currentUsername = localStorage.getItem('user');
  if (!currentUsername) {
    alert('您尚未登录或登录已过期，请先登录！');
    window.location.href = 'login.html';
    return;
  }

  const userInfoElements = document.querySelectorAll('.user-info');
  userInfoElements.forEach(infoDiv => {
    infoDiv.innerHTML = `
            <i style="font-family: 'icomoon' !important; font-style: normal; margin-right: 5px;">&#xe971;</i>
            <span style="font-family: inherit;">${currentUsername}</span>
        `;
  });
}


// ==========================================
// 3. ECharts 初始化与数据看板更新
// ==========================================
function initCharts() {
  const pieChartDom = document.getElementById('pie-chart');
  if (!pieChartDom) return;
  pieChartInstance = echarts.init(pieChartDom);

  pieChartInstance.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item', formatter: '{b}: {d}%' },
    legend: {
      orient: 'vertical', right: '5%', top: 'center',
      textStyle: { color: 'rgba(255, 255, 255, 0.7)', fontSize: 12 },
      icon: 'circle'
    },
    series: [{
      name: '目标分布', type: 'pie', radius: ['40%', '65%'], center: ['40%', '50%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 5, borderColor: '#0a0f1f', borderWidth: 2 },
      label: {
        show: true, position: 'outside',
        formatter: '{nameStyle|{b}}\n{percentStyle|{d}%}',
        rich: {
          nameStyle: { color: 'inherit', fontSize: 12, lineHeight: 18 },
          percentStyle: { color: '#fff', fontSize: 13, fontWeight: 'bold', textShadowColor: 'rgba(255, 255, 255, 0.3)', textShadowBlur: 5 }
        }
      },
      labelLine: { show: true, length: 10, length2: 15 },
      data: [],
      color: ['#00f0ff', '#1e6ff2', '#f5a623', '#2ecc71', '#ff4d4d']
    }]
  });

  window.addEventListener('resize', () => pieChartInstance.resize());
}

function updateDashboardData(counts) {
  if (!pieChartInstance) return;

  // 只保留已检测到的类别
  const filteredCounts = Object.fromEntries(
    Object.entries(counts || {}).filter(([_, value]) => Number(value) > 0)
  );

  const chartData = Object.keys(filteredCounts).map(key => ({
    name: labelMap[key] || key,
    value: filteredCounts[key]
  }));

  pieChartInstance.setOption({ series: [{ data: chartData }] });

  const progressListDom = document.getElementById('progress-list');
  if (progressListDom) {
    progressListDom.innerHTML = '';

    const values = Object.values(filteredCounts);
    if (values.length === 0) return;

    const maxCount = Math.max(...values, 1);
    const barGradients = [
      'linear-gradient(90deg, #1e6ff2, #00f0ff)',
      'linear-gradient(90deg, #1e6ff2, #7367f0)',
      'linear-gradient(90deg, #f5a623, #ffd073)'
    ];

    let colorIndex = 0;
    for (const key in filteredCounts) {
      const count = filteredCounts[key];
      const percentage = (count / maxCount) * 100;
      const bgGradient = barGradients[colorIndex % barGradients.length];
      const displayName = labelMap[key] || key;
      colorIndex++;

      const itemHtml = `
        <div class="progress-item">
            <div class="progress-label">${displayName}</div>
            <div class="progress-track">
                <div class="progress-fill" style="width: ${percentage}%; background: ${bgGradient}; box-shadow: 0 0 10px ${bgGradient.split(',')[2]};"></div>
            </div>
            <div class="progress-value-box">${count}</div>
        </div>
      `;
      progressListDom.insertAdjacentHTML('beforeend', itemHtml);
    }
  }
}

// ==========================================
//  f1 实时航拍黑幕布交互逻辑
// ==========================================
let f1PollingIntervals = {};

function initLiveDetection() {
  const liveItems = document.querySelectorAll('.live-item');

  liveItems.forEach(item => {
    const box = item.querySelector('.live-box');
    const fileInput = item.querySelector('.live-upload-input');
    const switchBtn = item.querySelector('.switch-btn');
    const modalityLabel = item.querySelector('.modality-label');
    const emptyText = item.querySelector('.empty-text');
    const changeBtn = item.querySelector('.change-source-btn');
    const deleteBtn = item.querySelector('.delete-source-btn');
    
    const boxId = box.getAttribute('data-id');
    const sessionId = `f1_box_${boxId}`;

    let isUploaded = false; 

    const updateControlsState = () => {
      changeBtn.disabled = !isUploaded; 
      deleteBtn.disabled = !isUploaded;
    };

    box.addEventListener('click', (e) => {
      if (e.target === switchBtn) return;
      if (!isUploaded) fileInput.click();
    });

    switchBtn.addEventListener('click', (e) => {
      e.stopPropagation(); 
      let isRGB = modalityLabel.innerText.includes('可见光');
      modalityLabel.innerHTML = `当前: ${isRGB ? '红外' : '可见光'}`;
      modalityLabel.style.borderLeftColor = isRGB ? '#ff4d4d' : '#00cc66';
    });

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      isUploaded = true;
      emptyText.style.display = 'none';

      let videoEl = box.querySelector('.live-video');
      if (videoEl) {
          videoEl.src = URL.createObjectURL(file);
          videoEl.style.display = 'block';
          videoEl.play();
      }
      
      const formData = new FormData();
      formData.append('session_id', sessionId);
      formData.append('source_type', 'file');
      formData.append('video_file', file);
      formData.append('scenario', 'live_single');

      try {
        const res = await fetch(`${API_BASE}/api/session/start`, { method: 'POST', body: formData });
        const data = await res.json();
        
        if (data.ok) {
          // 不再显示后端处理后视频流，只保留原视频播放和右侧统计轮询
          if (f1PollingIntervals[sessionId]) clearInterval(f1PollingIntervals[sessionId]);
          f1PollingIntervals[sessionId] = setInterval(() => {
            fetch(`${API_BASE}/api/session/status?session_id=${encodeURIComponent(sessionId)}&t=${Date.now()}`)
              .then(r => r.json())
              .then(res => {
                if (res.total_counts) {
                  globalLiveCounts[sessionId] = res.total_counts;
                  aggregateLiveStats();
                }
              })
              .catch(e => {});
          }, 500);
        }
      } catch(e) {}
      
      fileInput.value = '';
      updateControlsState();
    });

    changeBtn.addEventListener('click', () => fileInput.click());

    deleteBtn.addEventListener('click', async () => {
      const stopForm = new FormData();
      stopForm.append('session_id', sessionId);
      await fetch(`${API_BASE}/api/session/stop`, { method: 'POST', body: stopForm });
    
      if (f1PollingIntervals[sessionId]) {
        clearInterval(f1PollingIntervals[sessionId]);
        delete f1PollingIntervals[sessionId];
      }
    
      // 不清空 globalLiveCounts[sessionId]
      const streamImg = box.querySelector('.backend-stream');
      if (streamImg) streamImg.remove();
    
      // 停止并隐藏本地预览视频
      let videoEl = box.querySelector('.live-video');
      if (videoEl) {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.load();
        videoEl.style.display = 'none';
      }
    
      // 恢复空状态
      emptyText.style.display = '';
      isUploaded = false;
    
      // 还原标签状态
      modalityLabel.innerHTML = `当前: 可见光`;
      modalityLabel.style.borderLeftColor = '#00f0ff';
    
      updateControlsState();
    });

    updateControlsState();
  });
}


// ==========================================
// 4. 视频检测模块 (上传、推理、状态轮询)
// ==========================================
function initVideoDetection() {
  const videoInput = document.getElementById('video-upload-input-video');
  const uploadTrigger = document.getElementById('upload-trigger-video');
  const topLeftBox = document.getElementById('top-left-box-video');
  const bottomLeftBox = document.getElementById('bottom-left-box-video');

  const videoInputIr = document.getElementById('video-upload-input-video-ir');
  const uploadTriggerIr = document.getElementById('upload-trigger-video-ir');

  const deleteBtn = document.querySelector('.video-card .delete-video-btn');
  const startBtn = document.getElementById('start-video-btn');
  const sessionId = 'f2_session';
  let selectedVideoFile = null;
  let videoPairInterval = null;
  let lastPairFrameId = -1;
  let currentVideoMode = 'single';

  function refreshVideoStartBtn() {
    const hasRgb = !!selectedVideoFile;
    startBtn.disabled = !hasRgb;
  
    if (!hasRgb) {
      startBtn.innerHTML =
        `<i style="font-family: 'icomoon' !important; font-style: normal;">&#xea1c;</i> 请先上传可见光视频`;
    } else if (selectedVideoFileIr) {
      startBtn.innerHTML =
        `<i style="font-family: 'icomoon' !important; font-style: normal;">&#xea1c;</i> 开始双模态检测`;
    } else {
      startBtn.innerHTML =
        `<i style="font-family: 'icomoon' !important; font-style: normal;">&#xea1c;</i> 开始单模态检测`;
    }
  } 

  // 1. 左侧：可见光上传逻辑
  if (uploadTrigger && videoInput) {
    uploadTrigger.addEventListener('click', () => {
      videoInput.click();
    });

    videoInput.addEventListener('change', async function (e) {
      const file = e.target.files[0];
      if (!file || !file.type.startsWith("video/")) {
        alert("检测到非法格式！请选择标准的视频文件。");
        return;
      }

      selectedVideoFile = file;

      const stopForm = new FormData();
      stopForm.append('session_id', sessionId);
      await fetch(`${API_BASE}/api/session/stop`, { method: 'POST', body: stopForm });
      
      if (statusInterval) clearInterval(statusInterval);
      statusInterval = null;

      uploadTrigger.style.display = 'none';

      if (currentVideoUrl) URL.revokeObjectURL(currentVideoUrl);
      currentVideoUrl = URL.createObjectURL(file);

      const oldLv = document.getElementById('local-video');
      if (oldLv) oldLv.remove();
      const oldStream = document.getElementById('backend-stream-f2');
      if (oldStream) oldStream.remove();

      const localVideo = document.createElement("video");
      localVideo.id = "local-video";
      localVideo.src = currentVideoUrl;
      localVideo.controls = true;
      localVideo.muted = true;
      localVideo.autoplay = false;
      localVideo.className = "video-player";
      topLeftBox.appendChild(localVideo);

      refreshVideoStartBtn();
    });
  }

  // 2. 禁用红外上传入口并予以提示
  let selectedVideoFileIr = null;
  let currentVideoUrlIr = null;
  
  if (uploadTriggerIr && videoInputIr) {
    uploadTriggerIr.addEventListener('click', () => {
      videoInputIr.click();
    });
  
    videoInputIr.addEventListener('change', async function (e) {
      const file = e.target.files[0];
      if (!file || !file.type.startsWith("video/")) {
        alert("检测到非法格式！请选择标准的视频文件。");
        return;
      }
  
      selectedVideoFileIr = file;
      uploadTriggerIr.style.display = 'none';
  
      if (currentVideoUrlIr) URL.revokeObjectURL(currentVideoUrlIr);
      currentVideoUrlIr = URL.createObjectURL(file);
  
      const oldIrLv = document.getElementById('local-video-ir');
      if (oldIrLv) oldIrLv.remove();
  
      const localVideoIr = document.createElement("video");
      localVideoIr.id = "local-video-ir";
      localVideoIr.src = currentVideoUrlIr;
      localVideoIr.controls = true;
      localVideoIr.muted = true;
      localVideoIr.autoplay = false;
      localVideoIr.className = "video-player";
      document.getElementById('top-right-box-video').appendChild(localVideoIr);
  
      refreshVideoStartBtn();
    });
  }

  // 3. 后端状态轮询与图表更新
  async function pollBackendStatus() {
    try {
      const statusUrl = currentVideoMode === 'dual'
        ? `${API_BASE}/api/session/status_video_dual?session_id=${encodeURIComponent(sessionId)}&t=${Date.now()}`
        : `${API_BASE}/api/session/status?session_id=${encodeURIComponent(sessionId)}&t=${Date.now()}`;
      
      const res = await fetch(statusUrl);

      const data = await res.json();
  
      if (!res.ok) {
        console.error("视频检测状态接口异常:", data);
        return;
      }
  
      const statValues = document.querySelectorAll('.video-card .card-stats .value');
      if (statValues.length >= 3) {
        statValues[0].innerText = data.fps || 0;
        statValues[1].innerText = data.total_objects || 0;
        statValues[2].innerText = (data.memory_percent || 0) + '%';
      }
  
      if (data.total_counts) {
        globalLiveCounts[sessionId] = data.total_counts;
        aggregateLiveStats();
      }
  
      if (data.running === false) {
        clearInterval(statusInterval);
        statusInterval = null;
        startBtn.disabled = false;
        startBtn.innerHTML = `<i style="font-family: 'icomoon' !important; font-style: normal;">&#xea1c;</i> 开始检测`;
  
        if (data.last_error) {
          console.error("视频检测失败：", data.last_error);
        }
      }
    } catch (err) {
      console.error("状态轮询失败:", err);
    }
  }

  // 4. 开始检测
  startBtn.addEventListener('click', async () => {
    if (!selectedVideoFile) return;

    startBtn.disabled = true;
    startBtn.innerHTML = `<i style="font-family: 'icomoon' !important; font-style: normal;">&#xea1c;</i> 处理中...`;

    let streamImg = document.getElementById('backend-stream-f2');
    if (!streamImg) {
      streamImg = document.createElement('img');
      streamImg.id = 'backend-stream-f2';
      streamImg.className = 'img-player';
      bottomLeftBox.appendChild(streamImg);
    }

    if (!selectedVideoFile) {
      alert("请先上传可见光视频。");
      return;
    }
    
    const formData = new FormData();
    formData.append('session_id', sessionId);
    formData.append('source_type', 'file');
    formData.append('video_file', selectedVideoFile);
    formData.append('imgsz', '416');
    
    if (selectedVideoFileIr) {
      currentVideoMode = 'dual';
      formData.append('video_file_ir', selectedVideoFileIr);
      formData.append('modality_mode', 'dual');
      formData.append('scenario', 'video_dual');
    } else {
      currentVideoMode = 'single';
      formData.append('modality_mode', 'single');
      formData.append('scenario', 'video_single');
    }

    try {
      const res = await fetch(`${API_BASE}/api/session/start`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      
      if (!res.ok || !data.ok) {
        throw new Error(data.detail || data.message || "启动检测失败");
      }
      
      if (currentVideoMode === 'dual') {
        let streamImgRgb = document.getElementById('backend-stream-f2');
        if (!streamImgRgb) {
          streamImgRgb = document.createElement('img');
          streamImgRgb.id = 'backend-stream-f2';
          streamImgRgb.className = 'img-player';
          bottomLeftBox.appendChild(streamImgRgb);
        }
      
        let streamImgIr = document.getElementById('backend-stream-f2-ir');
        if (!streamImgIr) {
          streamImgIr = document.createElement('img');
          streamImgIr.id = 'backend-stream-f2-ir';
          streamImgIr.className = 'img-player';
          document.getElementById('bottom-right-box-video').appendChild(streamImgIr);
        }
      
        if (videoPairInterval) clearInterval(videoPairInterval);
        videoPairInterval = setInterval(async () => {
          try {
            const res = await fetch(`${API_BASE}/api/session/frame_pair_dual?session_id=${encodeURIComponent(sessionId)}&t=${Date.now()}`);
            const data = await res.json();
      
            if (!res.ok || !data.ok) return;
            if (data.frame_id === lastPairFrameId) return;
      
            lastPairFrameId = data.frame_id;
      
            if (data.rgb_b64 && data.ir_b64) {
              streamImgRgb.src = `data:image/jpeg;base64,${data.rgb_b64}`;
              streamImgIr.src = `data:image/jpeg;base64,${data.ir_b64}`;
            }
          } catch (e) {
            console.error("双模态帧对获取失败:", e);
          }
        }, 80);
      } else {
        let streamImg = document.getElementById('backend-stream-f2');
        if (!streamImg) {
          streamImg = document.createElement('img');
          streamImg.id = 'backend-stream-f2';
          streamImg.className = 'img-player';
          bottomLeftBox.appendChild(streamImg);
        }
      
        const oldIrResult = document.getElementById('backend-stream-f2-ir');
        if (oldIrResult) oldIrResult.remove();
      
        if (videoPairInterval) {
          clearInterval(videoPairInterval);
          videoPairInterval = null;
        }
        lastPairFrameId = -1;
      
        streamImg.src = `${API_BASE}/api/session/stream?session_id=${encodeURIComponent(sessionId)}&t=${Date.now()}`;
        streamImg.style.display = 'block';
        streamImg.style.width = '100%';
        streamImg.style.height = '100%';
        streamImg.style.objectFit = 'contain';
      }

      if (statusInterval) clearInterval(statusInterval);
      statusInterval = setInterval(pollBackendStatus, 500);
      await pollBackendStatus();
    } catch (err) {
      console.error("启动接口通信错误:", err);
      startBtn.disabled = false;
      startBtn.innerHTML = `<i style="font-family: 'icomoon' !important; font-style: normal;">&#xea1c;</i> 开始检测`;
    }
  });

  // 5. 删除视频
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async function () {
      const stopForm = new FormData();
      stopForm.append('session_id', sessionId);
      const stopUrl = currentVideoMode === 'dual'
        ? `${API_BASE}/api/session/stop_video_dual`
        : `${API_BASE}/api/session/stop`;
      
      await fetch(stopUrl, { method: 'POST', body: stopForm });
      
      if (statusInterval) clearInterval(statusInterval);
      statusInterval = null;
      globalLiveCounts['f2_session'] = {}; 
      aggregateLiveStats();

      if (videoPairInterval) clearInterval(videoPairInterval);
      videoPairInterval = null;
      lastPairFrameId = -1;

      const lv = document.getElementById('local-video');
      if (lv) lv.remove();
      const streamImg = document.getElementById('backend-stream-f2');
      if (streamImg) streamImg.remove(); 

      videoInput.value = '';
      selectedVideoFile = null;
      document.getElementById('upload-trigger-video').style.display = 'flex';

      const lvIr = document.getElementById('local-video-ir');
      if (lvIr) lvIr.remove();
      
      const streamImgIr = document.getElementById('backend-stream-f2-ir');
      if (streamImgIr) streamImgIr.remove();
      
      videoInputIr.value = '';
      selectedVideoFileIr = null;
      document.getElementById('upload-trigger-video-ir').style.display = 'flex';
      refreshVideoStartBtn();

      startBtn.disabled = true;
      startBtn.innerHTML = `<i style="font-family: 'icomoon' !important; font-style: normal;">&#xea1c;</i> 开始检测`;

      const statValues = document.querySelectorAll('.active-panel .card-stats .value');
      if (statValues.length >= 3) {
        statValues[0].innerText = '0';
        statValues[1].innerText = '0';
        statValues[2].innerText = '0%';
      }
      currentVideoMode = 'single';
    });
  }
}

// ==========================================
// 5. 图片检测模块 (上传、推理、复原)
// ==========================================
function initImageDetection() {
  // 左侧（可见光）节点
  const imageInput = document.getElementById('video-upload-input-image');
  const imgUploadTrigger = document.getElementById('upload-trigger-image');
  const topLeftBoxImg = document.getElementById('top-left-box-image');
  const bottomLeftBoxImg = document.getElementById('bottom-left-box-image');

  // 右侧（红外光）节点
  const imageInputIr = document.getElementById('image-upload-input-image-ir');
  const imgUploadTriggerIr = document.getElementById('upload-trigger-image-ir');
  const topRightBoxImg = document.getElementById('top-right-box-image');

  const imgDeleteBtn = document.querySelector('.image-card .delete-video-btn');
  const startImgBtn = document.getElementById('start-image-btn');

  let selectedImageFile = null;
  let selectedImageFileIr = null;

  function refreshImageStartBtn() {
    const hasRgb = !!selectedImageFile;
    startImgBtn.disabled = !hasRgb;
  
    if (!hasRgb) {
      startImgBtn.innerHTML =
        `<i style="font-family: 'icomoon' !important; font-style: normal;">&#xea1c;</i> 请先上传可见光图片`;
    } else if (selectedImageFileIr) {
      startImgBtn.innerHTML =
        `<i style="font-family: 'icomoon' !important; font-style: normal;">&#xea1c;</i> 开始双模态检测`;
    } else {
      startImgBtn.innerHTML =
        `<i style="font-family: 'icomoon' !important; font-style: normal;">&#xea1c;</i> 开始单模态检测`;
    }
  }

  // 左侧：可见光图片上传
  if (imgUploadTrigger && imageInput) {
    imgUploadTrigger.addEventListener('click', () => {
      imageInput.click();
    });

    imageInput.addEventListener('change', async function (e) {
      const file = e.target.files[0];
      if (!file || !file.type.startsWith("image/")) {
        alert("检测到非法格式！请选择标准的图片文件。");
        return;
      }

      selectedImageFile = file;

      imgUploadTrigger.style.display = 'none';

      const oldImg = document.getElementById('local-image-preview');
      if (oldImg) oldImg.remove();
      const oldProcessed = document.getElementById('processed-image-preview');
      if (oldProcessed) oldProcessed.remove();

      const localImg = document.createElement("img");
      localImg.id = "local-image-preview";
      localImg.src = URL.createObjectURL(file);
      localImg.className = "img-player";
      topLeftBoxImg.appendChild(localImg);

      refreshImageStartBtn();
    });
  }

  // 右侧：红外光图片上传
  if (imgUploadTriggerIr && imageInputIr) {
    imgUploadTriggerIr.addEventListener('click', () => {
      imageInputIr.click();
    });

    imageInputIr.addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (!file || !file.type.startsWith("image/")) {
        alert("检测到非法格式！请选择标准的图片文件。");
        return;
      }

      selectedImageFileIr = file;

      imgUploadTriggerIr.style.display = 'none';

      const oldImgIr = document.getElementById('local-image-preview-ir');
      if (oldImgIr) oldImgIr.remove();

      const localImgIr = document.createElement("img");
      localImgIr.id = "local-image-preview-ir";
      localImgIr.src = URL.createObjectURL(file);
      localImgIr.className = "img-player";
      topRightBoxImg.appendChild(localImgIr);

      refreshImageStartBtn();
    });
  }

  // 开始检测
  startImgBtn.addEventListener('click', async () => {
    if (!selectedImageFile) {
      alert("请先上传可见光图片。");
      return;
    }

    startImgBtn.disabled = true;
    startImgBtn.innerHTML = `<i style="font-family: 'icomoon' !important; font-style: normal;">&#xea1c;</i> 处理中...`;

    const formData = new FormData();
    formData.append('image_file', selectedImageFile);
    
    if (selectedImageFileIr) {
      formData.append('image_file_ir', selectedImageFileIr);
      formData.append('modality_mode', 'dual');
    } else {
      formData.append('modality_mode', 'single');
    }
    try {
      const res = await fetch(`${API_BASE}/api/session/image`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      // 1. 获取右侧红外图盒子的引用
      const bottomRightBoxImg = document.getElementById('bottom-right-box-image');
  
      // 2. 成功回传后的处理逻辑
      if (data.ok) {
        let resultImg = document.getElementById('processed-image-preview');
        if (!resultImg) {
          resultImg = document.createElement("img");
          resultImg.id = "processed-image-preview";
          resultImg.className = "img-player";
          bottomLeftBoxImg.appendChild(resultImg);
        }
        resultImg.src = `data:image/jpeg;base64,${data.annotated_image_b64}`;

        // 渲染红外结果
        if (data.annotated_image_ir_b64) {
          let resultImgIr = document.getElementById('processed-image-preview-ir');
          if (!resultImgIr) {
            resultImgIr = document.createElement("img");
            resultImgIr.id = "processed-image-preview-ir";
            resultImgIr.className = "img-player";
            bottomRightBoxImg.appendChild(resultImgIr);
          }
          resultImgIr.src = `data:image/jpeg;base64,${data.annotated_image_ir_b64}`;
        } else {
          const oldIrResult = document.getElementById('processed-image-preview-ir');
          if (oldIrResult) oldIrResult.remove();
        }

        const imgStatValues = document.querySelectorAll('.image-card .card-stats .value');
        if (imgStatValues.length >= 3) {
          imgStatValues[0].innerText = data.resolution;
          imgStatValues[1].innerText = data.total_objects;
          imgStatValues[2].innerText = data.infer_time_ms + 'ms';
        }

        moduleCounts['image-card'] = data.counts || {};
        renderCurrentTabCharts();
        startImgBtn.innerHTML = `<i style="font-family: 'icomoon' !important; font-style: normal;">&#xea1c;</i> 检测完成`;
      } else {
        alert("图片处理失败：" + (data.detail || "未知错误"));
        startImgBtn.disabled = false;
        startImgBtn.innerHTML = `<i style="font-family: 'icomoon' !important; font-style: normal;">&#xea1c;</i> 开始检测`;
      }
    } catch (err) {
      console.error("图片上传失败:", err);
      startImgBtn.disabled = false;
      startImgBtn.innerHTML = `<i style="font-family: 'icomoon' !important; font-style: normal;">&#xea1c;</i> 开始检测`;
    }
  });

  // 删除重置按钮
  if (imgDeleteBtn) {
    imgDeleteBtn.addEventListener('click', () => {
      // 清理可见光
      const li = document.getElementById('local-image-preview');
      if (li) li.remove();
      const pi = document.getElementById('processed-image-preview');
      if (pi) pi.remove();
      imageInput.value = '';
      selectedImageFile = null;

      // 清理红外光
      const liIr = document.getElementById('local-image-preview-ir');
      if (liIr) liIr.remove();
      const piIr = document.getElementById('processed-image-preview-ir');
      if (piIr) piIr.remove();
      imageInputIr.value = '';
      selectedImageFileIr = null;

      // 恢复显示上传按钮
      document.querySelectorAll('.image-card .empty-state').forEach(el => el.style.display = 'flex');

      startImgBtn.disabled = true;
      startImgBtn.innerHTML = `<i style="font-family: 'icomoon' !important; font-style: normal;">&#xea1c;</i> 开始检测`;

      const imgStatValues = document.querySelectorAll('.image-card .card-stats .value');
      if (imgStatValues.length >= 3) {
        imgStatValues[0].innerText = '-';
        imgStatValues[1].innerText = '0';
        imgStatValues[2].innerText = '0ms';
      }

      moduleCounts['image-card'] = {};
      renderCurrentTabCharts();
      refreshImageStartBtn();
    });
  }
}

// ==========================================
// 6. 交互逻辑 (表格滚动与Tab切换)
// ==========================================
function initTableScroll() {
  const scrollTbody = document.getElementById('scroll-tbody');
  if (scrollTbody) scrollTbody.innerHTML += scrollTbody.innerHTML;
}

function initTabSwitching() {
  const subNavList = document.querySelector('.sub-nav-list');
  if (!subNavList) return;

  subNavList.addEventListener('click', function (e) {
    const targetTab = e.target.closest('.sub-tab');
    if (!targetTab) return;
    if (targetTab.classList.contains('active')) return;

    const targetClass = targetTab.getAttribute('data-target');

    document.querySelectorAll('.sub-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.module-card').forEach(card => {
      if (card.classList.contains('live-card') ||
        card.classList.contains('video-card') ||
        card.classList.contains('image-card')) {
        card.classList.remove('active-panel');
      }
    });

    targetTab.classList.add('active');
    document.querySelector('.' + targetClass).classList.add('active-panel');

    activeTabTarget = targetClass;
    renderCurrentTabCharts();
  });
}


// ==========================================
// 7. 页面初始挂载 (生命周期总入口)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  initBackground();
  initUser();
  initCharts();
  initTableScroll();
  initTabSwitching();
  initLiveDetection();
  initVideoDetection();
  initImageDetection();
});