const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3001;
const DOWNLOADS_DIR = path.join(process.cwd(), 'downloads');
const CONVERTED_DIR = path.join(process.cwd(), 'converted');
const THUMBNAILS_DIR = path.join(process.cwd(), 'thumbnails');

app.use(cors());
app.use(express.json());

// ─── Database ─────────────────────────────────────────────────────────────────

const db = new Database(process.env.DB_PATH || './universal.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS downloads (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Fetching...',
    platform TEXT DEFAULT 'web',
    format TEXT NOT NULL DEFAULT 'mp4',
    quality TEXT DEFAULT '720p',
    status TEXT NOT NULL DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    speed REAL DEFAULT 0,
    eta INTEGER DEFAULT 0,
    file_path TEXT,
    file_size INTEGER DEFAULT 0,
    thumbnail TEXT,
    error_message TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  CREATE TABLE IF NOT EXISTS library (
    id TEXT PRIMARY KEY,
    download_id TEXT,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'video',
    source TEXT,
    format TEXT,
    quality TEXT,
    file_size INTEGER DEFAULT 0,
    file_path TEXT NOT NULL,
    duration INTEGER,
    thumbnail TEXT,
    artist TEXT,
    album TEXT,
    genre TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  CREATE TABLE IF NOT EXISTS conversions (
    id TEXT PRIMARY KEY,
    library_item_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    output_format TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    output_path TEXT,
    output_size INTEGER DEFAULT 0,
    error_message TEXT,
    options TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

[DOWNLOADS_DIR, CONVERTED_DIR, THUMBNAILS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const activeProcesses = {};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectPlatform(url) {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('tiktok.com')) return 'tiktok';
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
  if (url.includes('soundcloud.com')) return 'soundcloud';
  if (url.includes('vimeo.com')) return 'vimeo';
  if (url.includes('facebook.com') || url.includes('fb.watch')) return 'facebook';
  return 'web';
}

function buildFormatStr(format, quality) {
  const audioFormats = ['mp3', 'aac', 'flac', 'm4a', 'opus', 'wav'];
  if (audioFormats.includes(format)) return 'bestaudio/best';
  const heightMap = { '360p': 360, '480p': 480, '720p': 720, '1080p': 1080, '1440p': 1440, '2160p': 2160, '4k': 2160 };
  const h = heightMap[quality?.toLowerCase()];
  if (h) return `bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`;
  return 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best';
}

function fetchVideoInfo(url) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', ['--dump-json', '--no-playlist', '--no-warnings', url]);
    let out = '', err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('close', code => {
      if (code === 0) {
        try { resolve(JSON.parse(out.trim())); }
        catch { reject(new Error('Parse error')); }
      } else {
        reject(new Error(err.split('\n')[0] || 'yt-dlp failed'));
      }
    });
    setTimeout(() => { proc.kill(); reject(new Error('Timeout fetching info')); }, 30000);
  });
}

function checkFfmpeg() {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version']);
    proc.on('close', code => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

function runFfmpeg(args, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let err = '';
    let duration = 0;

    proc.stderr.on('data', data => {
      const line = data.toString();
      err += line;

      // Parse duration
      const durMatch = line.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
      if (durMatch) {
        duration = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3]);
      }

      // Parse progress
      const timeMatch = line.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
      if (timeMatch && duration > 0 && onProgress) {
        const current = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
        const pct = Math.min(Math.round((current / duration) * 100), 99);
        onProgress(pct);
      }
    });

    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(err.split('\n').filter(l => l.includes('Error') || l.includes('error')).pop() || 'ffmpeg failed'));
    });

    proc.on('error', err => reject(new Error('ffmpeg not found. Please install ffmpeg on the server.')));

    return proc;
  });
}

