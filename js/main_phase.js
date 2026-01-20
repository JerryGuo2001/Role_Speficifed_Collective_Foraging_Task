/* ===========================
   main_phase.js
   - Exports startGame(containerId, config)
   - 10x10 grid world
   - Two agents: Forager (green), Security (yellow)
   - Turn-based control, max moves per turn
   - Logs all UI + key events via provided logger (DataSaver-compatible)
   - NO minimap, NO 'E' action
   =========================== */

(function () {
  "use strict";

  // ---------------------------
  // Small DOM helper
  // ---------------------------
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "style") node.style.cssText = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    return node;
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  // ---------------------------
  // Placeholder policies (CSV/model later)
  // Contract: policy.nextAction(state) -> { dx, dy, label } | null
  // ---------------------------
  const IdlePolicy = {
    name: "idle",
    nextAction: () => null
  };

  // Example random walk policy (disabled by default; kept as reference)
  const RandomWalkPolicy = {
    name: "random_walk",
    nextAction: () => {
      const moves = [
        { dx: 0, dy: -1, label: "ArrowUp" },
        { dx: 0, dy:  1, label: "ArrowDown" },
        { dx: -1, dy: 0, label: "ArrowLeft" },
        { dx:  1, dy: 0, label: "ArrowRight" },
      ];
      return moves[Math.floor(Math.random() * moves.length)];
    }
  };

  // ---------------------------
  // startGame
  // ---------------------------
  function startGame(containerId, config) {
    const {
      participantId,
      logger,
      trialIndex = 0,

      // Map size now 10x10 by default
      gridSize = 10,

      // Spawn defaults (center-ish for 10x10)
      spawnForager = { x: 5, y: 5 },
      spawnSecurity = { x: 4, y: 5 },

      // Turn rules
      maxMovesPerTurn = 5,

      // Which agent is human-controlled?
      // "forager" or "security"
      humanAgent = "forager",

      // Placeholder for scripted/model control:
      // policies = { forager: {nextAction}, security: {nextAction} }
      // If an agent is not human-controlled, we will call its policy.
      policies = { forager: IdlePolicy, security: IdlePolicy },

      // Called when user clicks Next in the phase
      onEnd = null,
    } = config;

    if (!participantId) throw new Error("startGame requires participantId");
    if (!logger || typeof logger.log !== "function") throw new Error("startGame requires a logger with .log(evt)");

    const mount = typeof containerId === "string" ? document.getElementById(containerId) : containerId;
    if (!mount) throw new Error("Could not find container element for game.");

    mount.innerHTML = "";

    // ---------------------------
    // State
    // ---------------------------
    const state = {
      participantId,
      trialIndex,
      gridSize,
      running: true,

      agents: {
        forager: { name: "Forager", color: "forager", x: spawnForager.x, y: spawnForager.y },
        security:{ name: "Security", color: "security", x: spawnSecurity.x, y: spawnSecurity.y },
      },

      turn: {
        order: ["forager", "security"],
        idx: 0,
        movesUsed: 0,
        maxMoves: maxMovesPerTurn,
        humanAgent,
      },

      policies: {
        forager: policies.forager || IdlePolicy,
        security: policies.security || IdlePolicy,
      }
    };

    function currentAgentKey() {
      return state.turn.order[state.turn.idx % state.turn.order.length];
    }

    function otherAgentKey() {
      return state.turn.order[(state.turn.idx + 1) % state.turn.order.length];
    }

    function isHumanTurn() {
      return currentAgentKey() === state.turn.humanAgent;
    }

    // ---------------------------
    // UI
    // ---------------------------
    const style = el("style", {}, [`
      .gameCard { background:#fff; border:1px solid #e6e6e6; border-radius:12px; padding:16px; box-shadow:0 1px 2px rgba(0,0,0,.04); }
      .muted { color:#666; font-size:14px; }
      .topRow { display:flex; gap:12px; flex-wrap:wrap; align-items:center; justify-content:space-between; margin-bottom:12px; }
      .badge { display:inline-flex; align-items:center; gap:8px; border:1px solid #eee; border-radius:999px; padding:8px 12px; }
      .dot { width:10px; height:10px; border-radius:50%; display:inline-block; }
      .dot.forager { background:#16a34a; }   /* green */
      .dot.security { background:#eab308; }  /* yellow */
      .turnTitle { font-weight:700; }
      .gridWrap { display:flex; gap:16px; flex-wrap:wrap; align-items:flex-start; }
      .world {
        width: 640px;
        height: 640px;
        border:1px solid #ddd;
        border-radius:12px;
        display:grid;
        user-select:none;
      }
      .cell { border:1px solid #f1f1f1; display:flex; align-items:center; justify-content:center; }
      .agent { width:70%; height:70%; border-radius:10px; }
      .agent.forager { background:#16a34a; }
      .agent.security { background:#eab308; }
      .side { flex:1; min-width:260px; }
      .hud { display:flex; flex-direction:column; gap:10px; }
      .hudBox { border:1px solid #eee; border-radius:12px; padding:10px 12px; }
      .hudRow { display:flex; justify-content:space-between; gap:10px; }
      .btnRow { display:flex; gap:10px; flex-wrap:wrap; margin-top:10px; }
      button { padding:10px 14px; border-radius:10px; border:1px solid #ccc; background:#fff; cursor:pointer; font-size:15px; }
      button.primary { background:#111; color:#fff; border-color:#111; }
      button:disabled { opacity:.5; cursor:not-allowed; }
      .lock { color:#b45309; } /* amber-ish */
      .ok { color:#166534; }   /* green-ish */
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size:13px; }
    `]);

    const title = el("h2", {}, ["Main Phase"]);
    const subtitle = el("div", { class: "muted" }, [
      "Arrow keys move the active agent. Each turn allows up to ",
      String(state.turn.maxMoves),
      " moves. Then switch turns."
    ]);

    const turnBadge = el("div", { class: "badge", id: "turnBadge" }, []);
    const lockInfo = el("div", { class: "muted", id: "lockInfo" }, []);

    const topRow = el("div", { class: "topRow" }, [
      el("div", {}, [title, subtitle]),
      el("div", {}, [turnBadge, el("div", { style: "height:6px" }), lockInfo]),
    ]);

    const world = el("div", {
      class: "world",
      style: `grid-template-columns: repeat(${gridSize}, 1fr); grid-template-rows: repeat(${gridSize}, 1fr);`
    });

    const hud = el("div", { class: "hud" }, [
      el("div", { class: "hudBox" }, [
        el("div", { class: "hudRow" }, [
          el("div", {}, ["Trial"]),
          el("div", { class: "mono", id: "trialText" }, [String(trialIndex)]),
        ]),
        el("div", { class: "hudRow" }, [
          el("div", {}, ["Moves this turn"]),
          el("div", { class: "mono", id: "movesText" }, [`0/${state.turn.maxMoves}`]),
        ]),
      ]),
      el("div", { class: "hudBox" }, [
        el("div", { class: "hudRow" }, [
          el("div", {}, ["Forager position"]),
          el("div", { class: "mono", id: "foragerPos" }, [""]),
        ]),
        el("div", { class: "hudRow" }, [
          el("div", {}, ["Security position"]),
          el("div", { class: "mono", id: "securityPos" }, [""]),
        ]),
      ]),
      el("div", { class: "hudBox" }, [
        el("div", { class: "muted" }, ["Control mode"]),
        el("div", { class: "mono", id: "controlMode" }, [""]),
        el("div", { style: "height:8px" }),
        el("div", { class: "muted" }, ["Script/model placeholder"]),
        el("div", { class: "mono" }, [
          `policies.forager=${(state.policies.forager?.name || "custom")} | policies.security=${(state.policies.security?.name || "custom")}`
        ]),
      ]),
    ]);

    const endTurnBtn = el("button", {
      id: "endTurnBtn",
      onclick: () => endTurn("manual_end_turn")
    }, ["End Turn"]);

    const nextBtn = el("button", {
      class: "primary",
      id: "phaseNextBtn",
      onclick: () => {
        logger.log({
          trial_index: state.trialIndex,
          event_type: "ui",
          event_name: "click_next",
        });
        if (typeof onEnd === "function") onEnd({ reason: "next_clicked" });
      }
    }, ["Next"]);

    const btnRow = el("div", { class: "btnRow" }, [endTurnBtn, nextBtn]);

    const side = el("div", { class: "side" }, [hud, btnRow]);

    const gridWrap = el("div", { class: "gridWrap" }, [world, side]);

    const card = el("div", { class: "gameCard" }, [topRow, gridWrap]);

    mount.appendChild(style);
    mount.appendChild(card);

    // Build cells
    const cells = [];
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const c = el("div", { class: "cell", "data-x": x, "data-y": y }, []);
        world.appendChild(c);
        cells.push(c);
      }
    }

    function cellAt(x, y) {
      return cells[y * gridSize + x];
    }

    function setTurnUI() {
      const activeKey = currentAgentKey();
      const inactiveKey = otherAgentKey();
      const active = state.agents[activeKey];
      const inactive = state.agents[inactiveKey];

      // Badge: "Forager's Turn" etc
      turnBadge.innerHTML = "";
      turnBadge.appendChild(el("span", { class: `dot ${active.color}` }, []));
      turnBadge.appendChild(el("span", { class: "turnTitle" }, [`${active.name}'s Turn`]));
      turnBadge.appendChild(el("span", { class: "muted" }, [`(${state.turn.movesUsed}/${state.turn.maxMoves} moves)`]));

      // Lock info
      const human = state.turn.humanAgent;
      const lockText = (activeKey === human)
        ? `${active.name} is participant-controlled. ${inactive.name} is NOT controlled now.`
        : `${inactive.name} is participant-controlled (NOT controlled now). ${active.name} is scripted/model-controlled.`;

      lockInfo.className = `muted ${activeKey === human ? "ok" : "lock"}`;
      lockInfo.textContent = lockText;

      // Control mode box
      const cm = mount.querySelector("#controlMode");
      if (cm) {
        cm.textContent = isHumanTurn()
          ? `Participant controls: ${active.name}`
          : `Participant controls: ${state.agents[human].name} (LOCKED now)`;
      }

      // EndTurn button enabled always; but you can choose to disable when scripted if you prefer.
      endTurnBtn.disabled = false;
    }

    function setHUD() {
      const f = state.agents.forager;
      const s = state.agents.security;

      const movesText = mount.querySelector("#movesText");
      if (movesText) movesText.textContent = `${state.turn.movesUsed}/${state.turn.maxMoves}`;

      const fp = mount.querySelector("#foragerPos");
      if (fp) fp.textContent = `(${f.x}, ${f.y})`;

      const sp = mount.querySelector("#securityPos");
      if (sp) sp.textContent = `(${s.x}, ${s.y})`;
    }

    function render() {
      // Clear
      for (const c of cells) c.innerHTML = "";

      // Draw both agents (if they overlap, show both stacked)
      const f = state.agents.forager;
      const s = state.agents.security;

      const fCell = cellAt(f.x, f.y);
      fCell.appendChild(el("div", { class: "agent forager", title: "Forager" }));

      const sCell = cellAt(s.x, s.y);
      sCell.appendChild(el("div", { class: "agent security", title: "Security" }));

      setHUD();
      setTurnUI();
    }

    // ---------------------------
    // Turn logic
    // ---------------------------
    function logMove(agentKey, fromX, fromY, toX, toY, keyLabel, source) {
      logger.log({
        trial_index: state.trialIndex,
        event_type: source === "human" ? "key" : "model",
        event_name: "move",
        agent: agentKey,
        key: keyLabel || "",
        from_x: fromX,
        from_y: fromY,
        to_x: toX,
        to_y: toY,
        turn_agent: currentAgentKey(),
        turn_move_index: state.turn.movesUsed + 1,
      });
    }

    function attemptMove(agentKey, dx, dy, keyLabel, source) {
      if (!state.running) return false;
      const a = state.agents[agentKey];

      const fromX = a.x, fromY = a.y;
      const toX = clamp(fromX + dx, 0, gridSize - 1);
      const toY = clamp(fromY + dy, 0, gridSize - 1);

      logMove(agentKey, fromX, fromY, toX, toY, keyLabel, source);

      a.x = toX;
      a.y = toY;

      state.turn.movesUsed += 1;
      render();

      if (state.turn.movesUsed >= state.turn.maxMoves) {
        endTurn("auto_max_moves");
      }
      return true;
    }

    function endTurn(reason) {
      // log turn end
      logger.log({
        trial_index: state.trialIndex,
        event_type: "system",
        event_name: "end_turn",
        reason: reason || "",
        turn_agent: currentAgentKey(),
        moves_used: state.turn.movesUsed,
      });

      // advance
      state.turn.idx += 1;
      state.turn.movesUsed = 0;

      render();

      // If next agent is scripted/model, run its turn automatically (up to maxMoves)
      if (!isHumanTurn()) runScriptedTurn();
    }

    // ---------------------------
    // Scripted/model agent placeholder
    // ---------------------------
    function runScriptedTurn() {
      const agentKey = currentAgentKey();
      const policy = state.policies[agentKey] || IdlePolicy;

      logger.log({
        trial_index: state.trialIndex,
        event_type: "system",
        event_name: "scripted_turn_start",
        agent: agentKey,
        policy: policy.name || "custom",
      });

      // Take up to maxMoves actions from policy; stop if policy returns null
      while (state.running && currentAgentKey() === agentKey && state.turn.movesUsed < state.turn.maxMoves) {
        const act = policy.nextAction({
          gridSize: state.gridSize,
          agents: JSON.parse(JSON.stringify(state.agents)),
          turn: JSON.parse(JSON.stringify(state.turn)),
        });

        if (!act) break;
        attemptMove(agentKey, act.dx, act.dy, act.label || "policy", "model");
      }

      // End scripted turn (even if 0 moves)
      endTurn("scripted_turn_complete");
    }

    // ---------------------------
    // Human key handler (only during human-controlled agent's turn)
    // ---------------------------
    function onKeyDown(e) {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea") return;

      // If not human's turn, ignore keypresses but still could log if you want.
      if (!isHumanTurn()) {
        // Optional: log blocked key attempts
        // logger.log({ trial_index: state.trialIndex, event_type:"key", event_name:"blocked_key", key:e.key, turn_agent: currentAgentKey() });
        return;
      }

      const agentKey = currentAgentKey();

      switch (e.key) {
        case "ArrowUp":    e.preventDefault(); attemptMove(agentKey, 0, -1, "ArrowUp", "human"); break;
        case "ArrowDown":  e.preventDefault(); attemptMove(agentKey, 0,  1, "ArrowDown", "human"); break;
        case "ArrowLeft":  e.preventDefault(); attemptMove(agentKey, -1, 0, "ArrowLeft", "human"); break;
        case "ArrowRight": e.preventDefault(); attemptMove(agentKey,  1, 0, "ArrowRight", "human"); break;
        default:
          break;
      }
    }

    // ---------------------------
    // Initialize
    // ---------------------------
    logger.log({
      trial_index: state.trialIndex,
      event_type: "system",
      event_name: "game_start",
      grid_size: gridSize,
      max_moves_per_turn: state.turn.maxMoves,
      human_agent: state.turn.humanAgent,
    });

    window.addEventListener("keydown", onKeyDown);
    render();

    // If the first turn is scripted/model, run it immediately
    if (!isHumanTurn()) runScriptedTurn();

    // Public API
    return {
      getState: () => JSON.parse(JSON.stringify(state)),
      destroy: () => {
        if (!state.running) return;
        state.running = false;
        window.removeEventListener("keydown", onKeyDown);
        logger.log({ trial_index: state.trialIndex, event_type: "system", event_name: "game_destroy" });
        mount.innerHTML = "";
      },
    };
  }

  window.startGame = startGame;
})();
