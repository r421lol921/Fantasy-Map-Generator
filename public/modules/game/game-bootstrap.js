"use strict";
// game-bootstrap.js — Starts the strategy layer once FMG map has loaded

(function () {
  if (!window.ENV) {
    window.ENV = {SUPABASE_URL: "", SUPABASE_ANON_KEY: ""};
  }

  function waitForMap(cb, tries) {
    if (tries === undefined) tries = 0;
    if (pack && pack.states && pack.states.length > 1 && pack.burgs && pack.burgs.length > 1) {
      cb();
    } else if (tries < 120) {
      setTimeout(function() { waitForMap(cb, tries + 1); }, 1000);
    }
  }

  function startGame() {
    // Hide any top UI bar from FMG that blocks the map
    _hideTopBar();

    // Init HUD
    GameHUD.init();

    const playerState = pack.states.find(function(s) { return s && s.i && !s.removed; });
    if (!playerState) { console.error("[Bootstrap] No valid player state found"); return; }

    const playerStateId = playerState.i;
    const mapSeed = String(typeof seed !== "undefined" ? seed : Date.now());

    const savedSession = localStorage.getItem("fmg_game_session");
    if (savedSession) {
      GameState.resumeSession(savedSession).then(function(ok) {
        if (ok) { afterSession(playerStateId); }
        else { localStorage.removeItem("fmg_game_session"); createNewSession(mapSeed, playerStateId); }
      });
    } else {
      createNewSession(mapSeed, playerStateId);
    }
  }

  function createNewSession(mapSeed, playerStateId) {
    GameState.startSession(mapSeed, playerStateId).then(function(sessionId) {
      if (!sessionId) { console.error("[Bootstrap] Could not create session"); return; }
      localStorage.setItem("fmg_game_session", sessionId);
      GameState.playerStateId = playerStateId;
      afterSession(playerStateId);
    });
  }

  function afterSession(playerStateId) {
    Effects.init();
    UnitSystem.init();
    Effects.rebuildAllSmoke();

    const treasury = GameState.getTreasury(playerStateId);
    GameHUD.updateTreasury(treasury);
    GameHUD.updateYear(GameState.year);

    // ── Hook city/burg clicks ──────────────────────────────────────────────
    // Use event delegation on the entire SVG so we catch all burg circles/labels
    const svgEl = document.getElementById("map") || document.querySelector("svg");
    if (svgEl) {
      svgEl.addEventListener("click", function(e) {
        // Don't intercept if a unit captured the click first
        if (e._unitHandled) return;

        // Find closest burg to click point
        const pt = svgEl.createSVGPoint();
        pt.x = e.clientX; pt.y = e.clientY;
        const vbEl = document.getElementById("viewbox") || svgEl;
        const ctm = vbEl.getScreenCTM();
        if (!ctm) return;
        const svgPt = pt.matrixTransform(ctm.inverse());

        // Detect if click is near a burg (within 10px)
        let nearBurg = null, nearDist = 10;
        for (const burg of (pack.burgs || [])) {
          if (!burg || !burg.i || burg.removed) continue;
          const d = Math.sqrt((burg.x - svgPt.x)**2 + (burg.y - svgPt.y)**2);
          if (d < nearDist) { nearDist = d; nearBurg = burg; }
        }

        if (nearBurg) {
          // Show province panel (works for own and enemy cities)
          GameHUD.openProvince(nearBurg.i);
          return;
        }

        // Detect province/cell click for province info
        const cell = _cellAtPoint(svgPt.x, svgPt.y);
        if (cell != null) {
          const stateId = pack.cells.state[cell];
          const burgId = pack.cells.burg[cell];
          if (burgId) {
            GameHUD.openProvince(burgId);
          } else if (stateId && pack.states[stateId]) {
            // Show province owner info in a quick notify
            const st = pack.states[stateId];
            const treasury = GameState.getTreasury(stateId);
            GameHUD.notify(`${st.fullName || st.name} — Treasury: ${Math.floor(treasury)}g`, "info");
          }
        }
      });
    }

    // ── Diplomacy HUD updater ─────────────────────────────────────────────
    setInterval(function() { GameHUD.updateDiplomacy(); }, 3000);

    const stateName = pack.states[playerStateId] && (pack.states[playerStateId].fullName || pack.states[playerStateId].name);
    GameHUD.notify("Welcome, ruler of " + (stateName || "your realm") + ". Press Start to begin.", "success");
  }

  // Try to find which voronoi cell was clicked
  function _cellAtPoint(x, y) {
    try {
      if (typeof grid !== "undefined" && grid.cells && typeof findCell === "function") {
        return findCell(x, y);
      }
      if (pack && pack.cells && pack.cells.p) {
        let best = null, bestD = Infinity;
        const p = pack.cells.p;
        for (let i = 0; i < p.length; i++) {
          const d = (p[i][0]-x)**2 + (p[i][1]-y)**2;
          if (d < bestD) { bestD = d; best = i; }
        }
        return bestD < 400 ? best : null;
      }
    } catch(e) {}
    return null;
  }

  // Hide the FMG top toolbar so it doesn't cover the map
  function _hideTopBar() {
    // FMG uses #optionsContainer as its top toolbar container
    const selectors = ["#optionsContainer", "#options", "#menubar", "nav#menu", "#toolbar", "#topbar", "header"];
    selectors.forEach(function(sel) {
      const el = document.querySelector(sel);
      if (el) { el.style.display = "none"; el.style.visibility = "hidden"; el.style.pointerEvents = "none"; }
    });
    // Remove any top padding the bar may have added to the page
    document.body.style.paddingTop = "0";
    document.documentElement.style.paddingTop = "0";
  }

  window.addEventListener("map:generated", function() { waitForMap(startGame); });
  window.addEventListener("load", function() { setTimeout(function() { waitForMap(startGame); }, 5000); });
})();
