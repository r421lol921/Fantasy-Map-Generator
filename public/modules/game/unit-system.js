"use strict";
// unit-system.js — Spawn, move, fuel, combat, rendering of all military units

// Unit definitions: speed (px/tick), range (px), damage, fuelCost/tick, maxFuel
const UNIT_DEFS = {
  infantry:   {speed: 1.2,  range: 8,   damage: 15, fuelCost: 0,    maxFuel: 999, land: true,  sea: false, air: false, icon: "🪖", color: "#4a7c42", hp: 80},
  tank:       {speed: 2.2,  range: 10,  damage: 40, fuelCost: 2,    maxFuel: 100, land: true,  sea: false, air: false, icon: "🚜", color: "#8b7355", hp: 120},
  fighter:    {speed: 8.0,  range: 35,  damage: 55, fuelCost: 5,    maxFuel: 100, land: false, sea: false, air: true,  icon: "✈", color: "#3399cc", hp: 70},
  helicopter: {speed: 5.0,  range: 20,  damage: 45, fuelCost: 4,    maxFuel: 100, land: false, sea: false, air: true,  icon: "🚁", color: "#669966", hp: 80},
  antiair:    {speed: 1.8,  range: 30,  damage: 60, fuelCost: 0.5,  maxFuel: 100, land: true,  sea: false, air: false, icon: "⊕", color: "#cc4444", hp: 60},
  destroyer:  {speed: 3.5,  range: 25,  damage: 50, fuelCost: 3,    maxFuel: 100, land: false, sea: true,  air: false, icon: "⛵", color: "#336699", hp: 100},
  battleship: {speed: 2.5,  range: 40,  damage: 80, fuelCost: 4,    maxFuel: 100, land: false, sea: true,  air: false, icon: "⚓", color: "#1a3355", hp: 180}
};

