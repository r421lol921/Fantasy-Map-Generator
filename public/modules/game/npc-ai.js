"use strict";
// npc-ai.js — NPC AI: declare war, build units, march on player cities, counterattack

const NpcAI = {
  DECISION_INTERVAL: 3,       // every N ticks an NPC acts
  WAR_WEALTH_THRESHOLD: 500,  // lower threshold → more wars
  PEACE_HP_THRESHOLD: 0.30,
  PEACE_TREASURY_THRESHOLD: 80,
  MAX_UNITS_PER_STATE: 16,
  MIN_ATTACK_FORCE: 3,        // must have at least this many units before launching attack

  async processTick() {
    if (!GameState.sessionId) return;
    if (GameState.tick % this.DECISION_INTERVAL !== 0) return;

    const playerState = GameState.playerStateId;
    const states = pack?.states?.filter(s => s && s.i && !s.removed && s.i !== playerState) || [];

    for (const npcState of states) {
      await this._decideForState(npcState, playerState);
    }
  },

  async _decideForState(npc, playerStateId) {
    const sid = npc.i;
    const treasury = GameState.getTreasury(sid);
    const myUnits = Object.values(GameState.units).filter(
      u => u.state_id === sid && u.session_id === GameState.sessionId
    );
    const relation = GameState.getRelation(sid, playerStateId);

    // ── Declare war ─────────────────────────────────────────────────────────
    if (relation === "Neutral" && treasury > this.WAR_WEALTH_THRESHOLD) {
      // Higher chance at higher wealth
      const chance = Math.min(0.08, 0.02 + (treasury - this.WAR_WEALTH_THRESHOLD) / 20000);
      if (Math.random() < chance) {
        await GameState.setRelation(sid, playerStateId, "War");
        const name = npc.fullName || npc.name || `State ${sid}`;
        if (window.GameHUD) GameHUD.notify(`${name} has declared war on you!`, "danger");
      }
    }

    // ── Peace offer when weakened ────────────────────────────────────────────
    if (relation === "War") {
      const avgHp = myUnits.length
        ? myUnits.reduce((s, u) => s + u.hp / (UNIT_DEFS[u.unit_type]?.hp || 100), 0) / myUnits.length
        : 1;
      if ((avgHp < this.PEACE_HP_THRESHOLD || treasury < this.PEACE_TREASURY_THRESHOLD) && Math.random() < 0.15) {
        if (window.PeaceTreaty) PeaceTreaty.receiveOffer(sid, playerStateId);
        return;
      }
    }

    if (relation !== "War") return;

    // ── Build units aggressively ─────────────────────────────────────────────
    if (myUnits.length < this.MAX_UNITS_PER_STATE) {
      const myBurgs = (pack?.burgs || []).filter(b => b && b.i && !b.removed && b.state === sid);
      if (myBurgs.length && Math.random() < 0.45) {
        // Prefer cities with no/small queue
        const burg = myBurgs[Math.floor(Math.random() * myBurgs.length)];
        const cityEcon = GameState.cityEconomy[burg.i];
        if (cityEcon && (cityEcon.production_queue || []).length < 3) {
          let unitType = "infantry";
          if (treasury > 400)  unitType = Math.random() < 0.5 ? "tank" : "infantry";
          if (treasury > 700)  unitType = ["tank","fighter","helicopter","antiair"][Math.floor(Math.random()*4)];
          if (treasury > 900)  unitType = ["tank","fighter","missile","helicopter"][Math.floor(Math.random()*4)];
          if (burg.port && treasury > 600 && Math.random() < 0.25) unitType = Math.random() < 0.5 ? "destroyer" : "battleship";
          if (window.Economy) await Economy.queueUnit(burg.i, unitType);
        }
      }
    }

    // ── Offensive: all idle units march toward player ────────────────────────
    const playerBurgs = (pack?.burgs || []).filter(b => b && b.i && !b.removed && b.state === playerStateId);
    if (!playerBurgs.length) return;

    const idleUnits = myUnits.filter(u => u.status === "idle");

    for (const unit of idleUnits) {
      // Choose nearest player city as target
      let nearestBurg = null, nearestDist = Infinity;
      for (const pb of playerBurgs) {
        const d = Math.sqrt((pb.x - unit.x)**2 + (pb.y - unit.y)**2);
        if (d < nearestDist) { nearestDist = d; nearestBurg = pb; }
      }
      if (!nearestBurg) continue;

      // Small jitter so stacks don't pile perfectly
      const jx = (Math.random() - 0.5) * 12;
      const jy = (Math.random() - 0.5) * 12;

      // Missiles should launch toward player burg
      if (unit.unit_type === "missile" && nearestDist < 80) {
        if (window.UnitSystem) await UnitSystem.orderMove(unit.id, nearestBurg.x + jx, nearestBurg.y + jy);
        continue;
      }

      if (window.UnitSystem) await UnitSystem.orderMove(unit.id, nearestBurg.x + jx, nearestBurg.y + jy);

      // Naval: bombard from range when close
      if ((unit.unit_type === "battleship" || unit.unit_type === "destroyer") && nearestDist < 45) {
        if (window.Economy) await Economy.damageCity(nearestBurg.i, 0.06);
        if (window.Effects) Effects.spawnProjectile(unit.x, unit.y, nearestBurg.x, nearestBurg.y, "#ff8800");
        if (window.GameHUD) GameHUD.notify(`${npc.name} navy bombards ${nearestBurg.name}!`, "warning");
      }
    }

    // ── Counterattack: units near player cities chase nearby player units ────
    const playerUnits = Object.values(GameState.units).filter(u => u.state_id === playerStateId);
    for (const u of myUnits) {
      if (u.status !== "idle") continue;
      // Find nearby player unit within engagement range
      const nearby = playerUnits.find(pu =>
        Math.sqrt((pu.x - u.x)**2 + (pu.y - u.y)**2) < 22
      );
      if (nearby && window.UnitSystem) {
        await UnitSystem.orderMove(u.id, nearby.x + (Math.random()-0.5)*5, nearby.y + (Math.random()-0.5)*5);
      }
    }

    // ── City bombardment by any unit in range ────────────────────────────────
    for (const u of myUnits) {
      if (u.unit_type === "fighter" || u.unit_type === "helicopter") {
        const def = UNIT_DEFS[u.unit_type];
        for (const pb of playerBurgs) {
          const d = Math.sqrt((pb.x - u.x)**2 + (pb.y - u.y)**2);
          if (d < def.range) {
            if (window.Economy) await Economy.damageCity(pb.i, 0.04);
            if (window.Effects) Effects.spawnProjectile(u.x, u.y, pb.x, pb.y, "#ff4400");
            if (window.GameHUD && Math.random() < 0.15)
              GameHUD.notify(`${npc.name} air strike hits ${pb.name}!`, "warning");
            break;
          }
        }
      }
    }
  }
};

window.NpcAI = NpcAI;
