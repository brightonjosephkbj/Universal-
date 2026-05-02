# Universal Downloader v2.0

A fully working media downloader app — React Native + Expo frontend, Node.js + yt-dlp backend.

---

## App Structure

```
app/
  (tabs)/
    index.tsx      ← Home: paste URL, pick format/quality, download
    library.tsx    ← Library: browse and manage downloaded files
    player.tsx     ← Player: play audio/video with equalizer
    tools.tsx      ← Tools: convert, extract, merge (some coming soon)
    settings.tsx   ← Settings: server URL, defaults, preferences
lib/
  api.ts           ← All API calls + helpers
  theme.ts         ← Shared color theme
server/
  index.js         ← Node.js backend (Express + SQLite + yt-dlp)
  package.json
```

---

## Setup

### 1. Install app dependencies
```bash
npm install
```

### 2. Deploy the server (free on Render)

1. Push the `server/` folder to a GitHub repo
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your repo, set:
   - **Build command**: `npm install`
   - **Start command**: `node index.js`
   - **Environment**: Node
4. Add a build step to install yt-dlp:
   - In Render dashboard → Shell:
     ```bash
     pip install yt-dlp
     ```
5. Copy your Render URL (e.g. `https://universal-server-xxxx.onrender.com`)

### 3. Set the server URL in the app
- Open the app → Settings tab → tap the server URL → paste your Render URL → Save

### 4. Build the APK
```bash
# Install EAS CLI
npm install -g eas-cli

# Login
eas login

# Build APK
eas build --platform android --profile apk
```

---

## Features
- ✅ Download from YouTube, TikTok, Instagram, SoundCloud, Twitter/X, Vimeo, Facebook, 1000+ sites
- ✅ Choose format: MP4, MP3, MKV, AAC, FLAC, M4A
- ✅ Choose quality: 360p → 4K, 128k / 320k audio
- ✅ Real-time download progress with speed + ETA
- ✅ Library with list/grid view, search, filter by type
- ✅ Audio player with queue, shuffle, repeat, equalizer
- ✅ Settings persist across sessions (AsyncStorage)
- ✅ Configurable server URL (no rebuild needed to change server)
- 🔄 Tools: Video→Audio and Format Convert work, others coming soon
