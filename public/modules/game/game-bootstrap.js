"use strict";
// game-bootstrap.js — Starts the strategy layer once FMG map has loaded

(function () {
  // window.ENV is injected by the Vite plugin inline script in <head>
  // Fallback to empty strings if not set (will log an error via getSupabase())
  if (!window.ENV) {
    window.ENV = {SUPABASE_URL: "", SUPABASE_ANON_KEY: ""};
  }

  // Wait until the FMG map is fully generated (pack.states populated)
  function waitForMap(cb, tries = 0) {
    if (pack?.states?.length > 1 && pack?.burgs?.length > 1) {
      cb();
    } else if (tries < 120) {
      setTimeout(() => waitForMap(cb, tries + 1), 1000);
    }
  }

  function startGame() {
    // Init HUD
    GameHUD.init();

    // Pick player state = state 1 (first non-neutral state)
    const playerState = pack.states.find(s => s && s.i && !s.removed);
    if (!playerState) { console.error("[Bootstrap] No valid player state found"); return; }

    const playerStateId = playerState.i;

    // Seed for this map
    const mapSeed = String(seed || Date.now());

    // Check if a session already exists in localStorage
    const savedSession = localStorage.getItem("fmg_game_session");
    if (savedSession) {
      GameState.resumeSession(savedSession).then(ok => {
        if (ok) {
          afterSession(playerStateId);
        } else {
          localStorage.removeItem("fmg_game_session");
          createNewSession(mapSeed, playerStateId);
        }
      });
    } else {
      createNewSession(mapSeed, playerStateId);
    }
  }

  function createNewSession(mapSeed, playerStateId) {
    GameState.startSession(mapSeed, playerStateId).then(sessionId => {
      if (!sessionId) { console.error("[Bootstrap] Could not create session"); return; }
      localStorage.setItem("fmg_game_session", sessionId);
      GameState.playerStateId = playerStateId;
      afterSession(playerStateId);
    });
  }

  function afterSession(playerStateId) {
    // Init SVG layers
    Effects.init();
    UnitSystem.init();

    // Rebuild smoke for any already-damaged cities
    Effects.rebuildAllSmoke();

    // Update HUD treasury
    const treasury = GameState.getTreasury(playerStateId);
    GameHUD.updateTreasury(treasury);
    GameHUD.updateYear(GameState.year);

    // Hook burg click → open unit builder if player owns it
    // We attach to the burgIcons SVG layer
    d3.selectAll("#burgIcons circle, #burgLabels text").on("click.unitBuilder", function () {
      const burgId = +(this.dataset?.id || d3.select(this).attr("data-id") || 0);
      if (!burgId) return;
      const burg = pack.burgs[burgId];
      if (!burg || burg.state !== playerStateId) return;
      d3.event.stopPropagation();
      UnitBuilder.open(burgId);
    });

    // Notify player
    GameHUD.notify(`Welcome, ruler of ${pack.states[playerStateId]?.fullName || "your realm"}. Press ▶ Start to begin.`, "success");

    // Diplomacy HUD updater
    setInterval(() => GameHUD.updateDiplomacy(), 3000);
  }

  // Listen for FMG's map generation completion event
  window.addEventListener("map:generated", () => waitForMap(startGame));

  // Also try on window load as fallback (handles pre-loaded maps)
  window.addEventListener("load", () => setTimeout(() => waitForMap(startGame), 5000));
})();
