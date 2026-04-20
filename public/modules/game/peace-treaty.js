"use strict";
// peace-treaty.js — UI and logic for peace treaty proposals

const PeaceTreaty = {
  pendingOffers: [], // [{fromState, toState}]

  // Called when an NPC wants to offer peace to the player
  receiveOffer(fromStateId, toStateId) {
    // Avoid duplicate offers
    if (this.pendingOffers.some(o => o.fromState === fromStateId)) return;
    this.pendingOffers.push({fromState: fromStateId, toState: toStateId});
    this._showOfferDialog(fromStateId);
  },

  // Player proposes peace to an NPC — 50% chance accepted
  async playerPropose(toStateId) {
    const playerStateId = GameState.playerStateId;
    const relation = GameState.getRelation(playerStateId, toStateId);
    if (relation !== "War") {
      if (window.GameHUD) GameHUD.notify("You are not at war with this country.", "info");
      return;
    }

    const npcState = pack?.states?.[toStateId];
    const name = npcState?.fullName || npcState?.name || `State ${toStateId}`;

    // NPC accepts if weakened, otherwise 50/50
    const npcTreasury = GameState.getTreasury(toStateId);
    const npcUnits = Object.values(GameState.units).filter(u => u.state_id === toStateId);
    const avgHp = npcUnits.length
      ? npcUnits.reduce((s, u) => s + u.hp / (UNIT_DEFS[u.unit_type]?.hp || 100), 0) / npcUnits.length
      : 1;

    const accepts = avgHp < 0.5 || npcTreasury < 200 || Math.random() < 0.5;

    if (accepts) {
      await GameState.setRelation(playerStateId, toStateId, "Peace");
      if (window.GameHUD) GameHUD.notify(`${name} accepted your peace proposal.`, "success");
    } else {
      if (window.GameHUD) GameHUD.notify(`${name} refused your peace proposal.`, "danger");
    }
  },

  async _showOfferDialog(fromStateId) {
    const npcState = pack?.states?.[fromStateId];
    if (!npcState) return;
    const name = npcState.fullName || npcState.name;

    // Remove any existing treaty dialog
    const existing = document.getElementById("peaceTreatyDialog");
    if (existing) existing.remove();

    const dialog = document.createElement("div");
    dialog.id = "peaceTreatyDialog";
    dialog.style.cssText = `
      position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
      background:#1a1a2e; color:#e0d8c8; border:2px solid #8b6914;
      border-radius:8px; padding:20px 24px; z-index:10000; min-width:280px;
      box-shadow:0 8px 32px rgba(0,0,0,0.7); font-family:Georgia,serif;
    `;
    dialog.innerHTML = `
      <h3 style="margin:0 0 10px;color:#d4a843;font-size:15px;">Peace Offer</h3>
      <p style="font-size:13px;margin:0 0 16px;line-height:1.5;">
        <strong>${name}</strong> is offering a peace treaty.<br>
        Destruction from this war will gradually heal.
      </p>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="peaceTreatyAccept" style="background:#2d5a27;color:#c8e6c2;border:1px solid #4caf50;
          border-radius:4px;padding:7px 16px;cursor:pointer;font-size:13px;">Accept</button>
        <button id="peaceTreatyDecline" style="background:#5a1a1a;color:#f5c0c0;border:1px solid #f44336;
          border-radius:4px;padding:7px 16px;cursor:pointer;font-size:13px;">Decline</button>
      </div>
    `;
    document.body.appendChild(dialog);

    document.getElementById("peaceTreatyAccept").onclick = async () => {
      await GameState.setRelation(GameState.playerStateId, fromStateId, "Peace");
      this.pendingOffers = this.pendingOffers.filter(o => o.fromState !== fromStateId);
      dialog.remove();
      if (window.GameHUD) GameHUD.notify(`Peace treaty signed with ${name}.`, "success");
    };
    document.getElementById("peaceTreatyDecline").onclick = () => {
      this.pendingOffers = this.pendingOffers.filter(o => o.fromState !== fromStateId);
      dialog.remove();
      if (window.GameHUD) GameHUD.notify(`You declined ${name}'s peace offer.`, "info");
    };
  }
};

window.PeaceTreaty = PeaceTreaty;
