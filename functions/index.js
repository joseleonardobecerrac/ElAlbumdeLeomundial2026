// ═══════════════════════════════════════════════════════════
// CLOUD FUNCTIONS — Álbum Mundial 2026
//
// Funciones:
//   1. claudeProxy     — proxy seguro para la API de Anthropic
//   2. openPack        — sobre diario server-side con rate limit real
//   3. scheduleDailyPack — Cloud Scheduler: notif push a todos a las 8am
//   4. syncMatchResults — Cloud Scheduler: sincroniza resultados del Mundial
//   5. subscribeToNotifs — guarda token FCM del usuario en Firestore
//
// Deploy:
//   firebase functions:secrets:set ANTHROPIC_API_KEY
//   firebase functions:secrets:set FOOTBALL_API_KEY
//   firebase deploy --only functions
// ═══════════════════════════════════════════════════════════

const { onRequest }          = require('firebase-functions/v2/https');
const { onSchedule }         = require('firebase-functions/v2/scheduler');
const { defineSecret }       = require('firebase-functions/params');
const admin                  = require('firebase-admin');

admin.initializeApp();

const anthropicKey   = defineSecret('ANTHROPIC_API_KEY');
const footballApiKey = defineSecret('FOOTBALL_API_KEY'); // football-data.org

// ── Constantes ────────────────────────────────────────────
const MAX_PACKS_PER_DAY = 5;
const FOOTBALL_API_BASE = 'https://api.football-data.org/v4';
// ID del Mundial 2026 — verificado en football-data.org/v4/competitions
// FIFA World Cup 2026 competition code: WC
const WORLD_CUP_2026_CODE = 'WC';
const WORLD_CUP_2026_ID   = 2000; // Fallback numérico

// ── Helper: verificar token de Firebase ───────────────────
async function verifyUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) throw new Error('No autorizado');
  return admin.auth().verifyIdToken(token);
}

// ── Helper: headers CORS ──────────────────────────────────
function setCORS(res, req) {
  const allowed = [
    'https://joseleonardobecerrac.github.io',
    'http://localhost',
    'http://127.0.0.1',
  ];
  const origin = req.headers.origin || '';
  if (allowed.some(o => origin.startsWith(o)) || origin.includes('localhost')) {
    res.set('Access-Control-Allow-Origin', origin);
  } else {
    res.set('Access-Control-Allow-Origin', 'https://joseleonardobecerrac.github.io');
  }
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.set('Access-Control-Max-Age', '3600');
}

