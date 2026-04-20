"use strict";
// game-state.js — Supabase session management & global game tick
// Reads SUPABASE_URL and SUPABASE_ANON_KEY from window.ENV (injected by index.html)

const SUPABASE_URL = window.ENV?.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = window.ENV?.SUPABASE_ANON_KEY || "";

// Lazily initialise the Supabase client once the CDN script has loaded
let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  if (!window.supabase) {
    console.error("[GameState] Supabase CDN not loaded yet");
    return null;
  }
  _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _supabase;
}

// ── Shared game state ────────────────────────────────────────────────────────
const GameState = {
  sessionId: null,
  playerStateId: null,
  tick: 0,
  year: 1,
  running: false,
  tickIntervalId: null,
  // ms per tick:  normal=5 s, fast=2 s, slow=10 s
  speedMs: {slow: 10000, normal: 5000, fast: 2000},
  currentSpeed: "normal",

  // Local caches updated by realtime subscriptions
  units: {},        // id → unit row
  cityEconomy: {},  // burgId → city_economy row
  stateEconomy: {}, // stateId → state_economy row
  diplomacy: {},    // `${a}_${b}` → diplomacy_state row

  // ── Session bootstrap ─────────────────────────────────────────────────────
  async startSession(mapSeed, playerStateId) {
    const sb = getSupabase();
    if (!sb) return null;

    const {data, error} = await sb
      .from("game_sessions")
      .insert({map_seed: mapSeed, player_state_id: playerStateId})
      .select()
      .single();

    if (error) {console.error("[GameState] startSession:", error); return null;}

    this.sessionId = data.id;
    this.playerStateId = playerStateId;
    this.tick = 0;
    this.year = 1;

    // Seed economy rows for every state/burg
    await this._seedEconomy();
    // Subscribe to realtime tables
    this._subscribeRealtime();
    // Load initial data
    await this._loadAllData();

    return data.id;
  },

  async resumeSession(sessionId) {
    const sb = getSupabase();
    if (!sb) return false;
    const {data, error} = await sb.from("game_sessions").select("*").eq("id", sessionId).single();
    if (error || !data) return false;

    this.sessionId = sessionId;
    this.playerStateId = data.player_state_id;
    this.tick = data.tick;
    this.year = data.year;
    this._subscribeRealtime();
    await this._loadAllData();
    return true;
  },

  // ── Seed initial economy rows ─────────────────────────────────────────────
  async _seedEconomy() {
    const sb = getSupabase();
    if (!sb || !pack?.states) return;

    const stateRows = pack.states
      .filter(s => s && s.i && !s.removed)
      .map(s => ({session_id: this.sessionId, state_id: s.i, treasury: 500}));

    const burgRows = pack.burgs
      .filter(b => b && b.i && !b.removed)
      .map(b => ({
        session_id: this.sessionId,
        burg_id: b.i,
        state_id: b.state,
        income_per_tick: Math.max(1, Math.round(b.population * 0.5)),
        damage_level: 0,
        smoke_active: false,
        production_queue: []
      }));

    if (stateRows.length) {
      await sb.from("state_economy").upsert(stateRows, {onConflict: "session_id,state_id"});
    }
    if (burgRows.length) {
      await sb.from("city_economy").upsert(burgRows, {onConflict: "session_id,burg_id"});
    }
  },

  // ── Load all data into local caches ──────────────────────────────────────
  async _loadAllData() {
    const sb = getSupabase();
    if (!sb) return;
    const sid = this.sessionId;

    const [units, cities, states, diplo] = await Promise.all([
      sb.from("game_units").select("*").eq("session_id", sid),
      sb.from("city_economy").select("*").eq("session_id", sid),
      sb.from("state_economy").select("*").eq("session_id", sid),
      sb.from("diplomacy_state").select("*").eq("session_id", sid)
    ]);

    if (units.data)  units.data.forEach(u => { this.units[u.id] = u; });
    if (cities.data) cities.data.forEach(c => { this.cityEconomy[c.burg_id] = c; });
    if (states.data) states.data.forEach(s => { this.stateEconomy[s.state_id] = s; });
    if (diplo.data)  diplo.data.forEach(d => { this.diplomacy[`${d.state_a}_${d.state_b}`] = d; });
  },

  // ── Realtime subscriptions ────────────────────────────────────────────────
  _subscribeRealtime() {
    const sb = getSupabase();
    if (!sb) return;
    const sid = this.sessionId;

    sb.channel("game_units")
      .on("postgres_changes", {event: "*", schema: "public", table: "game_units", filter: `session_id=eq.${sid}`},
        payload => {
          if (payload.eventType === "DELETE") delete this.units[payload.old.id];
          else this.units[payload.new.id] = payload.new;
          if (window.UnitSystem) UnitSystem.render();
        })
      .subscribe();

    sb.channel("city_economy")
      .on("postgres_changes", {event: "*", schema: "public", table: "city_economy", filter: `session_id=eq.${sid}`},
        payload => {
          if (payload.new) {
            this.cityEconomy[payload.new.burg_id] = payload.new;
            if (window.Effects) Effects.updateSmoke(payload.new.burg_id, payload.new.smoke_active, payload.new.damage_level);
          }
        })
      .subscribe();

    sb.channel("state_economy")
      .on("postgres_changes", {event: "*", schema: "public", table: "state_economy", filter: `session_id=eq.${sid}`},
        payload => {
          if (payload.new) {
            this.stateEconomy[payload.new.state_id] = payload.new;
            if (window.GameHUD && payload.new.state_id === this.playerStateId) GameHUD.updateTreasury(payload.new.treasury);
          }
        })
      .subscribe();

    sb.channel("combat_events")
      .on("postgres_changes", {event: "INSERT", schema: "public", table: "combat_events", filter: `session_id=eq.${sid}`},
        payload => {
          if (window.Effects) Effects.spawnExplosion(payload.new.x, payload.new.y);
        })
      .subscribe();
  },

  // ── Tick loop ─────────────────────────────────────────────────────────────
  startTick() {
    if (this.running) return;
    this.running = true;
    const ms = this.speedMs[this.currentSpeed] || 5000;
    this.tickIntervalId = setInterval(() => this._doTick(), ms);
  },

  pauseTick() {
    this.running = false;
    clearInterval(this.tickIntervalId);
    this.tickIntervalId = null;
  },

  setSpeed(speed) {
    this.currentSpeed = speed;
    if (this.running) {
      this.pauseTick();
      this.startTick();
    }
  },

  async _doTick() {
    this.tick++;
    if (this.tick % 72 === 0) this.year++; // ~72 ticks per game year

    const sb = getSupabase();
    if (sb && this.sessionId) {
      sb.from("game_sessions").update({tick: this.tick, year: this.year, updated_at: new Date().toISOString()})
        .eq("id", this.sessionId).then(() => {});
    }

    // Dispatch to each subsystem
    if (window.Economy) await Economy.processTick();
    if (window.UnitSystem) await UnitSystem.processTick();
    if (window.NpcAI) await NpcAI.processTick();

    if (window.GameHUD) GameHUD.updateYear(this.year);
  },

  // ── Helper ─────────────────────────────────────────────────────────────────
  getRelation(stateA, stateB) {
    const key = `${Math.min(stateA,stateB)}_${Math.max(stateA,stateB)}`;
    return this.diplomacy[key]?.relation || "Neutral";
  },

  async setRelation(stateA, stateB, relation) {
    const sb = getSupabase();
    if (!sb) return;
    const a = Math.min(stateA, stateB);
    const b = Math.max(stateA, stateB);
    const key = `${a}_${b}`;
    const {data} = await sb
      .from("diplomacy_state")
      .upsert({session_id: this.sessionId, state_a: a, state_b: b, relation}, {onConflict: "session_id,state_a,state_b"})
      .select().single();
    if (data) this.diplomacy[key] = data;
  },

  getTreasury(stateId) {
    return this.stateEconomy[stateId]?.treasury || 0;
  },

  async spendTreasury(stateId, amount) {
    const sb = getSupabase();
    if (!sb) return false;
    const current = this.getTreasury(stateId);
    if (current < amount) return false;
    const newVal = current - amount;
    await sb.from("state_economy")
      .update({treasury: newVal})
      .eq("session_id", this.sessionId)
      .eq("state_id", stateId);
    // optimistic local update
    if (this.stateEconomy[stateId]) this.stateEconomy[stateId].treasury = newVal;
    return true;
  }
};

window.GameState = GameState;

// Exported singleton helper for other modules
window.getSb = getSupabase;
