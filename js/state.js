// ═══ APP STATE + FIREBASE AUTH ═══
const state = {
  userId: null,
  userMode: 'firebase',
  isAdmin: false,

  collected: new Set(),
  duplicates: {},       // { playerId: count }
  stadiumsCollected: new Set(),

  gameScore: 0,
  gameStreak: 0,
  gameBest: 0,

  // ── Rate limiting de sobres (verificado server-side) ──
  packOpens: {},        // { 'YYYY-MM-DD': count } — solo local, truth está en Firestore
  lastPackDate: null,

  bracket: {
    r32: Array.from({length:16},(_,i)=>({id:`R32-${i+1}`,home:null,away:null,hs:null,as:null,winner:null})),
    qf:  Array.from({length:8}, (_,i)=>({id:`QF-${i+1}`, home:null,away:null,hs:null,as:null,winner:null})),
    sf:  Array.from({length:2}, (_,i)=>({id:`SF-${i+1}`, home:null,away:null,hs:null,as:null,winner:null})),
    f:   [{id:"FIN",home:null,away:null,hs:null,as:null,winner:null}],
  },

  standings: {},        // { groupCode: { countryCode: {pj,pg,pe,pp,gf,gc} } }
  currentMatch: null,
  currentView: 'home',

  favTeam: null,        // country code of favorite team
  favMissions: {},      // { missionId: { completed, claimedAt } }
};

// ═══════════════════════════════════════════════════════════
// ADMIN CONFIG
// ═══════════════════════════════════════════════════════════
const ADMIN_EMAIL = 'joseleonardobecerrac@gmail.com';
window.ADMIN_EMAIL = ADMIN_EMAIL;

function isAdminUser(user) {
  return (user?.email || '').toLowerCase() === ADMIN_EMAIL;
}

function fillAdminAlbum() {
  const allPlayerIds = COUNTRIES.flatMap(c => c.players.map(p => p.id));
  const allStadiumIds = (typeof STADIUMS !== 'undefined' ? STADIUMS : []).map(s => s.id);

  state.collected = new Set(allPlayerIds);
  state.stadiumsCollected = new Set(allStadiumIds);
  state.duplicates = {};
  state.gameScore = 999999;
  state.gameBest = 999999;
  state.gameStreak = 999;
}

// ═══════════════════════════════════════════════════════════
// FLAG HELPER
// ═══════════════════════════════════════════════════════════
function flagImg(code, cls='') {
  if(!code) return '<span>🏳️</span>';
  return `<img src="https://flagcdn.com/${code}.svg" alt="${code}" class="${cls||'std-flag'}" loading="lazy" onerror="this.style.display='none'">`;
}

function flagImgSized(code, w=24, h=17) {
  if(!code) return '';
  return `<img src="https://flagcdn.com/${code}.svg" style="width:${w}px;height:${h}px;object-fit:cover;border-radius:3px;" loading="lazy">`;
}

// ═══════════════════════════════════════════════════════════
// FIREBASE / AUTH
// ═══════════════════════════════════════════════════════════
let _fb;

function fb(){
  return window._firebase;
}

function setSyncStatus(s) {
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-label');

  if(!dot || !lbl) return;

  dot.className = s;

  if(s === 'syncing') {
    lbl.textContent = 'Sincronizando…';
  } else if(s === 'error') {
    lbl.textContent = 'Sin conexión';
  } else {
    lbl.textContent = 'Sincronizado';
  }
}


// ═══════════════════════════════════════════════════════════
// PACK RATE LIMIT — Helpers client-side
// La verdad está en Firestore/Cloud Function.
// Esto solo es la capa visual para UX inmediata.
// ═══════════════════════════════════════════════════════════
const MAX_PACKS_PER_DAY = 5;

function getTodayKey() {
  return new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
}

function getPacksToday() {
  if (state.isAdmin) return 0; // admin sin límite
  const key = getTodayKey();
  return (state.packOpens && state.packOpens[key]) || 0;
}

function getPacksRemaining() {
  return Math.max(0, MAX_PACKS_PER_DAY - getPacksToday());
}

function recordPackOpen() {
  if (state.isAdmin) return;
  const key = getTodayKey();
  if (!state.packOpens) state.packOpens = {};
  state.packOpens[key] = (state.packOpens[key] || 0) + 1;
  // Limpiar días viejos para no acumular basura
  Object.keys(state.packOpens).forEach(k => {
    if (k !== key) delete state.packOpens[k];
  });
  saveState();
}

// Exponer al scope global
window.getPacksToday    = getPacksToday;
window.getPacksRemaining = getPacksRemaining;
window.recordPackOpen   = recordPackOpen;
window.MAX_PACKS_PER_DAY = MAX_PACKS_PER_DAY;

async function saveToFirestore() {
  // El admin no guarda progreso real ni modifica su álbum en Firestore
  if(state.isAdmin) {
    setSyncStatus('');
    return;
  }

  if(state.userMode !== 'firebase' || !state.userId) {
    saveLocalFallback();
    return;
  }

  setSyncStatus('syncing');

  try {
    const { db, doc, setDoc } = fb();

    const data = {
      collected: [...state.collected],
      duplicates: state.duplicates,
      stadiumsCollected: [...state.stadiumsCollected],
      bracket: state.bracket,
      standings: state.standings,
      gameScore: state.gameScore,
      gameStreak: state.gameStreak,
      gameBest: state.gameBest,
      updatedAt: new Date().toISOString(),
      favTeam: state.favTeam,
      favMissions: state.favMissions,
    };

    await setDoc(doc(db, 'albums', state.userId), data);
    setSyncStatus('');
  } catch(e) {
    console.error('[Firestore] Save error:', e);
    setSyncStatus('error');
    saveLocalFallback();
  }
}

