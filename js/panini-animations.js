// ═══════════════════════════════════════════════════════════
// PANINI ANIMATIONS — Álbum Mundial 2026
// Confetti, badges ¡NUEVO!/DUP, y mejoras visuales del revelado
// NOTA: openStickerDetail y closeStickerDetail viven en scorers.js
// ═══════════════════════════════════════════════════════════

// ── PARTÍCULAS DE CONFETTI ──────────────────────────────────
window.spawnConfetti = function(originEl, rarity) {
  if (rarity !== 'icon' && rarity !== 'legendary') return;
  const rect = originEl.getBoundingClientRect();
  const cx = rect.left + rect.width  / 2;
  const cy = rect.top  + rect.height / 2;

  const colors = rarity === 'icon'
    ? ['#E535AB','#5BA4F5','#00A650','#EF9F27','#E31E24']
    : ['#EF9F27','#FFD700','#fff','#F5DEB3'];

  const count = rarity === 'icon' ? 28 : 16;

  for (let i = 0; i < count; i++) {
    const dot   = document.createElement('div');
    const angle = (Math.random() * 360) * (Math.PI / 180);
    const dist  = 60 + Math.random() * 90;
    const size  = 4 + Math.random() * 6;
    const dur   = 600 + Math.random() * 500;
    const color = colors[Math.floor(Math.random() * colors.length)];

    Object.assign(dot.style, {
      position:     'fixed',
      left:         cx + 'px',
      top:          cy + 'px',
      width:        size + 'px',
      height:       size + 'px',
      borderRadius: Math.random() > 0.5 ? '50%' : '2px',
      background:   color,
      pointerEvents:'none',
      zIndex:       '99999',
      transform:    'translate(-50%,-50%)',
      transition:   `transform ${dur}ms cubic-bezier(.22,.68,0,1), opacity ${dur}ms ease`,
    });

    document.body.appendChild(dot);

    requestAnimationFrame(() => requestAnimationFrame(() => {
      dot.style.transform = `translate(
        calc(-50% + ${Math.cos(angle) * dist}px),
        calc(-50% + ${Math.sin(angle) * dist}px)
      ) rotate(${Math.random() * 360}deg) scale(0)`;
      dot.style.opacity = '0';
    }));

    setTimeout(() => dot.remove(), dur + 100);
  }
};

// ── PARCHE DE renderDrawnCards ──────────────────────────────
// Añade badges ¡NUEVO!/DUP y confetti encima de la función original en state.js
(function patchDrawnCards() {
  // Esperamos a que la función esté disponible en el scope global
  // state.js la define como función local, la exponemos desde aquí
  const _tryPatch = setInterval(() => {
    // Buscamos la función en window (si state.js la expuso) o nos apoyamos
    // en el hook que llamamos desde state.js directamente
    if (typeof window._drawCardsRendered !== 'undefined') {
      clearInterval(_tryPatch);
    }
  }, 200);
  setTimeout(() => clearInterval(_tryPatch), 5000);
})();

// Esta función es llamada desde state.js al final de renderDrawnCards
// con la lista de cartas ya reveladas
window.onDrawnCardsRendered = function(drawn) {
  const grid = document.getElementById('pack-grid');
  if (!grid) return;

  drawn.forEach((s, i) => {
    setTimeout(() => {
      const slots = grid.querySelectorAll('.pack-sticker-reveal');
      const slot  = slots[i];
      if (!slot) return;

      const inner = slot.querySelector('.sticker-slot');
      if (!inner) return;

      const rarity = s.rarity || 'common';
      const isDup  = (window.state?.duplicates?.[s.id] || 0) > 0;

      // Badge ¡NUEVO! o ×DUP
      if (!inner.querySelector('.slot-new-badge')) {
        const badge = document.createElement('div');
        badge.className = 'slot-new-badge' + (isDup ? ' dup' : '');
        badge.textContent = isDup ? '×DUP' : '¡NUEVO!';
        inner.appendChild(badge);
      }

      // Confetti para raridades altas
      if (rarity === 'icon' || rarity === 'legendary') {
        setTimeout(() => window.spawnConfetti(inner, rarity), 350);
      }
    }, 150 + i * 180 + 400);
  });
};

