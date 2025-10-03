const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const fs = require('fs');
const path = require('path');
const util = require('util');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 1e8 // 100 MB
});

const stat = util.promisify(fs.stat);

// Configuration
const PORT = 3000;
const VIDEOS_DIR = path.join(__dirname, 'videos');
const CHUNK_SIZE = 64 * 1024; // 64KB chunks for socket streaming

// Track active viewers and rooms
const activeViewers = new Map(); // videoId -> Set of socketIds
const watchSessions = new Map(); // socketId -> session data
const videoProgress = new Map(); // userId-videoId -> progress

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
  next();
});

// Socket.IO real-time features
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Join video room for real-time updates
  socket.on('join-video', (data) => {
    const { videoId, userId } = data;
    const room = `video-${videoId}`;

    socket.join(room);

    // Track viewer
    if (!activeViewers.has(videoId)) {
      activeViewers.set(videoId, new Set());
    }
    activeViewers.get(videoId).add(socket.id);

    // Store session data
    watchSessions.set(socket.id, { videoId, userId, joinedAt: Date.now() });

    // Notify others in room
    const viewerCount = activeViewers.get(videoId).size;
    io.to(room).emit('viewer-update', {
      viewerCount,
      message: `${userId || 'Anonymous'} joined`
    });

    // Send current viewer list
    socket.emit('viewer-count', { count: viewerCount });

    console.log(`${userId || socket.id} joined room: ${room}`);
  });

  // Stream video chunks via socket
  socket.on('stream-request', async (data) => {
    const { videoId, start = 0, chunkSize = CHUNK_SIZE } = data;

    try {
      const filename = Buffer.from(videoId, 'base64').toString('utf-8');
      const videoPath = path.join(VIDEOS_DIR, filename);

      if (!videoPath.startsWith(VIDEOS_DIR) || !fs.existsSync(videoPath)) {
        socket.emit('stream-error', { error: 'Video not found' });
        return;
      }

      const stats = await stat(videoPath);
      const end = Math.min(start + chunkSize - 1, stats.size - 1);

      const stream = fs.createReadStream(videoPath, { start, end });
      const chunks = [];

      stream.on('data', (chunk) => {
        chunks.push(chunk);
      });

      stream.on('end', () => {
        const buffer = Buffer.concat(chunks);
        socket.emit('stream-chunk', {
          data: buffer.toString('base64'),
          start,
          end,
          total: stats.size,
          hasMore: end < stats.size - 1
        });
      });

      stream.on('error', (err) => {
        socket.emit('stream-error', { error: 'Stream error' });
      });
    } catch (err) {
      socket.emit('stream-error', { error: 'Failed to stream video' });
    }
  });

  // Live progress tracking
  socket.on('progress-update', (data) => {
    const { videoId, userId, currentTime, duration, percentage } = data;
    const progressKey = `${userId}-${videoId}`;

    videoProgress.set(progressKey, {
      currentTime,
      duration,
      percentage,
      lastUpdated: Date.now()
    });

    // Broadcast to room (for watch party features)
    const room = `video-${videoId}`;
    socket.to(room).emit('viewer-progress', {
      userId,
      currentTime,
      percentage
    });
  });

  // Sync playback for watch parties
  socket.on('sync-playback', (data) => {
    const { videoId, action, currentTime } = data;
    const room = `video-${videoId}`;

    socket.to(room).emit('playback-sync', {
      action, // 'play', 'pause', 'seek'
      currentTime,
      timestamp: Date.now()
    });
  });

  // Live chat/comments
  socket.on('send-comment', (data) => {
    const { videoId, userId, message, timestamp } = data;
    const room = `video-${videoId}`;

    const comment = {
      id: Date.now(),
      userId: userId || 'Anonymous',
      message,
      timestamp: timestamp || Date.now()
    };

    io.to(room).emit('new-comment', comment);
  });

  // Real-time reactions
  socket.on('send-reaction', (data) => {
    const { videoId, reaction, currentTime } = data;
    const room = `video-${videoId}`;

    io.to(room).emit('video-reaction', {
      reaction, // '👍', '❤️', '😂', etc.
      currentTime,
      timestamp: Date.now()
    });
  });

  // Quality change request
  socket.on('quality-change', (data) => {
    const { videoId, quality } = data;
    socket.emit('quality-changed', { quality, message: `Switched to ${quality}p` });
  });

  // Get saved progress
  socket.on('get-progress', (data) => {
    const { videoId, userId } = data;
    const progressKey = `${userId}-${videoId}`;
    const progress = videoProgress.get(progressKey);

    socket.emit('progress-data', progress || null);
  });

  // Leave video room
  socket.on('leave-video', (data) => {
    handleLeaveVideo(socket, data?.videoId);
  });

  // Disconnect
  socket.on('disconnect', () => {
    const session = watchSessions.get(socket.id);
    if (session) {
      handleLeaveVideo(socket, session.videoId);
    }
    console.log(`User disconnected: ${socket.id}`);
  });
});

