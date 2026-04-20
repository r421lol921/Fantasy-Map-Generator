"use strict";
// game-hud.js — Floating bottom-left HUD panel (no top header bar)

const GameHUD = {
  init() {
    if (document.getElementById("gameHUDPanel")) return;
    this._injectStyles();
    this._buildPanel();
  },

  _injectStyles() {
    if (document.getElementById("gameHUDStyle")) return;
    const s = document.createElement("style");
    s.id = "gameHUDStyle";
    s.textContent = `
      #gameHUDPanel {
        position: fixed; bottom: 18px; left: 18px; z-index: 9000;
        background: rgba(8,16,28,0.93); border: 1px solid #1e3a5a;
        border-radius: 10px; padding: 10px 14px; min-width: 200px;
        font-family: Georgia, serif; font-size: 12px; color: #c8d8e8;
        box-shadow: 0 4px 20px rgba(0,0,0,0.7);
        user-select: none;
        backdrop-filter: blur(4px);
      }
      #gameHUDPanel .hud-row { display:flex; align-items:center; gap:10px; margin-bottom:5px; }
      #gameHUDPanel .hud-label { color:#5a8aaa; font-size:10px; min-width:48px; }
      #gameHUDPanel .hud-value { color:#f0d080; font-size:13px; font-weight:bold; }
      #gameHUDPanel .hud-sep { height:1px; background:#1e3a5a; margin:6px 0; }
      #gameHUDPanel button {
        background:#152535; border:1px solid #2a4a6a; color:#90b8cc;
        border-radius:4px; padding:3px 9px; cursor:pointer; font-size:11px;
        font-family:Georgia,serif; transition:background 0.12s;
      }
      #gameHUDPanel button:hover { background:#1e3a50; }
      #gameHUDPanel button.active { background:#1e4a30; border-color:#3a9a6a; color:#80e8a0; }
      #hudUnitInfo {
        font-size:11px; color:#a0c0d8; margin-top:5px;
        padding: 5px 8px; background: rgba(255,255,255,0.04);
        border-radius:5px; display:none;
      }
      #hudUnitInfo.visible { display:block; }
      #hudUnitInfo .unit-move-hint { color:#ffe066; font-size:10px; margin-top:3px; }
      #hudDiplomacy { font-size:10px; color:#e88080; margin-top:4px; }
      #gameNotification {
        position:fixed; bottom:18px; right:18px; z-index:11000;
        display:flex; flex-direction:column; gap:6px; max-width:300px;
      }
      .game-notif {
        padding:8px 13px; border-radius:7px; font-family:Georgia,serif; font-size:12px;
        opacity:0; transform:translateX(20px); transition:opacity 0.25s, transform 0.25s;
        pointer-events:none;
      }
      .game-notif.show { opacity:1; transform:translateX(0); }
      .game-notif.info    { background:#0d2035; border:1px solid #2a5a80; color:#a8d0e8; }
      .game-notif.success { background:#0d2a18; border:1px solid #2a7a50; color:#80e8a8; }
      .game-notif.warning { background:#2a2008; border:1px solid #8a6020; color:#e8c870; }
      .game-notif.danger  { background:#2a0808; border:1px solid #8a2020; color:#e88080; }
      /* Province info panel */
      #provincePanel {
        position:fixed; top:50%; right:18px; transform:translateY(-50%);
        z-index:9000; background:rgba(8,16,28,0.95); border:1px solid #1e3a5a;
        border-radius:10px; padding:12px 16px; min-width:190px; max-width:240px;
        font-family:Georgia,serif; font-size:12px; color:#c8d8e8;
        box-shadow:0 4px 20px rgba(0,0,0,0.7); display:none;
        backdrop-filter:blur(4px);
      }
      #provincePanel .pp-title { font-size:14px; color:#d4a843; font-weight:bold; margin-bottom:8px; }
      #provincePanel .pp-row { display:flex; justify-content:space-between; margin-bottom:4px; font-size:11px; }
      #provincePanel .pp-label { color:#6a9ab8; }
      #provincePanel .pp-val { color:#e8d890; }
      #provincePanel .pp-close { float:right; background:none; border:none; color:#555; font-size:16px; cursor:pointer; line-height:1; }
      #provincePanel .pp-tab-row { display:flex; gap:6px; margin-bottom:8px; }
      #provincePanel .pp-tab { background:#152535; border:1px solid #2a4a6a; color:#7aaccc; border-radius:4px; padding:3px 8px; cursor:pointer; font-size:10px; }
      #provincePanel .pp-tab.active { background:#1e4a30; border-color:#3a9a6a; color:#80e8a0; }
      #provincePanel .pp-units { font-size:10px; color:#aaa; }
      #provincePanel .pp-unit-row { display:flex; justify-content:space-between; padding:2px 0; border-bottom:1px solid #1a2a3a; }
    `;
    document.head.appendChild(s);
  },

  _buildPanel() {
    // Main HUD
    const hud = document.createElement("div");
    hud.id = "gameHUDPanel";
    hud.innerHTML = `
      <div class="hud-row">
        <span class="hud-label">Treasury</span>
        <span class="hud-value" id="hudTreasury">0g</span>
      </div>
      <div class="hud-row">
        <span class="hud-label">Year</span>
        <span class="hud-value" id="hudYear">1</span>
        <span style="color:#5a8aaa;font-size:10px;" id="hudTick">Tick 0</span>
      </div>
      <div class="hud-sep"></div>
      <div class="hud-row" style="gap:6px;">
        <button id="hudPlayBtn" onclick="GameHUD.togglePause()">&#9654; Start</button>
        <button id="hudSlow" onclick="GameState.setSpeed('slow')">Slow</button>
        <button id="hudNormal" onclick="GameState.setSpeed('normal')" class="active">Normal</button>
        <button id="hudFast" onclick="GameState.setSpeed('fast')">Fast</button>
      </div>
      <div id="hudDiplomacy"></div>
      <div id="hudUnitInfo">
        <div id="hudUnitText"></div>
        <div class="unit-move-hint">Click map to move &bull; Click unit to deselect</div>
      </div>
    `;
    document.body.appendChild(hud);

    // Province panel
    const pp = document.createElement("div");
    pp.id = "provincePanel";
    pp.innerHTML = `
      <button class="pp-close" onclick="GameHUD.closeProvince()">&#x2715;</button>
      <div class="pp-title" id="ppTitle">Province</div>
      <div class="pp-tab-row">
        <button class="pp-tab active" id="ppTabInfo" onclick="GameHUD.switchProvinceTab('info')">Info</button>
        <button class="pp-tab" id="ppTabUnits" onclick="GameHUD.switchProvinceTab('units')">Units</button>
      </div>
      <div id="ppBody"></div>
    `;
    document.body.appendChild(pp);

    // Notification container
    const nc = document.createElement("div");
    nc.id = "gameNotification";
    document.body.appendChild(nc);

    this._ppCurrentBurgId = null;
    this._ppCurrentTab = "info";
  },

  togglePause() {
    const btn = document.getElementById("hudPlayBtn");
    if (GameState.running) {
      GameState.pauseTick();
      if (btn) btn.innerHTML = "&#9654; Start";
    } else {
      GameState.startTick();
      if (btn) btn.innerHTML = "&#9646;&#9646; Pause";
    }
  },

  updateTreasury(amount) {
    const el = document.getElementById("hudTreasury");
    if (el) el.textContent = Math.floor(amount) + "g";
  },

  updateYear(year) {
    const ye = document.getElementById("hudYear");
    const te = document.getElementById("hudTick");
    if (ye) ye.textContent = year;
    if (te) te.textContent = "Tick " + (GameState.tick || 0);
  },

  showUnitInfo(unit, isSelected) {
    const el = document.getElementById("hudUnitInfo");
    const txt = document.getElementById("hudUnitText");
    if (!el || !unit) return;
    const def = UNIT_DEFS?.[unit.unit_type] || {};
    const hpPct = Math.round((unit.hp / (def.hp || 100)) * 100);
    const fuelStr = def.maxFuel < 999 ? ` | Fuel: ${Math.round(unit.fuel)}` : "";
    txt.textContent = `${unit.unit_type.toUpperCase()} — HP: ${hpPct}%${fuelStr} | ${unit.status}`;
    el.classList.toggle("visible", true);
    // Only show move hint for player selected unit
    const hint = el.querySelector(".unit-move-hint");
    if (hint) hint.style.display = isSelected ? "block" : "none";
  },

  clearUnitInfo() {
    const el = document.getElementById("hudUnitInfo");
    if (el) el.classList.remove("visible");
  },

  updateDiplomacy() {
    const el = document.getElementById("hudDiplomacy");
    if (!el || !GameState.playerStateId) return;
    const wars = [];
    for (const [, d] of Object.entries(GameState.diplomacy)) {
      if (d.relation === "War") {
        const other = d.state_a === GameState.playerStateId ? d.state_b : d.state_a;
        if (other !== GameState.playerStateId) {
          const s = pack?.states?.[other];
          if (s) wars.push(s.name || `State ${other}`);
        }
      }
    }
    el.textContent = wars.length ? "At war: " + wars.slice(0, 3).join(", ") : "";
  },

  // ── Province panel ─────────────────────────────────────────────────────────
  openProvince(burgId) {
    this._ppCurrentBurgId = burgId;
    this._ppCurrentTab = "info";
    this._refreshProvincePanel();
    document.getElementById("provincePanel").style.display = "block";
  },

  closeProvince() {
    document.getElementById("provincePanel").style.display = "none";
    this._ppCurrentBurgId = null;
  },

  switchProvinceTab(tab) {
    this._ppCurrentTab = tab;
    document.querySelectorAll(".pp-tab").forEach(b => b.classList.remove("active"));
    const btn = document.getElementById("ppTab" + tab.charAt(0).toUpperCase() + tab.slice(1));
    if (btn) btn.classList.add("active");
    this._refreshProvincePanel();
  },

  _refreshProvincePanel() {
    const burgId = this._ppCurrentBurgId;
    if (!burgId) return;
    const burg = pack?.burgs?.[burgId];
    if (!burg) return;
    const title = document.getElementById("ppTitle");
    const body = document.getElementById("ppBody");
    const ownerState = pack?.states?.[burg.state];
    const isPlayer = burg.state === GameState.playerStateId;
    const city = GameState.cityEconomy[burgId] || {};

    if (title) title.textContent = burg.name || ("City " + burgId);

    if (this._ppCurrentTab === "info") {
      const damagePct = Math.round((city.damage_level || 0) * 100);
      const income = city.income_per_tick ? Math.round(city.income_per_tick * (1 - (city.damage_level || 0) * 0.9)) : "?";
      const relation = ownerState && !isPlayer ? GameState.getRelation(GameState.playerStateId, burg.state) : null;
      const treasury = isPlayer ? Math.floor(GameState.getTreasury(GameState.playerStateId)) + "g" : "?";
      const queueList = (city.production_queue || []).map(q => `${q.type} (${q.ticksLeft}t)`).join(", ") || "None";

      body.innerHTML = `
        <div class="pp-row"><span class="pp-label">Owner</span><span class="pp-val">${ownerState?.name || "?"}</span></div>
        <div class="pp-row"><span class="pp-label">Status</span><span class="pp-val" style="color:${isPlayer ? "#80e8a0" : relation === "War" ? "#e88080" : "#c8d8e8"}">${isPlayer ? "Yours" : (relation || "Neutral")}</span></div>
        <div class="pp-row"><span class="pp-label">Income</span><span class="pp-val">${income}/tick</span></div>
        <div class="pp-row"><span class="pp-label">Damage</span><span class="pp-val" style="color:${damagePct > 50 ? "#e88080" : "#aaa"}">${damagePct}%</span></div>
        <div class="pp-row"><span class="pp-label">Port</span><span class="pp-val">${burg.port ? "Yes" : "No"}</span></div>
        ${isPlayer ? `<div class="pp-row"><span class="pp-label">Treasury</span><span class="pp-val">${treasury}</span></div>
        <div class="pp-row"><span class="pp-label">Queue</span><span class="pp-val" style="max-width:120px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${queueList}</span></div>
        <div class="hud-sep" style="margin:8px 0"></div>
        <button style="width:100%;padding:6px;background:#1a3a1a;border:1px solid #3a7a3a;color:#80d080;border-radius:5px;cursor:pointer;font-family:Georgia,serif;font-size:11px;"
          onclick="UnitBuilder.open(${burgId}); GameHUD.closeProvince();">Open Build Menu</button>` : ""}
      `;
    } else {
      // Units tab — show all units at this burg's location
      const burgX = burg.x, burgY = burg.y;
      const nearbyUnits = Object.values(GameState.units).filter(u => {
        return Math.sqrt((u.x - burgX)**2 + (u.y - burgY)**2) < 20;
      });
      if (!nearbyUnits.length) {
        body.innerHTML = `<div class="pp-units" style="color:#555;padding:8px 0">No units nearby</div>`;
      } else {
        body.innerHTML = `<div class="pp-units">` +
          nearbyUnits.map(u => {
            const def = UNIT_DEFS[u.unit_type] || {};
            const hp = Math.round((u.hp / (def.hp || 100)) * 100);
            const stateN = pack?.states?.[u.state_id]?.name || "?";
            const isEnemy = u.state_id !== GameState.playerStateId;
            return `<div class="pp-unit-row">
              <span style="color:${isEnemy ? "#e88080" : "#80e8a0"}">${u.unit_type}</span>
              <span style="color:#aaa">HP:${hp}% &bull; ${stateN}</span>
            </div>`;
          }).join("") +
        `</div>`;
      }
    }
  },

  notify(message, type = "info") {
    const container = document.getElementById("gameNotification");
    if (!container) return;
    const notif = document.createElement("div");
    notif.className = `game-notif ${type}`;
    notif.textContent = message;
    container.appendChild(notif);
    requestAnimationFrame(() => requestAnimationFrame(() => notif.classList.add("show")));
    setTimeout(() => {
      notif.classList.remove("show");
      setTimeout(() => notif.remove(), 300);
    }, 4500);
  }
};

window.GameHUD = GameHUD;
