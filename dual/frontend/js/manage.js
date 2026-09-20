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
  // 1. 获取登录的用户名和角色
  const currentUsername = localStorage.getItem('user');
  const currentRole = localStorage.getItem('role');

  // 2. 鉴权拦截
  if (!currentUsername) {
    alert('您尚未登录或登录已过期，请先登录！');
    window.location.href = 'login.html';
    return;
  }

  // 3. 渲染图标与原字体用户名
  const userInfoElements = document.querySelectorAll('.user-info');
  userInfoElements.forEach(infoDiv => {
    infoDiv.innerHTML = `
            <i style="font-family: 'icomoon' !important; font-style: normal; margin-right: 5px;">&#xe971;</i>
            <span style="font-family: inherit;">${currentUsername}</span>
        `;
  });

  // 4. 权限控制：如果不是admin，则隐藏【用户管理】，并自动跳转至【区域管理】
  if (currentUsername !== 'admin' && currentRole !== 'admin') {
    const userManageTab = document.querySelector('.sidebar-item[data-target="user-manage"]');
    const userManagePanel = document.getElementById('user-manage');
    const regionManageTab = document.querySelector('.sidebar-item[data-target="region-manage"]');
    const regionManagePanel = document.getElementById('region-manage');

    // 隐藏并取消激活用户管理界面
    if (userManageTab) {
      userManageTab.style.display = 'none';
      userManageTab.classList.remove('active');
    }
    if (userManagePanel) {
      userManagePanel.classList.remove('active');
    }

    // 默认点亮并激活区域管理界面
    if (regionManageTab) {
      regionManageTab.classList.add('active');
    }
    if (regionManagePanel) {
      regionManagePanel.classList.add('active');
    }
  }
}

// tab栏切换
function initSidebarTabs() {
  const sidebarItems = document.querySelectorAll('.sidebar-item');
  const contentPanels = document.querySelectorAll('.content-panel');

  sidebarItems.forEach(item => {
    item.addEventListener('click', () => {
      // 1. 移除所有侧边栏项和内容面板的 active 类
      sidebarItems.forEach(nav => nav.classList.remove('active'));
      contentPanels.forEach(panel => panel.classList.remove('active'));

      // 2. 为当前点击的项添加 active 类
      item.classList.add('active');

      // 3. 根据 data-target 显示对应的右侧内容面板
      const targetId = item.getAttribute('data-target');
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) {
        targetPanel.classList.add('active');
      }
    });
  });
}

/* =========================================================
   表格交互功能模块 (复选框、删除、搜索)
========================================================= */

// 1. 初始化所有表格的交互逻辑
function initTableInteractions() {
  // 获取所有的 Tab 面板
  const panels = document.querySelectorAll('.content-panel');

  panels.forEach(panel => {
    setupCheckboxes(panel);
    setupDeleteRow(panel);
    setupSearch(panel);
  });
}

// 2. 全选/反选逻辑
function setupCheckboxes(panel) {
  // 获取当前面板内的表头主复选框和表格主体
  const masterCheckbox = panel.querySelector('thead input[type="checkbox"]');
  const tbody = panel.querySelector('tbody');

  if (!masterCheckbox || !tbody) return;

  // 2.1 点击表头主复选框：全选或全不选
  masterCheckbox.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    // 获取当前面板的所有数据行复选框
    const rowCheckboxes = tbody.querySelectorAll('input[type="checkbox"]');

    rowCheckboxes.forEach(cb => {
      // 只有当行没有被搜索隐藏时，才参与全选/反选操作 (优化体验)
      if (cb.closest('tr').style.display !== 'none') {
        cb.checked = isChecked;
      }
    });
  });

  // 2.2 点击数据行复选框：反向检查是否需要勾选主复选框
  // 使用事件委托绑定在 tbody 上，这样即使未来动态添加行也能生效
  tbody.addEventListener('change', (e) => {
    if (e.target.type === 'checkbox') {
      updateMasterCheckbox(panel);
    }
  });
}

