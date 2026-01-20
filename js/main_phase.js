/* ===========================
   main_phase.js
   - 10x10 grid world
   - Two agents: Forager (green), Security (yellow)
   - Turn-based control, max 5 moves per turn
   - Model-controlled moves: 1 second per move, random direction
   - 1 round = both agents take a turn
   - Total rounds default: 20
   - No End Turn / Next / Save buttons
   =========================== */

(function () {
  "use strict";

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

  function sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  // Random direction policy (placeholder for CSV/model later)
  const RandomPolicy = {
    name: "random_direction",
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

  function startGame(containerId, config) {
    const {
      participantId,
      logger,
      trialIndex = 0,

      gridSize = 10,
      spawnForager = { x: 5, y: 5 },
      spawnSecurity = { x: 4, y: 5 },

      maxMovesPerTurn = 5,
      totalRounds = 20,

      // who participant controls: "forager" or "security"
      humanAgent = "forager",

      // model-controlled timing
      modelMoveMs = 1000,

      // human turn ends after idle timeout (since no End Turn button)
      humanIdleTimeoutMs = 5000,

      // placeholder policies (CSV/model later)
      policies = { forager: RandomPolicy, security: RandomPolicy },

      onEnd = null,
    } = config;

    if (!participantId) throw new Error("startGame requires participantId");
    if (!logger || typeof logger.log !== "function") throw new Error("startGame requires a logger with .log(evt)");

    const mount = typeof containerId === "string" ? document.getElementById(containerId) : containerId;
    if (!mount) throw new Error("Could not find container element for game.");
    mount.innerHTML = "";

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
        token: 0, // increments each turn to invalidate timers
      },

      round: {
        current: 1,
        total: totalRounds,
      },

      policies: {
        forager: policies.forager || RandomPolicy,
        security: policies.security || RandomPolicy,
      },

      timers: {
        humanIdle: null,
      },

      scriptedRunning: false,
    };

    const currentAgentKey = () => state.turn.order[state.turn.idx % state.turn.order.length];
    const otherAgentKey = () => state.turn.order[(state.turn.idx + 1) % state.turn.order.length];
    const isHumanTurn = () => currentAgentKey() === state.turn.humanAgent;

    // ---------------- UI ----------------
    const style = el("style", {}, [`
      .gameCard { background:#fff; border:1px solid #e6e6e6; border-radius:12px; padding:16px; box-shadow:0 1px 2px rgba(0,0,0,.04); }
      .muted { color:#666; font-size:14px; }
      .topRow { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-start; justify-content:space-between; margin-bottom:12px; }
      .badge { display:inline-flex; align-items:center; gap:8px; border:1px solid #eee; border-radius:999px; padding:8px 12px; }
      .dot { width:10px; height:10px; border-radius:50%; display:inline-block; }
      .dot.forager { background:#16a34a; }
      .dot.security { background:#eab308; }
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
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size:13px; }
      .lock { color:#b45309; }
      .ok { color:#166534; }
    `]);

    const title = el("h2", {}, ["Main Phase"]);
    const subtitle = el("div", { class: "muted" }, [
      `Round-based turns. Each agent can move up to ${state.turn.maxMoves} times per turn.`,
      " Human turn auto-ends after 2s inactivity."
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
        el("div", { class: "hudRow" }, [el("div", {}, ["Round"]), el("div", { class: "mono", id: "roundText" }, [""])]),
        el("div", { class: "hudRow" }, [el("div", {}, ["Moves (this turn)"]), el("div", { class: "mono", id: "movesText" }, [""])]),
      ]),
      el("div", { class: "hudBox" }, [
        el("div", { class: "hudRow" }, [el("div", {}, ["Forager"]), el("div", { class: "mono", id: "foragerPos" }, [""])]),
        el("div", { class: "hudRow" }, [el("div", {}, ["Security"]), el("div", { class: "mono", id: "securityPos" }, [""])]),
      ]),
      el("div", { class: "hudBox" }, [
        el("div", { class: "muted" }, ["Control"]),
        el("div", { class: "mono", id: "controlMode" }, [""]),
        el("div", { style: "height:8px" }),
        el("div", { class: "muted" }, ["Model placeholder"]),
        el("div", { class: "mono" }, [
          `policies.forager=${state.policies.forager?.name || "custom"} | policies.security=${state.policies.security?.name || "custom"}`
        ]),
      ]),
    ]);

    const side = el("div", { class: "side" }, [hud]);
    const gridWrap = el("div", { class: "gridWrap" }, [world, side]);
    const card = el("div", { class: "gameCard" }, [topRow, gridWrap]);

    mount.appendChild(style);
    mount.appendChild(card);

    // Cells
    const cells = [];
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const c = el("div", { class: "cell", "data-x": x, "data-y": y }, []);
        world.appendChild(c);
        cells.push(c);
      }
    }
    const cellAt = (x, y) => cells[y * gridSize + x];

    function setTurnUI() {
      const activeKey = currentAgentKey();
      const inactiveKey = otherAgentKey();
      const active = state.agents[activeKey];
      const inactive = state.agents[inactiveKey];

      turnBadge.innerHTML = "";
      turnBadge.appendChild(el("span", { class: `dot ${active.color}` }, []));
      turnBadge.appendChild(el("span", { class: "turnTitle" }, [`${active.name}'s Turn`]));
      turnBadge.appendChild(el("span", { class: "muted" }, [`(${state.turn.movesUsed}/${state.turn.maxMoves})`]));

      const human = state.turn.humanAgent;
      const lockText = (activeKey === human)
        ? `${active.name} is participant-controlled. ${inactive.name} is NOT controlled now.`
        : `${inactive.name} is participant-controlled (NOT controlled now). ${active.name} is model-controlled.`;

      lockInfo.className = `muted ${activeKey === human ? "ok" : "lock"}`;
      lockInfo.textContent = lockText;

      const cm = mount.querySelector("#controlMode");
      if (cm) {
        cm.textContent = isHumanTurn()
          ? `Participant controls: ${active.name}`
          : `Participant controls: ${state.agents[human].name} (LOCKED now)`;
      }
    }

    function setHUD() {
      const f = state.agents.forager;
      const s = state.agents.security;

      mount.querySelector("#roundText").textContent = `${state.round.current}/${state.round.total}`;
      mount.querySelector("#movesText").textContent = `${state.turn.movesUsed}/${state.turn.maxMoves}`;
      mount.querySelector("#foragerPos").textContent = `(${f.x}, ${f.y})`;
      mount.querySelector("#securityPos").textContent = `(${s.x}, ${s.y})`;
    }

    function render() {
      for (const c of cells) c.innerHTML = "";

      const f = state.agents.forager;
      const s = state.agents.security;

      cellAt(f.x, f.y).appendChild(el("div", { class: "agent forager", title: "Forager" }));
      cellAt(s.x, s.y).appendChild(el("div", { class: "agent security", title: "Security" }));

      setHUD();
      setTurnUI();
    }

    // ------------- turn/round progression -------------
    function clearHumanIdleTimer() {
      if (state.timers.humanIdle) {
        clearTimeout(state.timers.humanIdle);
        state.timers.humanIdle = null;
      }
    }

    function scheduleHumanIdleEnd() {
      clearHumanIdleTimer();
      const token = state.turn.token;
      state.timers.humanIdle = setTimeout(() => {
        if (!state.running) return;
        if (state.turn.token !== token) return;
        endTurn("idle_timeout");
      }, humanIdleTimeoutMs);
    }

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
        round: state.round.current,
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

      if (source === "human") scheduleHumanIdleEnd();

      if (state.turn.movesUsed >= state.turn.maxMoves) {
        endTurn("auto_max_moves");
      }
      return true;
    }

    function endGame(reason) {
      if (!state.running) return;
      state.running = false;
      clearHumanIdleTimer();

      logger.log({
        trial_index: state.trialIndex,
        event_type: "system",
        event_name: "game_end",
        reason: reason || "",
      });

      if (typeof onEnd === "function") onEnd({ reason: reason || "completed" });
    }

    function endTurn(reason) {
      if (!state.running) return;

      clearHumanIdleTimer();

      logger.log({
        trial_index: state.trialIndex,
        event_type: "system",
        event_name: "end_turn",
        reason: reason || "",
        round: state.round.current,
        turn_agent: currentAgentKey(),
        moves_used: state.turn.movesUsed,
      });

      // advance turn
      state.turn.idx += 1;
      state.turn.movesUsed = 0;
      state.turn.token += 1; // invalidate prior timers

      // if wrapped back to forager, a full round completed
      if (state.turn.idx % state.turn.order.length === 0) {
        logger.log({
          trial_index: state.trialIndex,
          event_type: "system",
          event_name: "end_round",
          round: state.round.current,
        });

        state.round.current += 1;
        if (state.round.current > state.round.total) {
          render();
          endGame("round_limit_reached");
          return;
        }
      }

      render();

      // start next turn
      if (isHumanTurn()) {
        scheduleHumanIdleEnd(); // starts idle countdown even if 0 moves
      } else {
        runScriptedTurn();      // model-controlled
      }
    }

    async function runScriptedTurn() {
      if (!state.running) return;
      if (state.scriptedRunning) return;
      state.scriptedRunning = true;

      const agentKey = currentAgentKey();
      const policy = state.policies[agentKey] || RandomPolicy;
      const token = state.turn.token;

      logger.log({
        trial_index: state.trialIndex,
        event_type: "system",
        event_name: "scripted_turn_start",
        agent: agentKey,
        policy: policy.name || "custom",
        round: state.round.current,
      });

      while (state.running &&
             state.turn.token === token &&
             currentAgentKey() === agentKey &&
             state.turn.movesUsed < state.turn.maxMoves) {

        const act = policy.nextAction({
          gridSize: state.gridSize,
          agents: JSON.parse(JSON.stringify(state.agents)),
          round: state.round.current,
          turn: JSON.parse(JSON.stringify(state.turn)),
        });

        if (!act) break;

        // 1s per model move
        await sleep(modelMoveMs);

        if (!state.running) break;
        if (state.turn.token !== token) break;
        if (currentAgentKey() !== agentKey) break;

        attemptMove(agentKey, act.dx, act.dy, act.label || "policy", "model");
      }

      state.scriptedRunning = false;

      if (state.running && state.turn.token === token && currentAgentKey() === agentKey) {
        endTurn("scripted_turn_complete");
      }
    }

    // Human key handler
    function onKeyDown(e) {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea") return;
      if (!state.running) return;
      if (!isHumanTurn()) return;

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

    // ---------------- initialize ----------------
    logger.log({
      trial_index: state.trialIndex,
      event_type: "system",
      event_name: "game_start",
      grid_size: gridSize,
      max_moves_per_turn: state.turn.maxMoves,
      total_rounds: state.round.total,
      human_agent: state.turn.humanAgent,
      model_move_ms: modelMoveMs,
      human_idle_timeout_ms: humanIdleTimeoutMs,
    });

    window.addEventListener("keydown", onKeyDown);
    render();

    // start first turn
    if (isHumanTurn()) scheduleHumanIdleEnd();
    else runScriptedTurn();

    return {
      getState: () => JSON.parse(JSON.stringify(state)),
      destroy: () => {
        if (!state.running) return;
        state.running = false;
        clearHumanIdleTimer();
        window.removeEventListener("keydown", onKeyDown);
        logger.log({ trial_index: state.trialIndex, event_type: "system", event_name: "game_destroy" });
        mount.innerHTML = "";
      },
    };
  }

  window.startGame = startGame;
})();