// Helper function to handle leaving video
function handleLeaveVideo(socket, videoId) {
  if (!videoId) return;

  const room = `video-${videoId}`;
  socket.leave(room);

  if (activeViewers.has(videoId)) {
    activeViewers.get(videoId).delete(socket.id);
    const viewerCount = activeViewers.get(videoId).size;

    io.to(room).emit('viewer-update', {
      viewerCount,
      message: 'A viewer left'
    });

    if (viewerCount === 0) {
      activeViewers.delete(videoId);
    }
  }

  watchSessions.delete(socket.id);
}

// REST API Endpoints (from previous version)
app.get('/api/videos', (req, res) => {
  fs.readdir(VIDEOS_DIR, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Unable to scan videos directory' });
    }

    const videos = files
      .filter(file => /\.(mp4|mkv|avi|mov|webm)$/i.test(file))
      .map(file => {
        const id = Buffer.from(file).toString('base64');
        const viewers = activeViewers.get(id)?.size || 0;

        return {
          id,
          name: file,
          url: `/api/stream/${id}`,
          viewers
        };
      });

    res.json({ videos, count: videos.length });
  });
});

app.get('/api/videos/:id/info', async (req, res) => {
  try {
    const filename = Buffer.from(req.params.id, 'base64').toString('utf-8');
    const videoPath = path.join(VIDEOS_DIR, filename);

    if (!videoPath.startsWith(VIDEOS_DIR)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const stats = await stat(videoPath);
    const ext = path.extname(filename).toLowerCase();
    const viewers = activeViewers.get(req.params.id)?.size || 0;

    res.json({
      name: filename,
      size: stats.size,
      sizeReadable: formatBytes(stats.size),
      format: ext.substring(1),
      created: stats.birthtime,
      modified: stats.mtime,
      viewers
    });
  } catch (err) {
    res.status(500).json({ error: 'Error retrieving video info' });
  }
});

app.get('/api/stream/:id', async (req, res) => {
  try {
    const filename = Buffer.from(req.params.id, 'base64').toString('utf-8');
    const videoPath = path.join(VIDEOS_DIR, filename);

    if (!videoPath.startsWith(VIDEOS_DIR)) {
      return res.status(403).send('Access denied');
    }

    if (!fs.existsSync(videoPath)) {
      return res.status(404).send('Video not found');
    }

    const stats = await stat(videoPath);
    const fileSize = stats.size;
    const range = req.headers.range;

    const ext = path.extname(filename).toLowerCase();
    const contentType = getContentType(ext);

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 1024 * 1024, fileSize - 1);

      if (start >= fileSize) {
        res.status(416).send('Requested range not satisfiable');
        return;
      }

      const chunksize = (end - start) + 1;
      const stream = fs.createReadStream(videoPath, { start, end });

      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600'
      };

      res.writeHead(206, head);
      stream.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600'
      };

      res.writeHead(200, head);
      fs.createReadStream(videoPath).pipe(res);
    }
  } catch (err) {
    res.status(500).send('Error streaming video');
  }
});