// ═══════════════════════════════════════════════════════════
// 1. CLAUDE PROXY — API de Anthropic segura
// ═══════════════════════════════════════════════════════════
exports.claudeProxy = onRequest(
  { secrets: [anthropicKey], cors: true },
  async (req, res) => {
    setCORS(res, req);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    let user;
    try { user = await verifyUser(req); }
    catch (e) { return res.status(401).json({ error: 'No autorizado' }); }

    const { mode, messages, system, prompt } = req.body;
    const maxTokens = { chat: 1000, match: 1500, group: 1500, champion: 1500 }[mode];
    if (!maxTokens) return res.status(400).json({ error: `Modo inválido: ${mode}` });

    const body = mode === 'chat'
      ? { model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, system, messages: messages.slice(-20) }
      : { model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, messages: [{ role: 'user', content: String(prompt).slice(0, 6000) }] };

    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey.value(),
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) return res.status(502).json({ error: data?.error?.message || 'upstream error' });
      return res.json(data);
    } catch (e) {
      return res.status(503).json({ error: 'IA no disponible: ' + e.message });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// 2. OPEN PACK — Rate limit real server-side
//    POST /openPack
//    Body: { allIds: string[] }
//    → { cards, packsToday, packsRemaining, newlyCollected }
// ═══════════════════════════════════════════════════════════
exports.openPack = onRequest(
  { cors: true },
  async (req, res) => {
    setCORS(res, req);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    let user;
    try { user = await verifyUser(req); }
    catch (e) { return res.status(401).json({ error: 'No autorizado' }); }

    const uid = user.uid;
    const db  = admin.firestore();
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD UTC

    // ── Leer/crear contador diario (transacción atómica) ──
    const packRef = db.collection('packOpens').doc(uid);

    let countToday = 0;
    let newCards    = [];

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(packRef);
      const data = snap.exists ? snap.data() : {};
      countToday = data.date === today ? (data.count || 0) : 0;

      if (countToday >= MAX_PACKS_PER_DAY) return; // sin cambios

      // Elegir 5 cartas server-side
      const { allIds } = req.body;
      if (!Array.isArray(allIds) || allIds.length < 5) throw new Error('allIds inválido');

      const RARITY_WEIGHTS = { icon: 2, legendary: 8, rare: 25, common: 65 };

      // Clasificar IDs por rareza: el cliente manda allIds como array simple
      // El servidor elige al azar con pesos (simplificado: aleatorio uniforme
      // ya que no tenemos la rareza aquí — el cliente la aplica en el render)
      const shuffled = [...allIds].sort(() => Math.random() - 0.5);
      newCards = shuffled.slice(0, 5);

      // Actualizar contador
      tx.set(packRef, { date: today, count: countToday + 1, uid }, { merge: true });

      // Actualizar álbum del usuario
      const albumRef  = db.collection('albums').doc(uid);
      const albumSnap = await tx.get(albumRef);
      const album     = albumSnap.exists ? albumSnap.data() : {};

      const collected  = new Set(album.collected || []);
      const duplicates = album.duplicates || {};

      newCards.forEach(id => {
        if (collected.has(id)) {
          duplicates[id] = (duplicates[id] || 1) + 1;
        } else {
          collected.add(id);
        }
      });

      tx.set(albumRef,
        { collected: [...collected], duplicates, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    });

    if (countToday >= MAX_PACKS_PER_DAY) {
      // Calcular cuándo se resetea (medianoche UTC)
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      tomorrow.setUTCHours(0, 0, 0, 0);

      return res.status(429).json({
        error: `Límite diario alcanzado (${MAX_PACKS_PER_DAY} sobres/día)`,
        packsToday: countToday,
        packsRemaining: 0,
        resetAt: tomorrow.toISOString(),
      });
    }

    return res.json({
      cards: newCards,
      packsToday: countToday + 1,
      packsRemaining: MAX_PACKS_PER_DAY - (countToday + 1),
    });
  }
);

// ═══════════════════════════════════════════════════════════
// 3. SUBSCRIBE TO NOTIFICATIONS — Guarda token FCM
//    POST /subscribeToNotifs
//    Body: { token: string, timezone?: string }
// ═══════════════════════════════════════════════════════════
exports.subscribeToNotifs = onRequest(
  { cors: true },
  async (req, res) => {
    setCORS(res, req);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    let user;
    try { user = await verifyUser(req); }
    catch (e) { return res.status(401).json({ error: 'No autorizado' }); }

    const { token, timezone } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'token FCM requerido' });
    }

    const db = admin.firestore();
    await db.collection('fcmTokens').doc(user.uid).set({
      token,
      uid: user.uid,
      timezone: timezone || 'America/Bogota',
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    return res.json({ ok: true, message: 'Token registrado correctamente' });
  }
);

// ═══════════════════════════════════════════════════════════
// 4. SCHEDULED: NOTIFICACIÓN DIARIA DEL SOBRE
//    Corre todos los días a las 8:00 AM hora de Colombia (UTC-5 = 13:00 UTC)
// ═══════════════════════════════════════════════════════════
exports.scheduleDailyPack = onSchedule(
  {
    schedule: '0 13 * * *',  // 8:00 AM Colombia (UTC-5)
    timeZone: 'America/Bogota',
  },
  async () => {
    const db = admin.firestore();

    // Obtener todos los tokens FCM registrados
    const tokensSnap = await db.collection('fcmTokens').get();
    if (tokensSnap.empty) {
      console.log('[scheduleDailyPack] No hay tokens registrados');
      return;
    }

    const tokens = [];
    tokensSnap.forEach(doc => {
      const { token } = doc.data();
      if (token) tokens.push(token);
    });

    console.log(`[scheduleDailyPack] Enviando notificación a ${tokens.length} usuarios`);

    // Enviar en lotes de 500 (límite de FCM)
    const messaging = admin.messaging();
    const BATCH_SIZE = 500;

    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE);
      try {
        const response = await messaging.sendEachForMulticast({
          tokens: batch,
          notification: {
            title: '📦 Álbum Mundial 2026',
            body: '¡Tu sobre diario está listo! Abre 5 láminas nuevas ahora.',
          },
          webpush: {
            notification: {
              icon: '/icon-192.png',
              badge: '/icon-96.png',
              tag: 'daily-pack',
              renotify: true,
              actions: [
                { action: 'open', title: '📦 Abrir sobre' },
                { action: 'dismiss', title: 'Luego' },
              ],
            },
            fcmOptions: {
              link: '/?shortcut=pack',
            },
          },
          data: {
            type: 'DAILY_PACK',
            url: '/?shortcut=pack',
          },
        });

        console.log(`[scheduleDailyPack] Lote ${i / BATCH_SIZE + 1}: ${response.successCount} OK, ${response.failureCount} errores`);

        // Limpiar tokens inválidos
        const invalidTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success && (
            resp.error?.code === 'messaging/registration-token-not-registered' ||
            resp.error?.code === 'messaging/invalid-registration-token'
          )) {
            invalidTokens.push(batch[idx]);
          }
        });

        if (invalidTokens.length > 0) {
          console.log(`[scheduleDailyPack] Eliminando ${invalidTokens.length} tokens inválidos`);
          const cleanupBatch = db.batch();
          const staleSnap = await db.collection('fcmTokens')
            .where('token', 'in', invalidTokens.slice(0, 30))
            .get();
          staleSnap.forEach(doc => cleanupBatch.delete(doc.ref));
          await cleanupBatch.commit();
        }

      } catch (e) {
        console.error('[scheduleDailyPack] Error en lote:', e);
      }
    }
  }
);

