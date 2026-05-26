// ═══════════════════════════════════════════════════════════
// PWA — Service Worker + Install Prompt + Update Banner
// ═══════════════════════════════════════════════════════════

(function initPWA() {

// ── CSS ───────────────────────────────────────────────────
const css = `
/* ══ PWA UI ══════════════════════════════════════════════ */

/* Install prompt banner */
#pwa-install-banner {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 600;
  background: linear-gradient(135deg, #0C1019, #111827);
  border-top: 1px solid rgba(239,159,39,0.3);
  padding: 14px 16px 14px;
  display: flex; align-items: center; gap: 12px;
  transform: translateY(100%);
  transition: transform 0.4s cubic-bezier(.34,1.56,.64,1);
  box-shadow: 0 -8px 32px rgba(0,0,0,0.5);
}
#pwa-install-banner.visible { transform: translateY(0); }
.pwa-banner-icon {
  width: 44px; height: 44px; border-radius: 10px; flex-shrink: 0;
  overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.4);
}
.pwa-banner-icon img { width: 100%; height: 100%; object-fit: cover; }
.pwa-banner-info { flex: 1; min-width: 0; }
.pwa-banner-title {
  font-family: 'Bebas Neue', sans-serif; font-size: 16px;
  letter-spacing: 1px; color: #F0F4FF; line-height: 1;
}
.pwa-banner-desc {
  font-size: 11px; color: rgba(240,244,255,0.5);
  font-family: 'Barlow', sans-serif; margin-top: 2px;
}
.pwa-install-btn {
  padding: 9px 18px; border-radius: 8px;
  background: linear-gradient(135deg, #E31E24, #004F9F);
  border: none; color: #fff;
  font-family: 'Bebas Neue', sans-serif; font-size: 15px;
  letter-spacing: 2px; cursor: pointer; flex-shrink: 0;
  transition: all .15s; white-space: nowrap;
}
.pwa-install-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(227,30,36,0.35); }
.pwa-dismiss-btn {
  background: none; border: none; color: rgba(240,244,255,0.3);
  cursor: pointer; font-size: 18px; padding: 4px; flex-shrink: 0;
  transition: color .12s;
}
.pwa-dismiss-btn:hover { color: rgba(240,244,255,0.6); }

/* Update banner */
#pwa-update-banner {
  position: fixed; top: 0; left: 0; right: 0; z-index: 600;
  background: linear-gradient(90deg, #00A650, #004F9F);
  padding: 10px 16px;
  display: flex; align-items: center; gap: 10px;
  transform: translateY(-100%);
  transition: transform 0.35s ease;
}
#pwa-update-banner.visible { transform: translateY(0); }
.pwa-update-text {
  flex: 1; font-family: 'Barlow Condensed', sans-serif;
  font-size: 14px; font-weight: 600; color: #fff;
}
.pwa-update-btn {
  padding: 6px 14px; border-radius: 6px; background: rgba(255,255,255,0.2);
  border: 1px solid rgba(255,255,255,0.3); color: #fff;
  font-family: 'Bebas Neue', sans-serif; font-size: 13px;
  letter-spacing: 1px; cursor: pointer; white-space: nowrap;
  transition: background .12s;
}
.pwa-update-btn:hover { background: rgba(255,255,255,0.3); }
.pwa-update-close {
  background: none; border: none; color: rgba(255,255,255,0.6);
  cursor: pointer; font-size: 16px; padding: 2px 6px;
}

/* Offline indicator */
#pwa-offline-bar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 599;
  background: rgba(7,10,16,0.95); border-bottom: 1px solid rgba(227,30,36,0.4);
  padding: 8px 16px;
  display: flex; align-items: center; gap: 8px;
  transform: translateY(-100%); transition: transform 0.3s ease;
  backdrop-filter: blur(8px);
}
#pwa-offline-bar.visible { transform: translateY(0); }
.pwa-offline-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #E31E24; animation: offlinePulse 1.5s ease-in-out infinite;
}
@keyframes offlinePulse { 0%,100%{opacity:1} 50%{opacity:.3} }
.pwa-offline-text {
  font-family: 'JetBrains Mono', monospace; font-size: 11px;
  color: rgba(240,244,255,0.7); letter-spacing: .5px;
}

/* PWA Status in sidebar */
#pwa-status-row {
  padding: 8px 16px; border-top: 1px solid rgba(255,255,255,0.04);
  display: flex; align-items: center; gap: 7px;
  font-size: 9px; font-family: 'JetBrains Mono', monospace;
  color: rgba(240,244,255,0.25); letter-spacing: 1px;
}
#pwa-status-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #888; transition: background .3s;
}
#pwa-status-dot.online  { background: #00A650; box-shadow: 0 0 5px #00A650; }
#pwa-status-dot.offline { background: #E31E24; }
#pwa-status-dot.syncing { background: #EF9F27; animation: offlinePulse 1s infinite; }

/* Standalone mode indicator */
.pwa-standalone-badge {
  display: none;
  font-size: 8px; font-family: 'JetBrains Mono', monospace;
  letter-spacing: 1px; padding: 2px 6px; border-radius: 3px;
  background: rgba(0,166,80,0.12); color: #00A650;
  border: 1px solid rgba(0,166,80,0.2);
}
.is-standalone .pwa-standalone-badge { display: inline-block; }
`;

const styleEl = document.createElement('style');
styleEl.textContent = css;
document.head.appendChild(styleEl);

// ── HTML ELEMENTS ─────────────────────────────────────────
// Install banner
const installBanner = document.createElement('div');
installBanner.id = 'pwa-install-banner';
installBanner.innerHTML = `
  <div class="pwa-banner-icon"><img src="icon-192.png" alt="Album 26" onerror="this.style.display='none'"></div>
  <div class="pwa-banner-info">
    <div class="pwa-banner-title">📦 Instalar Álbum 2026</div>
    <div class="pwa-banner-desc">Accede sin internet · Notificaciones · Inicio rápido</div>
  </div>
  <button class="pwa-install-btn" id="pwa-install-btn">INSTALAR</button>
  <button class="pwa-dismiss-btn" id="pwa-dismiss-btn">✕</button>`;
document.body.appendChild(installBanner);

// Update banner
const updateBanner = document.createElement('div');
updateBanner.id = 'pwa-update-banner';
updateBanner.innerHTML = `
  <span style="font-size:16px">🔄</span>
  <div class="pwa-update-text">Nueva versión disponible · El álbum se actualizó</div>
  <button class="pwa-update-btn" id="pwa-update-btn">ACTUALIZAR</button>
  <button class="pwa-update-close" id="pwa-update-close">✕</button>`;
document.body.appendChild(updateBanner);

// Offline bar
const offlineBar = document.createElement('div');
offlineBar.id = 'pwa-offline-bar';
offlineBar.innerHTML = `
  <div class="pwa-offline-dot"></div>
  <div class="pwa-offline-text">SIN CONEXIÓN — Los datos locales están disponibles</div>`;
document.body.appendChild(offlineBar);

// ── INJECT STATUS ROW INTO SIDEBAR ────────────────────────
function injectSidebarStatus() {
  const sb = document.getElementById('sidebar');
  if(!sb) return;
  const progress = sb.querySelector('.sb-progress');
  if(!progress || document.getElementById('pwa-status-row')) return;

  const row = document.createElement('div');
  row.id = 'pwa-status-row';
  row.innerHTML = `<span id="pwa-status-dot"></span><span id="pwa-status-text">Verificando…</span>
    <span class="pwa-standalone-badge" style="margin-left:auto;">APP</span>`;
  sb.insertBefore(row, progress);
}
setTimeout(injectSidebarStatus, 800);

// ── STANDALONE MODE DETECTION ─────────────────────────────
const isStandalone = window.matchMedia('(display-mode: standalone)').matches
  || window.navigator.standalone === true;

if(isStandalone) {
  document.documentElement.classList.add('is-standalone');
}

// ── URL SHORTCUT HANDLER ──────────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const shortcut  = urlParams.get('shortcut');
if(shortcut) {
  // Navigate after app loads
  setTimeout(() => {
    if(window.navigate) window.navigate(shortcut);
  }, 1200);
}

// ── ONLINE / OFFLINE ──────────────────────────────────────
function setOnlineStatus(online) {
  offlineBar.classList.toggle('visible', !online);
  const dot  = document.getElementById('pwa-status-dot');
  const text = document.getElementById('pwa-status-text');
  if(dot)  dot.className  = online ? 'online' : 'offline';
  if(text) text.textContent = online ? (isStandalone ? 'APP INSTALADA' : 'EN LÍNEA') : 'SIN CONEXIÓN';
}

window.addEventListener('online',  () => { setOnlineStatus(true);  toast('🌐 Conexión restaurada', 'success'); });
window.addEventListener('offline', () => { setOnlineStatus(false); toast('📴 Sin conexión — modo offline', 'error'); });

// Initial status
setTimeout(() => setOnlineStatus(navigator.onLine), 500);

// ── SERVICE WORKER REGISTRATION ───────────────────────────
let swRegistration = null;
let newWorker = null;

async function registerSW() {
  if(!('serviceWorker' in navigator)) {
    console.log('[PWA] Service Worker not supported');
    return;
  }

  try {
    // Use relative path so it works in GitHub Pages subdirectories
    const swUrl = new URL('./sw.js', window.location.href).href;
    const swScope = new URL('./', window.location.href).href;
    swRegistration = await navigator.serviceWorker.register(swUrl, {
      scope: swScope,
      updateViaCache: 'none',
    });

    console.log('[PWA] SW registered:', swRegistration.scope);

    // Check for updates immediately and then every 30 minutes
    swRegistration.update();
    setInterval(() => swRegistration.update(), 30 * 60 * 1000);

    // Handle SW updates
    swRegistration.addEventListener('updatefound', () => {
      newWorker = swRegistration.installing;
      if(!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if(newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New version available — show banner
          showUpdateBanner();
        }
      });
    });

    // Handle messages from SW
    navigator.serviceWorker.addEventListener('message', event => {
      if(event.data?.type === 'SYNC_COMPLETE') {
        const dot = document.getElementById('pwa-status-dot');
        if(dot) { dot.className = 'syncing'; setTimeout(() => dot.className = 'online', 2000); }
      }
      if(event.data?.type === 'CACHE_CLEARED') {
        toast('🗑 Caché limpiada', 'success');
      }
    });

    // If SW already active, update status
    if(navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' });
    }

    updateSWStatus('ready');

  } catch(err) {
    console.warn('[PWA] SW registration failed:', err);
    updateSWStatus('error');
  }
}

function updateSWStatus(status) {
  const dot  = document.getElementById('pwa-status-dot');
  const text = document.getElementById('pwa-status-text');
  if(!dot || !text) return;
  if(status === 'ready') {
    dot.className = 'online';
    text.textContent = isStandalone ? 'APP INSTALADA · OFFLINE OK' : navigator.onLine ? 'EN LÍNEA' : 'SIN CONEXIÓN';
  } else if(status === 'error') {
    dot.className = '';
    text.textContent = 'SW no disponible';
  }
}

// ── INSTALL PROMPT ────────────────────────────────────────
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredPrompt = event;

  // Don't show if already dismissed in last 7 days
  const dismissed = localStorage.getItem('pwa_install_dismissed');
  if(dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 60 * 60 * 1000) return;

  // Show after 3 seconds
  setTimeout(() => installBanner.classList.add('visible'), 3000);
});