function saveLocalFallback() {
  // El admin tampoco guarda respaldo local para no contaminar el navegador
  if(state.isAdmin) return;

  try {
    localStorage.setItem('album26_v2', JSON.stringify({
      collected: [...state.collected],
      duplicates: state.duplicates,
      stadiumsCollected: [...state.stadiumsCollected],
      bracket: state.bracket,
      standings: state.standings,
      gameScore: state.gameScore,
      gameStreak: state.gameStreak,
      gameBest: state.gameBest,
      favTeam: state.favTeam,
      favMissions: state.favMissions,
    }));
  } catch(e) {
    console.warn('[LocalStorage] Save fallback failed:', e);
  }
}

async function loadFromFirestore(uid) {
  setSyncStatus('syncing');

  try {
    const { db, doc, getDoc } = fb();
    const snap = await getDoc(doc(db, 'albums', uid));

    if(snap.exists()) {
      const d = snap.data();

      state.collected         = new Set(d.collected || []);
      state.duplicates        = d.duplicates || {};
      state.stadiumsCollected = new Set(d.stadiumsCollected || []);

      if(d.bracket)     state.bracket     = d.bracket;
      if(d.standings)   state.standings   = d.standings;
      if(d.gameScore)   state.gameScore   = d.gameScore;
      if(d.gameStreak)  state.gameStreak  = d.gameStreak;
      if(d.gameBest)    state.gameBest    = d.gameBest;
      if(d.favTeam)     state.favTeam     = d.favTeam;
      if(d.favMissions) state.favMissions = d.favMissions;
      if(d.packOpens)   state.packOpens   = d.packOpens;

      console.log('[Auth] Loaded existing album for', uid, '—', state.collected.size, 'stickers');
    } else {
      console.log('[Auth] New user', uid, '— starting fresh album');
    }

    setSyncStatus('');
  } catch(e) {
    console.error('[Auth] Firestore load error:', e);
    setSyncStatus('error');
  }
}

function loadLocalFallback() {
  if(state.isAdmin) return;

  try {
    const saved = localStorage.getItem('album26_v2');

    if(saved) {
      const d = JSON.parse(saved);

      state.collected = new Set(d.collected || []);
      state.duplicates = d.duplicates || {};
      state.stadiumsCollected = new Set(d.stadiumsCollected || []);

      if(d.bracket) state.bracket = d.bracket;
      if(d.standings) state.standings = d.standings;
      if(d.gameScore) state.gameScore = d.gameScore;
      if(d.gameStreak) state.gameStreak = d.gameStreak;
      if(d.gameBest) state.gameBest = d.gameBest;
      if(d.favTeam) state.favTeam = d.favTeam;
      if(d.favMissions) state.favMissions = d.favMissions;
      if(d.packOpens)   state.packOpens   = d.packOpens;
    }
  } catch(e) {
    console.warn('[LocalStorage] Load fallback failed:', e);
  }
}

let _lastUserId = null;

// ═══════════════════════════════════════════════════════════
// AUTH SETUP
// ═══════════════════════════════════════════════════════════
function setupAuth() {
  const { auth, onAuthStateChanged } = fb();

  onAuthStateChanged(auth, async (user) => {
    if(user) {
      // Si cambia de cuenta, limpiamos todo primero
      if(_lastUserId && _lastUserId !== user.uid) {
        resetStateCompletely();
      }

      _lastUserId = user.uid;

      state.userId   = user.uid;
      state.userMode = 'firebase';
      state.isAdmin  = isAdminUser(user);

      updateUserUI(user);

      if(state.isAdmin) {
        fillAdminAlbum();
        showApp();
        toast('Modo administrador activado · Álbum completo al 100%', 'success');
        return;
      }

      await loadFromFirestore(user.uid);
      showApp();
    } else {
      _lastUserId = null;
      resetStateCompletely();

      const appEl = document.getElementById('app');
      const authEl = document.getElementById('auth-screen');

      if(appEl) appEl.classList.add('hidden');
      if(authEl) authEl.style.display = 'flex';
    }
  });

  setupGoogleLoginButton();
}

function setupGoogleLoginButton() {
  const googleBtn = document.getElementById('btn-google');
  if(!googleBtn) return;

  const originalHTML = googleBtn.innerHTML;

  googleBtn.onclick = async () => {
    googleBtn.disabled = true;
    googleBtn.textContent = 'Conectando…';

    try {
      const { auth, signInWithPopup, provider } = fb();
      await signInWithPopup(auth, provider);
    } catch(e) {
      const msg = e.code === 'auth/popup-blocked'
        ? 'El navegador bloqueó el popup. Permite popups para este sitio.'
        : e.code === 'auth/unauthorized-domain'
        ? 'Dominio no autorizado. Agrégalo en Firebase → Authentication → Authorized domains.'
        : e.code === 'auth/popup-closed-by-user'
        ? 'Cerraste la ventana antes de iniciar sesión.'
        : 'Error al iniciar sesión: ' + (e.message || e.code);

      toast(msg, 'error');
      console.error('[Google Auth]', e.code, e.message);

      googleBtn.disabled = false;
      googleBtn.innerHTML = originalHTML;
    }
  };
}

