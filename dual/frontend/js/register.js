// ==========================================
// 1. 无人机与背景特效 (3D机身 + 2D长机臂)
// ==========================================
function initDroneAnimation() {
    const canvas = document.getElementById('bg-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let width, height;
    let time = 0;

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    }

    window.addEventListener('resize', resize);
    resize();

    // 无人机点云生成
    const droneParticles = [];
    function createDroneShape() {
        const step = 4;

        // 1. 3D立体机身
        for (let x = -36; x <= 36; x += step) {
            for (let y = -12; y <= 12; y += step) {
                for (let z = -52; z <= 52; z += step) {
                    if (x * x / (36 * 36) + y * y / (12 * 12) + z * z / (52 * 52) <= 1) {
                        if (Math.random() > 0.2) {
                            droneParticles.push({ x: x, y: y, z: z, color: '#00F0FF' });
                        }
                    }
                }
            }
        }

        // 机身底部的3D云台
        for (let angle = 0; angle < Math.PI * 2; angle += 0.35) {
            for (let r = 0; r <= 15; r += 4) {
                droneParticles.push({
                    x: Math.cos(angle) * r,
                    y: 18,
                    z: Math.sin(angle) * r,
                    color: '#FFFFFF'
                });
            }
        }

        // 2. 扁平2D机臂与旋翼
        const armLength = 110;
        const angles = [45, 135, 225, 315];

        angles.forEach(angle => {
            const rad = angle * Math.PI / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);

            // 扁平机臂
            for (let r = 32; r < armLength; r += step) {
                droneParticles.push({ x: r * cos, y: 0, z: r * sin, color: '#1E6FF2' });
                droneParticles.push({ x: r * cos - 2.5 * sin, y: 0, z: r * sin + 2.5 * cos, color: '#1E6FF2' });
                droneParticles.push({ x: r * cos + 2.5 * sin, y: 0, z: r * sin - 2.5 * cos, color: '#1E6FF2' });
            }

            // 扁平飞行盘/旋翼
            const mx = armLength * cos;
            const mz = armLength * sin;
            const rotorRadius = 24;

            for (let a = 0; a < Math.PI * 2; a += 0.2) {
                for (let r = 8; r <= rotorRadius; r += 4) {
                    droneParticles.push({
                        x: mx + Math.cos(a) * r,
                        y: 0,
                        z: mz + Math.sin(a) * r,
                        color: '#00F0FF'
                    });
                }
            }
        });
    }
    createDroneShape();

    // 渲染水波纹背景
    function drawRipples() {
        const numLines = 35;
        ctx.lineWidth = 1.5;

        for (let i = 0; i < numLines; i++) {
            const yOffset = height * 0.5 + i * 18;
            if (yOffset > height + 50) break;

            ctx.beginPath();
            const alpha = Math.max(0, 1 - (i / numLines));
            ctx.strokeStyle = `rgba(0, 240, 255, ${alpha * 0.5})`;

            for (let x = 0; x <= width; x += 15) {
                const noise1 = Math.sin(x * 0.005 + time * 0.02 + i * 0.1) * 20;
                const noise2 = Math.sin(x * 0.003 - time * 0.015 + i * 0.2) * 15;
                const noise3 = Math.sin(x * 0.01 + time * 0.03) * 5;

                const perspective = 1 + (i * 0.08);
                const y = yOffset + (noise1 + noise2 + noise3) * perspective;

                if (x === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();

            // 波峰发光点
            if (i % 3 === 0) {
                for (let x = 0; x <= width; x += 60) {
                    if (Math.random() > 0.9) {
                        const noise = Math.sin(x * 0.005 + time * 0.02 + i * 0.1) * 20 + Math.sin(x * 0.003 - time * 0.015 + i * 0.2) * 15;
                        const y = yOffset + noise * (1 + i * 0.08);
                        ctx.fillStyle = `rgba(0, 240, 255, ${alpha})`;
                        ctx.beginPath();
                        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }
        }
    }

    // 渲染无人机
    let droneRotY = 0;
    const droneRotX = 0.25;

    function renderDrone() {
        droneRotY -= 0.008;

        // 布局靠左，避开注册框
        const cx = width * 0.3;
        const cy = height * 0.35 + Math.sin(time * 0.03) * 15;
        const scale = Math.min(width, height) * 0.0038;

        const sinY = Math.sin(droneRotY);
        const cosY = Math.cos(droneRotY);
        const sinX = Math.sin(droneRotX);
        const cosX = Math.cos(droneRotX);

        ctx.save();
        ctx.translate(cx, cy);

        // 椭圆声呐扫描光波
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
            const wt = ((time + i * 25) % 100) / 100;
            ctx.beginPath();
            ctx.ellipse(0, 70 + wt * 150, 40 + wt * 200, 10 + wt * 50, 0, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(0, 240, 255, ${0.6 * (1 - wt)})`;
            ctx.stroke();

            ctx.setLineDash([10, 15]);
            ctx.beginPath();
            ctx.ellipse(0, 70 + wt * 150, 60 + wt * 250, 15 + wt * 60, 0, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(30, 111, 242, ${0.4 * (1 - wt)})`;
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // 渲染混合点阵
        droneParticles.forEach(p => {
            let rx = p.x * cosY - p.z * sinY;
            let rz = p.x * sinY + p.z * cosY;
            let ry = p.y;

            let rry = ry * cosX - rz * sinX;
            let rrz = ry * sinX + rz * cosX;

            const zOff = rrz + 300;
            const fov = 400;
            const projScale = fov / zOff;

            const px = rx * projScale * scale;
            const py = rry * projScale * scale;

            const alpha = Math.min(1, Math.max(0.35, 1 - (rrz + 80) / 250));
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;

            ctx.beginPath();
            ctx.arc(px, py, 2.0 * projScale, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.restore();
    }

    function animate() {
        ctx.fillStyle = 'rgba(10, 15, 31, 0.3)';
        ctx.fillRect(0, 0, width, height);

        drawRipples();
        renderDrone();

        time++;
        requestAnimationFrame(animate);
    }

    animate();
}

// ==========================================
// 2. 密码可见性切换逻辑
// ==========================================
function initPasswordToggle() {
    const toggleBtns = document.querySelectorAll('.icon-eye-toggle');
    toggleBtns.forEach(btn => {
        btn.addEventListener('click', function () {
            const targetInput = document.getElementById(this.getAttribute('data-target'));
            if (targetInput) {
                targetInput.type = targetInput.type === 'password' ? 'text' : 'password';
                this.classList.toggle('eye-open');
            }
        });
    });
}

// ==========================================
// 3. 表单前端 UI 校验逻辑
// ==========================================
function initFormValidation() {
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirm-password');
    const usernameMsg = document.getElementById('username-msg');
    const passwordMsg = document.getElementById('password-msg');
    const confirmPasswordMsg = document.getElementById('confirm-password-msg');

    function showSuccess(element, message = '输入正确') {
        element.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${message}`;
        element.className = 'validation-message show success';
    }

    function showError(element, message) {
        element.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ${message}`;
        element.className = 'validation-message show error';
    }

    function clearMessage(element) {
        element.className = 'validation-message';
        setTimeout(() => { if (element.className === 'validation-message') element.innerHTML = ''; }, 300);
    }

    function validateConfirmPassword() {
        const pwd = passwordInput.value, confirm = confirmPasswordInput.value;
        if (confirm.length === 0) return clearMessage(confirmPasswordMsg);
        pwd === confirm ? showSuccess(confirmPasswordMsg) : showError(confirmPasswordMsg, '两次密码输入不一致');
    }

    if (usernameInput) usernameInput.addEventListener('input', function () {
        this.value.trim().length > 0 ? showSuccess(usernameMsg) : clearMessage(usernameMsg);
    });

    if (passwordInput) passwordInput.addEventListener('input', function () {
        if (this.value.length > 0) {
            showSuccess(passwordMsg);
            if (confirmPasswordInput.value.length > 0) validateConfirmPassword();
        } else {
            clearMessage(passwordMsg);
            if (confirmPasswordInput.value.length > 0) validateConfirmPassword();
        }
    });

    if (confirmPasswordInput) confirmPasswordInput.addEventListener('input', validateConfirmPassword);
}

// ==========================================
// 4. 注册提交与后端交互
// ==========================================
function initRegisterSubmit() {
    const registerForm = document.getElementById('register-form');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirm-password');
    const confirmPasswordMsg = document.getElementById('confirm-password-msg');

    if (registerForm) {
        registerForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            if (passwordInput.value !== confirmPasswordInput.value) {
                confirmPasswordMsg.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> 两次密码输入不一致`;
                confirmPasswordMsg.className = 'validation-message show error';
                return;
            }

            const reqUsername = usernameInput.value.trim();
            const reqPassword = passwordInput.value.trim();

            if (!reqUsername || !reqPassword) return alert('请完善注册信息后再提交！');

            try {
                const response = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: reqUsername, password: reqPassword })
                });
                const res = await response.json();

                if (response.ok && (res.code === 200 || !res.code)) {
                    alert('注册成功，请前往登录！');
                    window.location.href = 'login.html';
                } else {
                    alert(res.message || '注册失败，用户名可能已存在！');
                }
            } catch (error) {
                console.error('注册请求失败:', error);
                alert('网络错误，请稍后再试！');
            }
        });
    }
}

// ==========================================
// 5. 页面生命周期挂载
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initDroneAnimation();
    initPasswordToggle();
    initFormValidation();
    initRegisterSubmit();
});