document.getElementById('pwa-install-btn')?.addEventListener('click', async () => {
  if(!deferredPrompt) return;
  installBanner.classList.remove('visible');
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  if(outcome === 'accepted') {
    toast('🎉 ¡Álbum instalado! Ya puedes abrirlo desde tu pantalla de inicio', 'success');
    document.documentElement.classList.add('is-standalone');
    setTimeout(injectSidebarStatus, 500);
  }
});

document.getElementById('pwa-dismiss-btn')?.addEventListener('click', () => {
  installBanner.classList.remove('visible');
  localStorage.setItem('pwa_install_dismissed', Date.now().toString());
});

window.addEventListener('appinstalled', () => {
  console.log('[PWA] App installed');
  deferredPrompt = null;
  installBanner.classList.remove('visible');
  toast('✅ ¡Álbum instalado correctamente!', 'success');
});

// ── UPDATE BANNER ─────────────────────────────────────────
function showUpdateBanner() {
  updateBanner.classList.add('visible');
}

document.getElementById('pwa-update-btn')?.addEventListener('click', () => {
  if(newWorker) {
    newWorker.postMessage({ type: 'SKIP_WAITING' });
  }
  updateBanner.classList.remove('visible');
  // Reload after a tick to let SW activate
  setTimeout(() => window.location.reload(), 400);
});

