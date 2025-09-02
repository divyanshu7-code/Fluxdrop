// public/main.js
const $ = (s) => document.querySelector(s);
const api = (path, opts = {}) => fetch(path, opts).then(r => r.json());

let socket = null;
let currentRoom = null;
let syncing = false;
let expiryTimer = null;

function setHidden(el, hidden) {
  if (!el) return;
  hidden ? el.classList.add('hidden') : el.classList.remove('hidden');
}

function formatExpiry(ts) {
  const d = new Date(ts);
  return `Expires at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function showToast(msg, ms = 2000) {
  const container = document.getElementById('toast');
  if (!container) return;
  const t = document.createElement('div');
  t.textContent = msg;
  t.style = "background:rgba(0,0,0,0.8);color:#fff;padding:8px 12px;border-radius:8px;margin-top:8px;pointer-events:auto;";
  container.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => container.removeChild(t), 300);
  }, ms);
}

// 🆕 Sync dot updates
function setSyncDot(color, text) {
  $('#syncDot').style.background = color;
  $('#syncStatus').textContent = text;
}

async function createRoom() {
  try {
    const res = await api('/api/room', { method: 'POST' });
    showToast('Room created');
    joinRoom(res.roomId, res.expiresAt);
  } catch (e) {
    console.error('createRoom error', e);
    showToast('Failed to create room');
  }
}

function cleanRoomId(raw) {
  return (raw || '').trim().replace(/[^0-9a-zA-Z]/g, '');
}

function clearQRCode() {
  const qr = document.getElementById('qrcanvas');
  if (!qr) return;
  qr.innerHTML = '';
}

function startExpiryCountdown(expiresAt) {
  if (expiryTimer) clearInterval(expiryTimer);
  function update() {
    const now = Date.now();
    const diff = expiresAt - now;
    if (diff <= 0) {
      $('#countdown').textContent = 'Room expired';
      clearInterval(expiryTimer);
      expiryTimer = null;
      return;
    }
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    $('#countdown').textContent = `Expires in ${minutes}m ${seconds}s`;
  }
  update();
  expiryTimer = setInterval(update, 1000);
}

async function joinRoom(roomId, expiresAt) {
  if (socket) {
    try { socket.disconnect(); } catch (e) {}
    socket = null;
  }

  currentRoom = roomId;
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  history.replaceState(null, '', url.toString());

  $('#roomId').textContent = roomId;
  $('#expiry').textContent = expiresAt ? formatExpiry(expiresAt) : '';
  setHidden($('#room'), false);
  setHidden($('#setup'), true);

  clearQRCode();
  const roomUrl = `${location.origin}?room=${encodeURIComponent(roomId)}`;
  try {
    new QRCode(document.getElementById("qrcanvas"), {
      text: roomUrl,
      width: 160,
      height: 160
    });
  } catch (e) {
    console.warn("QRCode generation failed:", e);
  }

  socket = io();
  socket.on('connect', () => {
    socket.emit('join', roomId);
    showToast('Connected to room');
    setSyncDot('orange', 'Connecting...');
  });

  socket.on('disconnect', () => {
    showToast('Disconnected');
    setSyncDot('gray', 'Disconnected');
  });

  socket.on('room:joined', ({ text, expiresAt: ex }) => {
    $('#textArea').value = text || '';
    if (ex) {
      $('#expiry').textContent = formatExpiry(ex);
      startExpiryCountdown(ex);
    }
    setSyncDot('green', 'Connected');
  });

  socket.on('room:error', (msg) => showToast(msg));

  socket.on('text:sync', ({ text }) => {
    syncing = true;
    $('#textArea').value = text || '';
    setSyncDot('green', `Last synced at ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    setTimeout(() => syncing = false, 50);
  });

  socket.on('file:available', (file) => addFile(file));

  try {
    const info = await api(`/api/room/${roomId}`);
    $('#textArea').value = info.text || '';
    if (info.expiresAt) {
      $('#expiry').textContent = formatExpiry(info.expiresAt);
      startExpiryCountdown(info.expiresAt);
    }
  } catch (e) {
    console.warn("Room fetch failed:", e);
  }
}

