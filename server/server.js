const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const chokidar = require('chokidar');
const mime = require('mime-types');
const path = require('path');
const fs = require('fs');

const SHARE_DIR = process.env.SHARE_DIR || '/srv/pidrive';
const PORT = process.env.PORT || 3000;

// Ensure share directory exists
if (!fs.existsSync(SHARE_DIR)) {
  fs.mkdirSync(SHARE_DIR, { recursive: true });
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(SHARE_DIR, req.body.path || '');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Preserve original filename, avoid overwrites by appending number
    let name = file.originalname;
    let fullPath = path.join(SHARE_DIR, req.body.path || '', name);
    let counter = 1;
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    while (fs.existsSync(fullPath)) {
      name = `${base} (${counter})${ext}`;
      fullPath = path.join(SHARE_DIR, req.body.path || '', name);
      counter++;
    }
    cb(null, name);
  }
});
const upload = multer({ storage, limits: { fileSize: 64 * 1024 * 1024 * 1024 } });

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: false }));
app.use(express.json());

// Helper: get file info
function getFileInfo(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const name = path.basename(filePath);
    const relativePath = path.relative(SHARE_DIR, filePath);
    return {
      name,
      path: relativePath,
      isDirectory: stat.isDirectory(),
      size: stat.size,
      modified: stat.mtime.toISOString(),
      mime: stat.isDirectory() ? 'directory' : (mime.lookup(name) || 'application/octet-stream')
    };
  } catch {
    return null;
  }
}

