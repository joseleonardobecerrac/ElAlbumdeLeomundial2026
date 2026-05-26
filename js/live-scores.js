// ═══════════════════════════════════════════════════════════
// LIVE SCORES — Álbum Mundial 2026
//
// Sincroniza resultados del Mundial 2026 desde Firestore
// (poblado por la Cloud Function syncMatchResults cada 5 min).
//
// Expone:
//   liveScores.init()           — iniciar escucha en tiempo real
//   liveScores.getMatches(date) — partidos de un día
//   liveScores.getStandings()   — posiciones de todos los grupos
//   liveScores.destroy()        — detener escucha
// ═══════════════════════════════════════════════════════════

const liveScores = (() => {

  let _unsubscribeMatches   = null;
  let _unsubscribeStandings = null;
  let _listeners = {};          // { eventName: [callbacks] }
  let _matches   = {};          // { matchId: matchData }
  let _standings = {};          // { group: standingsData }
  let _initialized = false;

  // ── CONSTANTES ────────────────────────────────────────────
  const STATUS_LABELS = {
    SCHEDULED:  '🕒 Programado',
    TIMED:      '🕒 Programado',
    IN_PLAY:    '🔴 EN VIVO',
    PAUSED:     '⏸ Medio tiempo',
    FINISHED:   '✅ Finalizado',
    SUSPENDED:  '⚠️ Suspendido',
    POSTPONED:  '⚠️ Aplazado',
    CANCELLED:  '❌ Cancelado',
  };

  const STAGE_LABELS = {
    'GROUP_STAGE':     'Fase de Grupos',
    'ROUND_OF_16':     'Octavos de Final',
    'QUARTER_FINALS':  'Cuartos de Final',
    'SEMI_FINALS':     'Semifinales',
    'THIRD_PLACE':     'Tercer Puesto',
    'FINAL':           'Gran Final',
  };

  // ── MAPEO: TLA de football-data.org → código interno ──────
  const TLA_TO_CODE = {
    MEX:'MEX', RSA:'SAF', KOR:'KOR', CZE:'RCH',
    CAN:'CAN', BIH:'BOS', QAT:'CAT', SUI:'SUI',
    BRA:'BRA', MAR:'MAR', HAI:'HAI', SCO:'ESC',
    USA:'USA', PAR:'PAR', AUS:'AUS', TUR:'TUR',
    GER:'ALE', CUW:'CUW', CIV:'CIV', ECU:'ECU',
    NED:'HOL', JPN:'JAP', SWE:'SWE', TUN:'TUN',
    BEL:'BEL', EGY:'EGI', IRN:'IRA', NZL:'NZL',
    ESP:'ESP', CPV:'CPV', SAU:'ARS', URU:'URU',
    FRA:'FRA', SEN:'SEN', IRQ:'IRA2', NOR:'NOR',
    ARG:'ARG', ALG:'ALG', AUT:'AUT', JOR:'JOR',
    POR:'POR', COD:'RDC', UZB:'UZB', COL:'COL',
    ENG:'ING', CRO:'CRO', GHA:'GHA', PAN:'PAN',
  };

  // ── EVENT EMITTER SIMPLE ──────────────────────────────────
  function on(event, cb) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(cb);
    return () => { _listeners[event] = _listeners[event].filter(f => f !== cb); };
  }

  function emit(event, data) {
    (_listeners[event] || []).forEach(cb => { try { cb(data); } catch(e) {} });
  }

  // ── INICIALIZAR escucha en tiempo real ────────────────────
  function init() {
    if (_initialized || !window._firebase) return;
    _initialized = true;

    const { db, collection, onSnapshot, query, where, orderBy } = window._firebase;

    // Escuchar partidos de hoy y los próximos 3 días
    const from = new Date().toISOString().split('T')[0] + 'T00:00:00Z';
    const to   = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0] + 'T23:59:59Z';

    const matchesQuery = query(
      collection(db, 'matches2026'),
      where('utcDate', '>=', from),
      where('utcDate', '<=', to),
      orderBy('utcDate')
    );

    _unsubscribeMatches = onSnapshot(matchesQuery, snap => {
      snap.docChanges().forEach(change => {
        const match = { id: change.doc.id, ...change.doc.data() };
        if (change.type === 'removed') {
          delete _matches[match.id];
        } else {
          const prev = _matches[match.id];
          _matches[match.id] = match;

          // Detectar gol o cambio de estado
          if (prev) {
            const prevScore = `${prev.score?.home}-${prev.score?.away}`;
            const newScore  = `${match.score?.home}-${match.score?.away}`;
            if (prevScore !== newScore && match.status === 'IN_PLAY') {
              emit('goal', { match, prevScore, newScore });
            }
            if (prev.status !== match.status) {
              emit('statusChange', { match, prevStatus: prev.status });
            }
          }
        }
      });

      emit('matchesUpdated', Object.values(_matches));
      updateStandingsUI();
    }, err => {
      console.warn('[liveScores] Firestore error:', err.message);
    });

    // Escuchar posiciones en tiempo real
    const standingsQuery = collection(db, 'standings2026');
    _unsubscribeStandings = onSnapshot(standingsQuery, snap => {
      snap.forEach(doc => {
        _standings[doc.id] = doc.data();
      });
      emit('standingsUpdated', _standings);
    });

    console.log('[liveScores] Escucha en tiempo real iniciada');
  }

  // ── PARAR escucha ─────────────────────────────────────────
  function destroy() {
    _unsubscribeMatches?.();
    _unsubscribeStandings?.();
    _initialized = false;
    _matches = {};
    _standings = {};
    _listeners = {};
    console.log('[liveScores] Escucha detenida');
  }

  // ── GETTERS ───────────────────────────────────────────────
  function getMatches(dateStr) {
    const all = Object.values(_matches);
    if (!dateStr) return all;
    return all.filter(m => m.utcDate?.startsWith(dateStr));
  }

  function getMatchesByGroup(group) {
    return Object.values(_matches).filter(m => m.group === group);
  }

  function getStandings(group) {
    if (group) return _standings[group] || null;
    return _standings;
  }

  function getLiveMatches() {
    return Object.values(_matches).filter(m => m.status === 'IN_PLAY' || m.status === 'PAUSED');
  }

  function getTodayMatches() {
    const today = new Date().toISOString().split('T')[0];
    return getMatches(today);
  }

  // ── RENDER: Widget de partido ─────────────────────────────
  function renderMatchCard(match) {
    const homeCode = TLA_TO_CODE[match.homeTeam?.tla] || '';
    const awayCode = TLA_TO_CODE[match.awayTeam?.tla] || '';
    const homeFlag = homeCode ? `https://flagcdn.com/w40/${getIso2(homeCode)}.png` : '';
    const awayFlag = awayCode ? `https://flagcdn.com/w40/${getIso2(awayCode)}.png` : '';

    const isLive     = match.status === 'IN_PLAY' || match.status === 'PAUSED';
    const isFinished = match.status === 'FINISHED';
    const hasScore   = match.score?.home !== null && match.score?.away !== null;

    const utcDate  = new Date(match.utcDate);
    const timeStr  = utcDate.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    const stageStr = STAGE_LABELS[match.stage] || match.stage || '';

    return `<div class="live-match-card ${isLive ? 'live' : ''} ${isFinished ? 'finished' : ''}">
      <div class="lmc-stage">
        ${isLive ? '<span class="lmc-live-dot"></span> EN VIVO' : isFinished ? '✅ FINALIZADO' : `🕒 ${timeStr}`}
        <span class="lmc-group">${match.group || stageStr}</span>
      </div>
      <div class="lmc-teams">
        <div class="lmc-team">
          ${homeFlag ? `<img src="${homeFlag}" class="lmc-flag" onerror="this.style.display='none'">` : ''}
          <span class="lmc-name">${match.homeTeam?.shortName || match.homeTeam?.name || '?'}</span>
        </div>
        <div class="lmc-score">
          ${hasScore
            ? `<span class="${isLive ? 'lmc-score-live' : ''}">${match.score.home}</span>
               <span class="lmc-score-sep">-</span>
               <span class="${isLive ? 'lmc-score-live' : ''}">${match.score.away}</span>`
            : `<span class="lmc-score-vs">VS</span>`}
        </div>
        <div class="lmc-team lmc-team-away">
          <span class="lmc-name">${match.awayTeam?.shortName || match.awayTeam?.name || '?'}</span>
          ${awayFlag ? `<img src="${awayFlag}" class="lmc-flag" onerror="this.style.display='none'">` : ''}
        </div>
      </div>
      ${match.score?.halfHome !== null && match.score?.halfAway !== null && isFinished
        ? `<div class="lmc-halftime">Medio tiempo: ${match.score.halfHome}-${match.score.halfAway}</div>`
        : ''}
    </div>`;
  }

  // ── RENDER: Widget de posiciones del grupo ────────────────
  function renderGroupStandings(group, standingsData) {
    if (!standingsData?.teams) {
      return `<div style="color:var(--muted);font-size:12px;font-family:var(--fs);padding:12px 0;">
        Sin datos de posiciones aún — se actualizarán cuando inicie el torneo.
      </div>`;
    }

    const teams = Object.entries(standingsData.teams)
      .map(([tla, stats]) => ({ tla, ...stats }))
      .sort((a, b) => (b.pts || 0) - (a.pts || 0) || ((b.gf - b.gc) - (a.gf - a.gc)));

    return `<table class="live-standings-table">
      <thead>
        <tr>
          <th>#</th>
          <th style="text-align:left">Equipo</th>
          <th>PJ</th><th>PG</th><th>PE</th><th>PP</th>
          <th>GF</th><th>GC</th><th>DIF</th>
          <th class="live-pts">PTS</th>
        </tr>
      </thead>
      <tbody>
        ${teams.map((t, i) => {
          const code = TLA_TO_CODE[t.tla] || '';
          const country = code ? (window.COUNTRIES || []).find(c => c.code === code) : null;
          const name    = country?.name || t.tla;
          const flag    = country ? `https://flagcdn.com/w20/${getIso2(code)}.png` : '';
          const dif     = (t.gf || 0) - (t.gc || 0);
          return `<tr class="${i < 2 ? 'qualify-row' : ''}">
            <td class="live-pos">${i + 1}</td>
            <td class="live-team">
              ${flag ? `<img src="${flag}" style="width:16px;height:11px;object-fit:cover;border-radius:1px;margin-right:5px;">` : ''}
              ${name}
            </td>
            <td>${t.pj || 0}</td>
            <td>${t.pg || 0}</td>
            <td>${t.pe || 0}</td>
            <td>${t.pp || 0}</td>
            <td>${t.gf || 0}</td>
            <td>${t.gc || 0}</td>
            <td style="color:${dif > 0 ? 'var(--green)' : dif < 0 ? 'var(--red)' : 'var(--muted)'}">
              ${dif > 0 ? '+' : ''}${dif}
            </td>
            <td class="live-pts-val">${t.pts || 0}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  }

  // ── Helper: obtener código iso2 desde código interno ─────
  function getIso2(code) {
    if (!window.COUNTRIES) return 'un';
    const c = window.COUNTRIES.find(x => x.code === code);
    return c?.flag || 'un';
  }

  // ── Actualizar UI de posiciones si está visible ───────────
  function updateStandingsUI() {
    const liveEl = document.getElementById('live-standings-container');
    if (!liveEl) return;
    // Llamar al render de posiciones si existe en la página actual
    if (typeof renderLiveStandingsPage === 'function') {
      renderLiveStandingsPage();
    }
  }

  // ── RENDER: Página completa de Live Scores ────────────────
  window.renderLiveScoresPage = function(page) {
    init(); // Asegurar que la escucha está activa

    const liveMatches  = getLiveMatches();
    const todayMatches = getTodayMatches();
    const allStandings = getStandings();

    page.innerHTML = `<div class="page-enter" id="live-scores-page">
      <button class="page-back-btn" onclick="navigate('home')">← Inicio</button>

      <div style="font-family:var(--fd);font-size:38px;letter-spacing:3px;margin-bottom:4px;">
        ⚽ RESULTADOS EN VIVO
      </div>
      <div style="font-size:11px;color:var(--muted);font-family:var(--fm);margin-bottom:20px;letter-spacing:1px;">
        FIFA World Cup 2026 · Actualización automática cada 5 minutos
      </div>

      ${liveMatches.length > 0 ? `
        <div class="section-label">🔴 EN VIVO AHORA</div>
        <div class="live-matches-grid">
          ${liveMatches.map(renderMatchCard).join('')}
        </div>
      ` : ''}

      <div class="section-label">📅 Partidos de hoy</div>
      <div class="live-matches-grid" id="today-matches-grid">
        ${todayMatches.length > 0
          ? todayMatches.map(renderMatchCard).join('')
          : `<div style="color:var(--muted);font-size:13px;font-family:var(--fs);padding:20px 0;">
              Sin partidos programados para hoy.
              ${Object.keys(_matches).length === 0
                ? '<br>Los resultados se sincronizarán cuando inicie el torneo en junio 2026.'
                : ''}
            </div>`}
      </div>

      <div class="section-label" style="margin-top:20px;">📊 Posiciones</div>
      <div id="live-standings-container">
        ${Object.keys(allStandings).length > 0
          ? Object.entries(allStandings).map(([group, data]) => `
              <div style="margin-bottom:20px;">
                <div style="font-family:var(--fd);font-size:16px;letter-spacing:2px;margin-bottom:8px;color:var(--gold);">
                  ${group.replace('_', ' ')}
                </div>
                ${renderGroupStandings(group, data)}
              </div>`).join('')
          : `<div style="color:var(--muted);font-size:13px;font-family:var(--fs);padding:20px 0;">
              Las posiciones se actualizarán automáticamente durante el torneo.
              <br>Se sincronizan cada 5 minutos con los datos oficiales.
            </div>`}
      </div>
    </div>`;

    // Escuchar actualizaciones y re-renderizar
    const offMatches   = on('matchesUpdated', () => {
      const todayEl = document.getElementById('today-matches-grid');
      if (todayEl) todayEl.innerHTML = getTodayMatches().map(renderMatchCard).join('') || '<div style="color:var(--muted);font-size:13px;padding:20px 0;">Sin partidos hoy.</div>';
    });
    const offStandings = on('standingsUpdated', () => {
      const sEl = document.getElementById('live-standings-container');
      if (!sEl) return;
      sEl.innerHTML = Object.entries(getStandings()).map(([g, d]) => `
        <div style="margin-bottom:20px;">
          <div style="font-family:var(--fd);font-size:16px;letter-spacing:2px;margin-bottom:8px;color:var(--gold);">${g.replace('_',' ')}</div>
          ${renderGroupStandings(g, d)}
        </div>`).join('');
    });

    // Notificación de gol
    const offGoal = on('goal', ({ match, newScore }) => {
      const [h, a] = newScore.split('-');
      toast(`⚽ GOL! ${match.homeTeam?.shortName} ${h}-${a} ${match.awayTeam?.shortName}`, 'success');
    });

    // Limpiar listeners cuando se sale de la página
    const cleanup = () => { offMatches(); offStandings(); offGoal(); };
    window._liveScoresCleanup = cleanup;
  };

  // Limpiar al navegar a otra sección
  const _origNavigate = window.navigate;
  if (typeof _origNavigate === 'function') {
    window.navigate = function(...args) {
      if (window._liveScoresCleanup) {
        window._liveScoresCleanup();
        window._liveScoresCleanup = null;
      }
      return _origNavigate.apply(this, args);
    };
  }

  return { init, destroy, on, getMatches, getMatchesByGroup, getStandings, getLiveMatches, getTodayMatches, renderMatchCard, renderGroupStandings };
})();

// Exponer globalmente
window.liveScores = liveScores;

// Iniciar escucha en background cuando el usuario está logueado
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (window.state?.userId) liveScores.init();
  }, 3000);
});
