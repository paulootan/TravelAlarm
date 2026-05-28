/**
 * TRAVEL ARRIVAL ALARM - app.js
 * Production PWA for destination-based alarms
 * Uses: Leaflet.js, Web Geolocation API, Web Audio API,
 *       Web Notifications, Vibration API, IndexedDB/localStorage
 */

'use strict';

/* ===================================================
   STATE MANAGER
   =================================================== */
const State = {
  destinations: [],          // Saved destinations
  activeAlarms: [],          // Currently active alarm IDs
  isTracking: false,
  currentPosition: null,
  watchId: null,
  alarmTriggered: {},        // { destId: timestamp } prevents re-trigger
  snoozedAlarms: {},         // { destId: snoozeUntil }
  currentAlarmDestId: null,
  alarmInterval: null,
  wakeLock: null,
  audioContext: null,
  alarmAudioNode: null,
  settings: {
    highAccuracy: true,
    interval: 3,
    vibration: true,
    voice: true,
    snooze: 5,
    theme: 'dark',
    wakeLock: true,
  },
  maps: {
    main: null,
    add: null,
    userMarker: null,
    destMarkers: {},
    routeLines: {},
    distCircles: {},
    addMarker: null,
  },
  selectedDist: 500,
  selectedMode: 'driving',
  customToneBlob: null,
  currentPage: 'dashboard',
};

/* ===================================================
   STORAGE
   =================================================== */
const Storage = {
  save() {
    try {
      localStorage.setItem('ta_destinations', JSON.stringify(State.destinations));
      localStorage.setItem('ta_settings', JSON.stringify(State.settings));
    } catch (e) { console.warn('Storage save failed', e); }
  },
  load() {
    try {
      const dests = localStorage.getItem('ta_destinations');
      if (dests) State.destinations = JSON.parse(dests);
      const settings = localStorage.getItem('ta_settings');
      if (settings) State.settings = { ...State.settings, ...JSON.parse(settings) };
    } catch (e) { console.warn('Storage load failed', e); }
  },
  clear() {
    localStorage.removeItem('ta_destinations');
    localStorage.removeItem('ta_settings');
  }
};