// 根据子复选框的状态，更新表头主复选框的状态
function updateMasterCheckbox(panel) {
  const masterCheckbox = panel.querySelector('thead input[type="checkbox"]');
  const tbody = panel.querySelector('tbody');
  if (!masterCheckbox || !tbody) return;

  // 只统计当前处于显示状态的行
  const visibleRows = Array.from(tbody.querySelectorAll('tr')).filter(row => row.style.display !== 'none');
  const visibleCheckboxes = visibleRows.map(row => row.querySelector('input[type="checkbox"]'));

  if (visibleCheckboxes.length === 0) {
    masterCheckbox.checked = false;
    return;
  }

  // 判断是否所有显示的复选框都被勾选了
  const isAllChecked = visibleCheckboxes.every(cb => cb.checked);
  masterCheckbox.checked = isAllChecked;
}

// 3. 删除行逻辑
function setupDeleteRow(panel) {
  const tbody = panel.querySelector('tbody');
  if (!tbody) return;

  tbody.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-delete-outline')) {
      const row = e.target.closest('tr');
      if (row) {
        row.remove();
        updateMasterCheckbox(panel);
      }
    }
  });
}

// 4. 搜索逻辑
function setupSearch(panel) {
  const searchInput = panel.querySelector('.search-input');
  const searchBtn = panel.querySelector('.btn-search');
  const tbody = panel.querySelector('tbody');

  if (!searchInput || !searchBtn || !tbody) return;

  const performSearch = () => {
    const keyword = searchInput.value.trim().toLowerCase();
    const rows = tbody.querySelectorAll('tr');

    rows.forEach(row => {
      const rowText = row.textContent.toLowerCase();

      if (rowText.includes(keyword)) {
        row.style.display = '';
      } else {
        row.style.display = 'none';
        const cb = row.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = false;
      }
    });

    // 搜索过滤后，显示的行发生变化，更新主复选框状态
    updateMasterCheckbox(panel);
  };

  // 4.1 点击搜索按钮执行过滤
  searchBtn.addEventListener('click', performSearch);

  // 4.2 在搜索框中按下回车键也能触发搜索
  searchInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  });

  // 4.3 监听输入框的实时变化
  searchInput.addEventListener('input', (e) => {
    // 如果用户清空了输入框，立刻恢复显示所有行
    if (e.target.value.trim() === '') {
      performSearch();
    }
  });
}

async function loadUserData() {
  const panel = document.getElementById('user-manage');
  const tbody = panel.querySelector('tbody');
  if (!tbody) return;

  try {
    // 读取本地的JSON文件 (请确保路径正确)
    const response = await fetch('backend/users.json');
    if (!response.ok) {
      throw new Error('网络请求失败或找不到 backend/users.json');
    }
    const data = await response.json();

    let html = '';
    let baseId = 1215789125101;
    let index = 0;

    // 预设几个头像颜色循环使用
    const avatarColors = ['#ffca28', '#42a5f5', '#66bb6a', '#ab47bc'];

    // 遍历JSON对象的键名
    for (const username in data) {
      const id = baseId + index;

      // 判断角色
      const role = username === 'admin' ? '管理员' : '普通用户';
      const roleClass = username === 'admin' ? 'role-admin' : 'role-user';

      const avatarColor = avatarColors[index % avatarColors.length];

      // 简单编造一个创建时间
      const createDate = `2026-03-${String(12 + index).padStart(2, '0')} 11:45:14`;

      html += `
        <tr>
          <td><input type="checkbox"></td>
          <td>${id}</td>
          <td>${username}</td>
          <td>${username}</td> <td><i class="icon-user avatar-icon" style="color: ${avatarColor};"></i></td>
          <td>${createDate}</td>
          <td><span class="role-tag ${roleClass}">${role}</span></td>
          <td>
            <button class="btn btn-delete-outline">删除</button>
          </td>
        </tr>
      `;
      index++;
    }

    // 将生成的HTML注入到表格主体中
    tbody.innerHTML = html;

    // 渲染完毕后，由于可能是空数据或全选状态，触发一次主复选框的更新
    if (typeof updateMasterCheckbox === 'function') {
      updateMasterCheckbox(panel);
    }

  } catch (error) {
    console.error('加载用户数据失败:', error);
    // 如果 fetch 失败（例如直接双击打开 html 的跨域限制），这里可以给个提示
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:red;">无法加载用户数据，请检查服务是否开启或文件路径是否正确。</td></tr>`;
  }
}

