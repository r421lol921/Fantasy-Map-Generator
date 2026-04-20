-- Fantasy Map Generator: Real-Time Strategy Layer
-- Migration 001: Game tables

-- Game sessions
CREATE TABLE IF NOT EXISTS game_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_seed text NOT NULL,
  player_state_id integer NOT NULL,
  game_speed text NOT NULL DEFAULT 'normal',
  year integer NOT NULL DEFAULT 1,
  tick integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Units on the map
CREATE TABLE IF NOT EXISTS game_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  state_id integer NOT NULL,
  unit_type text NOT NULL,
  x real NOT NULL,
  y real NOT NULL,
  target_x real,
  target_y real,
  hp integer NOT NULL DEFAULT 100,
  max_hp integer NOT NULL DEFAULT 100,
  fuel real NOT NULL DEFAULT 100.0,
  status text NOT NULL DEFAULT 'idle',
  home_burg_id integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS game_units_session_idx ON game_units(session_id);
CREATE INDEX IF NOT EXISTS game_units_state_idx ON game_units(state_id);

-- City economy
CREATE TABLE IF NOT EXISTS city_economy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  burg_id integer NOT NULL,
  state_id integer NOT NULL,
  income_per_tick real NOT NULL DEFAULT 10.0,
  damage_level real NOT NULL DEFAULT 0.0,
  smoke_active boolean NOT NULL DEFAULT false,
  production_queue jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE(session_id, burg_id)
);

CREATE INDEX IF NOT EXISTS city_economy_session_idx ON city_economy(session_id);

-- State treasury
CREATE TABLE IF NOT EXISTS state_economy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  state_id integer NOT NULL,
  treasury real NOT NULL DEFAULT 500.0,
  UNIQUE(session_id, state_id)
);

CREATE INDEX IF NOT EXISTS state_economy_session_idx ON state_economy(session_id);

-- Diplomacy state (persisted to DB, mirrors pack.states diplomacy)
CREATE TABLE IF NOT EXISTS diplomacy_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  state_a integer NOT NULL,
  state_b integer NOT NULL,
  relation text NOT NULL DEFAULT 'Neutral',
  peace_timer integer NOT NULL DEFAULT 0,
  UNIQUE(session_id, state_a, state_b)
);

CREATE INDEX IF NOT EXISTS diplomacy_state_session_idx ON diplomacy_state(session_id);

-- Combat events (for real-time visual effects trigger via Realtime)
CREATE TABLE IF NOT EXISTS combat_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  attacker_unit_id uuid,
  defender_unit_id uuid,
  attacker_state integer NOT NULL,
  defender_state integer NOT NULL,
  damage integer NOT NULL DEFAULT 0,
  x real NOT NULL,
  y real NOT NULL,
  event_type text NOT NULL DEFAULT 'attack',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS combat_events_session_idx ON combat_events(session_id);

-- Enable Realtime for live unit movement and combat events
ALTER PUBLICATION supabase_realtime ADD TABLE game_units;
ALTER PUBLICATION supabase_realtime ADD TABLE combat_events;
ALTER PUBLICATION supabase_realtime ADD TABLE city_economy;
ALTER PUBLICATION supabase_realtime ADD TABLE state_economy;