/* ===================================================
   HAVERSINE DISTANCE
   =================================================== */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // metres
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // in metres
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function estimateETA(distMeters, speedKmh) {
  if (!speedKmh || speedKmh < 1) return '—';
  const hours = (distMeters / 1000) / speedKmh;
  const mins = Math.round(hours * 60);
  if (mins < 1) return '< 1 min';
  if (mins < 60) return `~${mins} min`;
  return `~${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/* ===================================================
   UNIQUE ID
   =================================================== */
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ===================================================
   TOAST NOTIFICATIONS
   =================================================== */
function showToast(msg, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* ===================================================
   MAPS SETUP
   =================================================== */
function initMaps() {
  const tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const tileOpts = { maxZoom: 19 };

  // Main map
  State.maps.main = L.map('map', { zoomControl: false, attributionControl: false })
    .setView([20.5937, 78.9629], 5);
  L.tileLayer(tileUrl, tileOpts).addTo(State.maps.main);
  L.control.zoom({ position: 'bottomright' }).addTo(State.maps.main);

  // Add-destination map
  State.maps.add = L.map('add-map', { zoomControl: false, attributionControl: false })
    .setView([20.5937, 78.9629], 5);
  L.tileLayer(tileUrl, tileOpts).addTo(State.maps.add);

  // Click on add-map to drop pin
  State.maps.add.on('click', (e) => {
    placeAddMarker(e.latlng.lat, e.latlng.lng);
  });

  // Center button
  document.getElementById('center-map-btn').addEventListener('click', () => {
    if (State.currentPosition) {
      State.maps.main.setView(
        [State.currentPosition.latitude, State.currentPosition.longitude], 14
      );
    } else {
      showToast('GPS not yet available', 'warning');
    }
  });
}

function createUserMarkerIcon() {
  return L.divIcon({
    className: '',
    html: '<div class="current-location-marker"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function createDestMarkerIcon() {
  return L.divIcon({
    className: '',
    html: '<div class="dest-marker"></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 20],
  });
}

function updateUserMarker(lat, lng) {
  if (!State.maps.main) return;
  if (State.maps.userMarker) {
    State.maps.userMarker.setLatLng([lat, lng]);
  } else {
    State.maps.userMarker = L.marker([lat, lng], { icon: createUserMarkerIcon(), zIndexOffset: 1000 })
      .addTo(State.maps.main);
  }
}

function updateDestMarkersOnMap() {
  if (!State.maps.main) return;
  // Clear old
  Object.values(State.maps.destMarkers).forEach(m => m.remove());
  Object.values(State.maps.distCircles).forEach(c => c.remove());
  Object.values(State.maps.routeLines).forEach(l => l.remove());
  State.maps.destMarkers = {};
  State.maps.distCircles = {};
  State.maps.routeLines = {};

  State.activeAlarms.forEach(id => {
    const dest = State.destinations.find(d => d.id === id);
    if (!dest) return;
    const m = L.marker([dest.lat, dest.lng], { icon: createDestMarkerIcon() })
      .addTo(State.maps.main)
      .bindTooltip(dest.name, { permanent: false, direction: 'top' });
    State.maps.destMarkers[id] = m;
    const circle = L.circle([dest.lat, dest.lng], {
      radius: dest.alertDist,
      color: '#ff4d6d',
      fillColor: '#ff4d6d',
      fillOpacity: 0.08,
      weight: 1.5,
      dashArray: '6,4',
    }).addTo(State.maps.main);
    State.maps.distCircles[id] = circle;
  });

  if (State.currentPosition && State.activeAlarms.length) {
    const pos = State.currentPosition;
    State.activeAlarms.forEach(id => {
      const dest = State.destinations.find(d => d.id === id);
      if (!dest) return;
      const line = L.polyline(
        [[pos.latitude, pos.longitude], [dest.lat, dest.lng]],
        { color: '#00d4ff', weight: 2, opacity: 0.5, dashArray: '6,6' }
      ).addTo(State.maps.main);
      State.maps.routeLines[id] = line;
    });
  }
}

function placeAddMarker(lat, lng) {
  if (State.maps.addMarker) State.maps.addMarker.remove();
  State.maps.addMarker = L.marker([lat, lng], { icon: createDestMarkerIcon() })
    .addTo(State.maps.add);
  document.getElementById('dest-lat').value = lat.toFixed(6);
  document.getElementById('dest-lng').value = lng.toFixed(6);
  State.maps.add.setView([lat, lng], 14);
}

/* ===================================================
   GPS TRACKING
   =================================================== */
function startGPSTracking() {
  if (!navigator.geolocation) {
    showToast('Geolocation not supported', 'error');
    return;
  }

  setGPSIndicator('searching');

  const options = {
    enableHighAccuracy: State.settings.highAccuracy,
    timeout: 10000,
    maximumAge: State.settings.interval * 1000,
  };

  State.watchId = navigator.geolocation.watchPosition(
    onPositionUpdate,
    onPositionError,
    options
  );

  State.isTracking = true;
  updateTrackingUI();
  requestWakeLock();
  updateDestMarkersOnMap();
  showToast('GPS tracking started', 'success');
}

function stopGPSTracking() {
  if (State.watchId !== null) {
    navigator.geolocation.clearWatch(State.watchId);
    State.watchId = null;
  }
  State.isTracking = false;
  clearAlarmState();
  updateTrackingUI();
  releaseWakeLock();
  setGPSIndicator('inactive');
  document.getElementById('gps-status-text').textContent = 'Stopped';
  showToast('Tracking stopped', 'info');
}

function onPositionUpdate(pos) {
  const { latitude, longitude, accuracy, speed } = pos.coords;
  State.currentPosition = { latitude, longitude, accuracy, speed };

  setGPSIndicator('active');
  document.getElementById('gps-status-text').textContent = 'Active';

  // Update speed display
  const speedKmh = speed ? (speed * 3.6).toFixed(1) : 0;
  document.getElementById('speed-value').textContent = `${speedKmh} km/h`;
  document.getElementById('accuracy-value').textContent = accuracy ? `±${Math.round(accuracy)}m` : '—';

  // Update user marker
  updateUserMarker(latitude, longitude);

  // Check each active alarm
  if (State.isTracking && State.activeAlarms.length) {
    checkAlarmsProximity(latitude, longitude, speedKmh);
    updateActiveAlarmsList();
    updateDestMarkersOnMap();
  }
}

function onPositionError(err) {
  setGPSIndicator('error');
  document.getElementById('gps-status-text').textContent = 'Error';
  const msgs = {
    1: 'GPS permission denied. Please enable in settings.',
    2: 'GPS position unavailable. Check signal.',
    3: 'GPS timed out. Retrying…',
  };
  showToast(msgs[err.code] || 'GPS error', 'error');

  // Auto retry after 5s
  if (State.isTracking) {
    setTimeout(() => {
      if (State.isTracking) {
        navigator.geolocation.clearWatch(State.watchId);
        startGPSTracking();
      }
    }, 5000);
  }
}

function setGPSIndicator(status) {
  const dot = document.getElementById('gps-indicator');
  dot.className = 'status-dot';
  if (status === 'active') dot.classList.add('active');
  else if (status === 'searching') dot.classList.add('searching');
  else if (status === 'error') dot.classList.add('error');
}

function updateTrackingUI() {
  const startBtn = document.getElementById('btn-start-journey');
  const stopBtn = document.getElementById('btn-stop-journey');
  const badge = document.getElementById('tracking-badge');
  const badgeText = document.getElementById('tracking-badge-text');

  if (State.isTracking) {
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    badge.classList.add('active');
    badgeText.textContent = 'Tracking Active';
  } else {
    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    badge.classList.remove('active');
    badgeText.textContent = 'Not Tracking';
  }
}

/* ===================================================
   ALARM PROXIMITY CHECK
   =================================================== */
function checkAlarmsProximity(lat, lng, speedKmh) {
  const now = Date.now();

  State.activeAlarms.forEach(id => {
    const dest = State.destinations.find(d => d.id === id);
    if (!dest) return;

    const dist = calculateDistance(lat, lng, dest.lat, dest.lng);
    dest._currentDist = dist;
    dest._speedKmh = speedKmh;

    // Check snooze
    if (State.snoozedAlarms[id] && now < State.snoozedAlarms[id]) return;

    // Check if already triggered recently (prevent re-trigger for 30 seconds after dismiss)
    if (State.alarmTriggered[id] && (now - State.alarmTriggered[id]) < 30000) return;

    if (dist <= dest.alertDist) {
      triggerAlarm(dest);
    }
  });
}

/* ===================================================
   ALARM SYSTEM
   =================================================== */
function triggerAlarm(dest) {
  if (State.currentAlarmDestId === dest.id) return; // Already showing for this

  State.currentAlarmDestId = dest.id;
  State.alarmTriggered[dest.id] = Date.now();

  // Show modal
  document.getElementById('alarm-dest-name').textContent = dest.name;
  document.getElementById('alarm-distance-text').textContent =
    `${formatDistance(dest._currentDist || 0)} away`;
  document.getElementById('alarm-modal').classList.remove('hidden');

  // Vibration
  if (State.settings.vibration && navigator.vibrate) {
    const pattern = [300, 200, 300, 200, 500, 200, 300, 200, 300];
    State.alarmInterval = setInterval(() => navigator.vibrate(pattern), 2000);
    navigator.vibrate(pattern);
  }

  // Audio
  playAlarmTone(dest.alarmTone);

  // Voice announcement
  if (State.settings.voice && window.speechSynthesis) {
    const msg = new SpeechSynthesisUtterance(
      `Approaching ${dest.name}. You are ${formatDistance(dest._currentDist || 0)} away.`
    );
    msg.rate = 0.9; msg.pitch = 1;
    window.speechSynthesis.speak(msg);
  }

  // Browser notification
  sendNotification(dest);
}

function playAlarmTone(toneType) {
  try {
    if (!State.audioContext) {
      State.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = State.audioContext;

    function playBeep(freq, duration, delay = 0) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(0.6, ctx.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + duration);
    }

    const tones = {
      beep: () => {
        [0, 0.4, 0.8, 1.2].forEach(d => playBeep(880, 0.3, d));
      },
      chime: () => {
        [523, 659, 784, 1047].forEach((f, i) => playBeep(f, 0.5, i * 0.3));
      },
      siren: () => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(400, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.5);
        osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 1.0);
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime + 1.2);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 1.2);
      },
      bell: () => {
        [0, 1.5].forEach(d => {
          [1000, 1500, 2000].forEach((f, i) => playBeep(f, 1.2, d + i * 0.05));
        });
      },
    };

    const fn = tones[toneType] || tones.beep;
    fn();

    // Repeat every 2 seconds while alarm is showing
    State.alarmAudioNode = setInterval(() => {
      if (!document.getElementById('alarm-modal').classList.contains('hidden')) {
        fn();
      }
    }, 2200);

  } catch (e) {
    console.warn('Audio playback failed:', e);
  }
}

function stopAlarmTone() {
  // Clear repeating audio interval
  if (State.alarmAudioNode) {
    clearInterval(State.alarmAudioNode);
    State.alarmAudioNode = null;
  }
  // Clear vibration interval
  if (State.alarmInterval) {
    clearInterval(State.alarmInterval);
    State.alarmInterval = null;
  }
  // Stop vibration
  if (navigator.vibrate) navigator.vibrate(0);
  // Stop speech
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  // Suspend AudioContext to silence any still-playing nodes
  if (State.audioContext && State.audioContext.state === 'running') {
    State.audioContext.suspend().catch(() => {});
  }
}

function dismissAlarm() {
  stopAlarmTone();
  // Resume AudioContext so it's ready for next alarm
  if (State.audioContext && State.audioContext.state === 'suspended') {
    State.audioContext.resume().catch(() => {});
  }
  const modal = document.getElementById('alarm-modal');
  modal.classList.add('hidden');
  State.currentAlarmDestId = null;
}

function snoozeAlarm() {
  const id = State.currentAlarmDestId;
  if (id) {
    const snoozeMs = State.settings.snooze * 60 * 1000;
    State.snoozedAlarms[id] = Date.now() + snoozeMs;
    showToast(`Snoozed for ${State.settings.snooze} min`, 'info');
  }
  dismissAlarm();
}

function clearAlarmState() {
  stopAlarmTone();
  State.alarmTriggered = {};
  State.snoozedAlarms = {};
  State.currentAlarmDestId = null;
  document.getElementById('alarm-modal').classList.add('hidden');
}

/* ===================================================
   BROWSER NOTIFICATIONS
   =================================================== */
async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    showToast('Notifications not supported', 'warning');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') showToast('Notifications enabled!', 'success');
  else showToast('Notifications denied', 'warning');
}

function sendNotification(dest) {
  if (Notification.permission !== 'granted') return;
  try {
    new Notification('📍 Approaching Destination!', {
      body: `${dest.name} is ${formatDistance(dest._currentDist || 0)} away`,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: `alarm-${dest.id}`,
      renotify: true,
      vibrate: [300, 200, 300],
    });
  } catch (e) { console.warn('Notification failed', e); }
}

/* ===================================================
   WAKE LOCK
   =================================================== */
async function requestWakeLock() {
  if (!State.settings.wakeLock) return;
  if (!('wakeLock' in navigator)) return;
  try {
    State.wakeLock = await navigator.wakeLock.request('screen');
    State.wakeLock.addEventListener('release', () => { State.wakeLock = null; });
  } catch (e) { console.warn('Wake lock failed:', e); }
}

function releaseWakeLock() {
  if (State.wakeLock) {
    State.wakeLock.release().catch(() => {});
    State.wakeLock = null;
  }
}

/* ===================================================
   DESTINATION MANAGEMENT
   =================================================== */
function addDestination(dest) {
  State.destinations.push(dest);
  Storage.save();
  renderDestinationsList();
  renderActiveAlarmsList();
}

function removeDestination(id) {
  // Remove from active alarms too
  State.activeAlarms = State.activeAlarms.filter(a => a !== id);
  State.destinations = State.destinations.filter(d => d.id !== id);
  delete State.alarmTriggered[id];
  delete State.snoozedAlarms[id];
  Storage.save();
  renderDestinationsList();
  renderActiveAlarmsList();
  updateDestMarkersOnMap();
}

function toggleDestinationActive(id) {
  const idx = State.activeAlarms.indexOf(id);
  if (idx === -1) {
    State.activeAlarms.push(id);
  } else {
    State.activeAlarms.splice(idx, 1);
    delete State.alarmTriggered[id];
    delete State.snoozedAlarms[id];
  }
  renderDestinationsList();
  renderActiveAlarmsList();
  updateDestMarkersOnMap();

  const count = State.activeAlarms.length;
  showToast(idx === -1 ? 'Alarm activated' : 'Alarm deactivated', 'info');
  document.getElementById('active-count').textContent = count;
}

/* ===================================================
   RENDER: ACTIVE ALARMS (Dashboard)
   =================================================== */
function renderActiveAlarmsList() {
  const container = document.getElementById('active-alarms-list');
  const noMsg = document.getElementById('no-alarms-msg');
  document.getElementById('active-count').textContent = State.activeAlarms.length;

  const existing = container.querySelectorAll('.alarm-item');
  existing.forEach(el => el.remove());

  if (State.activeAlarms.length === 0) {
    noMsg.classList.remove('hidden');
    return;
  }
  noMsg.classList.add('hidden');

  State.activeAlarms.forEach(id => {
    const dest = State.destinations.find(d => d.id === id);
    if (!dest) return;

    const dist = (State.currentPosition && dest._currentDist != null)
      ? formatDistance(dest._currentDist) : '—';
    const eta = (State.currentPosition && dest._currentDist != null)
      ? estimateETA(dest._currentDist, dest._speedKmh || 0) : '—';

    const modeEmoji = { driving: '🚗', train: '🚆', walking: '🚶' }[dest.mode] || '📍';

    const el = document.createElement('div');
    el.className = 'alarm-item active-alarm';
    el.dataset.id = id;
    el.innerHTML = `
      <div class="alarm-item-icon">${modeEmoji}</div>
      <div class="alarm-item-info">
        <div class="alarm-item-name">${dest.name}</div>
        <div class="alarm-item-meta">Alert at ${formatDistance(dest.alertDist)} · ETA: ${eta}</div>
      </div>
      <div class="alarm-item-dist">${dist}</div>
      <button class="alarm-item-remove" data-id="${id}" title="Remove alarm">✕</button>
    `;
    el.querySelector('.alarm-item-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDestinationActive(id);
    });
    container.appendChild(el);
  });
}

function updateActiveAlarmsList() {
  document.querySelectorAll('.alarm-item[data-id]').forEach(el => {
    const id = el.dataset.id;
    const dest = State.destinations.find(d => d.id === id);
    if (!dest || dest._currentDist == null) return;
    const distEl = el.querySelector('.alarm-item-dist');
    if (distEl) distEl.textContent = formatDistance(dest._currentDist);
    const metaEl = el.querySelector('.alarm-item-meta');
    if (metaEl) {
      const eta = estimateETA(dest._currentDist, dest._speedKmh || 0);
      metaEl.textContent = `Alert at ${formatDistance(dest.alertDist)} · ETA: ${eta}`;
    }
  });
}

/* ===================================================
   RENDER: SAVED DESTINATIONS LIST
   =================================================== */
function renderDestinationsList() {
  const container = document.getElementById('destinations-list');
  container.innerHTML = '';

  if (State.destinations.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📍</div>
        <p>No saved destinations</p>
        <span>Your saved destinations will appear here</span>
      </div>`;
    return;
  }

  State.destinations.forEach(dest => {
    const isActive = State.activeAlarms.includes(dest.id);
    const modeEmoji = { driving: '🚗', train: '🚆', walking: '🚶' }[dest.mode] || '📍';

    const el = document.createElement('div');
    el.className = 'dest-card';
    el.innerHTML = `
      <div class="dest-card-header">
        <div class="dest-card-name">${modeEmoji} ${dest.name}</div>
        <div class="dest-card-actions">
          <button class="dest-card-action ${isActive ? 'active-btn' : ''}" data-action="toggle" data-id="${dest.id}">
            ${isActive ? '🔔 Active' : '🔕 Enable'}
          </button>
          <button class="dest-card-action" data-action="zoom" data-id="${dest.id}" title="View on map">🗺️</button>
          <button class="dest-card-action danger" data-action="delete" data-id="${dest.id}" title="Delete">🗑️</button>
        </div>
      </div>
      <div class="dest-card-meta">
        <span>📐 ${formatDistance(dest.alertDist)}</span>
        <span>🎵 ${dest.alarmTone}</span>
        ${dest.notes ? `<span>📝 ${dest.notes}</span>` : ''}
        <span>📍 ${dest.lat.toFixed(4)}, ${dest.lng.toFixed(4)}</span>
      </div>`;

    el.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (action === 'delete') {
          if (confirm(`Delete "${dest.name}"?`)) removeDestination(id);
        } else if (action === 'toggle') {
          toggleDestinationActive(id);
        } else if (action === 'zoom') {
          switchPage('dashboard');
          setTimeout(() => {
            State.maps.main.setView([dest.lat, dest.lng], 14);
          }, 300);
        }
      });
    });

    container.appendChild(el);
  });
}

