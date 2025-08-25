// 基本設定
const codeReader = new ZXing.BrowserMultiFormatReader();
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const startBtn = document.getElementById('startScan');
const stopBtn = document.getElementById('stopScan');
const cameraSelect = document.getElementById('cameraSelect');
const wineInfo = document.getElementById('wineInfo');
const manualInput = document.getElementById('manualInput');
const manualSubmit = document.getElementById('manualSubmit');
const historyTableBody = document.querySelector('#historyTable tbody');
const exportCSVBtn = document.getElementById('exportCSV');
const clearHistoryBtn = document.getElementById('clearHistory');

let currentStream = null;
let scanning = false;
let lastDraw = 0;

// Demo 資料表（可換成您自己的後端 API 呼叫）
let wineDB = null;

// 初始化
window.addEventListener('load', async () => {
  try {
    // 載入酒款資料
    const res = await fetch('wines.json');
    wineDB = await res.json();
  } catch(e) {
    console.warn('無法載入 wines.json，將使用空資料表。', e);
    wineDB = {};
  }

  // 列出可用攝影機
  try {
    const devices = await ZXing.BrowserCodeReader.listVideoInputDevices();
    devices.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `相機 ${i+1}`;
      cameraSelect.appendChild(opt);
    });
  } catch (e) {
    console.warn('列出影像裝置失敗：', e);
  }

  restoreHistory();
});

function drawOverlay(result) {
  const now = performance.now();
  if (now - lastDraw < 30) return; // 限制重繪頻率
  lastDraw = now;

  const w = video.videoWidth || overlay.width;
  const h = video.videoHeight || overlay.height;
  overlay.width = w;
  overlay.height = h;
  ctx.clearRect(0, 0, w, h);

  if (result && result.resultPoints) {
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#00ff00';
    ctx.beginPath();
    result.resultPoints.forEach((p, idx) => {
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.stroke();
  }
}

async function startScanWith(deviceId) {
  if (scanning) return;
  scanning = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;

  try {
    const constraints = deviceId ? { video: { deviceId: { exact: deviceId } } } : { video: { facingMode: 'environment' } };
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = currentStream;
    await video.play();

    requestAnimationFrame(loopOverlay);

    codeReader.decodeFromVideoDevice(deviceId || null, video, (result, err, controls) => {
      if (result) {
        drawOverlay(result);
        handlePayload(result.getText());
      } else if (err && !(err instanceof ZXing.NotFoundException)) {
        console.warn('掃描錯誤：', err);
      } else {
        drawOverlay(null);
      }
    });
  } catch (e) {
    alert('無法啟動相機：' + e.message);
    startBtn.disabled = false;
    stopBtn.disabled = true;
    scanning = false;
  }
}

function loopOverlay() {
  drawOverlay(null);
  if (scanning) requestAnimationFrame(loopOverlay);
}

function stopScan() {
  scanning = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  codeReader.reset();
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
  }
  ctx.clearRect(0,0,overlay.width,overlay.height);
}

startBtn.addEventListener('click', () => startScanWith(cameraSelect.value || null));
stopBtn.addEventListener('click', stopScan);
cameraSelect.addEventListener('change', () => {
  if (scanning) {
    stopScan();
    startScanWith(cameraSelect.value);
  }
});

manualSubmit.addEventListener('click', () => {
  const text = manualInput.value.trim();
  if (text) handlePayload(text);
});

function handlePayload(text) {
  // 規格：
  // 1) 內部代碼：  wine:<ID>  例如 wine:MERLOT_2019
  // 2) 一般 URL：  直接顯示為外部連結，同時嘗試從 wineDB 以 URL 或 ID 找資料
  // 3) 其他文字：  當作關鍵字，嘗試在 wineDB 以名稱比對

  let data = null;
  let raw = text;

  if (text.startsWith('wine:')) {
    const id = text.split(':')[1];
    data = wineDB[id] || null;
  } else if (isProbablyURL(text)) {
    // 嘗試以 URL 結尾的 ID 查詢（可依需求調整規則）
    const idGuess = text.split('/').pop().split('?')[0];
    data = wineDB[text] || wineDB[idGuess] || null;
  } else {
    // 關鍵字搜尋（名稱包含）
    const key = text.toLowerCase();
    for (const k in wineDB) {
      const item = wineDB[k];
      if ((item.name || '').toLowerCase().includes(key)) {
        data = item;
        raw = 'keyword:' + text;
        break;
      }
    }
  }

  showWine(data, raw);
  logHistory(raw, data);
}

function isProbablyURL(s) {
  try { new URL(s); return true; } catch { return false; }
}

function showWine(data, raw) {
  if (!data) {
    wineInfo.classList.remove('muted');
    wineInfo.innerHTML = `
      <div class="title">未找到酒款資料</div>
      <div class="meta">QR 內容：${escapeHTML(raw)}</div>
      <p>此內容未匹配內建資料表。您可修改 <code>wines.json</code> 加入此酒款，或讓 QR 直接連向商品頁。</p>
    `;
    return;
  }

  wineInfo.classList.remove('muted');
  wineInfo.innerHTML = `
    <div class="title">${escapeHTML(data.name || '（未命名）')}</div>
    <div class="meta">${escapeHTML(data.region || '—')} ｜ ${escapeHTML(data.variety || '—')} ｜ ${escapeHTML(data.vintage || '')}</div>
    <p>${escapeHTML(data.notes || '—')}</p>
    ${data.url ? `<p><a href="${escapeAttr(data.url)}" target="_blank" rel="noopener">查看商品頁</a></p>` : ''}
  `;
}

function logHistory(content, data) {
  const row = {
    ts: new Date().toISOString(),
    content,
    name: data?.name || '',
    region: data?.region || '',
    variety: data?.variety || ''
  };
  const old = JSON.parse(localStorage.getItem('scanHistory') || '[]');
  old.unshift(row);
  localStorage.setItem('scanHistory', JSON.stringify(old));
  renderHistory(old);
}

function restoreHistory() {
  const old = JSON.parse(localStorage.getItem('scanHistory') || '[]');
  renderHistory(old);
}

function renderHistory(list) {
  historyTableBody.innerHTML = '';
  for (const r of list) {
    const tr = document.createElement('tr');
    const time = new Date(r.ts).toLocaleString();
    tr.innerHTML = `
      <td>${escapeHTML(time)}</td>
      <td>${escapeHTML(r.content)}</td>
      <td>${escapeHTML(r.name)}</td>
      <td>${escapeHTML(r.region)}</td>
      <td>${escapeHTML(r.variety)}</td>
    `;
    historyTableBody.appendChild(tr);
  }
}

exportCSVBtn.addEventListener('click', () => {
  const list = JSON.parse(localStorage.getItem('scanHistory') || '[]');
  const rows = [['時間','內容','酒款名稱','產區','品種']].concat(
    list.map(r => [new Date(r.ts).toLocaleString(), r.content, r.name, r.region, r.variety])
  );
  const csv = rows.map(r => r.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'scan-history.csv';
  a.click();
  URL.revokeObjectURL(url);
});

clearHistoryBtn.addEventListener('click', () => {
  if (!confirm('確定要清空掃描紀錄？')) return;
  localStorage.removeItem('scanHistory');
  restoreHistory();
});

function escapeHTML(s){return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function escapeAttr(s){return String(s).replace(/"/g,'&quot;')}
