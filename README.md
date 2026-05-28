# 🗺️ Travel Arrival Alarm — PWA

A production-ready Progressive Web App that alerts you with an alarm before you reach your destination. Perfect for train journeys, buses, or any trip where you need to wake up before your stop.

---

## 📱 Features

- **GPS Tracking** — Continuous location monitoring via browser Geolocation API
- **Multi-Destination Alarms** — Add multiple destinations and activate any combination
- **Haversine Distance** — Precise real-time distance calculation
- **Alarm System** — Audio alarm + vibration + voice announcement + browser notification
- **Interactive Map** — OpenStreetMap via Leaflet.js — no API key needed
- **Place Search** — Search any location worldwide via Nominatim (free)
- **Snooze & Dismiss** — Full alarm control
- **Dark / Light Mode** — Automatic + manual toggle
- **Wake Lock API** — Keeps screen on while tracking
- **Offline Support** — Service Worker caches app shell
- **Installable PWA** — Works on Android Chrome, iOS Safari, and desktop

---

## 🚀 Quick Start (Local)

```bash
# Option 1: Python HTTP server
python3 -m http.server 8080
# Visit: http://localhost:8080

# Option 2: Node.js http-server
npx http-server -p 8080
# Visit: http://localhost:8080
```

> ⚠️ **Must run on HTTP server** — opening `index.html` directly as `file://` will break Service Worker and Geolocation (requires HTTPS or localhost).

---

## 🌐 Deploy on GitHub Pages

1. Create a new GitHub repository.
2. Push all project files to the `main` branch.
3. Go to **Settings → Pages → Source**: select `main` branch, root folder.
4. Your app will be live at: `https://yourusername.github.io/your-repo-name/`

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/travel-alarm.git
git push -u origin main
```

---

## 📦 Deploy on Netlify / Vercel (Recommended)

**Netlify (drag & drop):**
1. Go to [netlify.com](https://netlify.com)
2. Drag the entire project folder to the Netlify dashboard
3. Your app gets an HTTPS URL instantly

**Vercel:**
```bash
npx vercel --prod
```

---

## 📲 Install as PWA on Android

1. Open the app URL in **Chrome**
2. Tap the **3-dot menu → "Add to Home Screen"**
3. Or wait for the install banner to appear in the app

---

## 🍎 Install on iPhone / iOS Safari

1. Open the app URL in **Safari**
2. Tap the **Share button** (square with arrow)
3. Scroll down and tap **"Add to Home Screen"**
4. Tap **Add**

> Note: iOS Safari has limitations on background GPS. Keep the screen on for best results. Enable "Guided Access" to prevent screen timeout.

---

## 🤖 Convert to Android APK (PWABuilder)

1. Go to [pwabuilder.com](https://pwabuilder.com)
2. Enter your deployed app URL
3. Click **"Start"** → **"Build My PWA"**
4. Choose **Android** → Download the APK or AAB
5. Install on Android or publish to Play Store

---

## 📦 Convert to Native App (Capacitor)

```bash
# Install Capacitor
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios

# Initialize
npx cap init "Travel Alarm" "com.yourname.travelalarm" --web-dir "."

# Add platforms
npx cap add android
npx cap add ios

# Sync
npx cap sync

# Open in Android Studio
npx cap open android

# Open in Xcode
npx cap open ios
```

---

## 🗂️ File Structure

```
travel-alarm/
├── index.html          # Main app shell
├── styles.css          # All styles (dark/light theme, animations)
├── app.js              # Core application logic
├── service-worker.js   # PWA caching & offline support
├── manifest.json       # PWA manifest
├── icons/
│   ├── icon-192.png    # App icon (Android)
│   └── icon-512.png    # App icon (large)
└── README.md           # This file
```

---

## ⚙️ Technical Notes

### GPS Background Behavior
- **Android Chrome**: GPS stays active if screen is on. Install as PWA for better behavior.
- **iOS Safari**: Background GPS is restricted. Keep screen on during journey.
- **Wake Lock API**: Used to prevent screen sleep (requires user interaction first).

### Map Tiles
Uses free OpenStreetMap tiles. No API key required. For higher usage, consider hosting your own tile server or using a provider like MapTiler (free tier available).

### Notifications
Browser notifications require HTTPS. On localhost, they work natively.

### Audio Alarm
Uses the Web Audio API to generate tones procedurally — no audio files needed. Custom tone upload supported via FileReader API.

---

## 🔒 Privacy

- **No server-side code** — everything runs in the browser
- **No data collection** — destinations stored in localStorage only
- **No account required**
- Location data never leaves the device

---

## 📄 License

MIT License — free for personal and commercial use.