/* =========================================================
   批量删除 与 模态框 业务逻辑
========================================================= */

// 获取当前格式化时间
function getFormattedTime() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

// 获取某一列的所有当前值（用于下拉框联动）
function getColumnValues(panelId, colIndex) {
  const tbody = document.querySelector(`#${panelId} tbody`);
  if (!tbody) return [];
  const rows = Array.from(tbody.querySelectorAll('tr')).filter(row => row.style.display !== 'none');
  return Array.from(new Set(rows.map(row => row.children[colIndex].textContent.trim())));
}

// 自动生成下一个顺延ID
function getNextId(panelId, idColIndex) {
  const tbody = document.querySelector(`#${panelId} tbody`);
  if (!tbody) return 1;
  const rows = tbody.querySelectorAll('tr');
  if (rows.length === 0) return panelId === 'intersection-info' ? 1001 : 1;
  let maxId = 0;
  rows.forEach(row => {
    const currentId = parseInt(row.children[idColIndex].textContent.trim(), 10);
    if (!isNaN(currentId) && currentId > maxId) maxId = currentId;
  });
  return maxId + 1;
}

// 初始化业务按钮
function initBusinessActions() {
  document.querySelectorAll('.btn-action').forEach(btn => {
    const btnText = btn.textContent.trim();

    // 1. 批量删除功能
    if (btnText === '批量删除') {
      btn.addEventListener('click', (e) => {
        const panel = e.target.closest('.content-panel');
        const checkedBoxes = panel.querySelectorAll('tbody input[type="checkbox"]:checked');

        // 要求：如果没有勾选，也可以选择不响应，或者给个简单提示。这里保留简单提示防止误点。
        if (checkedBoxes.length === 0) return alert('请先勾选需要删除的项！');

        // 取消了confirm提示，直接静默删除
        checkedBoxes.forEach(cb => cb.closest('tr').remove());
        if (typeof updateMasterCheckbox === 'function') updateMasterCheckbox(panel);
      });
    }

    // 2. 批量导出功能 (只导出左侧勾选的项目)
    if (btnText === '批量导出') {
      btn.addEventListener('click', (e) => {
        const panel = e.target.closest('.content-panel');
        // 获取当前面板下所有被勾选的复选框
        const checkedBoxes = panel.querySelectorAll('tbody input[type="checkbox"]:checked');

        // 如果没勾选，显示“无法导出”
        if (checkedBoxes.length === 0) {
          return alert('无法导出');
        }

        const panelId = panel.id;

        // 根据模块命名导出的 Excel 文件
        let fileName = 'data';
        if (panelId === 'user-manage') fileName = 'user';
        if (panelId === 'region-manage') fileName = 'region';
        if (panelId === 'intersection-info') fileName = 'road';
        if (panelId === 'device-info') fileName = 'device';

        // 将checkedBoxes传给导出函数
        exportToExcel(panel, fileName, checkedBoxes);
      });
    }
  });

  // 3. 新增按钮绑定
  bindAddButton('region-manage', '新增区域', '区域');
  bindAddButton('intersection-info', '新增路口', '路口');
  bindAddButton('device-info', '新增设备', '设备');

  // 4. 更新按钮绑定
  document.querySelectorAll('.content-panel').forEach(panel => {
    panel.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-edit-outline')) {
        const row = e.target.closest('tr');
        const panelId = panel.id;
        let typeName = panelId === 'region-manage' ? '区域' : (panelId === 'intersection-info' ? '路口' : '设备');
        openModal(panelId, typeName, row);
      }
    });
  });
}

