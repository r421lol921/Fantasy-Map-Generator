"use strict";
// effects.js — Smoke plumes, explosions, projectile trails on the SVG map

const Effects = {
  // SVG group appended on top of all layers
  layer: null,
  smokeElements: {}, // burgId → SVG group

  init() {
    if (this.layer) return;
    // Append above markers layer
    this.layer = d3.select("#viewbox").append("g").attr("id", "gameEffects").attr("pointer-events", "none");
    this._injectStyles();
  },

  _injectStyles() {
    if (document.getElementById("gameEffectsStyle")) return;
    const style = document.createElement("style");
    style.id = "gameEffectsStyle";
    style.textContent = `
      @keyframes smokeRise {
        0%   { transform: translateY(0)  scaleX(1);   opacity: 0.75; }
        100% { transform: translateY(-22px) scaleX(1.6); opacity: 0; }
      }
      @keyframes explode {
        0%   { transform: scale(0.1); opacity: 1; }
        60%  { transform: scale(1.4); opacity: 0.85; }
        100% { transform: scale(2);   opacity: 0; }
      }
      @keyframes projectileFly {
        0%   { opacity: 1; }
        100% { opacity: 0; }
      }
      .smoke-puff {
        animation: smokeRise 2.4s ease-out infinite;
        transform-box: fill-box;
        transform-origin: center bottom;
      }
      .smoke-puff:nth-child(2) { animation-delay: 0.8s; }
      .smoke-puff:nth-child(3) { animation-delay: 1.6s; }
      .explosion-ring {
        animation: explode 0.55s ease-out forwards;
        transform-box: fill-box;
        transform-origin: center center;
      }
      .projectile-trail {
        animation: projectileFly 0.4s linear forwards;
      }
    `;
    document.head.appendChild(style);
  },

  // ── Smoke plume above a burg ───────────────────────────────────────────────
  updateSmoke(burgId, active, damageLevel = 0) {
    this.init();
    if (!active) {
      if (this.smokeElements[burgId]) {
        this.smokeElements[burgId].remove();
        delete this.smokeElements[burgId];
      }
      return;
    }
    if (!pack?.burgs?.[burgId]) return;
    const burg = pack.burgs[burgId];

    if (this.smokeElements[burgId]) {
      // Already showing — update opacity based on damage level
      this.smokeElements[burgId].style("opacity", 0.4 + damageLevel * 0.6);
      return;
    }

    const smokeFill = damageLevel > 0.6 ? "#333" : "#888";
    const g = this.layer.append("g")
      .attr("id", `smoke-${burgId}`)
      .attr("transform", `translate(${burg.x},${burg.y - 4})`)
      .style("opacity", 0.4 + damageLevel * 0.6);

    // 3 staggered puff circles
    [-2, 0, 2].forEach((dx, i) => {
      g.append("ellipse")
        .attr("class", "smoke-puff")
        .attr("cx", dx)
        .attr("cy", 0)
        .attr("rx", 3 + damageLevel * 2)
        .attr("ry", 2 + damageLevel * 1.5)
        .attr("fill", smokeFill)
        .style("animation-delay", `${i * 0.8}s`);
    });

    this.smokeElements[burgId] = g;
  },

  // ── Explosion flash at (x,y) ──────────────────────────────────────────────
  spawnExplosion(x, y, big = false) {
    this.init();
    const r = big ? 12 : 7;
    const g = this.layer.append("g")
      .attr("transform", `translate(${x},${y})`);

    g.append("circle")
      .attr("class", "explosion-ring")
      .attr("r", r)
      .attr("fill", "none")
      .attr("stroke", "#ff6600")
      .attr("stroke-width", big ? 3 : 2);

    g.append("circle")
      .attr("class", "explosion-ring")
      .attr("r", r * 0.55)
      .attr("fill", "#ffcc00")
      .attr("opacity", 0.9)
      .style("animation-delay", "0.05s");

    // Remove after animation finishes
    setTimeout(() => g.remove(), 650);
  },

  // ── Unit destruction — wreckage icon that fades over 60 s ─────────────────
  spawnWreckage(x, y, unitType) {
    this.init();
    const symbols = {tank: "✕", fighter: "✈", helicopter: "◈", infantry: "✝", antiair: "⊕", destroyer: "⚓", battleship: "⚓"};
    const sym = symbols[unitType] || "✕";

    const g = this.layer.append("g").attr("transform", `translate(${x},${y})`);
    g.append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("font-size", "6px")
      .attr("fill", "#aa3300")
      .attr("opacity", 0.85)
      .text(sym);

    // Fade out over 60 seconds
    g.transition().duration(60000).style("opacity", 0).remove();
  },

  // ── Projectile line (attacker → target) ──────────────────────────────────
  spawnProjectile(x1, y1, x2, y2, color = "#ff4400") {
    this.init();
    const line = this.layer.append("line")
      .attr("class", "projectile-trail")
      .attr("x1", x1).attr("y1", y1)
      .attr("x2", x2).attr("y2", y2)
      .attr("stroke", color)
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "3,2");

    setTimeout(() => line.remove(), 450);
  },

  // ── Rebuild smoke for all damaged cities on load ──────────────────────────
  rebuildAllSmoke() {
    this.init();
    for (const [burgId, city] of Object.entries(GameState.cityEconomy)) {
      if (city.smoke_active) {
        this.updateSmoke(+burgId, true, city.damage_level);
      }
    }
  }
};

window.Effects = Effects;