// ═══════════════════════════════════════════════════════════
// EMAIL / PASSWORD AUTH
// ═══════════════════════════════════════════════════════════
function getAuthFormValues() {
  return {
    name: document.getElementById('auth-name')?.value.trim() || '',
    email: document.getElementById('auth-email')?.value.trim().toLowerCase() || '',
    password: document.getElementById('auth-password')?.value || ''
  };
}

window.handleEmailLogin = async function() {
  const { email, password } = getAuthFormValues();

  if(!email || !password) {
    toast('Escribe tu correo y contraseña', 'error');
    return;
  }

  const btn = document.getElementById('btn-email-login');
  const oldText = btn?.textContent;

  try {
    if(btn) {
      btn.disabled = true;
      btn.textContent = 'Entrando…';
    }

    const { auth, signInWithEmailAndPassword } = fb();
    await signInWithEmailAndPassword(auth, email, password);
  } catch(e) {
    console.error('[Email Login]', e);

    const msg =
      e.code === 'auth/invalid-credential' ? 'Correo o contraseña incorrectos.' :
      e.code === 'auth/user-not-found' ? 'No existe una cuenta con ese correo.' :
      e.code === 'auth/wrong-password' ? 'Contraseña incorrecta.' :
      e.code === 'auth/invalid-email' ? 'Correo electrónico inválido.' :
      'No se pudo iniciar sesión.';

    toast(msg, 'error');

    if(btn) {
      btn.disabled = false;
      btn.textContent = oldText || 'Entrar';
    }
  }
};

window.handleEmailRegister = async function() {
  const { name, email, password } = getAuthFormValues();

  if(!name || !email || !password) {
    toast('Completa nombre, correo y contraseña', 'error');
    return;
  }

  if(password.length < 6) {
    toast('La contraseña debe tener mínimo 6 caracteres', 'error');
    return;
  }

  const btn = document.getElementById('btn-email-register');
  const oldText = btn?.textContent;

  try {
    if(btn) {
      btn.disabled = true;
      btn.textContent = 'Creando…';
    }

    const {
      auth,
      createUserWithEmailAndPassword,
      updateProfile
    } = fb();

    const cred = await createUserWithEmailAndPassword(auth, email, password);

    await updateProfile(cred.user, {
      displayName: name
    });

    updateUserUI(cred.user);
    toast('Cuenta creada correctamente', 'success');
  } catch(e) {
    console.error('[Email Register]', e);

    const msg =
      e.code === 'auth/email-already-in-use' ? 'Ese correo ya está registrado.' :
      e.code === 'auth/invalid-email' ? 'Correo electrónico inválido.' :
      e.code === 'auth/weak-password' ? 'La contraseña es muy débil.' :
      'No se pudo crear la cuenta.';

    toast(msg, 'error');

    if(btn) {
      btn.disabled = false;
      btn.textContent = oldText || 'Crear cuenta';
    }
  }
};

window.handlePasswordReset = async function() {
  const { email } = getAuthFormValues();

  if(!email) {
    toast('Escribe tu correo para recuperar la contraseña', 'error');
    return;
  }

  try {
    const { auth, sendPasswordResetEmail } = fb();
    await sendPasswordResetEmail(auth, email);

    toast('Te enviamos un correo para restablecer la contraseña', 'success');
  } catch(e) {
    console.error('[Password Reset]', e);

    const msg =
      e.code === 'auth/invalid-email' ? 'Correo electrónico inválido.' :
      e.code === 'auth/user-not-found' ? 'No existe una cuenta con ese correo.' :
      'No se pudo enviar el correo de recuperación.';

    toast(msg, 'error');
  }
};

// Full state reset — called on logout or account switch
function resetStateCompletely() {
  state.userId            = null;
  state.userMode          = 'firebase';
  state.isAdmin           = false;

  state.collected         = new Set();
  state.duplicates        = {};
  state.stadiumsCollected = new Set();

  state.gameScore         = 0;
  state.gameStreak        = 0;
  state.gameBest          = 0;

  state.standings         = {};
  state.currentMatch      = null;
  state.currentView       = 'home';

  state.favTeam           = null;
  state.favMissions       = {};
  state.packOpens         = {};
  state.lastPackDate      = null;

  state.bracket = {
    r32: Array.from({length:16},(_,i)=>({id:`R32-${i+1}`,home:null,away:null,hs:null,as:null,winner:null})),
    qf:  Array.from({length:8}, (_,i)=>({id:`QF-${i+1}`, home:null,away:null,hs:null,as:null,winner:null})),
    sf:  Array.from({length:2}, (_,i)=>({id:`SF-${i+1}`, home:null,away:null,hs:null,as:null,winner:null})),
    f:   [{id:'FIN',home:null,away:null,hs:null,as:null,winner:null}],
  };
}

function updateUserUI(user) {
  const av = document.getElementById('sb-avatar-el');
  const nm = document.getElementById('sb-name-el');
  const em = document.getElementById('sb-email-el');

  if(!av || !nm || !em) return;

  if(user) {
    nm.textContent = user.displayName || 'Usuario';
    em.textContent = user.email || '';

    if(user.photoURL) {
      av.innerHTML = `<img src="${user.photoURL}" alt="">`;
    } else {
      av.textContent = (user.displayName || user.email || 'U')[0].toUpperCase();
    }
  } else {
    nm.textContent = 'Usuario';
    em.textContent = '';
    av.textContent = '?';
  }
}