/* ===================================================
   SEARCH (Nominatim)
   =================================================== */
let searchDebounce = null;

async function searchPlace(query) {
  if (!query.trim()) {
    hideSearchResults();
    return;
  }
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();
    showSearchResults(data);
  } catch (e) {
    showToast('Search failed — check internet connection', 'error');
  }
}

function showSearchResults(results) {
  const container = document.getElementById('search-results');
  container.innerHTML = '';
  if (!results.length) {
    container.innerHTML = '<div class="search-result-item"><span>No results found</span></div>';
    container.classList.remove('hidden');
    return;
  }
  results.forEach(r => {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    const display = r.display_name.split(',');
    item.innerHTML = `<strong>${display[0]}</strong><span>${display.slice(1, 3).join(',').trim()}</span>`;
    item.addEventListener('click', () => {
      const lat = parseFloat(r.lat);
      const lng = parseFloat(r.lon);
      placeAddMarker(lat, lng);
      document.getElementById('dest-name').value = display[0].trim();
      document.getElementById('place-search').value = display[0].trim();
      hideSearchResults();
    });
    container.appendChild(item);
  });
  container.classList.remove('hidden');
}

function hideSearchResults() {
  document.getElementById('search-results').classList.add('hidden');
}

/* ===================================================
   PAGE NAVIGATION
   =================================================== */