document.getElementById('pwa-update-close')?.addEventListener('click', () => {
  updateBanner.classList.remove('visible');
});

// Handle SW controller change (after skipWaiting)
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  window.location.reload();
});

// ── EXPOSE PWA UTILITIES ──────────────────────────────────
window.pwa = {
  // Manually trigger install prompt
  promptInstall: () => {
    if(deferredPrompt) {
      installBanner.classList.add('visible');
    } else {
      toast('La app ya está instalada o el navegador no lo permite', 'error');
    }
  },

  // Clear all caches
  clearCache: () => {
    if(navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' });
    } else {
      caches.keys().then(keys =>
        Promise.all(keys.filter(k=>k.startsWith('album26-')).map(k=>caches.delete(k)))
      ).then(() => toast('🗑 Caché limpiada', 'success'));
    }
  },

  // Check if installed
  isInstalled: () => isStandalone,

  // Get SW version
  getVersion: () => {
    navigator.serviceWorker?.controller?.postMessage({ type: 'GET_VERSION' });
  },

  // Register for push notifications via FCM
  registerPush: async () => {
    if (!swRegistration) { toast('SW no registrado', 'error'); return; }

    // 1. Pedir permiso al usuario
    let permission;
    try {
      permission = await Notification.requestPermission();
    } catch(e) {
      toast('Error al solicitar permiso de notificaciones', 'error');
      return;
    }

    if (permission !== 'granted') {
      toast('Notificaciones bloqueadas. Actívalas en configuración del navegador.', 'error');
      return;
    }

    // 2. Obtener token FCM via Service Worker Push subscription
    try {
      // VAPID public key del proyecto Firebase
      // Obtener en: Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
      const VAPID_PUBLIC_KEY = window.FIREBASE_VAPID_KEY || '';

      if (!VAPID_PUBLIC_KEY) {
        // Sin VAPID key: solo activar notificaciones locales
        toast('🔔 Notificaciones locales activadas', 'success');
        localStorage.setItem('album26_notifs', 'local');
        return;
      }

      // Convertir VAPID key de base64url a Uint8Array
      const vapidKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);

      // Suscribir al push
      const subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey,
      });

      // 3. Obtener token FCM desde Firebase Messaging
      const { getMessaging, getToken } = await import(
        'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js'
      );
      const messaging = getMessaging(window._firebase.app);
      const fcmToken = await getToken(messaging, {
        vapidKey: VAPID_PUBLIC_KEY,
        serviceWorkerRegistration: swRegistration,
      });

      if (!fcmToken) {
        toast('No se pudo obtener el token de notificaciones', 'error');
        return;
      }

      // 4. Guardar token en servidor (Cloud Function)
      const base = window.CLOUD_FUNCTION_BASE || '';
      if (base && state?.userId && window._firebase?.auth?.currentUser) {
        const idToken = await window._firebase.auth.currentUser.getIdToken();
        await fetch(`${base}/subscribeToNotifs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            token: fcmToken,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        });
      }

      // Guardar localmente también
      localStorage.setItem('album26_fcm_token', fcmToken);
      localStorage.setItem('album26_notifs', 'fcm');

      toast('🔔 Notificaciones activadas — recibirás el sobre diario a las 8am', 'success');

    } catch(e) {
      console.error('[PWA] Push registration error:', e);
      // Fallback: notificaciones locales via SW
      scheduleLocalNotification();
      toast('🔔 Notificaciones locales activadas', 'success');
      localStorage.setItem('album26_notifs', 'local');
    }
  },

  // Desactivar notificaciones
  unregisterPush: async () => {
    try {
      if (swRegistration) {
        const sub = await swRegistration.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      }
      localStorage.removeItem('album26_fcm_token');
      localStorage.removeItem('album26_notifs');
      toast('🔕 Notificaciones desactivadas', 'success');
    } catch(e) {
      toast('Error al desactivar notificaciones', 'error');
    }
  },

  // Estado actual de las notificaciones
  getNotifStatus: () => {
    const perm = Notification.permission;
    const stored = localStorage.getItem('album26_notifs');
    return { permission: perm, type: stored || 'none' };
  },
};

// ── SETTINGS PAGE HOOK — inject into sidebar or settings ──
// Adds a small "App" section at the bottom of the sidebar
function injectPWASettings() {
  const sb = document.getElementById('sidebar');
  if(!sb || document.getElementById('pwa-sb-section')) return;

  const section = document.createElement('div');
  section.id = 'pwa-sb-section';
  section.style.cssText = 'padding:4px 0;border-top:1px solid rgba(255,255,255,0.04);flex-shrink:0;';
  section.innerHTML = `
    <div class="sb-section">App</div>
    <div class="sb-item" onclick="pwa.promptInstall()" style="font-size:12px;">
      <span class="sb-flag">📲</span> Instalar app
    </div>
    <div class="sb-item" onclick="pwa.clearCache()" style="font-size:12px;">
      <span class="sb-flag">🗑</span> Limpiar caché
    </div>
    <div class="sb-item" id="pwa-notif-btn" onclick="pwaToggleNotifs()" style="font-size:12px;">
      <span class="sb-flag" id="pwa-notif-icon">🔔</span>
      <span id="pwa-notif-label">Notificaciones</span>
    </div>`;

  const progress = sb.querySelector('.sb-progress');
  if(progress) sb.insertBefore(section, progress);
}
setTimeout(injectPWASettings, 900);

// ── REGISTER ──────────────────────────────────────────────
// Wait for page load to register SW
if(document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', registerSW);
} else {
  registerSW();
}

})(); // end IIFE

// ── Toggle notificaciones en el sidebar ──────────────────
async function pwaToggleNotifs() {
  const status = pwa.getNotifStatus();
  if (status.type !== 'none' && status.permission === 'granted') {
    await pwa.unregisterPush();
    updateNotifBtn(false);
  } else {
    await pwa.registerPush();
    updateNotifBtn(status.permission === 'granted' || Notification.permission === 'granted');
  }
}

function updateNotifBtn(active) {
  const icon  = document.getElementById('pwa-notif-icon');
  const label = document.getElementById('pwa-notif-label');
  if (!icon || !label) return;
  if (active) {
    icon.textContent  = '🔔';
    label.textContent = 'Notificaciones ✓';
    label.style.color = 'var(--green)';
  } else {
    icon.textContent  = '🔕';
    label.textContent = 'Notificaciones';
    label.style.color = '';
  }
}

// Sincronizar estado del botón al cargar
setTimeout(() => {
  const status = pwa.getNotifStatus();
  updateNotifBtn(status.type !== 'none' && status.permission === 'granted');
}, 1200);
