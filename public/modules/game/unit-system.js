"use strict";
// unit-system.js — Spawn, move, fuel, combat, SVG rendering of all military units

// Unit definitions: speed (px/tick), range (px), damage, fuelCost/tick, maxFuel
const UNIT_DEFS = {
  infantry:   {speed: 1.2,  range: 8,   damage: 15, fuelCost: 0,   maxFuel: 999, land:true,  sea:false, air:false, color:"#4a9a42", hp:80},
  tank:       {speed: 2.2,  range: 10,  damage: 40, fuelCost: 2,   maxFuel: 100, land:true,  sea:false, air:false, color:"#8b7c45", hp:120},
  fighter:    {speed: 8.0,  range: 35,  damage: 55, fuelCost: 5,   maxFuel: 100, land:false, sea:false, air:true,  color:"#44aadd", hp:70},
  helicopter: {speed: 5.0,  range: 20,  damage: 45, fuelCost: 4,   maxFuel: 100, land:false, sea:false, air:true,  color:"#66aa55", hp:80},
  antiair:    {speed: 1.8,  range: 30,  damage: 60, fuelCost: 0.5, maxFuel: 100, land:true,  sea:false, air:false, color:"#cc4444", hp:60},
  destroyer:  {speed: 3.5,  range: 25,  damage: 50, fuelCost: 3,   maxFuel: 100, land:false, sea:true,  air:false, color:"#3366aa", hp:100},
  battleship: {speed: 2.5,  range: 40,  damage: 80, fuelCost: 4,   maxFuel: 100, land:false, sea:true,  air:false, color:"#1a3355", hp:180},
  missile:    {speed: 12.0, range: 60,  damage: 90, fuelCost: 12,  maxFuel: 100, land:false, sea:false, air:true,  color:"#ff4400", hp:30}
};