function switchPage(pageId) {
  const pages = document.querySelectorAll('.page');
  pages.forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  document.getElementById(`page-${pageId}`)?.classList.add('active');
  document.querySelector(`.nav-btn[data-page="${pageId}"]`)?.classList.add('active');
  State.currentPage = pageId;

  // Invalidate map sizes when switching to those pages
  if (pageId === 'dashboard') {
    setTimeout(() => State.maps.main?.invalidateSize(), 100);
  } else if (pageId === 'add') {
    setTimeout(() => State.maps.add?.invalidateSize(), 100);
  }
}

/* ===================================================
   SAVE DESTINATION FORM
   =================================================== */
function saveDestination() {
  const name = document.getElementById('dest-name').value.trim();
  const lat = parseFloat(document.getElementById('dest-lat').value);
  const lng = parseFloat(document.getElementById('dest-lng').value);
  const notes = document.getElementById('dest-notes').value.trim();
  const alarmTone = document.getElementById('alarm-tone').value;

  if (!name) { showToast('Please enter a destination name', 'error'); return; }
  if (isNaN(lat) || isNaN(lng)) { showToast('Please select a location on the map or enter coordinates', 'error'); return; }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) { showToast('Invalid coordinates', 'error'); return; }

  const dest = {
    id: genId(),
    name,
    lat,
    lng,
    alertDist: State.selectedDist,
    alarmTone,
    mode: State.selectedMode,
    notes,
    createdAt: Date.now(),
  };

  addDestination(dest);
  showToast(`"${name}" saved!`, 'success');

  // Reset form
  document.getElementById('dest-name').value = '';
  document.getElementById('dest-lat').value = '';
  document.getElementById('dest-lng').value = '';
  document.getElementById('dest-notes').value = '';
  document.getElementById('place-search').value = '';
  if (State.maps.addMarker) { State.maps.addMarker.remove(); State.maps.addMarker = null; }

  switchPage('history');
}

