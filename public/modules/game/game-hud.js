"use strict";
// game-hud.js — Top-bar HUD: treasury, year, speed controls, unit info, notifications

const GameHUD = {
  _notifQueue: [],
  _notifTimeout: null,

  init() {
    if (document.getElementById("gameHUD")) return;
    this._injectStyles();
    this._buildHUD();
  },

  _injectStyles() {
    if (document.getElementById("gameHUDStyle")) return;
    const style = document.createElement("style");
    style.id = "gameHUDStyle";
    style.textContent = `
      #gameHUD {
        position: fixed; top: 0; left: 0; right: 0; z-index: 9000;
        background: linear-gradient(180deg, rgba(10,18,30,0.97) 0%, rgba(10,18,30,0.85) 100%);
        border-bottom: 1px solid #1e3a5a;
        display: flex; align-items: center; gap: 12px;
        padding: 6px 14px; height: 42px; box-sizing: border-box;
        font-family: Georgia, serif; font-size: 12px; color: #c8d8e8;
        user-select: none;
      }
      #gameHUD .hud-label { color: #6a9ab8; font-size: 10px; line-height:1; }
      #gameHUD .hud-value { color: #f0d080; font-size: 13px; font-weight: bold; }
      #gameHUD .hud-sep { width:1px; height:24px; background:#1e3a5a; margin:0 4px; }
      #gameHUD button {
        background: #152535; border: 1px solid #2a4a6a; color: #90b8cc;
        border-radius: 4px; padding: 3px 9px; cursor: pointer; font-size: 11px;
        font-family: Georgia,serif; transition: background 0.12s;
      }
      #gameHUD button:hover { background: #1e3a50; }
      #gameHUD button.active { background: #1e5a3a; border-color: #3aaa6a; color: #80e8a0; }
      #gameHUDUnitInfo {
        margin-left: auto; font-size: 11px; color: #a0c0d8;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;
      }
      #gameHUDStartBtn {
        background: #1a3a1a !important; border-color: #3a7a3a !important; color: #80d080 !important;
      }
      #gameHUDStartBtn.paused {
        background: #3a1a1a !important; border-color: #7a3a3a !important; color: #d08080 !important;
      }
      #gameNotification {
        position: fixed; bottom: 20px; right: 20px; z-index: 11000;
        max-width: 320px; display: flex; flex-direction: column; gap: 6px;
      }
      .game-notif {
        padding: 9px 14px; border-radius: 6px; font-family: Georgia,serif; font-size: 12px;
        opacity: 0; transform: translateX(20px);
        transition: opacity 0.25s, transform 0.25s;
        pointer-events: none;
      }
      .game-notif.show { opacity:1; transform:translateX(0); }
      .game-notif.info    { background:#0d2035; border:1px solid #2a5a80; color:#a8d0e8; }
      .game-notif.success { background:#0d2a18; border:1px solid #2a7a50; color:#80e8a8; }
      .game-notif.warning { background:#2a2008; border:1px solid #8a6020; color:#e8c870; }
      .game-notif.danger  { background:#2a0808; border:1px solid #8a2020; color:#e88080; }
      #gameHUDDiplomacy { font-size:10px; color:#8aabcc; white-space:nowrap; }
    `;
    document.head.appendChild(style);
  },

  _buildHUD() {
    const hud = document.createElement("div");
    hud.id = "gameHUD";
    hud.innerHTML = `
      <div>
        <div class="hud-label">Treasury</div>
        <div class="hud-value" id="hudTreasury">0g</div>
      </div>
      <div class="hud-sep"></div>
      <div>
        <div class="hud-label">Year</div>
        <div class="hud-value" id="hudYear">1</div>
      </div>
      <div class="hud-sep"></div>
      <div>
        <div class="hud-label">Tick</div>
        <div class="hud-value" id="hudTick">0</div>
      </div>
      <div class="hud-sep"></div>
      <button id="gameHUDStartBtn" onclick="GameHUD.togglePause()">▶ Start</button>
      <button onclick="GameState.setSpeed('slow')" id="speedSlow">Slow</button>
      <button onclick="GameState.setSpeed('normal')" id="speedNormal" class="active">Normal</button>
      <button onclick="GameState.setSpeed('fast')" id="speedFast">Fast</button>
      <div class="hud-sep"></div>
      <div id="gameHUDDiplomacy"></div>
      <div id="gameHUDUnitInfo"></div>
    `;
    document.body.appendChild(hud);

    // Notification container
    const notifContainer = document.createElement("div");
    notifContainer.id = "gameNotification";
    document.body.appendChild(notifContainer);
  },

  togglePause() {
    const btn = document.getElementById("gameHUDStartBtn");
    if (GameState.running) {
      GameState.pauseTick();
      if (btn) { btn.textContent = "▶ Start"; btn.classList.remove("paused"); }
    } else {
      GameState.startTick();
      if (btn) { btn.textContent = "⏸ Pause"; btn.classList.add("paused"); }
    }
  },

  updateTreasury(amount) {
    const el = document.getElementById("hudTreasury");
    if (el) el.textContent = Math.floor(amount) + "g";
  },

  updateYear(year) {
    const yearEl = document.getElementById("hudYear");
    const tickEl = document.getElementById("hudTick");
    if (yearEl) yearEl.textContent = year;
    if (tickEl) tickEl.textContent = GameState.tick;
  },

  showUnitInfo(unit) {
    const el = document.getElementById("gameHUDUnitInfo");
    if (!el || !unit) return;
    const def = UNIT_DEFS?.[unit.unit_type] || {};
    const hpPct = Math.round((unit.hp / (def.hp || 100)) * 100);
    el.textContent = `${unit.unit_type.toUpperCase()} — HP: ${hpPct}% | Fuel: ${Math.round(unit.fuel)} | ${unit.status}`;
  },

  updateDiplomacy() {
    const el = document.getElementById("gameHUDDiplomacy");
    if (!el || !GameState.playerStateId) return;
    const wars = [];
    for (const [key, d] of Object.entries(GameState.diplomacy)) {
      if (d.relation === "War") {
        const other = d.state_a === GameState.playerStateId ? d.state_b : d.state_a;
        if (other !== GameState.playerStateId) {
          const s = pack?.states?.[other];
          if (s) wars.push(s.name || `State ${other}`);
        }
      }
    }
    el.textContent = wars.length ? `⚔ At war: ${wars.slice(0,3).join(", ")}` : "";
  },

  notify(message, type = "info") {
    const container = document.getElementById("gameNotification");
    if (!container) return;

    const notif = document.createElement("div");
    notif.className = `game-notif ${type}`;
    notif.textContent = message;
    container.appendChild(notif);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => notif.classList.add("show"));
    });

    setTimeout(() => {
      notif.classList.remove("show");
      setTimeout(() => notif.remove(), 300);
    }, 4000);
  }
};

window.GameHUD = GameHUD;
