# QuickShare MVP

A tiny, no-login way to share text/files between devices using a short room code and QR. Built with Express + Socket.IO.

## Features
- Create a one-time room link (6-character code)
- Scan QR to open same room on phone
- Realtime synced notes
- Upload file and get instant download link in the room
- Auto-deletes files after 60 minutes (configurable)
- Rooms expire after 60 minutes (configurable)

## Run locally
```bash
cd quickshare-mvp
npm install
npm start
```
Open http://localhost:3000

## Environment variables (optional)
- `PORT` — default `3000`
- `ROOM_TTL_MIN` — room lifetime in minutes (default `60`)
- `FILE_TTL_MIN` — file lifetime in minutes (default `60`)
- `MAX_FILE_MB` — max upload size in MB (default `100`)

## Notes (MVP limitations)
- In-memory rooms (restart clears them). Use Redis/DB for production.
- Files are served as downloads with `Content-Disposition: attachment` to reduce risk.
- No auth/password protection yet (easy to add per room).
- No virus scanning; avoid sensitive/unknown files.