/* ===================================================
   SETTINGS
   =================================================== */
function loadSettingsUI() {
  document.getElementById('setting-high-accuracy').checked = State.settings.highAccuracy;
  document.getElementById('setting-interval').value = State.settings.interval;
  document.getElementById('interval-desc').textContent = `Every ${State.settings.interval} seconds`;
  document.getElementById('setting-vibration').checked = State.settings.vibration;
  document.getElementById('setting-voice').checked = State.settings.voice;
  document.getElementById('setting-snooze').value = State.settings.snooze;
  document.getElementById('setting-theme').value = State.settings.theme;
  document.getElementById('setting-wakelock').checked = State.settings.wakeLock;
}

function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  const darkIcon = document.getElementById('theme-icon-dark');
  const lightIcon = document.getElementById('theme-icon-light');
  if (theme === 'dark') {
    darkIcon.style.display = '';
    lightIcon.style.display = 'none';
  } else {
    darkIcon.style.display = 'none';
    lightIcon.style.display = '';
  }
}

/* ===================================================
   EXPORT / IMPORT
   =================================================== */
function exportDestinations() {
  const data = JSON.stringify(State.destinations, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'travel-alarm-destinations.json';
  a.click(); URL.revokeObjectURL(url);
  showToast('Destinations exported!', 'success');
}

function importDestinations(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) throw new Error('Invalid format');
      let added = 0;
      data.forEach(d => {
        if (d.id && d.name && d.lat != null && d.lng != null) {
          if (!State.destinations.find(x => x.id === d.id)) {
            State.destinations.push(d);
            added++;
          }
        }
      });
      Storage.save();
      renderDestinationsList();
      showToast(`Imported ${added} destinations`, 'success');
    } catch (err) {
      showToast('Import failed — invalid file', 'error');
    }
  };
  reader.readAsText(file);
}

