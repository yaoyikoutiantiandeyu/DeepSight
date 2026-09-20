// ==========================================
// 1. 基础背景特效
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

// ==========================================
// 2. 用户信息渲染
// ==========================================
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
// 3. 聊天系统核心逻辑
// ==========================================
function initChatSystem() {
  const tx = document.querySelector('#tx');
  const total = document.querySelector('.total');
  const submit = document.querySelector('#submit-btn');
  const content = document.querySelector('#chat-content');
  const chatList = document.querySelector('#chat-list');
  const newChatBtn = document.querySelector('#new-chat-btn');

  const clearBtn = document.querySelector('.i-1');
  const irUploadBtn = document.querySelector('.i-2');
  const micBtn = document.querySelector('.i-3');
  const uploadBtn = document.querySelector('.i-4');
  const imageUploadInput = document.querySelector('#image-upload');
  const imageUploadInputIr = document.querySelector('#image-upload-ir');
  const fileBox = document.querySelector('#file-box');

  const currentUser = localStorage.getItem('user') || 'default';
  const STORAGE_KEY = `deep_eye_chats_${currentUser}`;
  const ACTIVE_CHAT_KEY = `deep_eye_active_chat_${currentUser}`;

  let savedChats = localStorage.getItem(STORAGE_KEY);
  let chats = savedChats ? JSON.parse(savedChats) : [{ id: 'chat-' + Date.now(), title: '新对话', html: `` }];

  let activeChatId = localStorage.getItem(ACTIVE_CHAT_KEY) || chats[0].id;
  if (!chats.find(c => c.id === activeChatId)) {
    activeChatId = chats[0].id;
  }

  let isRecording = false;
  let recognition = null;
  let textBeforeRecording = '';
  let isAutoRead = false;

  function saveChatsToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
      localStorage.setItem(ACTIVE_CHAT_KEY, activeChatId);
    } catch (e) {
      console.warn("保存聊天记录受阻，可能是超出了5MB限制: ", e);
    }
  }

  // 聊天历史列表管理
  function setupChatListManager() {
    function renderChatList() {
      chatList.innerHTML = '';
      chats.forEach(chat => {
        const li = document.createElement('li');
        if (chat.id === activeChatId) li.classList.add('active');

        li.innerHTML = `
          <span class="chat-name-span">${chat.title}</span>
          <div class="icon del-btn" title="删除"></div>
          <div class="icon edit-btn" title="重命名"></div>
        `;

        li.addEventListener('click', (e) => {
          if (e.target.classList.contains('icon') || e.target.tagName === 'INPUT' || chat.id === activeChatId) return;
          switchChat(chat.id);
        });

        li.querySelector('.edit-btn').addEventListener('click', (e) => {
          e.stopPropagation(); triggerEditMode(li, chat);
        });

        li.querySelector('.del-btn').addEventListener('click', (e) => {
          e.stopPropagation(); deleteChat(chat.id);
        });

        chatList.appendChild(li);
      });
    }

    function switchChat(newId) {
      const oldChat = chats.find(c => c.id === activeChatId);
      if (oldChat) oldChat.html = content.innerHTML;
      activeChatId = newId;
      saveChatsToStorage();
      renderChatList();
      loadChatContent();
    }

    function triggerEditMode(li, chatObj) {
      const span = li.querySelector('.chat-name-span');
      const input = document.createElement('input');
      input.type = 'text'; input.className = 'edit-input'; input.value = chatObj.title;
      span.replaceWith(input);
      input.focus(); input.select();

      function finishEdit() {
        chatObj.title = input.value.trim() || '未命名对话';
        saveChatsToStorage();
        renderChatList();
      }
      input.addEventListener('blur', finishEdit);
      input.addEventListener('keyup', (e) => { if (e.key === 'Enter') finishEdit(); });
    }

    function deleteChat(idToDelete) {
      chats = chats.filter(c => c.id !== idToDelete);
      if (chats.length === 0) {
        chats = [{ id: 'chat-' + Date.now(), title: '新对话', html: `` }];
      }
      if (activeChatId === idToDelete) {
        activeChatId = chats[0].id;
        loadChatContent();
      }
      saveChatsToStorage();
      renderChatList();
    }

    newChatBtn.addEventListener('click', () => {
      const oldChat = chats.find(c => c.id === activeChatId);
      if (oldChat) oldChat.html = content.innerHTML;

      const newId = 'chat-' + Date.now();
      const newChat = { id: newId, title: '新对话', html: `` };
      chats.unshift(newChat);
      activeChatId = newId;

      saveChatsToStorage();
      renderChatList();
      loadChatContent();
      triggerEditMode(chatList.querySelector('li'), newChat);
    });

    renderChatList();
  }

  // 会话内容展示
  function loadChatContent() {
    const activeChat = chats.find(c => c.id === activeChatId);
    if (activeChat) {
      content.innerHTML = activeChat.html;
      content.scrollTop = content.scrollHeight;
      tx.disabled = false;
      submit.style.pointerEvents = 'auto';
    } else {
      content.innerHTML = '';
      tx.disabled = true;
      submit.style.pointerEvents = 'none';
    }
  }

  function syncCurrentChatHTML() {
    const activeChat = chats.find(c => c.id === activeChatId);
    if (activeChat) {
      activeChat.html = content.innerHTML;
      saveChatsToStorage();
    }
  }

  // 右侧输入区域控制 (字数、图片附件、清屏)
  function setupInputControls() {
    clearBtn.addEventListener('click', () => {
      if (!activeChatId || content.children.length === 0) return;
      content.innerHTML = '';
      syncCurrentChatHTML();
    });

    uploadBtn.addEventListener('click', () => imageUploadInput.click());
    irUploadBtn.addEventListener('click', () => imageUploadInputIr.click());

    function updateFileBox() {
      const fileRgb = imageUploadInput.files[0];
      const fileIr = imageUploadInputIr.files[0];
      let names = [];
      if (fileRgb) names.push(`可见光: ${fileRgb.name}`);
      if (fileIr) names.push(`红外图: ${fileIr.name}`);

      if (names.length > 0) {
        fileBox.innerHTML = names.join('<br>');
        fileBox.style.visibility = 'visible';
        submit.className = "checked";
      } else {
        fileBox.style.visibility = 'hidden';
        if (tx.value.length === 0) submit.className = "unchecked";
      }
    }

    imageUploadInput.addEventListener('change', updateFileBox);
    imageUploadInputIr.addEventListener('change', updateFileBox);

    tx.addEventListener('input', () => {
      let num = tx.value.length;
      total.innerHTML = `${num}/1000字`;
      const hasFile = imageUploadInput.files.length > 0 || imageUploadInputIr.files.length > 0;
      submit.className = (num >= 1 || hasFile) ? "checked" : "unchecked";
    });
  }

  // 语音识别
  function setupVoiceRecognition() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'zh-CN';

      recognition.onresult = (event) => {
        let currentTranscript = '';
        for (let i = 0; i < event.results.length; i++) {
          currentTranscript += event.results[i][0].transcript;
        }
        tx.value = textBeforeRecording + currentTranscript;
        tx.dispatchEvent(new Event('input'));
      };

      recognition.onerror = (event) => {
        console.error('语音识别发生错误:', event.error);
        stopRecording();
      };
      recognition.onend = () => { if (isRecording) stopRecording(); };
    }

    function startRecording() {
      if (!recognition) return alert('当前浏览器不支持语音识别。');
      isRecording = true;
      micBtn.classList.add('recording');
      textBeforeRecording = tx.value;
      try { recognition.start(); } catch (e) { }
    }

    function stopRecording() {
      isRecording = false;
      micBtn.classList.remove('recording');
      if (recognition) recognition.stop();
    }

    micBtn.addEventListener('click', () => {
      isRecording ? stopRecording() : startRecording();
    });
  }

  // 发送消息与模型请求
  function setupMessageSending() {
    tx.addEventListener('keyup', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });

    submit.addEventListener('click', handleSend);

    async function handleSend() {
      const textValue = tx.value.trim();
      const fileRgb = imageUploadInput.files[0];
      const fileIr = imageUploadInputIr.files[0];

      if (!activeChatId || (textValue.length === 0 && !fileRgb && !fileIr)) return;

      const tempImgIdRgb = "user-img-rgb-" + Date.now();
      const tempImgIdIr = "user-img-ir-" + Date.now();
      let fileUrlRgb = fileRgb ? URL.createObjectURL(fileRgb) : null;
      let fileUrlIr = fileIr ? URL.createObjectURL(fileIr) : null;

      // 渲染用户气泡
      renderUserMessage(textValue, fileUrlRgb, fileUrlIr, tempImgIdRgb, tempImgIdIr);

      total.innerHTML = `0/1000字`;
      tx.value = '';
      imageUploadInput.value = '';
      imageUploadInputIr.value = '';
      fileBox.style.visibility = 'hidden';
      submit.className = "unchecked";

      const formData = new FormData();
      formData.append("text", textValue);
      if (fileRgb) formData.append("image", fileRgb);
      if (fileIr) formData.append("image_ir", fileIr); // 对应后端新增字段

      try {
        const response = await fetch('/api/chat/qwen', { method: 'POST', body: formData });
        const resData = await response.json();

        // 替换真实 URL
        if (resData.user_image_url) {
          const uImgRgb = document.getElementById(tempImgIdRgb);
          if (uImgRgb) uImgRgb.src = resData.user_image_url;
        }
        if (resData.user_image_url_ir) {
          const uImgIr = document.getElementById(tempImgIdIr);
          if (uImgIr) uImgIr.src = resData.user_image_url_ir;
        }

        renderAIMessage(resData.reply, resData.generated_image_url || resData.annotated_image_url);
      } catch (error) {
        renderAIMessage("网络请求失败或服务器异常，请检查后台运行状态。");
      }
    }

    // 支持接收两个 URL 和对应的 ID
    function renderUserMessage(text, imgUrlRgb = null, imgUrlIr = null, imgIdRgb = null, imgIdIr = null) {
      const talk = document.createElement('div');
      talk.className = 'talk';
      const textHtml = text ? `<div class="text">${text.replace(/\n/g, '<br>')}</div>` : '';
      
      let imgsHtml = '';
      if (imgUrlRgb || imgUrlIr) {
        imgsHtml += `<div class="img-group">`;
        if (imgUrlRgb) imgsHtml += `<img src="${imgUrlRgb}" id="${imgIdRgb}" class="chat-img" alt="可见光" title="可见光">`;
        if (imgUrlIr) imgsHtml += `<img src="${imgUrlIr}" id="${imgIdIr}" class="chat-img" alt="红外" title="红外">`;
        imgsHtml += `</div>`;
      }

      talk.innerHTML = `
        <div class="info"><span class="time">${new Date().toLocaleString()}</span><span class="font"></span></div>
        ${textHtml}${imgsHtml}
      `;
      content.appendChild(talk);
      content.scrollTop = content.scrollHeight;
      syncCurrentChatHTML();
    }

    function renderAIMessage(text, imgUrl = null) {
      const talk = document.createElement('div');
      talk.className = 'reply_talk';
      
      const ttsClass = 'muted'; 

      const textHtml = text ? `
        <div class="reply_content_wrapper">
          <div class="reply_text">${text.replace(/\n/g, '<br>')}</div>
          <span class="tts-icon ${ttsClass}" title="点击切换语音播报"></span>
        </div>` : '';

      const imgHtml = imgUrl ? `<img src="${imgUrl}" class="chat-img" alt="分析结果图">` : '';

      talk.innerHTML = `
        <div class="reply_info"><span class="reply_font"></span><span class="reply_time">${new Date().toLocaleString()}</span></div>
        ${textHtml}${imgHtml}
      `;
      content.appendChild(talk);
      content.scrollTop = content.scrollHeight;
      syncCurrentChatHTML();

      if (isAutoRead && text) {
        setTimeout(() => {
          const newIcon = talk.querySelector('.tts-icon');
          const textToRead = text.replace(/\n/g, '，');
          playTTS(textToRead, newIcon);
        }, 100);
      }
    }
  }

  // 模块 F: TTS语音合成
  function setupTTS() {
    window.currentUtterance = null;

    window.playTTS = function (text, iconElement) {
      if (!('speechSynthesis' in window)) {
        alert("当前浏览器不支持语音合成");
        return;
      }

      // 1. 如果点击的是正在播放的图标，则停止播放并重置状态
      if (iconElement && iconElement.classList.contains('reading')) {
        window.speechSynthesis.cancel();
        iconElement.classList.remove('reading');
        iconElement.classList.add('muted');
        isAutoRead = false; // 手动停止时，取消后续的全局自动播报
        syncCurrentChatHTML();
        return;
      }

      // 2. 准备播放新语音前，停止其它正在播放的语音，重置所有图标状态
      window.speechSynthesis.cancel();
      document.querySelectorAll('.tts-icon').forEach(icon => {
        icon.classList.remove('reading');
        icon.classList.add('muted');
      });

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      window.currentUtterance = utterance;

      // 3. 真正开始播放时，切换当前图标为动效状态
      utterance.onstart = () => {
        if (iconElement) {
          iconElement.classList.remove('muted');
          iconElement.classList.add('reading');
          syncCurrentChatHTML();
        }
      };

      // 4. 播放自然结束或出错时，恢复图标为静止状态
      utterance.onend = utterance.onerror = () => {
        if (iconElement) {
          iconElement.classList.remove('reading');
          iconElement.classList.add('muted');
          syncCurrentChatHTML();
        }
      };

      window.speechSynthesis.speak(utterance);
    };

    // 5. 使用事件委托绑定到 content 父容器
    // 这样哪怕聊天内容被 innerHTML 重新渲染，点击事件也依然有效
    content.addEventListener('click', (e) => {
      if (e.target.classList.contains('tts-icon')) {
        const wrapper = e.target.closest('.reply_content_wrapper');
        if (!wrapper) return;
        const textElement = wrapper.querySelector('.reply_text');
        if (!textElement) return;

        // 提取纯文本，并将换行符替换为逗号，以获得更自然的语音停顿
        const textToRead = textElement.innerHTML.replace(/<br\s*\/?>/gi, '，').replace(/<[^>]+>/g, '');

        isAutoRead = true;
        playTTS(textToRead, e.target);
      }
    });
  }

  setupTTS();
  setupChatListManager();
  setupInputControls();
  setupVoiceRecognition();
  setupMessageSending();

  loadChatContent();
}

// ==========================================
// 4. 页面生命周期挂载
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  initBackground();
  initUser();
  initChatSystem();
});
