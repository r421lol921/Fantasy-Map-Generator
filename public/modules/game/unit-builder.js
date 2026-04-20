"use strict";
// unit-builder.js — Build panel for player cities

const UNIT_COSTS = {
  infantry:   {cost: 80,   buildTicks: 4},
  tank:       {cost: 220,  buildTicks: 8},
  fighter:    {cost: 350,  buildTicks: 10},
  helicopter: {cost: 300,  buildTicks: 9},
  antiair:    {cost: 200,  buildTicks: 7},
  missile:    {cost: 180,  buildTicks: 5},
  destroyer:  {cost: 400,  buildTicks: 12},
  battleship: {cost: 600,  buildTicks: 18}
};

// Unit label, SVG icon preview string shown in build panel
const UNIT_LABELS = {
  infantry:   "Infantry",
  tank:       "Tank",
  fighter:    "Fighter",
  helicopter: "Helicopter",
  antiair:    "Anti-Air",
  missile:    "Missile",
  destroyer:  "Destroyer",
  battleship: "Battleship"
};

const UnitBuilder = {
  currentBurgId: null,

  open(burgId) {
    const burg = pack?.burgs?.[burgId];
    if (!burg) return;
    if (burg.state !== GameState.playerStateId) return;

    this.currentBurgId = burgId;

    const existing = document.getElementById("unitBuilderPanel");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "unitBuilderPanel";
    panel.style.cssText = `
      position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
      background:#0a1220; color:#c8d8e8; border:1px solid #2a4a6a;
      border-radius:12px; padding:18px 22px; z-index:10000; min-width:380px;
      max-width:520px; box-shadow:0 8px 32px rgba(0,0,0,0.9); font-family:Georgia,serif;
    `;

    this._render(panel, burgId);
    document.body.appendChild(panel);
  },

  _render(panel, burgId) {
    const burg = pack?.burgs?.[burgId];
    if (!burg) return;
    const city = GameState.cityEconomy[burgId] || {};
    const treasury = GameState.getTreasury(GameState.playerStateId);
    const queue = city.production_queue || [];
    const damage = city.damage_level || 0;
    const damagePct = Math.round(damage * 100);
    const incomeReduced = city.income_per_tick
      ? Math.round(city.income_per_tick * (1 - damage * 0.9)) : 0;

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <span style="font-size:16px;color:#d4a843;font-weight:bold;">${burg.name}</span>
        <button id="ubClose" style="background:none;border:none;color:#556;font-size:20px;cursor:pointer;line-height:1;">&#x2715;</button>
      </div>
      <div style="display:flex;gap:18px;font-size:11px;color:#8aabcc;margin-bottom:14px;">
        <span>Treasury: <strong style="color:#f0d080">${Math.floor(treasury)}g</strong></span>
        <span>Income: <strong style="color:${damage > 0.3 ? "#f08060" : "#80d080"}">${incomeReduced}/tick</strong></span>
        <span>Damage: <strong style="color:${damage > 0.5 ? "#f06060" : "#888"}">${damagePct}%</strong></span>
      </div>
      ${queue.length ? `<div style="font-size:10px;color:#6a9ab8;margin-bottom:10px;padding:5px 8px;background:rgba(255,255,255,0.04);border-radius:5px;">
        Building: ${queue.map(q => `${UNIT_LABELS[q.type] || q.type} (${q.ticksLeft} ticks)`).join(" &bull; ")}
      </div>` : ""}
      <div style="font-size:11px;color:#6a9ab8;margin-bottom:8px;">Choose unit to build:</div>
      <div id="ubGrid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;"></div>
    `;

    panel.querySelector("#ubClose").onclick = () => panel.remove();

    const grid = panel.querySelector("#ubGrid");
    const allTypes = ["infantry","tank","fighter","helicopter","antiair","missile","destroyer","battleship"];

    for (const type of allTypes) {
      const spec = UNIT_COSTS[type];
      const def = UNIT_DEFS[type];
      if (!spec || !def) continue;
      if ((type === "destroyer" || type === "battleship") && !burg.port) continue;

      const canAfford = treasury >= spec.cost;
      const btn = document.createElement("button");
      btn.style.cssText = `
        background:${canAfford ? "#111e2e" : "#111"};
        color:${canAfford ? "#c8d8e8" : "#444"};
        border:1px solid ${canAfford ? "#2a5a7a" : "#222"};
        border-radius:8px; padding:9px 4px; cursor:${canAfford ? "pointer" : "not-allowed"};
        font-size:10px; display:flex; flex-direction:column; align-items:center; gap:4px;
        transition:background 0.13s; min-height:72px;
      `;
      // Mini SVG icon
      const iconSvg = this._miniIcon(type, def.color);
      btn.innerHTML = `
        <svg width="28" height="20" viewBox="-14 -10 28 20" style="overflow:visible;">${iconSvg}</svg>
        <span style="text-transform:capitalize;font-size:9px;">${UNIT_LABELS[type]}</span>
        <span style="color:#d4a843;font-size:10px;">${spec.cost}g</span>
        <span style="color:#445;font-size:9px;">${spec.buildTicks} ticks</span>
      `;

      if (canAfford) {
        btn.onmouseenter = () => btn.style.background = "#1a2f44";
        btn.onmouseleave = () => btn.style.background = "#111e2e";
        btn.onclick = async () => {
          const result = await Economy.queueUnit(burgId, type);
          if (result.ok) {
            if (window.GameHUD) GameHUD.notify(`Building ${UNIT_LABELS[type]} in ${burg.name}...`, "info");
            // Refresh panel
            this._render(panel, burgId);
          } else {
            if (window.GameHUD) GameHUD.notify(result.reason || "Cannot build", "warning");
          }
        };
      }
      grid.appendChild(btn);
    }
  },

  // Mini SVG path per unit (inline in build panel buttons)
  _miniIcon(type, color) {
    const c = color || "#5588aa";
    const w = "#ddeeff";
    switch (type) {
      case "infantry":
        return `<rect x="-5" y="-4" width="10" height="8" fill="${c}" stroke="${w}" stroke-width="0.8" rx="0.5"/>
                <line x1="-4" y1="-3" x2="4" y2="3" stroke="${w}" stroke-width="0.8"/>
                <line x1="4" y1="-3" x2="-4" y2="3" stroke="${w}" stroke-width="0.8"/>`;
      case "tank":
        return `<rect x="-7" y="-3" width="14" height="6" fill="${c}" stroke="${w}" stroke-width="0.7" rx="1"/>
                <rect x="-7" y="-5" width="14" height="2" fill="#333" stroke="${w}" stroke-width="0.4"/>
                <rect x="-7" y="3" width="14" height="2" fill="#333" stroke="${w}" stroke-width="0.4"/>
                <circle cx="0" cy="0" r="2.5" fill="${c}" stroke="${w}" stroke-width="0.7"/>
                <line x1="0" y1="0" x2="8" y2="0" stroke="${w}" stroke-width="1.2"/>`;
      case "fighter":
        return `<ellipse cx="0" cy="0" rx="8" ry="1.6" fill="${c}" stroke="${w}" stroke-width="0.7"/>
                <polygon points="0,-1 5,0 0,1 -2,0" fill="${c}" stroke="${w}" stroke-width="0.5"/>
                <polygon points="0,-1 -5,0 0,1 2,0" fill="${c}" stroke="${w}" stroke-width="0.5"/>
                <polygon points="-8,-1 -6,0 -8,1" fill="${c}" stroke="${w}" stroke-width="0.4"/>`;
      case "helicopter":
        return `<ellipse cx="0" cy="0" rx="5" ry="2.5" fill="${c}" stroke="${w}" stroke-width="0.7"/>
                <line x1="-8" y1="-3" x2="8" y2="-3" stroke="${w}" stroke-width="1.2"/>
                <line x1="-5" y1="0" x2="-10" y2="0" stroke="${w}" stroke-width="0.8"/>
                <line x1="-10" y1="-2" x2="-10" y2="2" stroke="${w}" stroke-width="0.8"/>`;
      case "antiair":
        return `<rect x="-4" y="0" width="8" height="4" fill="${c}" stroke="${w}" stroke-width="0.7" rx="0.5"/>
                <line x1="0" y1="0" x2="0" y2="-5" stroke="${w}" stroke-width="1"/>
                <ellipse cx="0" cy="-5" rx="4" ry="2" fill="none" stroke="${w}" stroke-width="0.8"/>`;
      case "missile":
        return `<ellipse cx="0" cy="0" rx="7" ry="1.3" fill="#cc2200" stroke="#ff6600" stroke-width="0.6"/>
                <polygon points="7,0 5,-1.5 5,1.5" fill="#ff4400"/>
                <polygon points="-7,0 -5,-3 -4,0" fill="#882200"/>
                <polygon points="-7,0 -5,3 -4,0" fill="#882200"/>
                <line x1="-7" y1="0" x2="-11" y2="0" stroke="#ff8800" stroke-width="1.2" opacity="0.7"/>`;
      case "destroyer":
        return `<ellipse cx="0" cy="0" rx="9" ry="2.5" fill="${c}" stroke="${w}" stroke-width="0.7"/>
                <polygon points="9,0 7,-2 7,2" fill="${c}" stroke="${w}" stroke-width="0.4"/>
                <rect x="0" y="-2" width="4" height="2" fill="#223355" stroke="${w}" stroke-width="0.4"/>
                <line x1="2" y1="-1" x2="8" y2="-1" stroke="${w}" stroke-width="1"/>`;
      case "battleship":
        return `<ellipse cx="0" cy="0" rx="12" ry="3.5" fill="${c}" stroke="${w}" stroke-width="0.8"/>
                <rect x="-3" y="-3" width="6" height="3" fill="#152030" stroke="${w}" stroke-width="0.4"/>
                <line x1="4" y1="-1" x2="12" y2="-1" stroke="${w}" stroke-width="1.2"/>
                <line x1="4" y1="1" x2="12" y2="1" stroke="${w}" stroke-width="1.2"/>
                <line x1="-4" y1="-1" x2="-12" y2="-1" stroke="${w}" stroke-width="1"/>`;
      default:
        return `<circle cx="0" cy="0" r="6" fill="${c}" stroke="${w}" stroke-width="0.8"/>`;
    }
  },

  close() {
    const p = document.getElementById("unitBuilderPanel");
    if (p) p.remove();
    this.currentBurgId = null;
  }
};

window.UnitBuilder = UnitBuilder;
window.UNIT_COSTS = UNIT_COSTS;