window.handleLogout = async function handleLogout() {
  // Guardamos antes de salir solo si NO es admin
  if(state.userId && !state.isAdmin) {
    await saveToFirestore();
  }

  try {
    const { auth, signOut } = fb();
    await signOut(auth);
  } catch(e) {
    console.error('[Auth] Logout error:', e);

    resetStateCompletely();

    const appEl = document.getElementById('app');
    const authEl = document.getElementById('auth-screen');

    if(appEl) appEl.classList.add('hidden');
    if(authEl) authEl.style.display = 'flex';
  }
}

function showApp() {
  const authEl = document.getElementById('auth-screen');
  const appEl = document.getElementById('app');

  if(authEl) authEl.style.display = 'none';
  if(appEl) appEl.classList.remove('hidden');

  // Ocultar secciones del sidebar que no son grupos/países
  cleanSidebar();
  buildSidebar();
  navigate('home');
}

function cleanSidebar() {
  // No ocultar secciones fijas — "Álbum", "Grupos", "Países" y "Más"
  // son parte del layout del sidebar y deben permanecer visibles.
  // buildSidebar() se encarga de poblar solo #nav-countries con los grupos dinámicos.
}

// ═══════════════════════════════════════════════════════════
// SAVE STATE
// ═══════════════════════════════════════════════════════════
let saveTimer;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveToFirestore, 1500);
}

// ═══════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════
window.navigate = function(view, code) {
  document.querySelectorAll('.sb-item').forEach(el => el.classList.remove('active'));
  const navEl = document.getElementById(`nav-${code||view}`);
  if(navEl) navEl.classList.add('active');
  state.currentView = view;
  const page = document.getElementById('page');

  if(view==='home') renderHome(page);
  else if(view==='pack') renderPack(page);
  else if(view==='bracket') renderBracket(page);
  else if(view==='stadiums') renderStadiums(page);
  else if(view==='country') renderCountry(page, code);
  else if(view==='standings') renderStandings(page);
  else if(view==='game') renderGame(page);
  else if(view==='exchange') renderExchange(page);
  else if(view==='lineup') renderLineup(page);
  else if(view==='trivia') renderTrivia(page);
  else if(view==='predictor') renderPredictor(page);
  else if(view==='compare') renderComparator(page);
  else if(view==='ranking') renderRanking(page);
  else if(view==='limited') renderLimited(page);
  else if(view==='favorite') renderFavorite(page);
  else if(view==='chatbot') renderChatbot(page);

  const labels = {home:'Inicio',pack:'Abrir Sobre',bracket:'Llaves del Torneo',stadiums:'Estadios',standings:'Posiciones por Grupo',game:'¿Quién soy?',exchange:'Intercambios',lineup:'Mi 11 Ideal',trivia:'Trivia Mundialista',predictor:'Predictor IA',compare:'Comparador de Jugadores',ranking:'Ranking Global',limited:'Edición Limitada',favorite:'Mi Selección',chatbot:'Oráculo del Fútbol',worldmap:'Mapa Mundial'};
  const crumb = view==='country'
    ? `<button class="back-crumb-btn" onclick="navigate('home')">← Inicio</button> · <span>${COUNTRIES.find(c=>c.code===code)?.name||code}</span>`
    : view==='home'
      ? `Álbum · <span>Inicio</span>`
      : `<button class="back-crumb-btn" onclick="navigate('home')">← Inicio</button> · <span>${labels[view]||view}</span>`;
  document.getElementById('breadcrumb').innerHTML = crumb;
  updateProgress();
};

// ═══════════════════════════════════════════════════════════
// SIDEBAR BUILD
// ═══════════════════════════════════════════════════════════
function buildSidebar() {
  const container = document.getElementById('nav-countries');
  container.innerHTML = '';
  GROUPS_ORDER.forEach(g => {
    const gcs = COUNTRIES.filter(c=>c.group===g);
    if(!gcs.length) return;
    const sec = document.createElement('div');
    sec.className = 'sb-section'; sec.textContent = `Grupo ${g}`;
    container.appendChild(sec);
    gcs.forEach(c => {
      const owned = c.players.filter(p=>state.collected.has(p.id)).length;
      const pct   = Math.round(owned/c.players.length*100);
      const el = document.createElement('div');
      el.className = 'sb-item'; el.id = `nav-${c.code}`;
      el.innerHTML = `<span class="sb-flag">${flagImgSized(c.flag,18,13)}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.name}</span>
        ${pct===100
          ? `<span class="sb-badge" style="color:var(--green);background:rgba(0,166,80,0.12);">✓</span>`
          : pct>0
            ? `<span class="sb-badge">${pct}%</span>`
            : `<span class="sb-badge">${g}</span>`}`;
      el.onclick = () => navigate('country', c.code);
      container.appendChild(el);
    });
  });
}

// ═══════════════════════════════════════════════════════════
// PROGRESS
// ═══════════════════════════════════════════════════════════
function updateProgress() {
  const total = COUNTRIES.reduce((a,c)=>a+c.players.length,0) + STADIUMS.length;
  const col = state.collected.size + state.stadiumsCollected.size;
  const pct = total>0 ? Math.round((col/total)*100) : 0;
  document.getElementById('prog-pct').textContent = pct+'%';
  document.getElementById('prog-bar').style.width = pct+'%';
}