/* ===================================================
   SERVICE WORKER REGISTRATION
   =================================================== */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js')
      .then(reg => console.log('SW registered:', reg.scope))
      .catch(err => console.warn('SW registration failed:', err));
  }
}

/* ===================================================
   PWA INSTALL PROMPT
   =================================================== */
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const banner = document.getElementById('install-banner');
  banner.classList.remove('hidden');
  setTimeout(() => banner.classList.add('show'), 100);
});

/* ===================================================
   INIT EVENT LISTENERS
   =================================================== */
function bindEvents() {
  // Navigation
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchPage(btn.dataset.page));
  });

  // Start/Stop tracking
  document.getElementById('btn-start-journey').addEventListener('click', () => {
    if (State.activeAlarms.length === 0) {
      showToast('Please activate at least one destination alarm first', 'warning');
      return;
    }
    startGPSTracking();
  });
  document.getElementById('btn-stop-journey').addEventListener('click', stopGPSTracking);

  // Tap anywhere on alarm modal to dismiss
  document.getElementById('alarm-modal').addEventListener('click', dismissAlarm);

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const newTheme = State.settings.theme === 'dark' ? 'light' : 'dark';
    State.settings.theme = newTheme;
    applyTheme(newTheme);
    document.getElementById('setting-theme').value = newTheme;
    Storage.save();
  });

  // Search
  const searchInput = document.getElementById('place-search');
  const clearBtn = document.getElementById('clear-search');
  searchInput.addEventListener('input', () => {
    clearBtn.classList.toggle('hidden', !searchInput.value);
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => searchPlace(searchInput.value), 500);
  });
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.classList.add('hidden');
    hideSearchResults();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) hideSearchResults();
  });

  // Distance buttons
  document.querySelectorAll('.dist-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dist-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const customInput = document.getElementById('custom-distance');
      if (btn.dataset.dist === 'custom') {
        customInput.classList.remove('hidden');
        customInput.focus();
      } else {
        customInput.classList.add('hidden');
        State.selectedDist = parseInt(btn.dataset.dist);
      }
    });
  });
  document.getElementById('custom-distance').addEventListener('input', (e) => {
    const v = parseInt(e.target.value);
    if (!isNaN(v) && v >= 100) State.selectedDist = v;
  });

  // Mode buttons
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.selectedMode = btn.dataset.mode;
    });
  });

  // Alarm tone - custom file
  document.getElementById('alarm-tone').addEventListener('change', (e) => {
    if (e.target.value === 'custom') {
      document.getElementById('custom-tone-file').click();
    }
  });
  document.getElementById('custom-tone-file').addEventListener('change', (e) => {
    if (e.target.files[0]) {
      State.customToneBlob = URL.createObjectURL(e.target.files[0]);
      showToast('Custom tone loaded', 'success');
    }
  });

  // Save destination
  document.getElementById('btn-save-dest').addEventListener('click', saveDestination);

  // Export/Import
  document.getElementById('btn-export').addEventListener('click', exportDestinations);
  document.getElementById('import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importDestinations(e.target.files[0]);
  });

  // Settings
  document.getElementById('setting-high-accuracy').addEventListener('change', (e) => {
    State.settings.highAccuracy = e.target.checked;
    Storage.save();
  });
  document.getElementById('setting-interval').addEventListener('input', (e) => {
    State.settings.interval = parseInt(e.target.value);
    document.getElementById('interval-desc').textContent = `Every ${State.settings.interval} seconds`;
    Storage.save();
  });
  document.getElementById('setting-vibration').addEventListener('change', (e) => {
    State.settings.vibration = e.target.checked;
    Storage.save();
  });
  document.getElementById('setting-voice').addEventListener('change', (e) => {
    State.settings.voice = e.target.checked;
    Storage.save();
  });
  document.getElementById('setting-snooze').addEventListener('change', (e) => {
    State.settings.snooze = parseInt(e.target.value);
    Storage.save();
  });
  document.getElementById('setting-theme').addEventListener('change', (e) => {
    State.settings.theme = e.target.value;
    applyTheme(e.target.value);
    Storage.save();
  });
  document.getElementById('setting-wakelock').addEventListener('change', (e) => {
    State.settings.wakeLock = e.target.checked;
    if (!e.target.checked) releaseWakeLock();
    Storage.save();
  });

  // Permission buttons
  document.getElementById('btn-perm-gps').addEventListener('click', () => {
    navigator.geolocation.getCurrentPosition(
      () => showToast('GPS permission granted!', 'success'),
      () => showToast('GPS permission denied', 'error'),
      { enableHighAccuracy: true }
    );
  });
  document.getElementById('btn-perm-notif').addEventListener('click', requestNotificationPermission);

  // Clear data
  document.getElementById('btn-clear-data').addEventListener('click', () => {
    if (confirm('This will delete ALL destinations and settings. Continue?')) {
      stopGPSTracking();
      State.destinations = [];
      State.activeAlarms = [];
      Storage.clear();
      renderDestinationsList();
      renderActiveAlarmsList();
      showToast('All data cleared', 'info');
    }
  });

  // Install banner
  document.getElementById('install-btn').addEventListener('click', () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then(() => {
        deferredInstallPrompt = null;
        document.getElementById('install-banner').classList.remove('show');
      });
    }
  });
  document.getElementById('install-dismiss').addEventListener('click', () => {
    document.getElementById('install-banner').classList.remove('show');
  });

  // Re-acquire wake lock on visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && State.isTracking && State.settings.wakeLock) {
      requestWakeLock();
    }
  });
}