function startDownload(id, url, format, quality) {
  const audioFormats = ['mp3', 'aac', 'flac', 'm4a', 'opus', 'wav'];
  const isAudio = audioFormats.includes(format);
  const outTemplate = path.join(DOWNLOADS_DIR, `${id}.%(ext)s`);
  const formatStr = buildFormatStr(format, quality);

  const args = [
    '--format', formatStr,
    '--output', outTemplate,
    '--no-playlist', '--newline', '--no-warnings', '--progress',
  ];

  if (isAudio) {
    args.push('--extract-audio', '--audio-format', format, '--audio-quality', '0');
  } else if (['mp4', 'mkv'].includes(format)) {
    args.push('--merge-output-format', format);
  }

  args.push(url);

  const proc = spawn('yt-dlp', args);
  activeProcesses[id] = proc;

  db.prepare(`UPDATE downloads SET status='downloading', updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`).run(id);

  proc.stdout.on('data', data => {
    const line = data.toString();
    const pct = line.match(/(\d+\.?\d*)%/);
    const spd = line.match(/([\d.]+)\s*([KMG]iB)\/s/);
    const eta = line.match(/ETA\s+(\d+):(\d+)/);

    if (pct) {
      const progress = Math.min(Math.round(parseFloat(pct[1])), 99);
      let speed = 0;
      if (spd) {
        const val = parseFloat(spd[1]);
        const unit = spd[2];
        speed = unit === 'GiB' ? val * 1024 : unit === 'MiB' ? val : val / 1024;
      }
      let etaSec = 0;
      if (eta) etaSec = parseInt(eta[1]) * 60 + parseInt(eta[2]);
      db.prepare(`UPDATE downloads SET progress=?, speed=?, eta=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`)
        .run(progress, speed, etaSec, id);
    }
  });

  proc.on('close', code => {
    delete activeProcesses[id];
    if (code === 0) {
      const files = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.startsWith(id + '.'));
      if (files.length > 0) {
        const filePath = path.join(DOWNLOADS_DIR, files[0]);
        const ext = path.extname(files[0]).slice(1);
        const stats = fs.statSync(filePath);
        db.prepare(`UPDATE downloads SET status='completed', progress=100, file_path=?, file_size=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`)
          .run(filePath, stats.size, id);
        const dl = db.prepare('SELECT * FROM downloads WHERE id=?').get(id);
        const audioExts = ['mp3', 'aac', 'flac', 'm4a', 'opus', 'wav'];
        const type = audioExts.includes(ext) ? 'audio' : 'video';
        db.prepare(`INSERT INTO library (id, download_id, title, type, source, format, file_size, file_path, thumbnail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(randomUUID(), id, dl.title, type, dl.platform, ext, stats.size, filePath, dl.thumbnail);
      }
    } else {
      db.prepare(`UPDATE downloads SET status='failed', error_message='Download failed. Check the URL and try again.', updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`)
        .run(id);
    }
  });

  proc.on('error', err => {
    delete activeProcesses[id];
    db.prepare(`UPDATE downloads SET status='failed', error_message=? WHERE id=?`).run(err.message, id);
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (_, res) => res.json({ status: 'ok', version: '2.1.0' }));

app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  try {
    const info = await fetchVideoInfo(url);
    res.json({
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      uploader: info.uploader || info.channel,
      platform: detectPlatform(url),
      description: info.description?.slice(0, 300) || null,
      viewCount: info.view_count || null,
      likeCount: info.like_count || null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Downloads ────────────────────────────────────────────────────────────────

app.get('/api/downloads', (req, res) => {
  const { status, limit = 50 } = req.query;
  const rows = status
    ? db.prepare('SELECT * FROM downloads WHERE status=? ORDER BY created_at DESC LIMIT ?').all(status, +limit)
    : db.prepare('SELECT * FROM downloads ORDER BY created_at DESC LIMIT ?').all(+limit);
  res.json(rows);
});

app.get('/api/downloads/active', (_, res) => {
  res.json(db.prepare(`SELECT * FROM downloads WHERE status IN ('pending','downloading','paused') ORDER BY created_at DESC`).all());
});

app.get('/api/downloads/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM downloads WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.post('/api/downloads', async (req, res) => {
  const { url, format = 'mp4', quality = '720p' } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const id = randomUUID();
  const platform = detectPlatform(url);

  db.prepare(`INSERT INTO downloads (id, url, title, platform, format, quality, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`)
    .run(id, url, 'Fetching title...', platform, format, quality);

  fetchVideoInfo(url).then(info => {
    db.prepare(`UPDATE downloads SET title=?, thumbnail=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`)
      .run(info.title || 'Unknown', info.thumbnail || null, id);
  }).catch(() => {});

  setImmediate(() => startDownload(id, url, format, quality));

  res.json(db.prepare('SELECT * FROM downloads WHERE id=?').get(id));
});

app.post('/api/downloads/:id/pause', (req, res) => {
  const proc = activeProcesses[req.params.id];
  if (proc) { try { proc.kill('SIGSTOP'); } catch {} }
  db.prepare(`UPDATE downloads SET status='paused', updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`).run(req.params.id);
  res.json({ success: true });
});

app.post('/api/downloads/:id/resume', (req, res) => {
  const proc = activeProcesses[req.params.id];
  if (proc) {
    try { proc.kill('SIGCONT'); } catch {}
    db.prepare(`UPDATE downloads SET status='downloading', updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`).run(req.params.id);
  } else {
    const dl = db.prepare('SELECT * FROM downloads WHERE id=?').get(req.params.id);
    if (dl) startDownload(dl.id, dl.url, dl.format, dl.quality);
  }
  res.json({ success: true });
});

app.delete('/api/downloads/:id', (req, res) => {
  const proc = activeProcesses[req.params.id];
  if (proc) { try { proc.kill('SIGKILL'); } catch {} delete activeProcesses[req.params.id]; }
  const dl = db.prepare('SELECT * FROM downloads WHERE id=?').get(req.params.id);
  if (dl?.file_path && fs.existsSync(dl.file_path)) try { fs.unlinkSync(dl.file_path); } catch {}
  db.prepare('DELETE FROM downloads WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/downloads/:id/file', (req, res) => {
  const dl = db.prepare('SELECT * FROM downloads WHERE id=?').get(req.params.id);
  if (!dl?.file_path || !fs.existsSync(dl.file_path)) return res.status(404).json({ error: 'File not found' });
  res.download(dl.file_path, `${dl.title}.${path.extname(dl.file_path).slice(1)}`);
});

// ─── Library ──────────────────────────────────────────────────────────────────

app.get('/api/library', (req, res) => {
  const { type, source, q } = req.query;
  const conds = [], params = [];
  if (type)   { conds.push('type=?'); params.push(type); }
  if (source) { conds.push('source=?'); params.push(source); }
  if (q)      { conds.push('(title LIKE ? OR artist LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';
  res.json(db.prepare(`SELECT * FROM library${where} ORDER BY created_at DESC`).all(...params));
});

app.get('/api/library/stats', (_, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM library').get();
  const byType = db.prepare('SELECT type, COUNT(*) as count FROM library GROUP BY type').all();
  const totalSize = db.prepare('SELECT COALESCE(SUM(file_size),0) as size FROM library').get();
  res.json({ total: total.count, byType, totalSize: totalSize.size });
});

app.get('/api/library/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM library WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.patch('/api/library/:id', (req, res) => {
  const { title, artist, album, genre } = req.body;
  db.prepare(`UPDATE library SET title=COALESCE(?,title), artist=COALESCE(?,artist), album=COALESCE(?,album), genre=COALESCE(?,genre) WHERE id=?`)
    .run(title, artist, album, genre, req.params.id);
  res.json(db.prepare('SELECT * FROM library WHERE id=?').get(req.params.id));
});

app.delete('/api/library/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM library WHERE id=?').get(req.params.id);
  if (item?.file_path && fs.existsSync(item.file_path)) try { fs.unlinkSync(item.file_path); } catch {}
  db.prepare('DELETE FROM library WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/library/:id/stream', (req, res) => {
  const item = db.prepare('SELECT * FROM library WHERE id=?').get(req.params.id);
  if (!item?.file_path || !fs.existsSync(item.file_path)) return res.status(404).json({ error: 'Not found' });
  const stat = fs.statSync(item.file_path);
  const range = req.headers.range;
  const ext = path.extname(item.file_path).slice(1).toLowerCase();
  const audioExts = ['mp3', 'aac', 'flac', 'm4a', 'wav', 'opus'];
  const contentType = audioExts.includes(ext) ? `audio/${ext === 'mp3' ? 'mpeg' : ext}` : 'video/mp4';

  if (range) {
    const [s, e] = range.replace(/bytes=/, '').split('-').map(Number);
    const end = e || Math.min(s + 1024 * 1024 * 2, stat.size - 1);
    res.writeHead(206, {
      'Content-Range': `bytes ${s}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - s + 1,
      'Content-Type': contentType,
    });
    fs.createReadStream(item.file_path, { start: s, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': contentType });
    fs.createReadStream(item.file_path).pipe(res);
  }
});

// ─── Tools ────────────────────────────────────────────────────────────────────

// Check ffmpeg availability
app.get('/api/tools/check', async (_, res) => {
  const available = await checkFfmpeg();
  res.json({ ffmpeg: available });
});

// Get all conversions
app.get('/api/tools/conversions', (req, res) => {
  const { status } = req.query;
  const rows = status
    ? db.prepare('SELECT * FROM conversions WHERE status=? ORDER BY created_at DESC').all(status)
    : db.prepare('SELECT * FROM conversions ORDER BY created_at DESC LIMIT 50').all();
  res.json(rows);
});

// Get one conversion
app.get('/api/tools/conversions/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM conversions WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// Video → Audio
app.post('/api/tools/video-to-audio', async (req, res) => {
  const { libraryItemId, outputFormat = 'mp3' } = req.body;
  if (!libraryItemId) return res.status(400).json({ error: 'libraryItemId is required' });

  const item = db.prepare('SELECT * FROM library WHERE id=?').get(libraryItemId);
  if (!item) return res.status(404).json({ error: 'Library item not found' });
  if (!fs.existsSync(item.file_path)) return res.status(404).json({ error: 'File not found on disk' });

  const supportedFormats = ['mp3', 'aac', 'flac', 'm4a', 'wav'];
  if (!supportedFormats.includes(outputFormat.toLowerCase())) {
    return res.status(400).json({ error: `Unsupported format. Use: ${supportedFormats.join(', ')}` });
  }

  const convId = randomUUID();
  const outputFile = path.join(CONVERTED_DIR, `${convId}.${outputFormat}`);
  const title = path.basename(item.title, path.extname(item.title));

  db.prepare(`INSERT INTO conversions (id, library_item_id, tool, output_format, status, options) VALUES (?, ?, ?, ?, 'pending', ?)`)
    .run(convId, libraryItemId, 'video-to-audio', outputFormat, JSON.stringify({ title }));

  res.json({ id: convId, status: 'pending' });

  // Run conversion async
  setImmediate(async () => {
    try {
      db.prepare(`UPDATE conversions SET status='processing', updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`).run(convId);

      const args = ['-i', item.file_path, '-vn'];

      if (outputFormat === 'mp3') {
        args.push('-acodec', 'libmp3lame', '-q:a', '2');
      } else if (outputFormat === 'aac') {
        args.push('-acodec', 'aac', '-b:a', '192k');
      } else if (outputFormat === 'flac') {
        args.push('-acodec', 'flac');
      } else if (outputFormat === 'm4a') {
        args.push('-acodec', 'aac', '-b:a', '192k');
      } else if (outputFormat === 'wav') {
        args.push('-acodec', 'pcm_s16le');
      }

      args.push('-y', outputFile);

      await runFfmpeg(args, (pct) => {
        db.prepare(`UPDATE conversions SET progress=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`).run(pct, convId);
      });

      const stats = fs.statSync(outputFile);
      const newLibId = randomUUID();
      db.prepare(`INSERT INTO library (id, title, type, format, file_size, file_path) VALUES (?, ?, 'audio', ?, ?, ?)`)
        .run(newLibId, `${title}.${outputFormat}`, outputFormat, stats.size, outputFile);

      db.prepare(`UPDATE conversions SET status='completed', progress=100, output_path=?, output_size=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`)
        .run(outputFile, stats.size, convId);

    } catch (err) {
      db.prepare(`UPDATE conversions SET status='failed', error_message=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`)
        .run(err.message, convId);
    }
  });
});

// Format Convert
app.post('/api/tools/format-convert', async (req, res) => {
  const { libraryItemId, outputFormat = 'mp4' } = req.body;
  if (!libraryItemId) return res.status(400).json({ error: 'libraryItemId is required' });

  const item = db.prepare('SELECT * FROM library WHERE id=?').get(libraryItemId);
  if (!item) return res.status(404).json({ error: 'Library item not found' });
  if (!fs.existsSync(item.file_path)) return res.status(404).json({ error: 'File not found on disk' });

  const videoFormats = ['mp4', 'mkv', 'webm', 'avi', 'mov'];
  const audioFormats = ['mp3', 'aac', 'flac', 'm4a', 'wav'];
  const allFormats = [...videoFormats, ...audioFormats];

  if (!allFormats.includes(outputFormat.toLowerCase())) {
    return res.status(400).json({ error: `Unsupported format. Use: ${allFormats.join(', ')}` });
  }

  const convId = randomUUID();
  const outputFile = path.join(CONVERTED_DIR, `${convId}.${outputFormat}`);
  const title = path.basename(item.title, path.extname(item.title));

  db.prepare(`INSERT INTO conversions (id, library_item_id, tool, output_format, status, options) VALUES (?, ?, ?, ?, 'pending', ?)`)
    .run(convId, libraryItemId, 'format-convert', outputFormat, JSON.stringify({ title }));

  res.json({ id: convId, status: 'pending' });

  setImmediate(async () => {
    try {
      db.prepare(`UPDATE conversions SET status='processing', updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`).run(convId);

      const args = ['-i', item.file_path];

      if (audioFormats.includes(outputFormat)) {
        args.push('-vn');
      }

      args.push('-y', outputFile);

      await runFfmpeg(args, (pct) => {
        db.prepare(`UPDATE conversions SET progress=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`).run(pct, convId);
      });

      const stats = fs.statSync(outputFile);
      const type = audioFormats.includes(outputFormat) ? 'audio' : 'video';
      const newLibId = randomUUID();
      db.prepare(`INSERT INTO library (id, title, type, format, file_size, file_path) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(newLibId, `${title}.${outputFormat}`, type, outputFormat, stats.size, outputFile);

      db.prepare(`UPDATE conversions SET status='completed', progress=100, output_path=?, output_size=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`)
        .run(outputFile, stats.size, convId);

    } catch (err) {
      db.prepare(`UPDATE conversions SET status='failed', error_message=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`)
        .run(err.message, convId);
    }
  });
});

// Trim / Clip
app.post('/api/tools/trim', async (req, res) => {
  const { libraryItemId, startTime, endTime, outputFormat } = req.body;
  if (!libraryItemId || startTime == null || endTime == null) {
    return res.status(400).json({ error: 'libraryItemId, startTime and endTime are required' });
  }
  if (endTime <= startTime) return res.status(400).json({ error: 'endTime must be greater than startTime' });

  const item = db.prepare('SELECT * FROM library WHERE id=?').get(libraryItemId);
  if (!item) return res.status(404).json({ error: 'Library item not found' });
  if (!fs.existsSync(item.file_path)) return res.status(404).json({ error: 'File not found on disk' });

  const ext = outputFormat || item.format || path.extname(item.file_path).slice(1) || 'mp4';
  const convId = randomUUID();
  const outputFile = path.join(CONVERTED_DIR, `${convId}.${ext}`);
  const title = path.basename(item.title, path.extname(item.title));
  const duration = endTime - startTime;

  db.prepare(`INSERT INTO conversions (id, library_item_id, tool, output_format, status, options) VALUES (?, ?, ?, ?, 'pending', ?)`)
    .run(convId, libraryItemId, 'trim', ext, JSON.stringify({ startTime, endTime, duration }));

  res.json({ id: convId, status: 'pending' });

  setImmediate(async () => {
    try {
      db.prepare(`UPDATE conversions SET status='processing', updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`).run(convId);

      const args = [
        '-i', item.file_path,
        '-ss', String(startTime),
        '-t', String(duration),
        '-c', 'copy',
        '-y', outputFile,
      ];

      await runFfmpeg(args, (pct) => {
        db.prepare(`UPDATE conversions SET progress=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`).run(pct, convId);
      });

      const stats = fs.statSync(outputFile);
      const audioExts = ['mp3', 'aac', 'flac', 'm4a', 'wav', 'opus'];
      const type = audioExts.includes(ext) ? 'audio' : 'video';
      db.prepare(`INSERT INTO library (id, title, type, format, file_size, file_path) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), `${title}_trimmed.${ext}`, type, ext, stats.size, outputFile);

      db.prepare(`UPDATE conversions SET status='completed', progress=100, output_path=?, output_size=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`)
        .run(outputFile, stats.size, convId);

    } catch (err) {
      db.prepare(`UPDATE conversions SET status='failed', error_message=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`)
        .run(err.message, convId);
    }
  });
});

// Compress
app.post('/api/tools/compress', async (req, res) => {
  const { libraryItemId, quality = 'medium' } = req.body;
  if (!libraryItemId) return res.status(400).json({ error: 'libraryItemId is required' });

  const item = db.prepare('SELECT * FROM library WHERE id=?').get(libraryItemId);
  if (!item) return res.status(404).json({ error: 'Library item not found' });
  if (!fs.existsSync(item.file_path)) return res.status(404).json({ error: 'File not found on disk' });

  // CRF: lower = better quality, higher = smaller file
  const crfMap = { high: 23, medium: 28, low: 35 };
  const crf = crfMap[quality] || 28;

  const ext = 'mp4';
  const convId = randomUUID();
  const outputFile = path.join(CONVERTED_DIR, `${convId}.${ext}`);
  const title = path.basename(item.title, path.extname(item.title));

  db.prepare(`INSERT INTO conversions (id, library_item_id, tool, output_format, status, options) VALUES (?, ?, ?, ?, 'pending', ?)`)
    .run(convId, libraryItemId, 'compress', ext, JSON.stringify({ quality, crf }));

  res.json({ id: convId, status: 'pending' });

  setImmediate(async () => {
    try {
      db.prepare(`UPDATE conversions SET status='processing', updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`).run(convId);

      const args = [
        '-i', item.file_path,
        '-vcodec', 'libx264',
        '-crf', String(crf),
        '-preset', 'fast',
        '-acodec', 'aac',
        '-b:a', '128k',
        '-y', outputFile,
      ];

      await runFfmpeg(args, (pct) => {
        db.prepare(`UPDATE conversions SET progress=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`).run(pct, convId);
      });

      const stats = fs.statSync(outputFile);
      db.prepare(`INSERT INTO library (id, title, type, format, file_size, file_path) VALUES (?, ?, 'video', ?, ?, ?)`)
        .run(randomUUID(), `${title}_compressed.${ext}`, ext, stats.size, outputFile);

      db.prepare(`UPDATE conversions SET status='completed', progress=100, output_path=?, output_size=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`)
        .run(outputFile, stats.size, convId);

    } catch (err) {
      db.prepare(`UPDATE conversions SET status='failed', error_message=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`)
        .run(err.message, convId);
    }
  });
});

// Merge Files
app.post('/api/tools/merge', async (req, res) => {
  const { libraryItemIds, outputFormat = 'mp4' } = req.body;
  if (!libraryItemIds || !Array.isArray(libraryItemIds) || libraryItemIds.length < 2) {
    return res.status(400).json({ error: 'At least 2 libraryItemIds are required' });
  }

  const items = libraryItemIds.map(id => db.prepare('SELECT * FROM library WHERE id=?').get(id)).filter(Boolean);
  if (items.length < 2) return res.status(400).json({ error: 'Could not find all library items' });

  for (const item of items) {
    if (!fs.existsSync(item.file_path)) return res.status(404).json({ error: `File not found: ${item.title}` });
  }

  const convId = randomUUID();
  const outputFile = path.join(CONVERTED_DIR, `${convId}.${outputFormat}`);
  const listFile = path.join(CONVERTED_DIR, `${convId}_list.txt`);

  // Write ffmpeg concat list
  const listContent = items.map(i => `file '${i.file_path}'`).join('\n');
  fs.writeFileSync(listFile, listContent);

  db.prepare(`INSERT INTO conversions (id, library_item_id, tool, output_format, status, options) VALUES (?, ?, ?, ?, 'pending', ?)`)
    .run(convId, libraryItemIds[0], 'merge', outputFormat, JSON.stringify({ count: items.length, titles: items.map(i => i.title) }));

  res.json({ id: convId, status: 'pending' });

  setImmediate(async () => {
    try {
      db.prepare(`UPDATE conversions SET status='processing', updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`).run(convId);

      const args = [
        '-f', 'concat',
        '-safe', '0',
        '-i', listFile,
        '-c', 'copy',
        '-y', outputFile,
      ];

      await runFfmpeg(args, (pct) => {
        db.prepare(`UPDATE conversions SET progress=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`).run(pct, convId);
      });

      // Cleanup list file
      try { fs.unlinkSync(listFile); } catch {}

      const stats = fs.statSync(outputFile);
      const audioExts = ['mp3', 'aac', 'flac', 'm4a', 'wav', 'opus'];
      const type = audioExts.includes(outputFormat) ? 'audio' : 'video';
      db.prepare(`INSERT INTO library (id, title, type, format, file_size, file_path) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), `merged_${Date.now()}.${outputFormat}`, type, outputFormat, stats.size, outputFile);

      db.prepare(`UPDATE conversions SET status='completed', progress=100, output_path=?, output_size=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`)
        .run(outputFile, stats.size, convId);

    } catch (err) {
      try { fs.unlinkSync(listFile); } catch {}
      db.prepare(`UPDATE conversions SET status='failed', error_message=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`)
        .run(err.message, convId);
    }
  });
});

// Extract Thumbnail
app.post('/api/tools/thumbnail', async (req, res) => {
  const { libraryItemId, timestamp = 0 } = req.body;
  if (!libraryItemId) return res.status(400).json({ error: 'libraryItemId is required' });

  const item = db.prepare('SELECT * FROM library WHERE id=?').get(libraryItemId);
  if (!item) return res.status(404).json({ error: 'Library item not found' });
  if (!fs.existsSync(item.file_path)) return res.status(404).json({ error: 'File not found on disk' });

  const convId = randomUUID();
  const outputFile = path.join(THUMBNAILS_DIR, `${convId}.jpg`);
  const title = path.basename(item.title, path.extname(item.title));

  db.prepare(`INSERT INTO conversions (id, library_item_id, tool, output_format, status, options) VALUES (?, ?, ?, ?, 'pending', ?)`)
    .run(convId, libraryItemId, 'thumbnail', 'jpg', JSON.stringify({ timestamp }));

  res.json({ id: convId, status: 'pending' });

  setImmediate(async () => {
    try {
      db.prepare(`UPDATE conversions SET status='processing', updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`).run(convId);

      const args = [
        '-i', item.file_path,
        '-ss', String(timestamp),
        '-frames:v', '1',
        '-q:v', '2',
        '-y', outputFile,
      ];

      await runFfmpeg(args);

      const stats = fs.statSync(outputFile);
      db.prepare(`INSERT INTO library (id, title, type, format, file_size, file_path) VALUES (?, ?, 'image', 'jpg', ?, ?)`)
        .run(randomUUID(), `${title}_thumbnail.jpg`, stats.size, outputFile);

      db.prepare(`UPDATE conversions SET status='completed', progress=100, output_path=?, output_size=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`)
        .run(outputFile, stats.size, convId);

    } catch (err) {
      db.prepare(`UPDATE conversions SET status='failed', error_message=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`)
        .run(err.message, convId);
    }
  });
});

// Download converted file
app.get('/api/tools/conversions/:id/file', (req, res) => {
  const conv = db.prepare('SELECT * FROM conversions WHERE id=?').get(req.params.id);
  if (!conv?.output_path || !fs.existsSync(conv.output_path)) return res.status(404).json({ error: 'File not found' });
  res.download(conv.output_path);
});

// Delete conversion
app.delete('/api/tools/conversions/:id', (req, res) => {
  const conv = db.prepare('SELECT * FROM conversions WHERE id=?').get(req.params.id);
  if (conv?.output_path && fs.existsSync(conv.output_path)) try { fs.unlinkSync(conv.output_path); } catch {}
  db.prepare('DELETE FROM conversions WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ─── Scraper ──────────────────────────────────────────────────────────────────

const SCRAPER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
};

// Scrape any webpage for media links
async function scrapePage(url) {
  const res = await axios.get(url, {
    headers: SCRAPER_HEADERS,
    timeout: 15000,
    maxRedirects: 5,
  });

  const $ = cheerio.load(res.data);
  const found = [];

  // Video sources
  $('video source, video[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src) found.push({ type: 'video', url: resolveUrl(src, url), quality: $(el).attr('label') || 'unknown' });
  });

  // Audio sources
  $('audio source, audio[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src) found.push({ type: 'audio', url: resolveUrl(src, url) });
  });

  // Direct media links in anchors
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const ext = href.split('?')[0].split('.').pop()?.toLowerCase();
    const mediaExts = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'mp3', 'aac', 'flac', 'm4a', 'wav'];
    if (mediaExts.includes(ext)) {
      found.push({ type: ['mp3','aac','flac','m4a','wav'].includes(ext) ? 'audio' : 'video', url: resolveUrl(href, url), format: ext });
    }
  });

  // OG meta tags
  const ogVideo = $('meta[property="og:video"], meta[property="og:video:url"]').attr('content');
  const ogAudio = $('meta[property="og:audio"]').attr('content');
  const ogImage = $('meta[property="og:image"]').attr('content');
  const ogTitle = $('meta[property="og:title"]').attr('content') || $('title').text().trim();
  const ogThumb = ogImage || null;

  if (ogVideo) found.unshift({ type: 'video', url: resolveUrl(ogVideo, url), source: 'og:video' });
  if (ogAudio) found.unshift({ type: 'audio', url: resolveUrl(ogAudio, url), source: 'og:audio' });

  // JSON-LD structured data
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || '{}');
      const contentUrl = data.contentUrl || data.embedUrl;
      if (contentUrl) found.push({ type: 'video', url: resolveUrl(contentUrl, url), source: 'ld+json' });
    } catch {}
  });

  // Deduplicate
  const seen = new Set();
  const unique = found.filter(item => {
    if (!item.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });

  return { title: ogTitle, thumbnail: ogThumb, media: unique };
}

function resolveUrl(src, base) {
  if (!src) return src;
  if (src.startsWith('http://') || src.startsWith('https://')) return src;
  if (src.startsWith('//')) return 'https:' + src;
  try {
    return new URL(src, base).href;
  } catch {
    return src;
  }
}

// Scrape a URL for media
app.post('/api/scrape', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    // First try yt-dlp (faster and more reliable for known platforms)
    const knownPlatforms = ['youtube', 'tiktok', 'instagram', 'twitter', 'x.com', 'soundcloud', 'vimeo', 'facebook', 'fb.watch', 'youtu.be'];
    const isKnown = knownPlatforms.some(p => url.includes(p));

    if (isKnown) {
      try {
        const info = await fetchVideoInfo(url);
        return res.json({
          title: info.title,
          thumbnail: info.thumbnail,
          source: 'yt-dlp',
          media: [{
            type: 'video',
            url,
            title: info.title,
            duration: info.duration,
            uploader: info.uploader,
          }],
        });
      } catch {
        // Fall through to scraper
      }
    }

    // Use cheerio scraper for unknown sites
    const result = await scrapePage(url);
    res.json({ ...result, source: 'scraper' });

  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to scrape URL' });
  }
});

// Download directly from a scraped URL
app.post('/api/scrape/download', async (req, res) => {
  const { url, title = 'download', type = 'video' } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const id = randomUUID();
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || (type === 'audio' ? 'mp3' : 'mp4');
  const filePath = path.join(DOWNLOADS_DIR, `${id}.${ext}`);

  db.prepare(`INSERT INTO downloads (id, url, title, platform, format, quality, status) VALUES (?, ?, ?, 'web', ?, 'unknown', 'downloading')`)
    .run(id, url, title, ext);

  res.json({ id, status: 'downloading' });

  setImmediate(async () => {
    try {
      const response = await axios({
        method: 'GET',
        url,
        responseType: 'stream',
        headers: SCRAPER_HEADERS,
        timeout: 60000,
      });

      const totalSize = parseInt(response.headers['content-length'] || '0');
      let downloaded = 0;

      const writer = fs.createWriteStream(filePath);
      response.data.on('data', (chunk) => {
        downloaded += chunk.length;
        if (totalSize > 0) {
          const progress = Math.min(Math.round((downloaded / totalSize) * 100), 99);
          db.prepare(`UPDATE downloads SET progress=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`).run(progress, id);
        }
      });

      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      const stats = fs.statSync(filePath);
      const audioExts = ['mp3', 'aac', 'flac', 'm4a', 'wav', 'opus'];
      const itemType = audioExts.includes(ext) ? 'audio' : 'video';

      db.prepare(`UPDATE downloads SET status='completed', progress=100, file_path=?, file_size=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`)
        .run(filePath, stats.size, id);

      db.prepare(`INSERT INTO library (id, download_id, title, type, source, format, file_size, file_path) VALUES (?, ?, ?, ?, 'web', ?, ?, ?)`)
        .run(randomUUID(), id, title, itemType, ext, stats.size, filePath);

    } catch (err) {
      if (fs.existsSync(filePath)) try { fs.unlinkSync(filePath); } catch {}
      db.prepare(`UPDATE downloads SET status='failed', error_message=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`)
        .run(err.message, id);
    }
  });
});

// ─── Settings ─────────────────────────────────────────────────────────────────

app.get('/api/settings', (_, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const out = {};
  rows.forEach(r => { try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; } });
  res.json(out);
});

app.post('/api/settings', (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  Object.entries(req.body).forEach(([k, v]) => upsert.run(k, JSON.stringify(v)));
  res.json({ success: true });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => console.log(`🚀 Universal Server v2.1.0 running on port ${PORT}`));

process.on('SIGTERM', () => {
  Object.values(activeProcesses).forEach(p => { try { p.kill(); } catch {} });
  process.exit(0);
});
