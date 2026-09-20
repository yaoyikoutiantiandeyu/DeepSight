// ==========================================
// 1. 鼠标互动粒子背景 + 2D 无人机
// ==========================================
function initCanvasEffects() {
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

    // 背景粒子系统参数
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

    // 2D无人机
    const droneParticles = [];
    const waves = [];
    let hoverTime = 0;

    function createDroneModel() {
        const step = 4;
        const addParticle = (x, y, type = 'body') => {
            droneParticles.push({
                ox: x, oy: y, size: 2.5,
                color: type === 'rotor' ? '#00F0FF' : (type === 'wave' ? '#FFFFFF' : '#1E6FF2'),
                alpha: type === 'rotor' ? 0.9 : 0.8, type,
                mx: 0, my: 0, angleOffset: 0, radius: 0
            });
        };
        const addRotorParticle = (mx, my, r, angle) => {
            droneParticles.push({
                ox: mx + r * Math.cos(angle), oy: my + r * Math.sin(angle),
                size: 2.5, color: '#00F0FF', alpha: 0.9, type: 'rotor',
                mx: mx, my: my, angleOffset: angle, radius: r
            });
        };

        // 2D机身
        for (let x = -36; x <= 36; x += step) {
            for (let y = -36; y <= 36; y += step) {
                const distSq = x * x + y * y;
                if (distSq < 36 * 36 && distSq > 14 * 14) addParticle(x, y, 'body');
            }
        }
        addParticle(0, 0, 'camera'); addParticle(0, step * 1.5, 'camera');
        addParticle(0, -step * 1.5, 'camera'); addParticle(step * 1.5, 0, 'camera');
        addParticle(-step * 1.5, 0, 'camera');

        // 机臂与旋翼
        const armLength = 90;
        [45, 135, 225, 315].forEach(angle => {
            const rad = angle * Math.PI / 180;
            const cos = Math.cos(rad); const sin = Math.sin(rad);

            for (let r = 38; r < armLength - 8; r += step) {
                addParticle(r * cos, r * sin, 'arm');
                addParticle(r * cos + step * sin, r * sin - step * cos, 'arm');
                addParticle(r * cos - step * sin, r * sin + step * cos, 'arm');
            }

            const mx = armLength * cos; const my = armLength * sin;
            for (let x = -14; x <= 14; x += step) {
                for (let y = -14; y <= 14; y += step) {
                    if (x * x + y * y <= 16 * 16) addParticle(mx + x, my + y, 'motor');
                }
            }

            const rotorRadius = 50;
            for (let r = rotorRadius - 6; r <= rotorRadius; r += 6) {
                let steps = Math.floor(2 * Math.PI * r / step);
                for (let i = 0; i < steps; i++) addRotorParticle(mx, my, r, (i / steps) * Math.PI * 2);
            }
            for (let r = 18; r < rotorRadius - 6; r += step) {
                addRotorParticle(mx, my, r, rad); addRotorParticle(mx, my, r, rad + Math.PI);
                addRotorParticle(mx, my, r, rad + Math.PI / 2); addRotorParticle(mx, my, r, rad - Math.PI / 2);
            }
        });
    }
    createDroneModel();

    // 动画启动
    function animate() {
        ctx.clearRect(0, 0, width, height);

        // 绘制背景网格和互动粒子
        drawGrid();
        for (let i = 0; i < bgParticles.length; i++) {
            let p = bgParticles[i];
            p.update(); p.draw();
            for (let j = i; j < bgParticles.length; j++) {
                let p2 = bgParticles[j];
                let dist = Math.sqrt(Math.pow(p.x - p2.x, 2) + Math.pow(p.y - p2.y, 2));
                if (dist < connectionDistance) {
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(0, 240, 255, ${(1 - dist / connectionDistance) * 0.4})`;
                    ctx.lineWidth = 0.5;
                    ctx.moveTo(p.x, p.y); ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                }
            }
        }

        // 再绘制无人机及其光波
        hoverTime += 0.03;
        const hoverOffset = Math.sin(hoverTime) * 12;

        let droneBaseX = width * 0.25;
        let droneBaseY = height * 0.5;
        if (width < 768) { droneBaseX = width * 0.5; droneBaseY = height * 0.3; }
        const droneScale = Math.min(width, height) / 1000 * 2.8;

        if (Math.random() < 0.02) waves.push({ r: 10, alpha: 0.7, speed: 2.0, width: 2.5 });

        for (let i = waves.length - 1; i >= 0; i--) {
            const wave = waves[i];
            wave.r += wave.speed; wave.alpha -= 0.004;
            if (wave.alpha <= 0 || wave.r > 1200) { waves.splice(i, 1); continue; }

            ctx.save();
            ctx.translate(droneBaseX, droneBaseY + hoverOffset);
            ctx.scale(droneScale, droneScale);
            ctx.beginPath();
            ctx.arc(0, 0, wave.r, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(0, 240, 255, ${wave.alpha})`;
            ctx.lineWidth = wave.width / droneScale;
            ctx.stroke();
            ctx.restore();
        }

        ctx.globalCompositeOperation = 'lighter';
        const globalRotate = Math.sin(hoverTime * 0.1) * 0.05;
        const cosR = Math.cos(globalRotate); const sinR = Math.sin(globalRotate);
        const rotorSpeed = hoverTime * 12;

        droneParticles.forEach(p => {
            let x = p.ox; let y = p.oy;
            if (p.type === 'rotor' && p.radius > 0) {
                const currentAngle = p.angleOffset + rotorSpeed;
                x = p.mx + p.radius * Math.cos(currentAngle);
                y = p.my + p.radius * Math.sin(currentAngle);
            }
            let finalX = x * cosR - y * sinR;
            let finalY = x * sinR + y * cosR;

            const screenX = droneBaseX + finalX * droneScale;
            const screenY = droneBaseY + hoverOffset + finalY * droneScale;
            const renderSize = Math.max(2.5, p.size * droneScale * 0.35);

            let alpha = p.alpha;
            if (p.type !== 'rotor' && Math.random() > 0.98) alpha = 1.0;

            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(screenX, screenY, renderSize, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;

        requestAnimationFrame(animate);
    }
    animate();
}

// ==========================================
// 2. 密码可见性切换逻辑
// ==========================================
function initPasswordToggle() {
    const passwordInput = document.getElementById('password-input');
    const togglePassword = document.getElementById('toggle-password');
    if (togglePassword && passwordInput) {
        togglePassword.addEventListener('click', function () {
            passwordInput.type = passwordInput.type === 'password' ? 'text' : 'password';
            this.classList.toggle('eye-open');
        });
    }
}

// ==========================================
// 3. 登录提交与后端交互
// ==========================================
function initLoginSubmit() {
    const loginForm = document.getElementById('login-form');
    const usernameInput = document.querySelector('#login-form input[type="text"]');
    const passwordInput = document.getElementById('password-input');

    if (loginForm) {
        loginForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            const enteredName = usernameInput.value.trim();
            const enteredPwd = passwordInput.value.trim();

            if (!enteredName || !enteredPwd) return alert('请输入完整的账号密码后再登录！');
            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: enteredName, password: enteredPwd })
                });
                const res = await response.json();

                if (response.ok && res.code === 200) {
                    localStorage.setItem('accessToken', res.data.accessToken);
                    localStorage.setItem('user', res.data.userInfo.username);
                    localStorage.setItem('role', res.data.userInfo.role);
                    window.location.href = 'index.html';
                } else {
                    alert(res.message || '登录失败，请检查账号密码！');
                    passwordInput.value = '';
                    passwordInput.focus();
                }
            } catch (error) {
                console.error('登录请求失败:', error);
                alert('网络错误，请确保后端服务已启动！');
            }
        });
    }
}

// ==========================================
// 4. 页面生命周期挂载
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initCanvasEffects();
    initPasswordToggle();
    initLoginSubmit();
});