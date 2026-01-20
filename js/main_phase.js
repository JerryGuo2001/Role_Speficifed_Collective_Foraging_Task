/* ===========================
   main_phase.js
   - Responsive centered UI ~70% viewport (card)
   - Grid stays square; agent stays square (rounded)
   - Top includes centered "You are: <role>" (bigger, nicer)
   - Turn-switch overlay: dim + centered text 0.6s
     - Blocks input during overlay
     - Pauses "human idle" timer effectively
     - Excludes overlay time from RT logging (by adjusting DataSaver.lastEventPerf)
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

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  const RandomPolicy = {
    name: "random_direction",
    nextAction: () => {
      const moves = [
        { dx: 0, dy: -1, dir: "up",    label: "ArrowUp" },
        { dx: 0, dy:  1, dir: "down",  label: "ArrowDown" },
        { dx: -1,dy:  0, dir: "left",  label: "ArrowLeft" },
        { dx: 1, dy:  0, dir: "right", label: "ArrowRight" },
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
      totalRounds = 10,

      humanAgent = "forager",   // "forager" or "security"
      modelMoveMs = 1000,
      humanIdleTimeoutMs = 2000,

      policies = { forager: RandomPolicy, security: RandomPolicy },

      onEnd = null,
    } = config;

    if (!participantId) throw new Error("startGame requires participantId");
    if (!logger || typeof logger.log !== "function") throw new Error("startGame requires logger.log(evt)");

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
        security:{ name: "Security",color: "security",x: spawnSecurity.x,y: spawnSecurity.y },
      },

      turn: {
        order: ["forager", "security"],
        idx: 0,
        movesUsed: 0,
        maxMoves: maxMovesPerTurn,
        humanAgent,
        token: 0,
      },

      round: {
        current: 1,
        total: totalRounds,
      },

      policies: {
        forager: policies.forager || RandomPolicy,
        security: policies.security || RandomPolicy,
      },

      timers: { humanIdle: null },
      scriptedRunning: false,

      overlayActive: false,
      overlayDurationMs: 600,
    };

    const currentAgentKey = () => state.turn.order[state.turn.idx % state.turn.order.length];
    const isHumanTurn = () => currentAgentKey() === state.turn.humanAgent;
    const turnIndexInRound = () => (state.turn.idx % state.turn.order.length);
    const turnGlobal = () => state.turn.idx + 1;

    const snapshotPos = () => ({
      forager_x: state.agents.forager.x,
      forager_y: state.agents.forager.y,
      security_x: state.agents.security.x,
      security_y: state.agents.security.y,
    });

    // ---------------- UI ----------------
    const style = el("style", {}, [`
      .gameStage{
        width: 100%;
        height: 100%;
        display:flex;
        justify-content:center;
        align-items:center;
        overflow:hidden;
      }

      .gameCard{
        background:#fff;
        border:1px solid #e6e6e6;
        border-radius:16px;
        padding:16px;
        box-shadow:0 2px 10px rgba(0,0,0,.06);

        width: min(75vw, 980px);
        height: min(75vh, 900px);

        display:flex;
        flex-direction:column;
        gap:12px;
        overflow:hidden;
        position: relative;
      }

      /* Top bar as a 3-column grid:
         left = round text, center = YOU ARE badge, right = turn indicator */
      .topBar{
        display:grid;
        grid-template-columns: 1fr auto 1fr;
        align-items:start;
        gap: 12px;
      }

      .roundText{
        font-size:16px;
        font-weight:800;
        line-height:1.1;
        justify-self:start;
      }

      .youAreBadge{
        justify-self:center;
        display:inline-flex;
        align-items:center;
        gap:10px;

        padding:10px 14px;
        border-radius:999px;
        border:1px solid #e6e6e6;
        background:#fafafa;
        box-shadow: 0 1px 2px rgba(0,0,0,.04);

        font-size:18px;
        font-weight:900;
        color:#111;
        line-height:1;
        white-space:nowrap;
      }

      .youDot{
        width:14px;height:14px;border-radius:999px;
        display:inline-block;
      }
      .youDot.forager{ background:#16a34a; }
      .youDot.security{ background:#eab308; }

      .turnBig{
        justify-self:end;
        display:flex;
        align-items:center;
        gap:10px;
        font-size:24px;
        font-weight:900;
        line-height:1.1;
        white-space:nowrap;
      }

      .dot{
        width:16px;height:16px;border-radius:50%;
        display:inline-block;
      }
      .dot.forager{ background:#16a34a; }
      .dot.security{ background:#eab308; }

      /* World fills remaining space, stays square */
      .world{
        flex: 1;
        width: 100%;
        max-height: 100%;
        aspect-ratio: 1 / 1;

        margin: 0 auto;
        border:2px solid #ddd;
        border-radius:14px;
        display:grid;
        user-select:none;
        overflow:hidden;
        background: #fff;
      }

      .cell{
        border:1px solid #f1f1f1;
        display:flex;
        align-items:center;
        justify-content:center;
      }

      /* Agent glyph: rounded block, strictly square (no stretching) */
      .agent{
        width:72%;
        height:72%;
        aspect-ratio: 1 / 1;   /* key: prevents rectangle distortion */
        border-radius:12px;   /* restore rounded look */
      }
      .agent.forager{ background:#16a34a; }
      .agent.security{ background:#eab308; }

      /* Turn transition overlay */
      .turnOverlay{
        position:absolute;
        inset:0;
        display:none;
        align-items:center;
        justify-content:center;
        background: rgba(0,0,0,0.25);
        z-index: 20;
      }
      .turnOverlay.active{
        display:flex;
      }
      .turnOverlayBox{
        background: rgba(255,255,255,0.95);
        border: 1px solid #e6e6e6;
        border-radius: 14px;
        padding: 16px 20px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.15);
        font-weight: 900;
        font-size: 26px;
        color: #111;
        text-align:center;
        width: min(420px, 86%);
      }
      .turnOverlaySub{
        margin-top: 6px;
        font-size: 13px;
        font-weight: 700;
        color: #666;
      }
    `]);

    const roundEl = el("div", { class: "roundText", id: "roundText" }, []);
    const youBadge = el("div", { class: "youAreBadge", id: "youAreBadge" }, [
      el("span", { class: "youDot", id: "youDot" }, []),
      el("span", { id: "youText" }, [""])
    ]);
    const turnEl = el("div", { class: "turnBig", id: "turnBig" }, []);

    const topBar = el("div", { class: "topBar" }, [roundEl, youBadge, turnEl]);

    const world = el("div", {
      class: "world",
      style: `grid-template-columns: repeat(${gridSize}, 1fr); grid-template-rows: repeat(${gridSize}, 1fr);`
    });

    const overlay = el("div", { class: "turnOverlay", id: "turnOverlay" }, [
      el("div", { class: "turnOverlayBox", id: "turnOverlayBox" }, [
        el("div", { id: "turnOverlayText" }, [""]),
        el("div", { class: "turnOverlaySub" }, [""])
      ])
    ]);

    const card = el("div", { class: "gameCard" }, [topBar, world, overlay]);
    const stage = el("div", { class: "gameStage" }, [card]);

    mount.appendChild(style);
    mount.appendChild(stage);

    // cells
    const cells = [];
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const c = el("div", { class: "cell" }, []);
        world.appendChild(c);
        cells.push(c);
      }
    }
    const cellAt = (x, y) => cells[y * gridSize + x];

    function humanRoleLabel() {
      return state.turn.humanAgent === "forager" ? "Forager (Green)" : "Security (Yellow)";
    }

    function renderTop() {
      roundEl.textContent = `Round ${state.round.current} / ${state.round.total}`;

      const youDotEl = document.getElementById("youDot");
      const youTextEl = document.getElementById("youText");

      if (youTextEl) youTextEl.textContent = `You are: ${humanRoleLabel()}`;
      if (youDotEl) {
        youDotEl.className = "youDot " + (state.turn.humanAgent === "forager" ? "forager" : "security");
      }

      const aKey = currentAgentKey();
      const a = state.agents[aKey];

      turnEl.innerHTML = "";
      turnEl.appendChild(el("span", { class: `dot ${a.color}` }, []));
      turnEl.appendChild(el("span", {}, [`${a.name}'s Turn`]));
    }

    function renderGrid() {
      for (const c of cells) c.innerHTML = "";

      const f = state.agents.forager;
      const s = state.agents.security;

      cellAt(f.x, f.y).appendChild(el("div", { class: "agent forager", title: "Forager" }));
      cellAt(s.x, s.y).appendChild(el("div", { class: "agent security", title: "Security" }));
    }

    function render() {
      renderTop();
      renderGrid();
    }

    // ---------------- timers ----------------
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
        if (state.overlayActive) return;
        endTurn("idle_timeout");
      }, humanIdleTimeoutMs);
    }

    // ---------------- logging helpers ----------------
    function logSystem(name, extra = {}) {
      logger.log({
        trial_index: state.trialIndex,
        event_type: "system",
        event_name: name,
        round: state.round.current,
        round_total: state.round.total,
        turn_global: turnGlobal(),
        turn_index_in_round: turnIndexInRound(),
        active_agent: currentAgentKey(),
        human_agent: state.turn.humanAgent,
        ...snapshotPos(),
        ...extra,
      });
    }

    function logMove(agentKey, source, act, fromX, fromY, attemptedX, attemptedY, toX, toY, clamped) {
      logger.log({
        trial_index: state.trialIndex,
        event_type: source === "human" ? "key" : "model",
        event_name: "move",

        round: state.round.current,
        round_total: state.round.total,

        turn_global: turnGlobal(),
        turn_index_in_round: turnIndexInRound(),
        active_agent: currentAgentKey(),
        human_agent: state.turn.humanAgent,
        controller: source,

        agent: agentKey,
        move_index_in_turn: state.turn.movesUsed + 1,

        dir: act.dir || "",
        dx: act.dx,
        dy: act.dy,

        from_x: fromX,
        from_y: fromY,
        attempted_x: attemptedX,
        attempted_y: attemptedY,
        to_x: toX,
        to_y: toY,
        clamped: clamped ? 1 : 0,

        key: act.label || "",
        ...snapshotPos(),
      });
    }

    // ---------------- overlay / turn transition gate ----------------
    function adjustLoggerClock(ms) {
      // exclude overlay time from RT logging
      try {
        if (logger && typeof logger === "object" && typeof logger.lastEventPerf === "number") {
          logger.lastEventPerf += ms;
        }
      } catch (_) {}
    }

    async function showTurnOverlay(text) {
      state.overlayActive = true;
      clearHumanIdleTimer();

      const txt = overlay.querySelector("#turnOverlayText");
      if (txt) txt.textContent = text;

      overlay.classList.add("active");

      const ms = state.overlayDurationMs;
      adjustLoggerClock(ms);

      await sleep(ms);

      overlay.classList.remove("active");
      state.overlayActive = false;

      if (state.running && isHumanTurn()) scheduleHumanIdleEnd();
    }

    // ---------------- core mechanics ----------------
    function attemptMove(agentKey, act, source) {
      if (!state.running) return false;
      if (state.overlayActive) return false;

      const a = state.agents[agentKey];

      const fromX = a.x, fromY = a.y;
      const attemptedX = fromX + act.dx;
      const attemptedY = fromY + act.dy;

      const toX = clamp(attemptedX, 0, gridSize - 1);
      const toY = clamp(attemptedY, 0, gridSize - 1);
      const clampedFlag = (toX !== attemptedX) || (toY !== attemptedY);

      logMove(agentKey, source, act, fromX, fromY, attemptedX, attemptedY, toX, toY, clampedFlag);

      a.x = toX;
      a.y = toY;
      state.turn.movesUsed += 1;

      render();

      if (source === "human") scheduleHumanIdleEnd();
      if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");

      return true;
    }

    function endGame(reason) {
      if (!state.running) return;
      state.running = false;
      clearHumanIdleTimer();

      logSystem("game_end", { reason: reason || "" });

      if (typeof onEnd === "function") onEnd({ reason: reason || "completed" });
    }

    async function startTurnFlow() {
      if (!state.running) return;

      render();

      const aKey = currentAgentKey();
      const a = state.agents[aKey];
      await showTurnOverlay(`${a.name}'s Turn`);

      if (!state.running) return;

      logSystem("start_turn", { controller: isHumanTurn() ? "human" : "model" });

      if (isHumanTurn()) scheduleHumanIdleEnd();
      else runScriptedTurn();
    }

    function endTurn(reason) {
      if (!state.running) return;

      clearHumanIdleTimer();
      logSystem("end_turn", { reason: reason || "", moves_used: state.turn.movesUsed });

      state.turn.idx += 1;
      state.turn.movesUsed = 0;
      state.turn.token += 1;

      if (state.turn.idx % state.turn.order.length === 0) {
        logSystem("end_round", { ended_round: state.round.current });
        state.round.current += 1;

        if (state.round.current > state.round.total) {
          render();
          endGame("round_limit_reached");
          return;
        }
      }

      startTurnFlow();
    }

    async function runScriptedTurn() {
      if (!state.running) return;
      if (state.scriptedRunning) return;
      if (state.overlayActive) return;

      state.scriptedRunning = true;

      const agentKey = currentAgentKey();
      const policy = state.policies[agentKey] || RandomPolicy;
      const token = state.turn.token;

      logSystem("scripted_turn_start", { agent: agentKey, policy: policy.name || "custom" });

      while (
        state.running &&
        state.turn.token === token &&
        currentAgentKey() === agentKey &&
        state.turn.movesUsed < state.turn.maxMoves
      ) {
        if (state.overlayActive) break;

        const act = policy.nextAction({
          gridSize: state.gridSize,
          agents: JSON.parse(JSON.stringify(state.agents)),
          round: state.round.current,
        });

        if (!act) break;

        await sleep(modelMoveMs);

        if (!state.running) break;
        if (state.turn.token !== token) break;
        if (currentAgentKey() !== agentKey) break;
        if (state.overlayActive) break;

        attemptMove(agentKey, act, "model");
      }

      state.scriptedRunning = false;

      if (state.running && state.turn.token === token && currentAgentKey() === agentKey) {
        endTurn("scripted_turn_complete");
      }
    }

    function onKeyDown(e) {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea") return;
      if (!state.running) return;
      if (state.overlayActive) return;
      if (!isHumanTurn()) return;

      const agentKey = currentAgentKey();
      const mk = (dx, dy, dir, label) => ({ dx, dy, dir, label });

      switch (e.key) {
        case "ArrowUp":    e.preventDefault(); attemptMove(agentKey, mk(0, -1, "up", "ArrowUp"), "human"); break;
        case "ArrowDown":  e.preventDefault(); attemptMove(agentKey, mk(0,  1, "down","ArrowDown"), "human"); break;
        case "ArrowLeft":  e.preventDefault(); attemptMove(agentKey, mk(-1, 0, "left","ArrowLeft"), "human"); break;
        case "ArrowRight": e.preventDefault(); attemptMove(agentKey, mk( 1, 0, "right","ArrowRight"), "human"); break;
        default:
          break;
      }
    }

    // ---------------- init ----------------
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
      ...snapshotPos(),
    });

    window.addEventListener("keydown", onKeyDown);
    render();

    startTurnFlow();

    return {
      getState: () => JSON.parse(JSON.stringify(state)),
      destroy: () => {
        if (!state.running) return;
        state.running = false;
        clearHumanIdleTimer();
        window.removeEventListener("keydown", onKeyDown);
        logSystem("game_destroy");
        mount.innerHTML = "";
      },
    };
  }

  window.startGame = startGame;
})();