// ═══════════════════════════════════════════════════════════
// HOME PAGE
// ═══════════════════════════════════════════════════════════
function renderHome(page) {
  const total = COUNTRIES.reduce((a,c)=>a+c.players.length,0) + STADIUMS.length;
  const col   = state.collected.size + state.stadiumsCollected.size;
  const pct   = total > 0 ? Math.round((col/total)*100) : 0;
  const dups  = Object.values(state.duplicates).reduce((a,b)=>a+b,0);

  page.innerHTML = `<div class="page-enter">

    <!-- ── HERO ── -->
    <div class="home-hero">
      <div class="home-hero-bg"></div>
      <div class="home-hero-stripes"></div>
      <div class="home-logo-big">26<span class="fifa-tag">FIFA WORLD CUP™</span></div>
      <p class="home-tagline">Tu álbum digital oficial. Colecciona las 48 selecciones, descubre jugadores legendarios y completa las llaves del torneo más grande de la historia.</p>
      <div class="home-stats-row">
        <div class="home-stat"><div class="n green">${col}</div><div class="l">LÁMINAS</div></div>
        <div class="home-stat"><div class="n">${total}</div><div class="l">TOTAL</div></div>
        <div class="home-stat"><div class="n">${state.collected.size}</div><div class="l">JUGADORES</div></div>
        <div class="home-stat"><div class="n">${state.stadiumsCollected.size}</div><div class="l">ESTADIOS</div></div>
        <div class="home-stat"><div class="n green">${pct}%</div><div class="l">COMPLETADO</div></div>
      </div>
      <!-- Acciones principales -->
      <div class="home-actions">
        <button class="home-cta primary" onclick="navigate('pack')">📦 Abrir sobre diario</button>
        <button class="home-cta secondary" onclick="navigate('standings')">📊 Grupos</button>
        <button class="home-cta secondary" onclick="navigate('bracket')">🏆 Llaves</button>
        <button class="home-cta secondary" onclick="navigate('worldmap')">🗺️ Mapa</button>
      </div>
    </div>

    <!-- ── CATEGORÍA: MI ÁLBUM ── -->
    <div class="home-section-label">📒 Mi álbum</div>
    <div class="home-grid home-grid-4">
      <div class="home-card" onclick="navigate('pack')">
        <div class="home-card-icon">📦</div>
        <div class="home-card-title">ABRIR SOBRE</div>
        <div class="home-card-desc">Abre tu sobre diario y obtén hasta 5 láminas nuevas.</div>
        <div class="home-card-stat" style="color:var(--gold)">${getPacksRemaining()} sobres restantes hoy</div>
      </div>
      <div class="home-card" onclick="navigate('exchange')">
        <div class="home-card-icon">🔄</div>
        <div class="home-card-title">INTERCAMBIOS</div>
        <div class="home-card-desc">Intercambia duplicados con otros coleccionistas vía link.</div>
        <div class="home-card-stat">${dups} duplicados disponibles</div>
      </div>
      <div class="home-card" onclick="navigate('limited')">
        <div class="home-card-icon">💎</div>
        <div class="home-card-title">EDICIÓN LIMITADA</div>
        <div class="home-card-desc">Láminas exclusivas y misiones especiales de tu selección favorita.</div>
        <div class="home-card-stat" style="color:var(--icon-c)">Colección premium</div>
      </div>
      <div class="home-card" onclick="navigate('favorite')">
        <div class="home-card-icon">❤️</div>
        <div class="home-card-title">MI SELECCIÓN</div>
        <div class="home-card-desc">Tu selección favorita, misiones y láminas especiales.</div>
        <div class="home-card-stat">${state.favTeam ? COUNTRIES.find(c=>c.code===state.favTeam)?.name||'—' : 'Elige tu favorita'}</div>
      </div>
    </div>

    <!-- ── CATEGORÍA: TORNEO ── -->
    <div class="home-section-label">🏆 Torneo</div>
    <div class="home-grid home-grid-4">
      <div class="home-card" onclick="navigate('standings')">
        <div class="home-card-icon">📊</div>
        <div class="home-card-title">GRUPOS</div>
        <div class="home-card-desc">Edita resultados, consulta posiciones y clasifica las 48 selecciones.</div>
        <div class="home-card-stat">12 grupos · ${COUNTRIES.length} países</div>
      </div>
      <div class="home-card" onclick="navigate('bracket')">
        <div class="home-card-icon">🏆</div>
        <div class="home-card-title">LLAVES</div>
        <div class="home-card-desc">Octavos, cuartos, semis y la gran final. Completa el camino al título.</div>
        <div class="home-card-stat">32 partidos en el torneo</div>
      </div>
      <div class="home-card" onclick="navigate('worldmap')">
        <div class="home-card-icon">🗺️</div>
        <div class="home-card-title">MAPA MUNDIAL</div>
        <div class="home-card-desc">48 selecciones en el mapa. Haz clic en un país para ver su álbum.</div>
        <div class="home-card-stat">3 países anfitriones</div>
      </div>
      <div class="home-card" onclick="navigate('stadiums')">
        <div class="home-card-icon">🏟️</div>
        <div class="home-card-title">ESTADIOS</div>
        <div class="home-card-desc">Los 16 estadios de USA, Canadá y México, desde el Azteca al MetLife.</div>
        <div class="home-card-stat">${state.stadiumsCollected.size}/16 coleccionados</div>
      </div>
    </div>

    <!-- ── CATEGORÍA: JUGAR ── -->
    <div class="home-section-label">🎮 Jugar</div>
    <div class="home-grid home-grid-4">
      <div class="home-card" onclick="navigate('game')">
        <div class="home-card-icon">🎮</div>
        <div class="home-card-title">¿QUIÉN SOY?</div>
        <div class="home-card-desc">Adivina el jugador por sus pistas y gana láminas exclusivas.</div>
        <div class="home-card-stat" style="color:var(--gold)">Racha: ${state.gameStreak} · Récord: ${state.gameBest}</div>
      </div>
      <div class="home-card" onclick="navigate('trivia')">
        <div class="home-card-icon">🧠</div>
        <div class="home-card-title">TRIVIA MUNDIALISTA</div>
        <div class="home-card-desc">97 preguntas de historia, jugadores, estadios y más. Compite en el ranking.</div>
        <div class="home-card-stat">Ranking global activo</div>
      </div>
      <div class="home-card" onclick="navigate('lineup')">
        <div class="home-card-icon">⚽</div>
        <div class="home-card-title">MI 11 IDEAL</div>
        <div class="home-card-desc">Arma tu equipo soñado con los jugadores de tu colección.</div>
        <div class="home-card-stat">6 formaciones disponibles</div>
      </div>
      <div class="home-card" onclick="navigate('ranking')">
        <div class="home-card-icon">🏅</div>
        <div class="home-card-title">RANKING GLOBAL</div>
        <div class="home-card-desc">Compite con coleccionistas de todo el mundo por el álbum más completo.</div>
        <div class="home-card-stat">Clasificación en tiempo real</div>
      </div>
    </div>

    <!-- ── CATEGORÍA: ANÁLISIS IA ── -->
    <div class="home-section-label">🤖 Análisis con IA</div>
    <div class="home-grid home-grid-3">
      <div class="home-card" onclick="navigate('predictor')">
        <div class="home-card-icon">🤖</div>
        <div class="home-card-title">PREDICTOR IA</div>
        <div class="home-card-desc">Claude analiza partidos, grupos y predice el campeón del Mundial 2026.</div>
        <div class="home-card-stat" style="color:var(--rare-c)">Powered by Claude AI</div>
      </div>
      <div class="home-card" onclick="navigate('compare')">
        <div class="home-card-icon">⚖️</div>
        <div class="home-card-title">COMPARADOR</div>
        <div class="home-card-desc">Estadísticas cara a cara de cualquier par de jugadores.</div>
        <div class="home-card-stat">${state.collected.size} jugadores en tu álbum</div>
      </div>
      <div class="home-card" onclick="navigate('chatbot')">
        <div class="home-card-icon">💬</div>
        <div class="home-card-title">ORÁCULO DEL FÚTBOL</div>
        <div class="home-card-desc">Pregunta cualquier cosa sobre el Mundial 2026. La IA lo sabe todo.</div>
        <div class="home-card-stat" style="color:var(--rare-c)">Chat con Claude AI</div>
      </div>
    </div>

  </div>`;
}