// ═══════════════════════════════════════════════════════════
// 5. SCHEDULED: SINCRONIZAR RESULTADOS DEL MUNDIAL
//    Corre cada 5 minutos durante el torneo (junio-julio 2026)
//    Usa la API gratuita de football-data.org
//    (plan gratuito: 10 req/min, suficiente para cada 5 min)
// ═══════════════════════════════════════════════════════════
// ── Helper: cabeceras para football-data.org ─────────────
function fdHeaders() {
  return {
    'X-Auth-Token': footballApiKey.value(),
    'Accept': 'application/json',
  };
}

exports.syncMatchResults = onSchedule(
  {
    schedule: 'every 5 minutes',
    secrets: [footballApiKey],
  },
  async () => {
    // Solo correr durante el torneo (junio-julio 2026)
    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year  = now.getUTCFullYear();

    if (year !== 2026 || month < 6 || month > 7) {
      console.log('[syncMatchResults] Fuera de temporada, omitiendo');
      return;
    }

    try {
      // Obtener partidos del día actual usando código WC
      const dateStr = now.toISOString().split('T')[0];
      const url = `${FOOTBALL_API_BASE}/competitions/${WORLD_CUP_2026_CODE}/matches?dateFrom=${dateStr}&dateTo=${dateStr}`;

      const response = await fetch(url, {
        headers: fdHeaders(),
      });

      if (!response.ok) {
        console.error('[syncMatchResults] API error:', response.status);
        return;
      }

      const data = await response.json();
      const matches = data.matches || [];

      if (matches.length === 0) {
        console.log('[syncMatchResults] Sin partidos hoy');
        return;
      }

      const db = admin.firestore();
      const batch = db.batch();

      for (const match of matches) {
        const matchData = {
          id: match.id,
          status: match.status,           // 'SCHEDULED' | 'IN_PLAY' | 'FINISHED' | 'PAUSED'
          homeTeam: {
            name: match.homeTeam?.name || '',
            shortName: match.homeTeam?.shortName || '',
            tla: match.homeTeam?.tla || '',         // código 3 letras
            crest: match.homeTeam?.crest || '',     // URL escudo
          },
          awayTeam: {
            name: match.awayTeam?.name || '',
            shortName: match.awayTeam?.shortName || '',
            tla: match.awayTeam?.tla || '',
            crest: match.awayTeam?.crest || '',
          },
          score: {
            home: match.score?.fullTime?.home ?? null,
            away: match.score?.fullTime?.away ?? null,
            halfHome: match.score?.halfTime?.home ?? null,
            halfAway: match.score?.halfTime?.away ?? null,
          },
          stage: match.stage || '',         // 'GROUP_STAGE' | 'ROUND_OF_16' | etc.
          group: match.group || '',
          utcDate: match.utcDate || '',
          updatedAt: new Date().toISOString(),
        };

        const ref = db.collection('matches2026').doc(String(match.id));
        batch.set(ref, matchData, { merge: true });

        // Si el partido terminó, actualizar posiciones del grupo
        if (match.status === 'FINISHED' && match.score?.fullTime) {
          await updateGroupStandings(db, match);
        }
      }

      await batch.commit();
      console.log(`[syncMatchResults] ${matches.length} partidos sincronizados`);

      // Notificación push si hay gol (partidos IN_PLAY)
      const liveMatches = matches.filter(m => m.status === 'IN_PLAY');
      if (liveMatches.length > 0) {
        await notifyLiveMatches(liveMatches);
      }

    } catch (e) {
      console.error('[syncMatchResults] Error:', e);
    }
  }
);