function bindAddButton(panelId, btnText, typeName) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const btns = panel.querySelectorAll('.btn-action');
  btns.forEach(btn => {
    if (btn.textContent.trim() === btnText) {
      btn.addEventListener('click', () => openModal(panelId, typeName, null));
    }
  });
}

// 核心：打开模态框 (row为null表示新增，有值表示更新)
function openModal(panelId, typeName, row = null) {
  const modal = document.getElementById('common-modal');
  const title = document.getElementById('modal-title');
  const idDisplay = document.getElementById('modal-id-display');
  const formContainer = document.getElementById('modal-form-container');
  const confirmBtn = document.getElementById('btn-modal-confirm');
  const cancelBtn = document.getElementById('btn-modal-cancel');

  const isEdit = row !== null;
  title.textContent = isEdit ? `更新${typeName}信息` : `新增${typeName}信息`;
  confirmBtn.textContent = isEdit ? '更新' : '添加';

  // 表单配置字典
  let fields = [];
  if (panelId === 'region-manage') {
    fields = [
      { key: 'name', label: '区域名', valIndex: 2 },
      { key: 'desc', label: '区域描述', valIndex: 3 }
    ];
  } else if (panelId === 'intersection-info') {
    fields = [
      { key: 'region', label: '所属区域', type: 'select', options: getColumnValues('region-manage', 2), valIndex: 8 },
      { key: 'name', label: '路口名', valIndex: 2 },
      { key: 'lat', label: '纬度', valIndex: 3 },
      { key: 'lng', label: '经度', valIndex: 4 },
      { key: 'desc', label: '路口描述', valIndex: 5 }
    ];
  } else if (panelId === 'device-info') {
    fields = [
      { key: 'name', label: '设备名称', valIndex: 2 },
      { key: 'intersection', label: '所属路口', type: 'select', options: getColumnValues('intersection-info', 2), valIndex: 5 },
      { key: 'region', label: '所属区域', type: 'select', options: getColumnValues('region-manage', 2), valIndex: 6 }
    ];
  }

  // 生成表单HTML
  let formHtml = '';
  fields.forEach(f => {
    let currentVal = isEdit ? row.children[f.valIndex].textContent.trim() : '';
    if (f.type === 'select') {
      let optionsHtml = f.options.map(opt => `<option value="${opt}" ${currentVal === opt ? 'selected' : ''}>${opt}</option>`).join('');
      formHtml += `
        <div class="form-group">
          <label><span class="required">*</span>${f.label}:</label>
          <select id="input-${f.key}">${optionsHtml}</select>
        </div>`;
    } else {
      formHtml += `
        <div class="form-group">
          <label><span class="required">*</span>${f.label}:</label>
          <input type="text" id="input-${f.key}" value="${currentVal}" autocomplete="off">
        </div>`;
    }
  });

  formContainer.innerHTML = formHtml;

  // 如果是更新，显示当前ID
  let currentId = '';
  if (isEdit) {
    currentId = row.children[1].textContent.trim();
    idDisplay.textContent = `当前${typeName}id: ${currentId}`;
    idDisplay.style.display = 'block';
  } else {
    idDisplay.style.display = 'none';
  }

  modal.style.display = 'flex';

  // 确认按钮逻辑
  confirmBtn.onclick = () => {
    // 收集表单数据
    const formData = {};
    for (let f of fields) {
      const val = document.getElementById(`input-${f.key}`).value.trim();
      if (!val) return alert(`请填写完整的 ${f.label} 信息！`);
      formData[f.key] = val;
    }

    const currentTime = getFormattedTime();

    if (isEdit) {
      // 执行更新逻辑
      fields.forEach(f => {
        row.children[f.valIndex].textContent = formData[f.key];
      });
      // 更新“更新时间”列 
      if (panelId === 'region-manage') row.children[5].textContent = currentTime;
      if (panelId === 'intersection-info') row.children[7].textContent = currentTime;
      if (panelId === 'device-info') row.children[4].textContent = currentTime;
    } else {
      // 执行新增逻辑
      const tbody = document.querySelector(`#${panelId} tbody`);
      const newTr = document.createElement('tr');
      const newId = getNextId(panelId, 1);

      let tdsHtml = `<td><input type="checkbox"></td><td>${newId}</td>`;

      if (panelId === 'region-manage') {
        tdsHtml += `<td>${formData.name}</td><td>${formData.desc}</td><td>${currentTime}</td><td>${currentTime}</td>`;
      } else if (panelId === 'intersection-info') {
        tdsHtml += `<td>${formData.name}</td><td>${formData.lat}</td><td>${formData.lng}</td><td>${formData.desc}</td><td>${currentTime}</td><td>${currentTime}</td><td>${formData.region}</td>`;
      } else if (panelId === 'device-info') {
        tdsHtml += `<td>${formData.name}</td><td>${currentTime}</td><td>${currentTime}</td><td>${formData.intersection}</td><td>${formData.region}</td>`;
      }

      tdsHtml += `
        <td>
          <button class="btn btn-edit-outline">更新</button>
          <button class="btn btn-delete-outline">删除</button>
        </td>`;

      newTr.innerHTML = tdsHtml;
      tbody.appendChild(newTr);
    }

    modal.style.display = 'none';
  };

  // 取消关闭逻辑
  cancelBtn.onclick = () => modal.style.display = 'none';
}