function addFile(file) {
  const el = document.createElement('div');
  el.className = 'fileItem';
  const sizeKB = Math.ceil(file.size / 1024);
  el.innerHTML = `<div><strong>${file.name}</strong><div class="muted">${sizeKB} KB</div></div>
                  <a href="${file.url}" download>Download</a>`;
  $('#files').prepend(el);
}

function uploadFileWithProgress(roomId, file) {
  return new Promise((resolve, reject) => {
    const filesDiv = $('#files');
    const wrapper = document.createElement('div');
    wrapper.className = 'fileItem';
    const label = document.createElement('div');
    label.innerHTML = `<strong>${file.name}</strong><div class="muted">0 KB</div>`;
    const prog = document.createElement('div');
    prog.textContent = 'Uploading: 0%';
    prog.style.fontSize = '12px';
    wrapper.appendChild(label);
    wrapper.appendChild(prog);
    filesDiv.prepend(wrapper);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload/${roomId}`);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          prog.textContent = 'Upload complete';
          resolve(res);
        } catch (e) {
          prog.textContent = 'Upload finished (bad response)';
          resolve(null);
        }
      } else {
        prog.textContent = `Upload failed (${xhr.status})`;
        reject(new Error('Upload failed'));
      }
    };
    xhr.onerror = () => {
      prog.textContent = 'Upload error';
      reject(new Error('Network error'));
    };
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const pct = Math.round((ev.loaded / ev.total) * 100);
      prog.textContent = `Uploading: ${pct}%`;
      label.querySelector('.muted').textContent = `${Math.ceil(ev.loaded/1024)} KB`;
    };
    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  });
}

function setupHandlers() {
  $('#createRoomBtn').addEventListener('click', createRoom);
  $('#joinBtn').addEventListener('click', () => {
    const code = cleanRoomId($('#roomInput').value);
    if (code.length < 4) return showToast('Enter a valid code');
    joinRoom(code);
  });

  $('#copyBtn').addEventListener('click', async () => {
    const link = `${location.origin}?room=${encodeURIComponent(currentRoom)}`;
    try {
      await navigator.clipboard.writeText(link);
      showToast('Link copied!');
    } catch {
      prompt('Copy the link:', link);
    }
  });

  $('#uploadBtn').addEventListener('click', async () => {
    const f = $('#fileInput').files[0];
    if (!f) return showToast('Choose a file first');
    if (!currentRoom) return showToast('Join/create a room first');
    try {
      const res = await uploadFileWithProgress(currentRoom, f);
      if (res) addFile(res);
      showToast('File uploaded');
    } catch {
      showToast('Upload failed');
    }
  });

  $('#textArea').addEventListener('input', (e) => {
    if (syncing) return;
    if (!socket || !currentRoom) return;
    socket.emit('text:update', { roomId: currentRoom, text: e.target.value });
    setSyncDot('orange', 'Syncing...');
  });

  $('#copyTextBtn').addEventListener('click', async () => {
    const val = $('#textArea').value;
    try {
      await navigator.clipboard.writeText(val);
      showToast('Text copied!');
    } catch {
      prompt("Copy this text:", val);
    }
  });

  const params = new URLSearchParams(location.search);
  const room = cleanRoomId(params.get('room'));
  if (room) joinRoom(room);
}

async function setupMobileLink() {
  try {
    const res = await fetch("/api/ip");
    const data = await res.json();
    const link = `http://${data.ip}:${data.port}`;
    document.getElementById("mobileLink").innerText = link;
    document.getElementById("copyMobileBtn").onclick = async () => {
      try {
        await navigator.clipboard.writeText(link);
        showToast("Mobile link copied");
      } catch {
        prompt("Copy this link:", link);
      }
    };
  } catch {
    document.getElementById("mobileLink").innerText = "Could not fetch mobile link";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupHandlers();
  setupMobileLink();
});