// ── Helper: actualizar posiciones del grupo ───────────────
async function updateGroupStandings(db, match) {
  const homeGoals = match.score.fullTime.home;
  const awayGoals = match.score.fullTime.away;

  const homeResult = homeGoals > awayGoals ? 'W' : homeGoals < awayGoals ? 'L' : 'D';
  const awayResult = homeGoals < awayGoals ? 'W' : homeGoals > awayGoals ? 'L' : 'D';

  const updateTeam = (teamTla, result, goalsFor, goalsAgainst) => ({
    [`teams.${teamTla}.pj`]:  admin.firestore.FieldValue.increment(1),
    [`teams.${teamTla}.gf`]:  admin.firestore.FieldValue.increment(goalsFor),
    [`teams.${teamTla}.gc`]:  admin.firestore.FieldValue.increment(goalsAgainst),
    [`teams.${teamTla}.pg`]:  admin.firestore.FieldValue.increment(result === 'W' ? 1 : 0),
    [`teams.${teamTla}.pe`]:  admin.firestore.FieldValue.increment(result === 'D' ? 1 : 0),
    [`teams.${teamTla}.pp`]:  admin.firestore.FieldValue.increment(result === 'L' ? 1 : 0),
    [`teams.${teamTla}.pts`]: admin.firestore.FieldValue.increment(result === 'W' ? 3 : result === 'D' ? 1 : 0),
  });

  const homeTla = match.homeTeam?.tla;
  const awayTla = match.awayTeam?.tla;
  const group   = match.group || 'UNKNOWN';

  if (!homeTla || !awayTla) return;

  const standingsRef = db.collection('standings2026').doc(group);
  await standingsRef.set({
    ...updateTeam(homeTla, homeResult, homeGoals, awayGoals),
    ...updateTeam(awayTla, awayResult, awayGoals, homeGoals),
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

// ── Helper: notificar partidos en vivo ────────────────────
async function notifyLiveMatches(matches) {
  const db = admin.firestore();
  const tokensSnap = await db.collection('fcmTokens').get();
  if (tokensSnap.empty) return;

  const tokens = [];
  tokensSnap.forEach(d => { if (d.data().token) tokens.push(d.data().token); });

  const matchSummary = matches
    .map(m => `${m.homeTeam?.shortName} ${m.score?.fullTime?.home ?? 0}-${m.score?.fullTime?.away ?? 0} ${m.awayTeam?.shortName}`)
    .join(' · ');

  await admin.messaging().sendEachForMulticast({
    tokens: tokens.slice(0, 500),
    notification: {
      title: '⚽ Mundial 2026 EN VIVO',
      body: matchSummary,
    },
    webpush: {
      notification: {
        icon: '/icon-192.png',
        badge: '/icon-96.png',
        tag: 'live-match',
        renotify: false,
      },
      fcmOptions: { link: '/?shortcut=standings' },
    },
    data: { type: 'LIVE_MATCH', matches: JSON.stringify(matches.map(m => m.id)) },
  }).catch(e => console.error('[notifyLiveMatches]', e));
}

// ═══════════════════════════════════════════════════════════
// 6. GET MATCHES — Devuelve partidos al cliente
//    GET /getMatches?date=2026-06-11  (opcional)
// ═══════════════════════════════════════════════════════════
exports.getMatches = onRequest(
  { cors: true },
  async (req, res) => {
    setCORS(res, req);
    if (req.method === 'OPTIONS') return res.status(204).send('');

    // No requiere auth — datos públicos
    const db = admin.firestore();
    try {
      let query = db.collection('matches2026').orderBy('utcDate');

      const date = req.query.date;
      if (date) {
        const startOfDay = `${date}T00:00:00Z`;
        const endOfDay   = `${date}T23:59:59Z`;
        query = query
          .where('utcDate', '>=', startOfDay)
          .where('utcDate', '<=', endOfDay);
      } else {
        // Por defecto: próximos 7 días
        const from = new Date().toISOString();
        const to   = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        query = query.where('utcDate', '>=', from).where('utcDate', '<=', to);
      }

      const snap = await query.limit(50).get();
      const matches = [];
      snap.forEach(d => matches.push({ id: d.id, ...d.data() }));

      return res.json({ matches, count: matches.length });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// 7. GET STANDINGS — Posiciones del grupo desde Firestore
//    GET /getStandings?group=GROUP_A  (opcional)
// ═══════════════════════════════════════════════════════════
exports.getStandings = onRequest(
  { cors: true },
  async (req, res) => {
    setCORS(res, req);
    if (req.method === 'OPTIONS') return res.status(204).send('');

    const db = admin.firestore();
    try {
      const group = req.query.group;
      let result  = {};

      if (group) {
        const snap = await db.collection('standings2026').doc(group).get();
        result = snap.exists ? snap.data() : {};
      } else {
        const snap = await db.collection('standings2026').get();
        snap.forEach(d => { result[d.id] = d.data(); });
      }

      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
);
