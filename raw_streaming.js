const express = require('express');
const fs = require('fs');
const path = require('path');
const util = require('util');

const app = express();
const stat = util.promisify(fs.stat);

// Configuration
const PORT = 3000;
const VIDEOS_DIR = path.join(__dirname, 'videos'); // Store your videos here
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
  next();
});

// Get list of available videos
app.get('/api/videos', (req, res) => {
  fs.readdir(VIDEOS_DIR, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Unable to scan videos directory' });
    }

    const videos = files
      .filter(file => /\.(mp4|mkv|avi|mov|webm)$/i.test(file))
      .map(file => ({
        id: Buffer.from(file).toString('base64'),
        name: file,
        url: `/api/stream/${Buffer.from(file).toString('base64')}`
      }));

    res.json({ videos, count: videos.length });
  });
});

// Get video metadata
app.get('/api/videos/:id/info', async (req, res) => {
  try {
    const filename = Buffer.from(req.params.id, 'base64').toString('utf-8');
    const videoPath = path.join(VIDEOS_DIR, filename);

    // Security check
    if (!videoPath.startsWith(VIDEOS_DIR)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const stats = await stat(videoPath);
    const ext = path.extname(filename).toLowerCase();

    res.json({
      name: filename,
      size: stats.size,
      sizeReadable: formatBytes(stats.size),
      format: ext.substring(1),
      created: stats.birthtime,
      modified: stats.mtime
    });
  } catch (err) {
    res.status(500).json({ error: 'Error retrieving video info' });
  }
});

// Stream video with range support
app.get('/api/stream/:id', async (req, res) => {
  try {
    const filename = Buffer.from(req.params.id, 'base64').toString('utf-8');
    const videoPath = path.join(VIDEOS_DIR, filename);

    // Security check
    if (!videoPath.startsWith(VIDEOS_DIR)) {
      return res.status(403).send('Access denied');
    }

    if (!fs.existsSync(videoPath)) {
      return res.status(404).send('Video not found');
    }

    const stats = await stat(videoPath);
    const fileSize = stats.size;
    const range = req.headers.range;

    // Get content type based on extension
    const ext = path.extname(filename).toLowerCase();
    const contentType = getContentType(ext);

    if (range) {
      // Parse range header
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + CHUNK_SIZE, fileSize - 1);

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

      stream.on('error', (err) => {
        console.error('Stream error:', err);
        res.end();
      });
    } else {
      // Stream entire file
      const head = {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600'
      };

      res.writeHead(200, head);
      const stream = fs.createReadStream(videoPath);
      stream.pipe(res);

      stream.on('error', (err) => {
        console.error('Stream error:', err);
        res.end();
      });
    }
  } catch (err) {
    console.error('Error streaming video:', err);
    res.status(500).send('Error streaming video');
  }
});

// Download video
app.get('/api/download/:id', async (req, res) => {
  try {
    const filename = Buffer.from(req.params.id, 'base64').toString('utf-8');
    const videoPath = path.join(VIDEOS_DIR, filename);

    if (!videoPath.startsWith(VIDEOS_DIR)) {
      return res.status(403).send('Access denied');
    }

    if (!fs.existsSync(videoPath)) {
      return res.status(404).send('Video not found');
    }

    res.download(videoPath, filename);
  } catch (err) {
    res.status(500).send('Error downloading video');
  }
});

// HTML video player demo
app.get('/player/:id', (req, res) => {
  const videoId = req.params.id;
  const filename = Buffer.from(videoId, 'base64').toString('utf-8');

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Video Player - ${filename}</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
          background: #1a1a1a;
          color: #fff;
        }
        video {
          width: 100%;
          max-height: 600px;
          background: #000;
          border-radius: 8px;
        }
        .controls {
          margin-top: 20px;
          display: flex;
          gap: 10px;
        }
        button {
          padding: 10px 20px;
          background: #2196F3;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        button:hover {
          background: #1976D2;
        }
        .info {
          margin-top: 20px;
          padding: 15px;
          background: #2a2a2a;
          border-radius: 4px;
        }
      </style>
    </head>
    <body>
      <h1>${filename}</h1>
      <video controls autoplay>
        <source src="/api/stream/${videoId}" type="video/mp4">
        Your browser does not support the video tag.
      </video>
      <div class="controls">
        <button onclick="location.href='/api/download/${videoId}'">Download</button>
        <button onclick="location.href='/'">Back to List</button>
      </div>
      <div class="info" id="videoInfo">Loading video info...</div>
      
      <script>
        fetch('/api/videos/${videoId}/info')
          .then(r => r.json())
          .then(data => {
            document.getElementById('videoInfo').innerHTML = \`
              <strong>Size:</strong> \${data.sizeReadable}<br>
              <strong>Format:</strong> \${data.format}<br>
              <strong>Modified:</strong> \${new Date(data.modified).toLocaleString()}
            \`;
          });
      </script>
    </body>
    </html>
  `);
});

// Home page with video list
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Video Streaming Server</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
          background: #1a1a1a;
          color: #fff;
        }
        .video-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 20px;
          margin-top: 20px;
        }
        .video-card {
          background: #2a2a2a;
          padding: 20px;
          border-radius: 8px;
          cursor: pointer;
          transition: transform 0.2s;
        }
        .video-card:hover {
          transform: scale(1.05);
          background: #333;
        }
        h1 { color: #2196F3; }
      </style>
    </head>
    <body>
      <h1>🎬 Video Streaming Server</h1>
      <p>Available videos:</p>
      <div class="video-grid" id="videoList">Loading videos...</div>
      
      <script>
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
                <h3>📹 \${v.name}</h3>
                <p>Click to play</p>
              </div>
            \`).join('');
          });
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

// Create videos directory if it doesn't exist
if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  console.log('Created videos directory:', VIDEOS_DIR);
}

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🎬 Video Streaming Server running on http://localhost:${PORT}`);
  console.log(`📁 Serving videos from: ${VIDEOS_DIR}`);
  console.log(`\nAPI Endpoints:`);
  console.log(`  GET  /api/videos           - List all videos`);
  console.log(`  GET  /api/videos/:id/info  - Get video metadata`);
  console.log(`  GET  /api/stream/:id       - Stream video (with range support)`);
  console.log(`  GET  /api/download/:id     - Download video`);
  console.log(`  GET  /player/:id           - Video player interface`);
});