// ═══════════════════════════════════════════════════════════
// PACK OPENING
// ═══════════════════════════════════════════════════════════
// ── URL del proxy Cloud Function (cambia por tu URL real de Firebase) ──
// Ejemplo: 'https://us-central1-algum-mundial-2026.cloudfunctions.net'
const CLOUD_FUNCTION_BASE = window.CLOUD_FUNCTION_BASE || '';

// ── Obtener ID token de Firebase del usuario actual ────────
async function getFirebaseIdToken() {
  try {
    const { auth } = fb();
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch(e) {
    console.warn('[Auth] No se pudo obtener ID token:', e);
    return null;
  }
}

// ── Pack Opening — con rate limit client-side y verificación server-side ──
function renderPack(page) {
  // Pool de láminas: jugadores normales + láminas especiales + estadios
  const allPlayers = COUNTRIES.flatMap(c => c.players.map(p => ({...p, countryCode:c.code, countryName:c.name, flagCode:c.flag})));
  const allStadiums = STADIUMS.map(s => ({id:s.id,name:s.name,pos:null,club:s.city,rarity:'rare',e:'🏟️',isStadium:true,flag:s.flag}));
  const pool = [...allPlayers, ...allStadiums];

  // DEBUG: verificar que FLAG/TEAM están en el pool
  // console.log('[Pack] Pool size:', pool.length, '| COL-FLAG:', pool.some(p=>p.id==='COL-FLAG'));

  // ── Rate limit UI ─────────────────────────────────────────
  const remaining  = getPacksRemaining();
  const packsToday = getPacksToday();
  const limitReached = !state.isAdmin && remaining <= 0;

  const packCounterHTML = state.isAdmin
    ? `<div class="pack-counter admin">👑 Admin — sobres ilimitados</div>`
    : `<div class="pack-counter">
        <span class="pack-counter-num ${remaining === 0 ? 'zero' : remaining <= 2 ? 'low' : ''}">${remaining}</span>
        <span class="pack-counter-label">sobre${remaining !== 1 ? 's' : ''} restante${remaining !== 1 ? 's' : ''} hoy</span>
        <div class="pack-counter-dots">
          ${Array.from({length: MAX_PACKS_PER_DAY}).map((_,i) =>
            `<div class="pack-dot ${i < packsToday ? 'used' : ''}"></div>`
          ).join('')}
        </div>
      </div>`;

  page.innerHTML = `<div id="pack-scene" class="page-enter">
    <button class="page-back-btn" onclick="navigate('home')" style="align-self:flex-start;">← Inicio</button>
    <div class="pack-header">
      <h2>SOBRE DEL DÍA</h2>
      <div class="pack-date">${new Date().toLocaleDateString('es-CO',{weekday:'long',year:'numeric',month:'long',day:'numeric'}).toUpperCase()}</div>
    </div>

    ${packCounterHTML}

    ${limitReached ? `
    <div class="pack-limit-msg">
      <div class="pack-limit-icon">📦</div>
      <div class="pack-limit-title">¡Sobres de hoy agotados!</div>
      <div class="pack-limit-sub">Vuelve mañana para abrir ${MAX_PACKS_PER_DAY} sobres más.<br>Tu colección se guardó correctamente.</div>
      <button class="tb-btn gold" onclick="navigate('home')" style="margin-top:16px;padding:10px 24px;">Ver mi álbum</button>
    </div>` : `
    <div class="pack-card-wrap" id="pack-card-wrap" onclick="openPack()">
      <div class="pack-card" id="pack-card">
        <div class="pack-face pack-front">
          <div class="pack-shine"></div>
          <div class="pack-front-logo">26</div>
          <div class="pack-front-tag">WORLD CUP™</div>
          <div class="pack-front-count">5 LÁMINAS</div>
        </div>
        <div class="pack-face pack-back">📦</div>
      </div>
    </div>
    <div class="pack-hint" id="pack-hint">TAP PARA ABRIR</div>`}

    <div class="pack-reveal" id="pack-reveal">
      <div class="section-label" style="margin-bottom:16px;">Láminas obtenidas</div>
      <div class="pack-reveal-grid" id="pack-grid"></div>
      <div id="pack-reveal-actions" style="display:flex;gap:10px;justify-content:center;margin-top:8px;">
        <button class="tb-btn gold" onclick="navigate('home')" style="padding:8px 20px;">Ir al álbum</button>
        <!-- El botón "Otro sobre" se inyecta en renderDrawnCards() una vez conocido el remaining real -->
      </div>
    </div>
  </div>`;

  // Inyectar estilos del counter (solo una vez)
  if (!document.getElementById('pack-counter-styles')) {
    const s = document.createElement('style');
    s.id = 'pack-counter-styles';
    s.textContent = `
      .pack-counter {
        display:flex;align-items:center;gap:10px;
        background:var(--surface2);border:1px solid var(--border);
        border-radius:12px;padding:10px 18px;margin-bottom:16px;
        font-family:var(--fb);
      }
      .pack-counter.admin { background:rgba(239,159,39,0.06);border-color:rgba(239,159,39,0.2);color:var(--gold); }
      .pack-counter-num { font-family:var(--fd);font-size:28px;line-height:1; }
      .pack-counter-num.low  { color:var(--gold); }
      .pack-counter-num.zero { color:var(--red); }
      .pack-counter-label { font-size:12px;color:var(--muted);font-family:var(--fs); }
      .pack-counter-dots { display:flex;gap:5px;margin-left:auto; }
      .pack-dot { width:10px;height:10px;border-radius:50%;background:var(--border2);transition:background .2s; }
      .pack-dot.used { background:var(--red); }
      .pack-limit-msg {
        display:flex;flex-direction:column;align-items:center;
        padding:40px 20px;text-align:center;
        background:var(--surface2);border:1px solid var(--border);border-radius:16px;
      }
      .pack-limit-icon { font-size:56px;margin-bottom:12px; }
      .pack-limit-title { font-family:var(--fd);font-size:28px;letter-spacing:2px;margin-bottom:8px; }
      .pack-limit-sub { font-size:13px;color:var(--muted);font-family:var(--fs);line-height:1.7; }
    `;
    document.head.appendChild(s);
  }

  window.openPack = async function() {
    const wrap = document.getElementById('pack-card-wrap');
    const card = document.getElementById('pack-card');
    const hint = document.getElementById('pack-hint');
    if (!card || card.classList.contains('opening')) return;

    // ── Verificación client-side del rate limit ───────────
    if (!state.isAdmin && getPacksRemaining() <= 0) {
      toast('Ya abriste todos los sobres de hoy. ¡Vuelve mañana!', 'error');
      renderPack(page); // Re-render para mostrar mensaje de límite
      return;
    }

    wrap.style.cursor = 'default';
    if (hint) hint.style.display = 'none';
    card.classList.add('opening');

    // ── Si hay Cloud Function disponible, usarla (server-side truth) ──
    if (CLOUD_FUNCTION_BASE && state.userId && !state.isAdmin) {
      try {
        card.classList.add('loading');
        const token = await getFirebaseIdToken();
        const allIds = pool.map(p => p.id);

        const resp = await fetch(`${CLOUD_FUNCTION_BASE}/openPack`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ allIds }),
        });

        const result = await resp.json();

        if (resp.status === 429) {
          // Límite server-side alcanzado
          card.classList.remove('opening', 'loading');
          toast(result.error || 'Límite diario alcanzado', 'error');
          // Sincronizar estado local con server
          if (result.packsToday !== undefined) {
            const key = getTodayKey();
            state.packOpens = { [key]: result.packsToday };
          }
          renderPack(page);
          return;
        }

        if (!resp.ok) throw new Error(result.error || 'Error server');

        // Éxito — sincronizar contador con server
        if (result.packsToday !== undefined) {
          const key = getTodayKey();
          state.packOpens = { [key]: result.packsToday };
        }

        // Reconstruir drawn desde los IDs elegidos por el server
        const drawn = result.cards
          .map(id => pool.find(p => p.id === id))
          .filter(Boolean);

        card.classList.remove('loading');
        setTimeout(() => {
          document.getElementById('pack-reveal').classList.add('show');
          renderDrawnCards(drawn, true /* ya guardado server-side */);
        }, 500);

      } catch(e) {
        console.warn('[Pack] Cloud Function no disponible, modo local:', e);
        card.classList.remove('loading');
        // Fallback local si el server no está disponible
        _openPackLocal(pool, card, page);
      }
    } else {
      // Modo local (sin Cloud Function configurada o admin)
      setTimeout(() => _openPackLocal(pool, card, page), 500);
    }
  };
}

