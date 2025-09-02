// server.js
// Final merged: file/text sharing + room management + mobile link API

const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const mime = require('mime-types');
const { customAlphabet } = require('nanoid');
const cors = require('cors');
const os = require('os');

const PORT = process.env.PORT || 3000;
const ROOM_TTL_MS = (process.env.ROOM_TTL_MIN || 60) * 60 * 1000; // default 60 min
const FILE_TTL_MS = (process.env.FILE_TTL_MIN || 60) * 60 * 1000; // default 60 min
const MAX_FILE_MB = process.env.MAX_FILE_MB ? parseInt(process.env.MAX_FILE_MB, 10) : 100;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// 🆕 Local IP detection
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (let name in interfaces) {
    for (let iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}
const localIP = getLocalIP();

// In-memory room store
const rooms = new Map(); // roomId -> { text: '', expiresAt: number }
const nanoid = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz', 6);

// Ensure uploads dir exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded files safely
app.use('/uploads', (req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'attachment');
  next();
}, express.static(uploadsDir, { dotfiles: 'deny', etag: true, index: false }));

// 🆕 Mobile Link API
app.get('/api/ip', (req, res) => {
  res.json({ ip: localIP, port: PORT });
});

// ---- REST API for Rooms ----

// Create room
app.post('/api/room', (req, res) => {
  const roomId = nanoid();
  const now = Date.now();
  rooms.set(roomId, { text: '', expiresAt: now + ROOM_TTL_MS });
  res.json({ roomId, expiresAt: now + ROOM_TTL_MS });
});

// Get room state
app.get('/api/room/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found or expired' });
  if (Date.now() > room.expiresAt) {
    rooms.delete(roomId);
    return res.status(410).json({ error: 'Room expired' });
  }
  res.json({ roomId, text: room.text, expiresAt: room.expiresAt });
});

// Multer setup
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const safeBase = path.basename(file.originalname).replace(/[^\w.\- ]+/g, '_');
    const ext = path.extname(safeBase) || '.' + (mime.extension(file.mimetype) || 'bin');
    const stamp = Date.now();
    cb(null, `${stamp}-${safeBase}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 }
});

// Upload file to room
app.post('/api/upload/:roomId', upload.single('file'), (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  if (!room) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: 'Room not found or expired' });
  }
  room.expiresAt = Math.max(room.expiresAt, Date.now() + 5 * 60 * 1000);

  const fileUrl = `/uploads/${path.basename(req.file.path)}`;
  const payload = {
    name: req.file.originalname,
    size: req.file.size,
    type: req.file.mimetype,
    url: fileUrl,
    uploadedAt: Date.now(),
    expiresAt: Date.now() + FILE_TTL_MS
  };

  // Schedule deletion
  setTimeout(() => {
    const fullPath = path.join(uploadsDir, path.basename(fileUrl));
    fs.unlink(fullPath, () => {});
  }, FILE_TTL_MS);

  io.to(roomId).emit('file:available', payload);
  res.json(payload);
});

// ---- Socket.io ----
io.on('connection', (socket) => {
  socket.on('join', (roomId) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('room:error', 'Room not found or expired');
      return;
    }
    socket.join(roomId);
    socket.emit('room:joined', { roomId, text: room.text, expiresAt: room.expiresAt });
  });

  socket.on('text:update', ({ roomId, text }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.text = String(text || '').slice(0, 20000);
    io.to(roomId).emit('text:sync', { text: room.text });
  });
});

// Cleanup expired rooms/files
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (now > room.expiresAt) rooms.delete(roomId);
  }
  fs.readdir(uploadsDir, (err, files) => {
    if (err) return;
    files.forEach((fname) => {
      const match = /^(\d+)-/.exec(fname);
      if (!match) return;
      const ts = parseInt(match[1], 10);
      if (Date.now() - ts > FILE_TTL_MS) {
        fs.unlink(path.join(uploadsDir, fname), () => {});
      }
    });
  });
}, 60 * 1000);

// ---- Start server ----
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ QuickShare running at: http://${localIP}:${PORT}`);
});
