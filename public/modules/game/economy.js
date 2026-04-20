"use strict";
// economy.js — City income, production queues, damage, and recovery

const UNIT_COSTS = {
  infantry:   {cost: 80,  buildTicks: 2},
  tank:       {cost: 300, buildTicks: 6},
  fighter:    {cost: 450, buildTicks: 8},
  helicopter: {cost: 350, buildTicks: 7},
  antiair:    {cost: 250, buildTicks: 5},
  destroyer:  {cost: 500, buildTicks: 10},
  battleship: {cost: 800, buildTicks: 14}
};

// Income reduction based on damage level (0-1 scale)
function incomeMultiplier(damageLevel) {
  // 0 damage → 1.0x income; 1.0 damage → 0.1x income
  return Math.max(0.1, 1 - damageLevel * 0.9);
}

const Economy = {
  async processTick() {
    const {sessionId, cityEconomy, stateEconomy} = GameState;
    if (!sessionId) return;

    // Aggregate income per state
    const incomeByState = {};
    for (const [burgId, city] of Object.entries(cityEconomy)) {
      const sid = city.state_id;
      const income = city.income_per_tick * incomeMultiplier(city.damage_level);
      incomeByState[sid] = (incomeByState[sid] || 0) + income;
    }

    // Apply income to all state treasuries
    const treasuryUpdates = [];
    for (const [stateId, income] of Object.entries(incomeByState)) {
      const current = stateEconomy[stateId]?.treasury || 0;
      const newVal = Math.min(99999, current + income);
      treasuryUpdates.push({session_id: sessionId, state_id: +stateId, treasury: newVal});
      if (GameState.stateEconomy[stateId]) GameState.stateEconomy[stateId].treasury = newVal;
    }

    // Advance production queues
    const queueUpdates = [];
    const unitsToSpawn = [];

    for (const [burgId, city] of Object.entries(cityEconomy)) {
      let queue = Array.isArray(city.production_queue) ? [...city.production_queue] : [];
      if (!queue.length) continue;

      queue[0].ticksLeft = (queue[0].ticksLeft || 1) - 1;
      if (queue[0].ticksLeft <= 0) {
        // Unit is ready — spawn it
        const spawned = queue.shift();
        unitsToSpawn.push({
          burgId: +burgId,
          unitType: spawned.type,
          stateId: city.state_id
        });
      }
      queueUpdates.push({id: city.id, production_queue: queue});
    }

    // City recovery — reduce damage_level by 0.02 per tick (full recovery ~50 ticks)
    const recoveryUpdates = [];
    for (const [burgId, city] of Object.entries(cityEconomy)) {
      if (city.damage_level > 0) {
        const newDamage = Math.max(0, city.damage_level - 0.02);
        const smokeActive = newDamage > 0.1;
        recoveryUpdates.push({id: city.id, damage_level: newDamage, smoke_active: smokeActive});
        GameState.cityEconomy[burgId].damage_level = newDamage;
        GameState.cityEconomy[burgId].smoke_active = smokeActive;
      }
    }

    // Batch write to Supabase
    const client = this._getClient();
    if (!client) return;

    if (treasuryUpdates.length) {
      await client.from("state_economy").upsert(treasuryUpdates, {onConflict: "session_id,state_id"});
    }

    for (const upd of queueUpdates) {
      await client.from("city_economy").update({production_queue: upd.production_queue}).eq("id", upd.id);
    }

    for (const upd of recoveryUpdates) {
      await client.from("city_economy")
        .update({damage_level: upd.damage_level, smoke_active: upd.smoke_active})
        .eq("id", upd.id);
    }

    // Spawn ready units
    for (const spawn of unitsToSpawn) {
      if (window.UnitSystem) {
        const burg = pack.burgs[spawn.burgId];
        if (burg) await UnitSystem.spawnUnit(spawn.stateId, spawn.unitType, burg.x, burg.y, spawn.burgId);
      }
    }
  },

  // Enqueue a unit for production in a city
  async queueUnit(burgId, unitType) {
    const city = GameState.cityEconomy[burgId];
    if (!city) return {ok: false, reason: "City not found"};

    const spec = UNIT_COSTS[unitType];
    if (!spec) return {ok: false, reason: "Unknown unit type"};

    const hasFunds = await GameState.spendTreasury(city.state_id, spec.cost);
    if (!hasFunds) return {ok: false, reason: "Insufficient treasury"};

    const queue = Array.isArray(city.production_queue) ? [...city.production_queue] : [];
    queue.push({type: unitType, ticksLeft: spec.buildTicks});

    const client = this._getClient();
    if (client) {
      await client.from("city_economy")
        .update({production_queue: queue})
        .eq("id", city.id);
    }
    GameState.cityEconomy[burgId].production_queue = queue;
    return {ok: true};
  },

  // Apply damage to a city (from bombardment or airstrike)
  async damageCity(burgId, amount) {
    const city = GameState.cityEconomy[burgId];
    if (!city) return;

    const newDamage = Math.min(1, city.damage_level + amount);
    const smokeActive = newDamage > 0.05;
    const newIncome = city.income_per_tick; // income_per_tick unchanged; multiplier handles it

    const client = this._getClient();
    if (client) {
      await client.from("city_economy")
        .update({damage_level: newDamage, smoke_active: smokeActive})
        .eq("id", city.id);
    }

    GameState.cityEconomy[burgId].damage_level = newDamage;
    GameState.cityEconomy[burgId].smoke_active = smokeActive;

    if (window.Effects) Effects.updateSmoke(burgId, smokeActive, newDamage);
  },

  _getClient() {
    return window.getSb ? window.getSb() : null;
  }
};

window.Economy = Economy;
window.UNIT_COSTS = UNIT_COSTS;