// API: List files in directory
app.get('/api/files', (req, res) => {
  const dirPath = path.join(SHARE_DIR, req.query.path || '');
  const safePath = path.resolve(dirPath);
  if (!safePath.startsWith(path.resolve(SHARE_DIR))) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    const entries = fs.readdirSync(safePath);
    const files = entries
      .filter(name => !name.startsWith('.') && name !== 'System Volume Information')
      .map(name => getFileInfo(path.join(safePath, name)))
      .filter(Boolean)
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    res.json({ path: req.query.path || '', files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Upload files
app.post('/api/upload', upload.array('files', 100), (req, res) => {
  res.json({ uploaded: req.files.map(f => f.filename) });
});

// API: Create folder
app.post('/api/folder', (req, res) => {
  const folderPath = path.join(SHARE_DIR, req.body.path || '', req.body.name);
  const safePath = path.resolve(folderPath);
  if (!safePath.startsWith(path.resolve(SHARE_DIR))) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    fs.mkdirSync(safePath, { recursive: true });
    res.json({ created: req.body.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Delete file or folder
app.delete('/api/files/:encodedPath(*)', (req, res) => {
  const filePath = path.join(SHARE_DIR, req.params.encodedPath);
  const safePath = path.resolve(filePath);
  if (!safePath.startsWith(path.resolve(SHARE_DIR)) || safePath === path.resolve(SHARE_DIR)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    const stat = fs.statSync(safePath);
    if (stat.isDirectory()) {
      fs.rmSync(safePath, { recursive: true });
    } else {
      fs.unlinkSync(safePath);
    }
    res.json({ deleted: req.params.encodedPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Rename file or folder
app.patch('/api/files/:encodedPath(*)', (req, res) => {
  const oldPath = path.join(SHARE_DIR, req.params.encodedPath);
  const newPath = path.join(path.dirname(oldPath), req.body.name);
  const safeOld = path.resolve(oldPath);
  const safeNew = path.resolve(newPath);
  if (!safeOld.startsWith(path.resolve(SHARE_DIR)) || !safeNew.startsWith(path.resolve(SHARE_DIR))) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    fs.renameSync(safeOld, safeNew);
    res.json({ renamed: req.body.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Move files to folder
app.post('/api/move', (req, res) => {
  const { files, destination } = req.body;
  if (!files || !Array.isArray(files)) return res.status(400).json({ error: 'files array required' });
  const destDir = path.join(SHARE_DIR, destination || '');
  const safeDest = path.resolve(destDir);
  if (!safeDest.startsWith(path.resolve(SHARE_DIR))) return res.status(403).json({ error: 'Access denied' });
  if (!fs.existsSync(safeDest)) fs.mkdirSync(safeDest, { recursive: true });
  const results = [];
  for (const filePath of files) {
    const src = path.resolve(path.join(SHARE_DIR, filePath));
    if (!src.startsWith(path.resolve(SHARE_DIR))) continue;
    const dest = path.join(safeDest, path.basename(filePath));
    try { fs.renameSync(src, dest); results.push({ file: filePath, moved: true }); }
    catch (err) { results.push({ file: filePath, moved: false, error: err.message }); }
  }
  res.json({ results });
});

// API: Download file
app.get('/api/download/:encodedPath(*)', (req, res) => {
  const filePath = path.join(SHARE_DIR, req.params.encodedPath);
  const safePath = path.resolve(filePath);
  if (!safePath.startsWith(path.resolve(SHARE_DIR))) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (!fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.download(safePath);
});

// API: WiFi - list saved networks
app.get('/api/wifi', (req, res) => {
  try {
    const { execSync } = require('child_process');
    const output = execSync('sudo nmcli -t -f NAME,TYPE connection show 2>/dev/null || true').toString().trim();
    const networks = output.split('\n')
      .filter(l => l.includes('802-11-wireless'))
      .map(l => {
        const name = l.split(':')[0].trim();
        let ssid = name;
        try {
          const ssidOut = execSync(`sudo nmcli -t -f 802-11-wireless.ssid connection show "${name}" 2>/dev/null || true`).toString().trim();
          const val = ssidOut.split(':').slice(1).join(':').trim();
          if (val) ssid = val;
        } catch {}
        let active = false;
        try {
          const status = execSync(`nmcli -t -f GENERAL.STATE connection show "${name}" 2>/dev/null || true`).toString();
          active = status.includes('activated');
        } catch {}
        return { name, ssid, active };
      });
    res.json({ networks });
  } catch {
    res.json({ networks: [], error: 'nmcli not available' });
  }
});

// API: WiFi - scan available networks
app.get('/api/wifi/scan', (req, res) => {
  try {
    const { execSync } = require('child_process');
    execSync('sudo nmcli device wifi rescan 2>/dev/null || true');
    const output = execSync('sudo nmcli -t -f SSID,SIGNAL,SECURITY device wifi list 2>/dev/null || true').toString().trim();
    const seen = new Set();
    const networks = output.split('\n')
      .filter(l => l.trim())
      .map(l => {
        const parts = l.split(':');
        return { ssid: parts[0], signal: parseInt(parts[1]) || 0, security: parts[2] || 'Open' };
      })
      .filter(n => n.ssid && !seen.has(n.ssid) && seen.add(n.ssid));
    res.json({ networks });
  } catch {
    res.json({ networks: [], error: 'scan not available' });
  }
});

// API: WiFi - add or update network
app.post('/api/wifi', (req, res) => {
  const { ssid, password } = req.body;
  if (!ssid) return res.status(400).json({ error: 'SSID required' });
  try {
    const { execSync } = require('child_process');
    // Check if a connection with this SSID already exists (match by actual SSID, not connection name)
    const allConns = execSync('sudo nmcli -t -f NAME,802-11-wireless.ssid connection show 2>/dev/null || true').toString();
    const existingName = allConns.split('\n')
      .map(l => { const p = l.split(':'); return { name: p[0], ssid: p.slice(1).join(':') }; })
      .find(c => c.ssid === ssid)?.name;
    if (existingName) {
      // Update password using connection name
      if (password) {
        execSync(`sudo nmcli connection modify "${existingName}" wifi-sec.psk "${password}"`, { timeout: 10000 });
      }
      execSync(`sudo nmcli connection up "${existingName}" 2>/dev/null || true`, { timeout: 15000 });
      res.json({ saved: true, updated: true });
    } else {
      // Remove any stale/partial profile with same name before adding
      execSync(`sudo nmcli con delete "${ssid}" 2>/dev/null || true`, { timeout: 5000 });
      // Add new — use con add to ensure key-mgmt is set correctly
      if (password) {
        execSync(`sudo nmcli con add type wifi con-name "${ssid}" ssid "${ssid}" ifname wlan0 wifi-sec.key-mgmt wpa-psk wifi-sec.psk "${password}"`, { timeout: 15000 });
      } else {
        execSync(`sudo nmcli con add type wifi con-name "${ssid}" ssid "${ssid}" ifname wlan0`, { timeout: 15000 });
      }
      // Try to connect, but keep the profile even if connection fails
      let connected = false;
      try {
        execSync(`sudo nmcli con up "${ssid}"`, { timeout: 20000 });
        connected = true;
      } catch (connErr) {
        console.log('Connection attempt failed (profile kept):', connErr.message);
      }
      res.json({ saved: true, updated: false, connected });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: WiFi - delete saved network
app.delete('/api/wifi/:ssid', (req, res) => {
  const ssid = decodeURIComponent(req.params.ssid);
  try {
    const { execSync } = require('child_process');
    execSync(`sudo nmcli connection delete "${ssid}"`, { timeout: 10000 });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Current WiFi connection (SSID + mode)
app.get('/api/wifi-current', (req, res) => {
  try {
    const { execSync } = require('child_process');
    const ssid = execSync('iwgetid wlan0 -r 2>/dev/null || true').toString().trim();
    if (ssid) {
      res.json({ ssid, mode: 'client' });
      return;
    }
    const hostapdPid = execSync('pgrep hostapd 2>/dev/null || true').toString().trim();
    if (hostapdPid) {
      res.json({ ssid: 'Pi-Drive', mode: 'ap' });
    } else {
      res.json({ ssid: null, mode: 'none' });
    }
  } catch {
    res.json({ ssid: null, mode: 'none' });
  }
});

// API: Network info (IP addresses)
app.get('/api/network-info', (req, res) => {
  const { networkInterfaces, hostname } = require('os');
  const nets = networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push({ iface: name, address: net.address });
      }
    }
  }
  res.json({ ips, hostname: hostname() });
});

// API: Shutdown Pi
app.post('/api/shutdown', (req, res) => {
  res.json({ shutting_down: true });
  setTimeout(() => {
    const { exec } = require('child_process');
    exec('sudo shutdown -h now', (err) => {
      if (err) console.log('Shutdown error:', err.message);
    });
  }, 500);
});

// API: Disk usage
app.get('/api/stats', (req, res) => {
  try {
    const { execSync } = require('child_process');
    const dfOutput = execSync(`df -B1 "${SHARE_DIR}"`).toString().split('\n')[1].split(/\s+/);
    res.json({
      total: parseInt(dfOutput[1]),
      used: parseInt(dfOutput[2]),
      available: parseInt(dfOutput[3])
    });
  } catch {
    res.json({ total: 0, used: 0, available: 0 });
  }
});

// Chokidar file watcher for real-time sync
const watcher = chokidar.watch(SHARE_DIR, {
  ignoreInitial: true,
  ignored: [
    /(^|[\/\\])\./,
    /\.fseventsd/,
    /\.Spotlight/,
    /\.Trashes/,
    /System Volume Information/,
    /\.DS_Store/,
    /\._/
  ],
  persistent: true,
  usePolling: true,
  interval: 2000,
  awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 500 }
});

watcher.on('error', (err) => {
  console.log('Watcher error (ignored):', err.message);
});

let debounceTimer = null;
function broadcastChange() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    io.emit('files-changed');
  }, 300);
}

watcher
  .on('add', broadcastChange)
  .on('unlink', broadcastChange)
  .on('addDir', broadcastChange)
  .on('unlinkDir', broadcastChange)
  .on('change', broadcastChange);

// Socket.IO connections
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Pi-Drive server running on http://0.0.0.0:${PORT}`);
  console.log(`Sharing directory: ${SHARE_DIR}`);
});