const UnitSystem = {
  layer: null,
  selected: null,
  _moveListening: false,

  init() {
    if (this.layer) return;
    this.layer = d3.select("#viewbox").append("g")
      .attr("id", "gameUnits")
      .attr("pointer-events", "all");
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

    if (error) { console.error("[UnitSystem] spawnUnit:", error); return null; }
    GameState.units[data.id] = data;
    this.render();
    return data;
  },

  // ── Move order ────────────────────────────────────────────────────────────
  async orderMove(unitId, tx, ty) {
    const unit = GameState.units[unitId];
    if (!unit) return;
    const sb = this._getClient();
    if (!sb) return;
    await sb.from("game_units").update({target_x: tx, target_y: ty, status: "moving"}).eq("id", unitId);
    GameState.units[unitId] = {...unit, target_x: tx, target_y: ty, status: "moving"};
    this.render();
  },

  // ── Per-tick: movement, fuel, refuel, combat ──────────────────────────────
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

      // Refuel near own burg
      const nearBurg = this._nearestOwnBurg(unit.state_id, x, y, 15);
      if (nearBurg && def.fuelCost > 0 && fuel < def.maxFuel) {
        fuel = Math.min(def.maxFuel, fuel + 8); changed = true;
        if (status === "stranded") { status = "idle"; changed = true; }
      } else if (def.fuelCost > 0 && status === "moving") {
        fuel = Math.max(0, fuel - def.fuelCost); changed = true;
        if (fuel <= 0 && status !== "stranded") {
          status = "stranded"; target_x = null; target_y = null; changed = true;
        }
      }

      // Move
      if (status === "moving" && target_x != null) {
        const dx = target_x - x, dy = target_y - y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < def.speed) {
          x = target_x; y = target_y; status = "idle"; target_x = null; target_y = null;
        } else {
          x += (dx / dist) * def.speed; y += (dy / dist) * def.speed;
        }
        changed = true;
      }

      // Combat vs enemy units
      if (status !== "stranded") {
        for (const [eid, enemy] of Object.entries(GameState.units)) {
          if (eid === id || enemy.state_id === unit.state_id) continue;
          if (GameState.getRelation(unit.state_id, enemy.state_id) !== "War") continue;
          const dist = Math.sqrt((enemy.x-x)**2 + (enemy.y-y)**2);
          if (dist > def.range) continue;
          if (unit.unit_type === "antiair" && !UNIT_DEFS[enemy.unit_type]?.air) continue;

          if (window.Effects) Effects.spawnProjectile(x, y, enemy.x, enemy.y,
            (unit.unit_type === "fighter" || unit.unit_type === "missile") ? "#00ccff" : "#ff4400");

          const newEHp = Math.max(0, enemy.hp - def.damage);
          sb.from("combat_events").insert({
            session_id: GameState.sessionId, attacker_unit_id: id,
            defender_unit_id: eid, attacker_state: unit.state_id,
            defender_state: enemy.state_id, damage: def.damage,
            x: enemy.x, y: enemy.y, event_type: "attack"
          }).then(() => {});

          if (newEHp <= 0) {
            destroyIds.push(eid);
            if (window.Effects) { Effects.spawnWreckage(enemy.x, enemy.y, enemy.unit_type); Effects.spawnExplosion(enemy.x, enemy.y, enemy.unit_type === "battleship"); }
          } else {
            updates.push({id: eid, hp: newEHp}); GameState.units[eid].hp = newEHp;
          }
          // Missiles die on impact
          if (unit.unit_type === "missile") { destroyIds.push(id); if (window.Effects) Effects.spawnExplosion(x, y, true); }
          break;
        }

        // Naval + missile bombardment of cities
        if (["battleship","destroyer","missile"].includes(unit.unit_type)) {
          for (const [burgId, city] of Object.entries(GameState.cityEconomy)) {
            if (city.state_id === unit.state_id) continue;
            if (GameState.getRelation(unit.state_id, city.state_id) !== "War") continue;
            const burg = pack?.burgs?.[+burgId];
            if (!burg) continue;
            const dist = Math.sqrt((burg.x-x)**2 + (burg.y-y)**2);
            if (dist > def.range) continue;
            if (window.Economy) await Economy.damageCity(+burgId, unit.unit_type === "missile" ? 0.18 : 0.08);
            if (window.Effects) { Effects.spawnProjectile(x, y, burg.x, burg.y, "#ff8800"); Effects.spawnExplosion(burg.x, burg.y, unit.unit_type === "missile"); }
            if (unit.unit_type === "missile") destroyIds.push(id);
            break;
          }
        }
      }

      if (changed) {
        updates.push({id, x, y, target_x, target_y, status, fuel, hp});
        GameState.units[id] = {...unit, x, y, target_x, target_y, status, fuel, hp};
      }
    }

    for (const upd of updates) {
      const {id, ...fields} = upd;
      sb.from("game_units").update(fields).eq("id", id).then(() => {});
    }
    for (const deadId of [...new Set(destroyIds)]) {
      await sb.from("game_units").delete().eq("id", deadId);
      delete GameState.units[deadId];
    }

    this.render();
  },

  // ── Render all units as proper SVG military icons ─────────────────────────
  render() {
    if (!this.layer) return;
    this.layer.selectAll("g.unit-g").remove();

    for (const [id, unit] of Object.entries(GameState.units)) {
      if (unit.session_id !== GameState.sessionId) continue;
      const def = UNIT_DEFS[unit.unit_type] || {};
      const isPlayer = unit.state_id === GameState.playerStateId;
      const isSelected = id === this.selected;
      const hpPct = unit.hp / (def.hp || 100);
      const stateColor = pack?.states?.[unit.state_id]?.color || def.color || "#888";
      const angle = this._movementAngle(unit);

      const g = this.layer.append("g")
        .attr("class", "unit-g")
        .attr("transform", `translate(${unit.x},${unit.y})`)
        .attr("cursor", isPlayer ? "pointer" : "default")
        .attr("data-unit-id", id);

      // Selection ring
      if (isSelected) {
        g.append("circle").attr("r", 10)
          .attr("fill", "none").attr("stroke", "#ffe066")
          .attr("stroke-width", 1.5).attr("opacity", 0.95)
          .attr("stroke-dasharray", "3,2");
      }

      // Stranded flash
      if (unit.status === "stranded") {
        g.append("circle").attr("r", 8).attr("fill", "#cc0000").attr("opacity", 0.35);
      }

      // Draw the unit-type SVG shape
      this._drawUnitShape(g, unit.unit_type, stateColor, isPlayer, angle);

      // HP bar
      g.append("rect").attr("x",-6).attr("y",-13).attr("width",12).attr("height",2)
        .attr("fill","#1a1a1a").attr("rx",1);
      g.append("rect").attr("x",-6).attr("y",-13).attr("width", 12 * hpPct).attr("height",2)
        .attr("fill", hpPct > 0.5 ? "#33dd33" : hpPct > 0.25 ? "#ffcc00" : "#dd2200").attr("rx",1);

      // Click to select (player) or just highlight (enemy)
      if (isPlayer) {
        g.on("click", (event) => {
          if (event) event.stopPropagation();
          this._selectUnit(id);
        });
      } else {
        g.on("click", (event) => {
          if (event) event.stopPropagation();
          const u = GameState.units[id];
          if (window.GameHUD) GameHUD.showUnitInfo(u, false);
        });
      }
    }

    // Move target line for selected unit
    if (this.selected && GameState.units[this.selected]) {
      const u = GameState.units[this.selected];
      if (u.target_x != null && u.target_y != null) {
        this.layer.append("line")
          .attr("class","unit-g")
          .attr("x1", u.x).attr("y1", u.y)
          .attr("x2", u.target_x).attr("y2", u.target_y)
          .attr("stroke","#ffe066").attr("stroke-width","0.7")
          .attr("stroke-dasharray","3,2").attr("opacity",0.7)
          .attr("pointer-events","none");
      }
    }
  },

  // ── Draw proper military-style SVG for each unit type ─────────────────────
  _drawUnitShape(g, type, color, isPlayer, angleDeg) {
    const outline = isPlayer ? "#ffffff" : "#ffaaaa";
    const fill = color;

    switch (type) {
      case "infantry": {
        // NATO infantry box with X
        g.append("rect").attr("x",-5).attr("y",-4).attr("width",10).attr("height",8)
          .attr("fill",fill).attr("stroke",outline).attr("stroke-width",0.8).attr("rx",0.5);
        g.append("line").attr("x1",-4).attr("y1",-3).attr("x2",4).attr("y2",3)
          .attr("stroke",outline).attr("stroke-width",0.8);
        g.append("line").attr("x1",4).attr("y1",-3).attr("x2",-4).attr("y2",3)
          .attr("stroke",outline).attr("stroke-width",0.8);
        break;
      }
      case "tank": {
        // Body + turret + barrel
        const rot = g.append("g").attr("transform",`rotate(${angleDeg})`);
        // Body
        rot.append("rect").attr("x",-6).attr("y",-3).attr("width",12).attr("height",6)
          .attr("fill",fill).attr("stroke",outline).attr("stroke-width",0.7).attr("rx",1);
        // Tracks
        rot.append("rect").attr("x",-6).attr("y",-5).attr("width",12).attr("height",2)
          .attr("fill","#333").attr("stroke",outline).attr("stroke-width",0.5).attr("rx",0.5);
        rot.append("rect").attr("x",-6).attr("y",3).attr("width",12).attr("height",2)
          .attr("fill","#333").attr("stroke",outline).attr("stroke-width",0.5).attr("rx",0.5);
        // Turret
        rot.append("circle").attr("cx",0).attr("cy",0).attr("r",2.5)
          .attr("fill",fill).attr("stroke",outline).attr("stroke-width",0.7);
        // Barrel
        rot.append("line").attr("x1",0).attr("y1",0).attr("x2",7).attr("y2",0)
          .attr("stroke",outline).attr("stroke-width",1.2);
        break;
      }
      case "fighter": {
        // Airplane silhouette pointing in direction of movement
        const rot = g.append("g").attr("transform",`rotate(${angleDeg})`);
        // Fuselage
        rot.append("ellipse").attr("cx",0).attr("cy",0).attr("rx",7).attr("ry",1.5)
          .attr("fill",fill).attr("stroke",outline).attr("stroke-width",0.7);
        // Wings
        rot.append("polygon").attr("points","0,-1 4,0 0,1 -2,0")
          .attr("fill",fill).attr("stroke",outline).attr("stroke-width",0.6);
        rot.append("polygon").attr("points","0,-1 -4,0 0,1 2,0")
          .attr("fill",fill).attr("stroke",outline).attr("stroke-width",0.6);
        // Tail fins
        rot.append("polygon").attr("points","-7,-1 -5,0 -7,1")
          .attr("fill",fill).attr("stroke",outline).attr("stroke-width",0.5);
        break;
      }
      case "helicopter": {
        // Helicopter: body + rotors
        const rot = g.append("g").attr("transform",`rotate(${angleDeg})`);
        // Body
        rot.append("ellipse").attr("cx",0).attr("cy",0).attr("rx",5).attr("ry",2.5)
          .attr("fill",fill).attr("stroke",outline).attr("stroke-width",0.7);
        // Main rotor
        rot.append("line").attr("x1",-7).attr("y1",-3).attr("x2",7).attr("y2",-3)
          .attr("stroke",outline).attr("stroke-width",1.2);
        rot.append("line").attr("x1",-3).attr("y1",-5).attr("x2",3).attr("y2",-1)
          .attr("stroke",outline).attr("stroke-width",0.7);
        // Tail boom
        rot.append("line").attr("x1",-5).attr("y1",0).attr("x2",-9).attr("y2",0)
          .attr("stroke",outline).attr("stroke-width",0.8);
        // Tail rotor
        rot.append("line").attr("x1",-9).attr("y1",-2).attr("x2",-9).attr("y2",2)
          .attr("stroke",outline).attr("stroke-width",0.8);
        break;
      }
      case "antiair": {
        // AA radar dish + radar arcs
        g.append("rect").attr("x",-4).attr("y",0).attr("width",8).attr("height",4)
          .attr("fill",fill).attr("stroke",outline).attr("stroke-width",0.7).attr("rx",0.5);
        g.append("line").attr("x1",0).attr("y1",0).attr("x2",0).attr("y2",-5)
          .attr("stroke",outline).attr("stroke-width",1);
        g.append("ellipse").attr("cx",0).attr("cy",-5).attr("rx",4).attr("ry",2)
          .attr("fill","none").attr("stroke",outline).attr("stroke-width",0.8);
        // Radar sweep arcs
        g.append("path").attr("d","M-6,-7 A8,8 0 0,1 6,-7")
          .attr("fill","none").attr("stroke",fill).attr("stroke-width",0.5).attr("opacity",0.6);
        g.append("path").attr("d","M-9,-9 A11,11 0 0,1 9,-9")
          .attr("fill","none").attr("stroke",fill).attr("stroke-width",0.4).attr("opacity",0.35);
        break;
      }
      case "destroyer": {
        const rot = g.append("g").attr("transform",`rotate(${angleDeg})`);
        // Hull
        rot.append("ellipse").attr("cx",0).attr("cy",0).attr("rx",8).attr("ry",2.5)
          .attr("fill",fill).attr("stroke",outline).attr("stroke-width",0.7);
        // Bow
        rot.append("polygon").attr("points","8,0 6,-2 6,2")
          .attr("fill",fill).attr("stroke",outline).attr("stroke-width",0.5);
        // Bridge
        rot.append("rect").attr("x",-1).attr("y",-2).attr("width",4).attr("height",2)
          .attr("fill","#223355").attr("stroke",outline).attr("stroke-width",0.5);
        // Gun
        rot.append("line").attr("x1",2).attr("y1",-1).attr("x2",7).attr("y2",-1)
          .attr("stroke",outline).attr("stroke-width",1);
        break;
      }
      case "battleship": {
        const rot = g.append("g").attr("transform",`rotate(${angleDeg})`);
        // Hull
        rot.append("ellipse").attr("cx",0).attr("cy",0).attr("rx",11).attr("ry",3.5)
          .attr("fill",fill).attr("stroke",outline).attr("stroke-width",0.8);
        // Superstructure
        rot.append("rect").attr("x",-4).attr("y",-3).attr("width",7).attr("height",3)
          .attr("fill","#152030").attr("stroke",outline).attr("stroke-width",0.5);
        // Front guns
        rot.append("line").attr("x1",4).attr("y1",-1).attr("x2",11).attr("y2",-1)
          .attr("stroke",outline).attr("stroke-width",1.2);
        rot.append("line").attr("x1",4).attr("y1",1).attr("x2",11).attr("y2",1)
          .attr("stroke",outline).attr("stroke-width",1.2);
        // Rear guns
        rot.append("line").attr("x1",-4).attr("y1",-1).attr("x2",-11).attr("y2",-1)
          .attr("stroke",outline).attr("stroke-width",1);
        break;
      }
      case "missile": {
        const rot = g.append("g").attr("transform",`rotate(${angleDeg})`);
        // Missile body
        rot.append("ellipse").attr("cx",0).attr("cy",0).attr("rx",6).attr("ry",1.2)
          .attr("fill","#cc2200").attr("stroke","#ff6600").attr("stroke-width",0.6);
        // Nose cone
        rot.append("polygon").attr("points","6,0 4,-1 4,1")
          .attr("fill","#ff4400").attr("stroke","none");
        // Fins
        rot.append("polygon").attr("points","-6,0 -4,-2.5 -3,0")
          .attr("fill","#882200").attr("stroke","none");
        rot.append("polygon").attr("points","-6,0 -4,2.5 -3,0")
          .attr("fill","#882200").attr("stroke","none");
        // Exhaust trail
        rot.append("line").attr("x1",-6).attr("y1",0).attr("x2",-10).attr("y2",0)
          .attr("stroke","#ff8800").attr("stroke-width",1.2).attr("opacity",0.7);
        break;
      }
      default: {
        g.append("circle").attr("r",5).attr("fill",fill).attr("stroke",outline).attr("stroke-width",0.8);
      }
    }
  },

  _movementAngle(unit) {
    if (unit.target_x == null || unit.target_y == null) return 0;
    return Math.atan2(unit.target_y - unit.y, unit.target_x - unit.x) * 180 / Math.PI;
  },

  _selectUnit(id) {
    if (this.selected === id) {
      // Deselect
      this.selected = null;
      this._stopMoveListening();
      this.render();
      if (window.GameHUD) GameHUD.clearUnitInfo();
      return;
    }
    this.selected = id;
    this.render();
    if (window.GameHUD) GameHUD.showUnitInfo(GameState.units[id], true);
    this._startMoveListening();
  },

  _startMoveListening() {
    this._stopMoveListening();
    this._moveListening = true;
    const svg = document.getElementById("map") || document.querySelector("svg");
    if (!svg) return;
    this._mapClickHandler = (e) => {
      if (!this.selected || !this._moveListening) return;
      // Get SVG coordinates
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const viewboxEl = document.getElementById("viewbox") || svg;
      const ctm = viewboxEl.getScreenCTM();
      if (!ctm) return;
      const svgPt = pt.matrixTransform(ctm.inverse());
      this.orderMove(this.selected, svgPt.x, svgPt.y);
      this._stopMoveListening();
      this.selected = null;
      this.render();
    };
    svg.addEventListener("click", this._mapClickHandler, {once: true});
  },

  _stopMoveListening() {
    this._moveListening = false;
    const svg = document.getElementById("map") || document.querySelector("svg");
    if (svg && this._mapClickHandler) {
      svg.removeEventListener("click", this._mapClickHandler);
      this._mapClickHandler = null;
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