// ── Pack local (fallback cuando no hay Cloud Function) ────
function _openPackLocal(pool, card, page) {
  if (!state.isAdmin) {
    // Verificar rate limit local de todos modos
    if (getPacksRemaining() <= 0) {
      if (card) card.classList.remove('opening');
      toast('Límite diario alcanzado', 'error');
      renderPack(page);
      return;
    }
    recordPackOpen(); // Registrar apertura local
  }
  const drawn = drawCards(pool, 5);
  const revealEl = document.getElementById('pack-reveal');
  if (revealEl) revealEl.classList.add('show');
  renderDrawnCards(drawn, false);
}

function drawCards(pool, count) {
  // Weighted random: legendary 8%, rare 25%, icon 2%, common rest
  const weights = {icon:2, legendary:8, rare:25, common:65};
  const drawn = [];
  const used = new Set();

  // Force at least 1 rare
  const rares = pool.filter(p=>p.rarity==='rare'||p.rarity==='legendary'||p.rarity==='icon');

  for(let i=0; i<count; i++) {
    let pick;
    let attempts = 0;
    while(!pick || used.has(pick.id)) {
      if(attempts++ > 200) break;
      const roll = Math.random()*100;
      let filtered;
      if(roll < weights.icon) filtered = pool.filter(p=>p.rarity==='icon');
      else if(roll < weights.icon + weights.legendary) filtered = pool.filter(p=>p.rarity==='legendary');
      else if(roll < weights.icon + weights.legendary + weights.rare) filtered = pool.filter(p=>p.rarity==='rare');
      else filtered = pool.filter(p=>p.rarity==='common');
      if(filtered.length) pick = filtered[Math.floor(Math.random()*filtered.length)];
    }
    if(pick) {
      drawn.push(pick);
      used.add(pick.id);
    }
  }
  return drawn;
}