// ── HOOK EN state.js: agregar al final de renderDrawnCards ──
// Buscar el final de la función original y hookearla
// (se aplica una sola vez al cargar)
(function hookStateJs() {
  const _orig = window.renderDrawnCards;
  if (typeof _orig === 'function') {
    window.renderDrawnCards = function(drawn, serverSide) {
      _orig.call(this, drawn, serverSide);
      window.onDrawnCardsRendered(drawn);
    };
    return;
  }
  // Si aún no está disponible, esperar
  const t = setInterval(() => {
    if (typeof window.renderDrawnCards === 'function') {
      clearInterval(t);
      const _o = window.renderDrawnCards;
      window.renderDrawnCards = function(drawn, serverSide) {
        _o.call(this, drawn, serverSide);
        window.onDrawnCardsRendered(drawn);
      };
    }
  }, 100);
  setTimeout(() => clearInterval(t), 5000);
})();

// ── CONFETTI AL ABRIR SDM DE RARIDAD ALTA ──────────────────
// Se engancha en el openStickerDetail existente de scorers.js
(function hookStickerDetail() {
  const _tryHook = setInterval(() => {
    if (typeof window.openStickerDetail === 'function') {
      clearInterval(_tryHook);
      const _orig = window.openStickerDetail;
      window.openStickerDetail = function(id, countryCode) {
        _orig.call(this, id, countryCode);
        // Disparar confetti si es raridad alta y está en el álbum
        setTimeout(() => {
          const c = COUNTRIES?.find(c => c.code === countryCode);
          const p = c?.players?.find(pl => pl.id === id);
          if (!p || !window.state?.collected?.has(id)) return;
          const card = document.querySelector('.sdm-card');
          if (card && (p.rarity === 'icon' || p.rarity === 'legendary')) {
            window.spawnConfetti(card, p.rarity);
          }
        }, 300);
      };
    }
  }, 100);
  setTimeout(() => clearInterval(_tryHook), 5000);
})();

// ── HAMBURGER MENU MOBILE ───────────────────────────────────
(function initHamburger() {
  document.addEventListener('DOMContentLoaded', () => {
    // Inyectar overlay y botón hamburguesa si no existen
    if (!document.getElementById('sb-overlay')) {
      const overlay = document.createElement('div');
      overlay.id = 'sb-overlay';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', closeSidebar);
    }

    // Inyectar botón hamburguesa en topbar
    const topbar = document.getElementById('topbar');
    if (topbar && !document.getElementById('sb-hamburger')) {
      const btn = document.createElement('button');
      btn.id = 'sb-hamburger';
      btn.innerHTML = '☰';
      btn.title = 'Menú';
      btn.addEventListener('click', toggleSidebar);
      topbar.prepend(btn);
    }
  });
})();

function toggleSidebar() {
  const sb  = document.getElementById('sidebar');
  const ov  = document.getElementById('sb-overlay');
  const open = sb?.classList.toggle('sb-open');
  if (ov) ov.classList.toggle('open', open);
}

function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('sb-open');
  document.getElementById('sb-overlay')?.classList.remove('open');
}

// Cerrar sidebar al navegar en móvil
const _origNav = window.navigate;
if (typeof _origNav === 'function') {
  window.navigate = function(...args) {
    closeSidebar();
    return _origNav.apply(this, args);
  };
} else {
  // navigate aún no está disponible, hookear cuando lo esté
  const t = setInterval(() => {
    if (typeof window.navigate === 'function') {
      clearInterval(t);
      const _o = window.navigate;
      window.navigate = function(...args) {
        closeSidebar();
        return _o.apply(this, args);
      };
    }
  }, 100);
  setTimeout(() => clearInterval(t), 5000);
}

console.log('[Panini] Animations + hamburger loaded');
