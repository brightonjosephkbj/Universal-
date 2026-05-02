# Universal Media Downloader — Deploy Guide

## STEP 1 — Deploy Backend to Render.com

1. Go to github.com and create a new repo called `universal-server`
2. Upload only the `server/` folder contents (index.js, package.json)
3. Go to render.com → New → Web Service
4. Connect your GitHub repo
5. Fill in these settings:
   - Name: universal-server
   - Build Command: `apt-get install -y ffmpeg python3-pip && pip install yt-dlp && npm install`
   - Start Command: `node index.js`
   - Instance Type: Free
6. Click Deploy
7. Wait 3-5 minutes — copy your server URL when done
   Example: https://universal-server-xxxx.onrender.com

## STEP 2 — Update App Server URL

Open `lib/api.ts` and change line 5:
```
export const DEFAULT_SERVER = 'https://your-render-url.onrender.com';
```

## STEP 3 — Build APK with Expo

In Termux:
```bash
cd Universal-Complete
npm install
npx expo login
npx eas build --platform android --profile preview
```

Wait for build — EAS will give you a download link for the APK.

## STEP 4 — Install APK

Download the APK link on your phone and install it.
Allow "Install from unknown sources" if asked.

---

## Test the backend is working:
Open browser and go to:
https://your-render-url.onrender.com/health

Should show: {"status":"ok","version":"2.1.0"}

## Troubleshooting:
- If downloads fail → yt-dlp not installed (check build command)
- If tools fail → ffmpeg not installed (check build command)  
- If app can't connect → wrong server URL in api.ts
