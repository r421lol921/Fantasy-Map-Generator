"use strict";
// unit-builder.js — Panel that appears when player clicks a city they own

const UnitBuilder = {
  currentBurgId: null,

  open(burgId) {
    const burg = pack?.burgs?.[burgId];
    if (!burg) return;

    // Only open for player's own cities
    if (burg.state !== GameState.playerStateId) return;

    this.currentBurgId = burgId;
    const city = GameState.cityEconomy[burgId] || {};
    const treasury = GameState.getTreasury(GameState.playerStateId);
    const queue = city.production_queue || [];
    const damage = city.damage_level || 0;

    const existing = document.getElementById("unitBuilderPanel");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "unitBuilderPanel";
    panel.style.cssText = `
      position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
      background:#0d1b2a; color:#c8d8e8; border:1px solid #2a4a6a;
      border-radius:10px; padding:16px 20px; z-index:9999; min-width:360px;
      max-width:520px; box-shadow:0 6px 24px rgba(0,0,0,0.8); font-family:Georgia,serif;
    `;

    const damagePct = Math.round(damage * 100);
    const incomeReduced = city.income_per_tick ? Math.round(city.income_per_tick * (1 - damage * 0.9)) : 0;

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <span style="font-size:15px;color:#d4a843;font-weight:bold;">${burg.name}</span>
        <button id="unitBuilderClose" style="background:none;border:none;color:#888;font-size:18px;cursor:pointer;">✕</button>
      </div>
      <div style="font-size:11px;color:#8aabcc;margin-bottom:12px;display:flex;gap:16px;">
        <span>Treasury: <strong style="color:#f0d080">${Math.floor(treasury)}</strong></span>
        <span>Income/tick: <strong style="color:${damage > 0.3 ? '#f08060' : '#80d080'}">${incomeReduced}</strong></span>
        <span>Damage: <strong style="color:${damage > 0.5 ? '#f06060' : '#aaaaaa'}">${damagePct}%</strong></span>
      </div>
      ${queue.length ? `
        <div style="font-size:11px;color:#aaa;margin-bottom:10px;">
          Queue: ${queue.map(q => `${q.type} (${q.ticksLeft} ticks)`).join(', ')}
        </div>` : ''}
      <div style="font-size:12px;color:#7ab;margin-bottom:8px;">Build Unit:</div>
      <div id="unitBuilderGrid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;"></div>
    `;

    document.body.appendChild(panel);
    document.getElementById("unitBuilderClose").onclick = () => panel.remove();

    // Populate unit buttons
    const grid = document.getElementById("unitBuilderGrid");
    const unitTypes = ["infantry", "tank", "fighter", "helicopter", "antiair", "destroyer", "battleship"];

    for (const type of unitTypes) {
      const spec = UNIT_COSTS[type];
      const def = UNIT_DEFS[type];
      if (!spec || !def) continue;

      // Only show destroyer/battleship for port cities
      if ((type === "destroyer" || type === "battleship") && !burg.port) continue;

      const canAfford = treasury >= spec.cost;
      const btn = document.createElement("button");
      btn.style.cssText = `
        background:${canAfford ? '#152535' : '#1a1a1a'}; color:${canAfford ? '#c8d8e8' : '#555'};
        border:1px solid ${canAfford ? '#2a5a7a' : '#333'}; border-radius:6px;
        padding:8px 4px; cursor:${canAfford ? 'pointer' : 'not-allowed'}; font-size:11px;
        display:flex; flex-direction:column; align-items:center; gap:3px;
        transition: background 0.15s;
      `;
      btn.innerHTML = `
        <span style="font-size:18px;">${this._unitEmoji(type)}</span>
        <span style="font-size:10px;text-transform:capitalize;">${type}</span>
        <span style="color:#d4a843;font-size:10px;">${spec.cost}g</span>
        <span style="color:#666;font-size:9px;">${spec.buildTicks}t</span>
      `;
      if (canAfford) {
        btn.onmouseenter = () => btn.style.background = "#1e3a50";
        btn.onmouseleave = () => btn.style.background = "#152535";
        btn.onclick = async () => {
          const result = await Economy.queueUnit(burgId, type);
          if (result.ok) {
            if (window.GameHUD) GameHUD.notify(`Building ${type} in ${burg.name}...`, "info");
            this.open(burgId); // refresh panel
          } else {
            if (window.GameHUD) GameHUD.notify(result.reason, "warning");
          }
        };
      }
      grid.appendChild(btn);
    }
  },

  _unitEmoji(type) {
    const map = {infantry: "🪖", tank: "🚜", fighter: "✈️", helicopter: "🚁", antiair: "🎯", destroyer: "🛥️", battleship: "⚓"};
    return map[type] || "?";
  },

  close() {
    const p = document.getElementById("unitBuilderPanel");
    if (p) p.remove();
    this.currentBurgId = null;
  }
};

window.UnitBuilder = UnitBuilder;