const UnitSystem = {
  layer: null,      // SVG group for all unit icons
  selected: null,   // currently selected unit id

  init() {
    if (this.layer) return;
    this.layer = d3.select("#viewbox").append("g")
      .attr("id", "gameUnits")
      .attr("pointer-events", "all")
      .style("font-family", "serif");
    this.render();
  },

  // ── Spawn a unit into the DB ──────────────────────────────────────────────
  async spawnUnit(stateId, unitType, x, y, homeBurgId = null) {
    const def = UNIT_DEFS[unitType];
    if (!def) return null;
    const sb = this._getClient();
    if (!sb) return null;

    const {data, error} = await sb.from("game_units").insert({
      session_id: GameState.sessionId,
      state_id: stateId,
      unit_type: unitType,
      x, y,
      hp: def.hp,
      max_hp: def.hp,
      fuel: def.maxFuel,
      status: "idle",
      home_burg_id: homeBurgId
    }).select().single();

    if (error) {console.error("[UnitSystem] spawnUnit:", error); return null;}
    GameState.units[data.id] = data;
    this.render();
    return data;
  },

  // ── Move order: set target, unit moves toward it each tick ───────────────
  async orderMove(unitId, tx, ty) {
    const unit = GameState.units[unitId];
    if (!unit) return;
    const sb = this._getClient();
    if (!sb) return;
    await sb.from("game_units").update({target_x: tx, target_y: ty, status: "moving"}).eq("id", unitId);
    GameState.units[unitId].target_x = tx;
    GameState.units[unitId].target_y = ty;
    GameState.units[unitId].status = "moving";
    this.render();
  },

  // ── Per-tick processing: movement, fuel, refuelling, combat resolution ────
  async processTick() {
    const sb = this._getClient();
    if (!sb) return;
    const updates = [];
    const destroyIds = [];

    for (const [id, unit] of Object.entries(GameState.units)) {
      if (unit.session_id !== GameState.sessionId) continue;
      const def = UNIT_DEFS[unit.unit_type] || {};
      let {x, y, target_x, target_y, status, fuel, hp} = unit;
      let changed = false;

      // ── Refuel check ──
      const nearBurg = this._nearestOwnBurg(unit.state_id, x, y, 15);
      const isRefuelling = nearBurg && def.fuelCost > 0;

      if (isRefuelling && fuel < def.maxFuel) {
        fuel = Math.min(def.maxFuel, fuel + 8);
        changed = true;
        if (status === "stranded") { status = "idle"; changed = true; }
      } else if (def.fuelCost > 0) {
        // Consume fuel only while moving
        if (status === "moving") {
          fuel = Math.max(0, fuel - def.fuelCost);
          changed = true;
        }
        if (fuel <= 0 && status !== "stranded") {
          status = "stranded";
          target_x = null;
          target_y = null;
          changed = true;
        }
      }

      // ── Movement ──
      if (status === "moving" && target_x != null && target_y != null) {
        const dx = target_x - x;
        const dy = target_y - y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < def.speed) {
          x = target_x; y = target_y;
          status = "idle"; target_x = null; target_y = null;
        } else {
          x += (dx / dist) * def.speed;
          y += (dy / dist) * def.speed;
        }
        changed = true;
      }

      // ── Combat: check for enemies in range ────────────────────────────────
      if (status !== "stranded") {
        for (const [eid, enemy] of Object.entries(GameState.units)) {
          if (eid === id) continue;
          if (enemy.state_id === unit.state_id) continue;
          if (GameState.getRelation(unit.state_id, enemy.state_id) !== "War") continue;

          const ex = enemy.x, ey = enemy.y;
          const dist = Math.sqrt((ex-x)**2 + (ey-y)**2);
          if (dist > def.range) continue;

          // Anti-air targets aircraft only
          if (unit.unit_type === "antiair") {
            const eDef = UNIT_DEFS[enemy.unit_type];
            if (!eDef?.air) continue;
          }

          // Fire!
          if (window.Effects) {
            Effects.spawnProjectile(x, y, ex, ey, unit.unit_type === "fighter" ? "#00ccff" : "#ff4400");
          }
          const dmg = def.damage;
          const newEHp = Math.max(0, enemy.hp - dmg);

          // Log combat event
          sb.from("combat_events").insert({
            session_id: GameState.sessionId,
            attacker_unit_id: id,
            defender_unit_id: eid,
            attacker_state: unit.state_id,
            defender_state: enemy.state_id,
            damage: dmg,
            x: ex, y: ey,
            event_type: "attack"
          }).then(() => {});

          if (newEHp <= 0) {
            // Unit destroyed
            destroyIds.push(eid);
            if (window.Effects) Effects.spawnWreckage(ex, ey, enemy.unit_type);
            if (window.Effects) Effects.spawnExplosion(ex, ey, enemy.unit_type === "battleship");
          } else {
            updates.push({id: eid, hp: newEHp});
            GameState.units[eid].hp = newEHp;
          }
          break; // one target per tick
        }

        // Naval bombardment of enemy cities in range
        if (unit.unit_type === "battleship" || unit.unit_type === "destroyer") {
          for (const [burgId, city] of Object.entries(GameState.cityEconomy)) {
            if (city.state_id === unit.state_id) continue;
            if (GameState.getRelation(unit.state_id, city.state_id) !== "War") continue;
            const burg = pack?.burgs?.[+burgId];
            if (!burg) continue;
            const dist = Math.sqrt((burg.x-x)**2 + (burg.y-y)**2);
            if (dist > def.range) continue;
            if (window.Economy) await Economy.damageCity(+burgId, 0.08);
            if (window.Effects) Effects.spawnProjectile(x, y, burg.x, burg.y, "#ff8800");
            break;
          }
        }
      }

      if (changed) {
        updates.push({id, x, y, target_x, target_y, status, fuel, hp});
        GameState.units[id] = {...unit, x, y, target_x, target_y, status, fuel, hp};
      }
    }

    // Batch writes
    for (const upd of updates) {
      const {id, ...fields} = upd;
      sb.from("game_units").update(fields).eq("id", id).then(() => {});
    }
    for (const deadId of destroyIds) {
      await sb.from("game_units").delete().eq("id", deadId);
      delete GameState.units[deadId];
    }

    this.render();
  },

  // ── Render all units as SVG text icons ────────────────────────────────────
  render() {
    if (!this.layer) return;
    this.layer.selectAll("g.unit-icon").remove();

    for (const [id, unit] of Object.entries(GameState.units)) {
      if (unit.session_id !== GameState.sessionId) continue;
      const def = UNIT_DEFS[unit.unit_type] || {};
      const isPlayer = unit.state_id === GameState.playerStateId;
      const isSelected = id === this.selected;
      const hpPct = unit.hp / (def.hp || 100);

      const g = this.layer.append("g")
        .attr("class", "unit-icon")
        .attr("transform", `translate(${unit.x},${unit.y})`)
        .attr("cursor", isPlayer ? "pointer" : "default")
        .attr("data-unit-id", id);

      // Selection ring
      if (isSelected) {
        g.append("circle").attr("r", 8).attr("fill", "none")
          .attr("stroke", "#ffff00").attr("stroke-width", 1.5).attr("opacity", 0.9);
      }

      // Stranded indicator
      if (unit.status === "stranded") {
        g.append("circle").attr("r", 7).attr("fill", "#cc0000").attr("opacity", 0.4);
      }

      // HP bar background
      g.append("rect")
        .attr("x", -5).attr("y", -11).attr("width", 10).attr("height", 2)
        .attr("fill", "#333").attr("rx", 1);
      // HP bar fill
      g.append("rect")
        .attr("x", -5).attr("y", -11).attr("width", 10 * hpPct).attr("height", 2)
        .attr("fill", hpPct > 0.5 ? "#33cc33" : hpPct > 0.25 ? "#ffcc00" : "#cc2200")
        .attr("rx", 1);

      // Unit icon text
      g.append("text")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("font-size", "7px")
        .attr("fill", isPlayer ? "#ffffff" : "#ffaaaa")
        .attr("stroke", def.color || "#333")
        .attr("stroke-width", "0.3px")
        .text(this._unitChar(unit.unit_type));

      // State color dot below icon
      const stateColor = pack?.states?.[unit.state_id]?.color || def.color || "#888";
      g.append("circle")
        .attr("cy", 6).attr("r", 2.5)
        .attr("fill", stateColor)
        .attr("opacity", 0.85);

      // Click to select (player units only)
      if (isPlayer) {
        g.on("click", () => this._selectUnit(id));
      }
    }
  },

  _unitChar(type) {
    const chars = {infantry: "I", tank: "T", fighter: "F", helicopter: "H", antiair: "A", destroyer: "D", battleship: "B"};
    return chars[type] || "?";
  },

  _selectUnit(id) {
    this.selected = this.selected === id ? null : id;
    this.render();
    if (window.GameHUD) GameHUD.showUnitInfo(GameState.units[id]);
    // Listen for next map click as move target
    if (this.selected) {
      d3.select("#map").on("click.unitMove", () => {
        const [mx, my] = d3.mouse(d3.select("#viewbox").node());
        this.orderMove(this.selected, mx, my);
        d3.select("#map").on("click.unitMove", null);
      });
    }
  },

  _nearestOwnBurg(stateId, x, y, maxDist) {
    if (!pack?.burgs) return null;
    let best = null, bestDist = maxDist + 1;
    for (const burg of pack.burgs) {
      if (!burg || !burg.i || burg.removed) continue;
      if (burg.state !== stateId) continue;
      const d = Math.sqrt((burg.x-x)**2 + (burg.y-y)**2);
      if (d < bestDist) { bestDist = d; best = burg; }
    }
    return best;
  },

  _getClient() {
    return window.getSb ? window.getSb() : null;
  }
};

window.UnitSystem = UnitSystem;
window.UNIT_DEFS = UNIT_DEFS;
