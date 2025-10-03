# 🎬 Advanced Video Streaming API

A high-performance Node.js API for streaming video content with range request support, built-in HTML5 player, and RESTful endpoints.

## ✨ Features

- 📡 HTTP Range Request Support - Efficient video seeking and partial content delivery
- 🎥 Multiple Video Formats - MP4, MKV, AVI, MOV, WebM
- 🔒 Security - Path traversal protection and input validation
- ⚡ Performance - Chunked streaming with 1MB chunks for optimal bandwidth usage
- 🎨 Built-in UI - Ready-to-use HTML5 video player and gallery
- 🌐 CORS Enabled - Works seamlessly with frontend applications
- 📊 Metadata API - Access video information and file details
- 💾 Download Support - Direct file download capability

## 🚀 Quick Start

### Prerequisites

- Node.js 14.x or higher
- npm or yarn

### Installation

1. Clone or create your project directory:
mkdir video-streaming-api
cd video-streaming-api
2. Initialize npm and install dependencies:
npm init -y
npm install express
3. Copy the server code to a file named server.js

4. Create the videos directory:
mkdir videos
5. Add your video files to the videos directory

6. Start the server:
node server.js
The server will start on http://localhost:3000

## 📚 API Documentation

### Base URL
http://localhost:3000
### Endpoints

#### 1. List All Videos
GET /api/videos
Response:
{
  "videos": [
    {
      "id": "bXl2aWRlby5tcDQ=",
      "name": "myvideo.mp4",
      "url": "/api/stream/bXl2aWRlby5tcDQ="
    }
  ],
  "count": 1
}
#### 2. Get Video Metadata
GET /api/videos/:id/info
Parameters:
- id (string) - Base64 encoded filename

Response:
{
  "name": "myvideo.mp4",
  "size": 52428800,
  "sizeReadable": "50 MB",
  "format": "mp4",
  "created": "2025-01-15T10:30:00.000Z",
  "modified": "2025-01-15T10:30:00.000Z"
}
#### 3. Stream Video
GET /api/stream/:id
Parameters:
- id (string) - Base64 encoded filename

Headers:
- Range (optional) - Byte range for partial content

Response:
- Status: 200 (full content) or 206 (partial content)
- Headers: Content-Type, Content-Length, Accept-Ranges, Content-Range
- Body: Video stream

Example with Range:
GET /api/stream/bXl2aWRlby5tcDQ=
Range: bytes=0-1048575
#### 4. Download Video
GET /api/download/:id
Parameters:
- id (string) - Base64 encoded filename

Response:
- Initiates file download with original filename

#### 5. Video Player UI
GET /player/:id
Parameters:
- id (string) - Base64 encoded filename

Response:
- HTML page with embedded video player

#### 6. Home Page
GET /
Response:
- HTML page with video gallery

## 💻 Usage Examples

### Using cURL

List videos:
curl http://localhost:3000/api/videos
Stream with range:
curl -H "Range: bytes=0-1048575" http://localhost:3000/api/stream/[VIDEO_ID]
Download video:
curl -O http://localhost:3000/api/download/[VIDEO_ID]
### Using JavaScript (Fetch API)

// List all videos
fetch('http://localhost:3000/api/videos')
  .then(res => res.json())
  .then(data => console.log(data.videos));

// Get video metadata
fetch('http://localhost:3000/api/videos/[VIDEO_ID]/info')
  .then(res => res.json())
  .then(info => console.log(info));

// Stream video in HTML5 player
const videoElement = document.querySelector('video');
videoElement.src = 'http://localhost:3000/api/stream/[VIDEO_ID]';
### Using HTML5 Video Tag

<video controls width="800">
  <source src="http://localhost:3000/api/stream/[VIDEO_ID]" type="video/mp4">
  Your browser does not support the video tag.
</video>
## 🔧 Configuration

### Environment Variables

You can customize the server by modifying these constants in server.js:

const PORT = 3000;              // Server port
const VIDEOS_DIR = './videos';  // Video storage directory
const CHUNK_SIZE = 1024 * 1024; // Streaming chunk size (1MB)
### Supported Video Formats

- .mp4 - MPEG-4 Part 14
- .mkv - Matroska Video
- .avi - Audio Video Interleave
- .mov - QuickTime Movie
- .webm - WebM Video

## 🛡️ Security Features

1. Path Traversal Protection - Prevents access to files outside the videos directory
2. Input Validation - Validates and sanitizes all user inputs
3. Base64 Encoding - Obscures filenames in URLs
4. Range Validation - Prevents invalid byte range requests

## 🎯 Best Practices

### For Production

1. Use Process Manager:
npm install -g pm2
pm2 start server.js --name video-api
2. Add Environment Variables:
export PORT=8080
export VIDEOS_DIR=/var/videos
3. Enable HTTPS - Use a reverse proxy like Nginx
4. Add Authentication - Implement JWT or OAuth for protected content
5. Add Rate Limiting - Prevent abuse with express-rate-limit
6. Enable Compression - Use compression middleware

### Optimization Tips

- Store videos on SSD for faster I/O
- Use CDN for static content delivery
- Implement caching headers (already included)
- Monitor server resources with pm2 or similar tools
- Consider video transcoding for multiple quality levels

## 📦 Project Structure

video-streaming-api/
├── server.js           # Main application file
├── videos/             # Video storage directory
│   ├── movie1.mp4
│   ├── movie2.mkv
│   └── ...
├── package.json
└── README.md
## 🐛 Troubleshooting

### Videos not showing up?
- Ensure videos are in the videos directory
- Check file extensions match supported formats
- Verify file permissions

### Stream not working?
- Check if the video file is corrupted
- Verify the video codec is supported by browsers
- Ensure enough disk space and memory

### CORS errors?
- CORS is enabled by default
- Check if your frontend origin is blocked by browser extensions

## 🔄 Extending the API

### Add Authentication

const authenticate = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).send('Unauthorized');
  // Verify token
  next();
};

app.get('/api/stream/:id', authenticate, async (req, res) => {
  // Existing stream logic
});
### Add Video Upload

const multer = require('multer');
const upload = multer({ dest: VIDEOS_DIR });

app.post('/api/upload', upload.single('video'), (req, res) => {
  res.json({ message: 'Video uploaded', file: req.file });
});
### Add Thumbnail Generation

const ffmpeg = require('fluent-ffmpeg');

app.get('/api/thumbnail/:id', (req, res) => {
  const videoPath = getVideoPath(req.params.id);
  ffmpeg(videoPath)
    .screenshots({
      count: 1,
      folder: './thumbnails',
      filename: req.params.id + '.png'
    });
});
## 📄 License

MIT License - feel free to use this in your projects!

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest new features
- Submit pull requests
- Improve documentation

## 📞 Support

For issues and questions:
- Check the troubleshooting section
- Review the API documentation
- Open an issue on GitHub

## 🙏 Acknowledgments

Built with:
- Express.js - Fast, unopinionated web framework
- Node.js - JavaScript runtime
- HTML5 Video API - Native video playback

---

Happy Streaming! 🎉