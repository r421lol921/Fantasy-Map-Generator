"use strict";
// npc-ai.js — NPC state AI: declare war, produce units, target player cities, offer peace

const NpcAI = {
  // How often (in ticks) each NPC takes a decision
  DECISION_INTERVAL: 3,

  // Aggression thresholds
  WAR_WEALTH_THRESHOLD: 800,     // treasury needed before attacking
  PEACE_HP_THRESHOLD: 0.35,      // sue for peace if avg unit HP < 35%
  PEACE_TREASURY_THRESHOLD: 100, // or if almost broke
  MAX_UNITS_PER_STATE: 12,

  async processTick() {
    if (!GameState.sessionId) return;
    if (GameState.tick % this.DECISION_INTERVAL !== 0) return;

    const playerState = GameState.playerStateId;
    const states = pack?.states?.filter(s => s && s.i && !s.removed && s.i !== playerState) || [];

    for (const npcState of states) {
      await this._decideForState(npcState, playerState);
    }
  },

  async _decideForState(npcState, playerStateId) {
    const sid = npcState.i;
    const treasury = GameState.getTreasury(sid);
    const myUnits = Object.values(GameState.units).filter(u => u.state_id === sid && u.session_id === GameState.sessionId);
    const myUnitCount = myUnits.length;

    // ── War declaration ────────────────────────────────────────────────────
    const relation = GameState.getRelation(sid, playerStateId);
    if (relation === "Neutral" && treasury > this.WAR_WEALTH_THRESHOLD && Math.random() < 0.04) {
      await GameState.setRelation(sid, playerStateId, "War");
      if (window.GameHUD) GameHUD.notify(`⚔ ${npcState.fullName || npcState.name} declared war on you!`, "danger");
    }

    // ── Peace offer ────────────────────────────────────────────────────────
    if (relation === "War") {
      const avgHp = myUnits.length
        ? myUnits.reduce((s, u) => s + u.hp / (UNIT_DEFS[u.unit_type]?.hp || 100), 0) / myUnits.length
        : 1;
      if (avgHp < this.PEACE_HP_THRESHOLD || treasury < this.PEACE_TREASURY_THRESHOLD) {
        if (Math.random() < 0.15) {
          if (window.PeaceTreaty) PeaceTreaty.receiveOffer(sid, playerStateId);
        }
      }
    }

    if (relation !== "War") return; // Only act aggressively if at war

    // ── Build units ────────────────────────────────────────────────────────
    if (myUnitCount < this.MAX_UNITS_PER_STATE) {
      const myBurgs = pack.burgs.filter(b => b && b.i && !b.removed && b.state === sid);
      if (myBurgs.length && Math.random() < 0.35) {
        const burg = myBurgs[Math.floor(Math.random() * myBurgs.length)];
        const cityEcon = GameState.cityEconomy[burg.i];
        if (cityEcon) {
          const queue = cityEcon.production_queue || [];
          if (queue.length < 2) {
            // Pick unit type based on treasury
            let unitType = "infantry";
            if (treasury > 600) unitType = Math.random() < 0.5 ? "tank" : "infantry";
            if (treasury > 900) unitType = ["tank", "fighter", "helicopter", "antiair"][Math.floor(Math.random()*4)];
            if (burg.port && treasury > 700) unitType = Math.random() < 0.3 ? "destroyer" : unitType;
            if (window.Economy) await Economy.queueUnit(burg.i, unitType);
          }
        }
      }
    }

    // ── Target player cities: move nearest unit toward nearest player city ─
    const playerBurgs = pack.burgs.filter(b => b && b.i && !b.removed && b.state === playerStateId);
    if (!playerBurgs.length) return;

    const idleUnits = myUnits.filter(u => u.status === "idle");
    for (const unit of idleUnits) {
      // Find nearest player burg
      let nearestBurg = null, nearestDist = Infinity;
      for (const pb of playerBurgs) {
        const d = Math.sqrt((pb.x - unit.x)**2 + (pb.y - unit.y)**2);
        if (d < nearestDist) { nearestDist = d; nearestBurg = pb; }
      }
      if (!nearestBurg) continue;

      // Add slight random offset so units don't stack perfectly
      const jx = (Math.random() - 0.5) * 10;
      const jy = (Math.random() - 0.5) * 10;
      if (window.UnitSystem) {
        await UnitSystem.orderMove(unit.id, nearestBurg.x + jx, nearestBurg.y + jy);
      }

      // Bombard nearby player city if in range (battleship/destroyer)
      if ((unit.unit_type === "battleship" || unit.unit_type === "destroyer") && nearestDist < 40) {
        if (window.Economy) await Economy.damageCity(nearestBurg.i, 0.05);
        if (window.GameHUD) GameHUD.notify(`${npcState.name} navy is bombarding ${nearestBurg.name}!`, "warning");
      }
    }

    // ── NPC also counterattacks near player cities ─────────────────────────
    const nearPlayerCityUnits = myUnits.filter(u => {
      const nearest = playerBurgs.reduce((best, pb) => {
        const d = Math.sqrt((pb.x - u.x)**2 + (pb.y - u.y)**2);
        return d < best.d ? {d, burg: pb} : best;
      }, {d: Infinity, burg: null});
      return nearest.d < 15;
    });

    for (const u of nearPlayerCityUnits) {
      const nearestPlayerUnit = Object.values(GameState.units).find(pu =>
        pu.state_id === playerStateId &&
        Math.sqrt((pu.x - u.x)**2 + (pu.y - u.y)**2) < 18
      );
      if (nearestPlayerUnit && window.UnitSystem) {
        await UnitSystem.orderMove(u.id, nearestPlayerUnit.x, nearestPlayerUnit.y);
      }
    }
  }
};

window.NpcAI = NpcAI;