/* ===================================================
   APP INIT
   =================================================== */
function init() {
  // Load saved data
  Storage.load();

  // Apply saved theme
  applyTheme(State.settings.theme);

  // Show app, hide splash after brief delay
  setTimeout(() => {
    document.getElementById('splash-screen').style.transition = 'opacity 0.4s ease';
    document.getElementById('splash-screen').style.opacity = '0';
    document.getElementById('app').classList.remove('hidden');
    setTimeout(() => {
      document.getElementById('splash-screen').style.display = 'none';
    }, 400);
  }, 1400);

  // Init maps (after DOM is visible)
  setTimeout(() => {
    initMaps();
    renderDestinationsList();
    renderActiveAlarmsList();
    loadSettingsUI();
    bindEvents();
    registerServiceWorker();

    // Try to get initial location for map centering
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          State.maps.main.setView([latitude, longitude], 13);
          State.maps.add.setView([latitude, longitude], 13);
          updateUserMarker(latitude, longitude);
          setGPSIndicator('active');
          document.getElementById('gps-status-text').textContent = 'Ready';
        },
        () => {
          setGPSIndicator('error');
          document.getElementById('gps-status-text').textContent = 'Denied';
        },
        { enableHighAccuracy: false, timeout: 8000 }
      );
    }
  }, 1500);
}

// Start
document.addEventListener('DOMContentLoaded', init);