// Enhanced video player with Socket.IO
app.get('/player/:id', (req, res) => {
  const videoId = req.params.id;
  const filename = Buffer.from(videoId, 'base64').toString('utf-8');

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Real-time Video Player - ${filename}</title>
      <script src="/socket.io/socket.io.js"></script>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: Arial, sans-serif;
          background: #0f0f0f;
          color: #fff;
        }
        .container {
          max-width: 1400px;
          margin: 0 auto;
          padding: 20px;
        }
        .video-container {
          display: grid;
          grid-template-columns: 1fr 350px;
          gap: 20px;
        }
        .main-content { flex: 1; }
        video {
          width: 100%;
          max-height: 600px;
          background: #000;
          border-radius: 8px;
        }
        .stats {
          display: flex;
          gap: 20px;
          margin: 20px 0;
          padding: 15px;
          background: #1a1a1a;
          border-radius: 8px;
        }
        .stat {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .sidebar {
          background: #1a1a1a;
          border-radius: 8px;
          padding: 20px;
          height: fit-content;
        }
        .chat-container {
          height: 400px;
          overflow-y: auto;
          margin: 15px 0;
          padding: 10px;
          background: #0f0f0f;
          border-radius: 4px;
        }
        .comment {
          margin: 10px 0;
          padding: 8px;
          background: #2a2a2a;
          border-radius: 4px;
        }
        .comment-user {
          color: #2196F3;
          font-weight: bold;
        }
        .reactions {
          display: flex;
          gap: 10px;
          margin: 15px 0;
        }
        .reaction-btn {
          background: #2a2a2a;
          border: none;
          padding: 10px 15px;
          border-radius: 20px;
          font-size: 20px;
          cursor: pointer;
          transition: transform 0.2s;
        }
        .reaction-btn:hover {
          transform: scale(1.2);
        }
        input, button {
          padding: 10px;
          border: none;
          border-radius: 4px;
        }
        input {
          width: calc(100% - 80px);
          background: #2a2a2a;
          color: #fff;
        }
        button {
          background: #2196F3;
          color: white;
          cursor: pointer;
          width: 70px;
        }
        button:hover { background: #1976D2; }
        .live-indicator {
          display: inline-block;
          width: 8px;
          height: 8px;
          background: #f00;
          border-radius: 50%;
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .controls {
          display: flex;
          gap: 10px;
          margin-top: 15px;
        }
        .sync-btn {
          background: #4CAF50;
        }
        h3 { margin-bottom: 15px; color: #2196F3; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🎬 ${filename}</h1>
        
        <div class="video-container">
          <div class="main-content">
            <video id="videoPlayer" controls>
              <source src="/api/stream/${videoId}" type="video/mp4">
            </video>
            
            <div class="stats">
              <div class="stat">
                <span class="live-indicator"></span>
                <span><strong>Live Viewers:</strong> <span id="viewerCount">0</span></span>
              </div>
              <div class="stat">
                <span>👁️</span>
                <span id="viewerStatus">Connecting...</span>
              </div>
            </div>
            
            <div class="controls">
              <button onclick="location.href='/api/download/${videoId}'">📥 Download</button>
              <button onclick="location.href='/'" class="sync-btn">🏠 Home</button>
              <button onclick="syncPlay()" class="sync-btn">🔄 Sync Play</button>
              <button onclick="syncPause()" class="sync-btn">⏸️ Sync Pause</button>
            </div>
          </div>
          
          <div class="sidebar">
            <h3>💬 Live Chat</h3>
            <div class="chat-container" id="chatContainer"></div>
            <div style="display: flex; gap: 10px;">
              <input type="text" id="commentInput" placeholder="Say something..." onkeypress="handleKeyPress(event)">
              <button onclick="sendComment()">Send</button>
            </div>
            
            <h3 style="margin-top: 20px;">⚡ Quick Reactions</h3>
            <div class="reactions">
              <button class="reaction-btn" onclick="sendReaction('👍')">👍</button>
              <button class="reaction-btn" onclick="sendReaction('❤️')">❤️</button>
              <button class="reaction-btn" onclick="sendReaction('😂')">😂</button>
              <button class="reaction-btn" onclick="sendReaction('🔥')">🔥</button>
            </div>
          </div>
        </div>
      </div>
      
      <script>
        const socket = io();
        const video = document.getElementById('videoPlayer');
        const userId = 'User_' + Math.random().toString(36).substr(2, 9);
        let progressInterval;
        
        // Join video room
        socket.emit('join-video', {
          videoId: '${videoId}',
          userId: userId
        });
        
        // Update viewer count
        socket.on('viewer-update', (data) => {
          document.getElementById('viewerCount').textContent = data.viewerCount;
          document.getElementById('viewerStatus').textContent = data.message;
        });
        
        socket.on('viewer-count', (data) => {
          document.getElementById('viewerCount').textContent = data.count;
        });
        
        // Track and sync progress
        video.addEventListener('timeupdate', () => {
          if (video.currentTime > 0) {
            const percentage = (video.currentTime / video.duration) * 100;
            socket.emit('progress-update', {
              videoId: '${videoId}',
              userId: userId,
              currentTime: video.currentTime,
              duration: video.duration,
              percentage: percentage.toFixed(2)
            });
          }
        });
        
        // Playback sync
        socket.on('playback-sync', (data) => {
          if (data.action === 'play') {
            video.currentTime = data.currentTime;
            video.play();
          } else if (data.action === 'pause') {
            video.pause();
          } else if (data.action === 'seek') {
            video.currentTime = data.currentTime;
          }
        });
        
        function syncPlay() {
          socket.emit('sync-playback', {
            videoId: '${videoId}',
            action: 'play',
            currentTime: video.currentTime
          });
          video.play();
        }
        
        function syncPause() {
          socket.emit('sync-playback', {
            videoId: '${videoId}',
            action: 'pause',
            currentTime: video.currentTime
          });
          video.pause();
        }
        
        // Chat functionality
        socket.on('new-comment', (comment) => {
          const chatContainer = document.getElementById('chatContainer');
          const commentEl = document.createElement('div');
          commentEl.className = 'comment';
          commentEl.innerHTML = \`
            <div class="comment-user">\${comment.userId}</div>
            <div>\${comment.message}</div>
          \`;
          chatContainer.appendChild(commentEl);
          chatContainer.scrollTop = chatContainer.scrollHeight;
        });
        
        function sendComment() {
          const input = document.getElementById('commentInput');
          if (input.value.trim()) {
            socket.emit('send-comment', {
              videoId: '${videoId}',
              userId: userId,
              message: input.value
            });
            input.value = '';
          }
        }
        
        function handleKeyPress(e) {
          if (e.key === 'Enter') sendComment();
        }
        
        // Reactions
        function sendReaction(reaction) {
          socket.emit('send-reaction', {
            videoId: '${videoId}',
            reaction: reaction,
            currentTime: video.currentTime
          });
        }
        
        socket.on('video-reaction', (data) => {
          showReaction(data.reaction);
        });
        
        function showReaction(reaction) {
          const el = document.createElement('div');
          el.textContent = reaction;
          el.style.cssText = \`
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 100px;
            animation: fadeOut 1s forwards;
            pointer-events: none;
            z-index: 1000;
          \`;
          document.body.appendChild(el);
          setTimeout(() => el.remove(), 1000);
        }
        
        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
          socket.emit('leave-video', { videoId: '${videoId}' });
        });
      </script>
      
      <style>
        @keyframes fadeOut {
          to {
            opacity: 0;
            transform: translate(-50%, -50%) scale(2);
          }
        }
      </style>
    </body>
    </html>
  `);
});

// Home page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Real-time Video Streaming</title>
      <script src="/socket.io/socket.io.js"></script>
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
          background: #0f0f0f;
          color: #fff;
        }
        h1 { color: #2196F3; margin-bottom: 10px; }
        .subtitle {
          color: #888;
          margin-bottom: 30px;
        }
        .video-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 20px;
        }
        .video-card {
          background: #1a1a1a;
          padding: 20px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.3s;
          border: 2px solid transparent;
        }
        .video-card:hover {
          transform: translateY(-5px);
          border-color: #2196F3;
          box-shadow: 0 5px 20px rgba(33, 150, 243, 0.3);
        }
        .video-title {
          font-size: 18px;
          margin-bottom: 10px;
          color: #fff;
        }
        .video-stats {
          display: flex;
          gap: 15px;
          color: #888;
          font-size: 14px;
        }
        .live-badge {
          background: #f00;
          padding: 3px 8px;
          border-radius: 3px;
          font-size: 12px;
          animation: pulse 2s infinite;
        }
      </style>
    </head>
    <body>
      <h1>🎬 Real-time Video Streaming Platform</h1>
      <p class="subtitle">Experience live viewing with chat, reactions, and synchronized playback</p>
      <div class="video-grid" id="videoList">Loading videos...</div>
      
      <script>
        const socket = io();
        
        fetch('/api/videos')
          .then(r => r.json())
          .then(data => {
            const list = document.getElementById('videoList');
            if (data.videos.length === 0) {
              list.innerHTML = '<p>No videos found. Add videos to the "videos" directory.</p>';
              return;
            }
            list.innerHTML = data.videos.map(v => \`
              <div class="video-card" onclick="location.href='/player/\${v.id}'">
                <div class="video-title">📹 \${v.name}</div>
                <div class="video-stats">
                  <span>👁️ \${v.viewers} watching</span>
                  \${v.viewers > 0 ? '<span class="live-badge">LIVE</span>' : ''}
                </div>
              </div>
            \`).join('');
          });
        
        // Update viewer counts in real-time
        setInterval(() => {
          fetch('/api/videos')
            .then(r => r.json())
            .then(data => {
              data.videos.forEach(v => {
                const cards = document.querySelectorAll('.video-card');
                cards.forEach(card => {
                  if (card.onclick.toString().includes(v.id)) {
                    const stats = card.querySelector('.video-stats');
                    stats.innerHTML = \`
                      <span>👁️ \${v.viewers} watching</span>
                      \${v.viewers > 0 ? '<span class="live-badge">LIVE</span>' : ''}
                    \`;
                  }
                });
              });
            });
        }, 5000);
      </script>
    </body>
    </html>
  `);
});

// Helper functions
function getContentType(ext) {
  const types = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm'
  };
  return types[ext] || 'application/octet-stream';
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Create videos directory
if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
}

// Start server
server.listen(PORT, () => {
  console.log(`🎬 Real-time Video Streaming Server running on http://localhost:${PORT}`);
  console.log(`📁 Serving videos from: ${VIDEOS_DIR}`);
  console.log(`\n✨ Socket.IO Features:`);
  console.log(`  - Live viewer tracking`);
  console.log(`  - Real-time chat`);
  console.log(`  - Synchronized playback`);
  console.log(`  - Live reactions`);
  console.log(`  - Progress tracking`);
  console.log(`\n🔌 Socket Events:`);
  console.log(`  join-video, stream-request, progress-update`);
  console.log(`  sync-playback, send-comment, send-reaction`);
});