// 导出指定表格数据为Excel
function exportToExcel(panel, fileName, checkedBoxes) {
  const table = panel.querySelector('.data-table');
  if (!table) return;

  const wsData = [];

  // 1. 提取表头
  const headers = [];
  const ths = table.querySelectorAll('thead th');
  for (let i = 1; i < ths.length - 1; i++) {
    headers.push(ths[i].textContent.trim());
  }

  // 动态寻找创建时间的索引，并在其前面插入参数配置
  let createTimeIndex = headers.indexOf('创建时间');
  if (createTimeIndex === -1) createTimeIndex = headers.length;
  headers.splice(createTimeIndex, 0, '参数配置');

  wsData.push(headers);

  // 2. 仅提取已勾选的表格行数据
  checkedBoxes.forEach(cb => {
    const tr = cb.closest('tr');
    // 确保行没有被搜索隐藏
    if (tr.style.display !== 'none') {
      const rowData = [];
      const tds = tr.querySelectorAll('td');
      for (let i = 1; i < tds.length - 1; i++) {
        rowData.push(tds[i].textContent.trim());
      }

      // 在与表头相同的索引位置，插入要求的精简版参数配置内容
      rowData.splice(createTimeIndex, 0, '{"configuration": 0.35, "imgsz"=640, "iou"="0.7"}');

      wsData.push(rowData);
    }
  });

  // 3. 将数组转换为Excel工作表
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // 4. 为第一行（表头）添加加粗样式和灰色背景
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let C = range.s.c; C <= range.e.c; ++C) {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c: C });
    if (!ws[cellAddress]) continue;
    ws[cellAddress].s = {
      font: { bold: true },
      fill: { fgColor: { rgb: "D9D9D9" } },
      alignment: { horizontal: "center", vertical: "center" }
    };
  }

  // 5. 优化排版
  const colWidths = headers.map(h => ({
    wch: h === '参数配置' ? 15 : (h.includes('描述') || h.includes('时间') ? 25 : Math.max(h.length * 3, 15))
  }));
  ws['!cols'] = colWidths;

  // 6. 创建工作簿并下载
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

  // 导出
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

document.addEventListener('DOMContentLoaded', () => {
  initBackground();
  initUser();
  initSidebarTabs();
  initTableInteractions();
  loadUserData();
  initBusinessActions();
});