function renderDrawnCards(drawn, serverSide = false) {
  const grid = document.getElementById('pack-grid');
  drawn.forEach((s, i) => {
    // Si el server ya actualizó Firestore, solo actualizamos el estado local en memoria
    // Si es modo local, actualizamos collected/duplicates normalmente
    if (!serverSide) {
      if(s.isStadium) {
        state.stadiumsCollected.add(s.id);
      } else {
        if(state.collected.has(s.id)) {
          state.duplicates[s.id] = (state.duplicates[s.id]||1) + 1;
        } else {
          state.collected.add(s.id);
        }
      }
    } else {
      // Modo server: sincronizamos visualmente, Firestore ya tiene la verdad
      if(s.isStadium) {
        state.stadiumsCollected.add(s.id);
      } else {
        if(state.collected.has(s.id)) {
          state.duplicates[s.id] = (state.duplicates[s.id]||1) + 1;
        } else {
          state.collected.add(s.id);
        }
      }
    }

    const slot = document.createElement('div');
    slot.className = `pack-sticker-reveal`;
    const rarityClass = s.rarity || 'common';
    // Imagen: especial (flag/team) o jugador normal
    let imgHTML;
    if ((s.type === 'flag' || s.type === 'team') && typeof getSpecialStickerImageHTML === 'function') {
      imgHTML = getSpecialStickerImageHTML(s, true, s.flagCode || s.flag);
    } else if (typeof getStickerImageHTML === 'function') {
      imgHTML = getStickerImageHTML(s, true);
    } else {
      imgHTML = `<div class="slot-silhouette">${s.e}</div>`;
    }

    // Subtítulo
    let subHTML = '';
    if (s.type === 'flag')  subHTML = `<div class="slot-special-label">🏳️ BANDERA OFICIAL</div>`;
    else if (s.type === 'team') subHTML = `<div class="slot-special-label">👥 FOTO DEL PLANTEL</div>`;
    else subHTML = `${s.club ? `<div class="slot-club">${s.club}</div>` : ''}
        ${s.pos ? `<span class="slot-pos pos-${s.pos}">${s.pos}</span>` : ''}`;

    slot.innerHTML = `<div class="sticker-slot ${rarityClass}${s.type==='flag'||s.type==='team'?' sticker-special':''} collected" style="cursor:default;">
      <div class="slot-number">${s.id}</div>
      <div class="slot-rarity-dot"></div>
      ${imgHTML}
      <div class="slot-info">
        <div class="slot-name">${s.name}</div>
        ${subHTML}
      </div>
    </div>`;
    grid.appendChild(slot);

    setTimeout(() => {
      slot.classList.add('shown');
    }, 100 + i * 180);
  });

  saveState();
  updateProgress();

  // Inyectar "Otro sobre" DESPUÉS de registrar la apertura,
  // así getPacksRemaining() refleja el valor real actualizado
  const actionsEl = document.getElementById('pack-reveal-actions');
  if (actionsEl && (state.isAdmin || getPacksRemaining() > 0)) {
    const btn = document.createElement('button');
    btn.className = 'tb-btn';
    btn.style.padding = '8px 20px';
    btn.textContent = 'Otro sobre';
    btn.onclick = () => renderPack(document.getElementById('page'));
    actionsEl.appendChild(btn);
  }
}

// ═══════════════════════════════════════════════════════════
// COUNTRY PAGE
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// GOLEADORES HISTÓRICOS POR SELECCIÓN
// ═══════════════════════════════════════════════════════════
