/* ===========================
   main_phase.js (CSV-driven map + 4 aliens) — CLEAN + BIG BOARD + BOTTOM HUD
   =========================== */

(function () {
  "use strict";

  // CSV next to index.html (or adjust path)
  const MAP_CSV_URL = "./gridworld/grid_map.csv";

  // Defaults
  const DEFAULT_TOTAL_ROUNDS = 10;
  const DEFAULT_MAX_MOVES_PER_TURN = 5;

  // ---------- Small helpers ----------
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const chebDist = (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));

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

  // ---------- CSV ----------
  function splitCSVLine(line) {
    const out = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else {
        if (ch === ",") { out.push(cur); cur = ""; }
        else if (ch === '"') inQ = true;
        else cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  async function loadMapCSV(url) {
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to fetch CSV (${resp.status})`);
    const text = await resp.text();

    const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
    if (lines.length < 2) throw new Error("CSV has no data rows");

    const headers = splitCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
    const idx = (name) => headers.indexOf(name);

    const ix = idx("x"), iy = idx("y"), im = idx("mine_type"), ia = idx("alien_id");
    if (ix < 0 || iy < 0 || im < 0 || ia < 0) {
      throw new Error("CSV must have headers: x,y,mine_type,alien_id");
    }

    const rows = [];
    let maxX = 0, maxY = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = splitCSVLine(lines[i]);
      const x = parseInt((cols[ix] || "").trim(), 10);
      const y = parseInt((cols[iy] || "").trim(), 10);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      const mineType = (cols[im] || "").trim();
      const alienIdRaw = (cols[ia] || "").trim();
      const alienId = alienIdRaw ? parseInt(alienIdRaw, 10) : 0;

      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      rows.push({ x, y, mineType, alienId });
    }

    return { gridSize: Math.max(maxX, maxY) + 1, rows };
  }

  function makeEmptyTile() {
    return { revealed: false, goldMine: false, mineType: "", highReward: false, alienCenterId: 0 };
  }

  function buildMapFromCSV(gridSize, rows) {
    const map = Array.from({ length: gridSize }, () =>
      Array.from({ length: gridSize }, () => makeEmptyTile())
    );

    const alienCenters = new Map(); // id -> {id,x,y,discovered,removed}
    const mines = [];

    for (const r of rows) {
      if (r.x < 0 || r.y < 0 || r.x >= gridSize || r.y >= gridSize) continue;
      const t = map[r.y][r.x];

      if (r.mineType) {
        t.goldMine = true;
        t.mineType = r.mineType;
        mines.push({ x: r.x, y: r.y, type: r.mineType });
      }

      if (r.alienId && r.alienId > 0) {
        t.alienCenterId = r.alienId;
        alienCenters.set(r.alienId, { id: r.alienId, x: r.x, y: r.y, discovered: false, removed: false });
      }
    }

    // highReward = union of 3x3 around each alien center
    for (const a of alienCenters.values()) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = a.x + dx, y = a.y + dy;
        if (x >= 0 && y >= 0 && x < gridSize && y < gridSize) map[y][x].highReward = true;
      }
    }

    const aliens = [...alienCenters.values()].sort((p, q) => p.id - q.id);
    return { map, aliens, mines };
  }

  // ---------- Policy ----------
  const RandomPolicy = {
    name: "random_direction",
    nextAction: () => {
      const moves = [
        { kind: "move", dx: 0, dy: -1, dir: "up",    label: "ArrowUp" },
        { kind: "move", dx: 0, dy:  1, dir: "down",  label: "ArrowDown" },
        { kind: "move", dx: -1,dy:  0, dir: "left",  label: "ArrowLeft" },
        { kind: "move", dx: 1, dy:  0, dir: "right", label: "ArrowRight" },
      ];
      return moves[Math.floor(Math.random() * moves.length)];
    }
  };

  // ===================== GAME =====================
  function startGame(containerId, config) {
    const {
      participantId,
      logger,
      trialIndex = 0,

      maxMovesPerTurn = DEFAULT_MAX_MOVES_PER_TURN,
      totalRounds = DEFAULT_TOTAL_ROUNDS,

      humanAgent = "forager",
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
      running: true,

      gridSize: 0,
      map: [],
      aliens: [],
      mines: [],

      agents: {
        forager:  { name: "Forager",  cls: "forager",  x: 0, y: 0 },
        security: { name: "Security", cls: "security", x: 0, y: 0 },
      },

      goldTotal: 0,
      foragerStunTurns: 0,
      uiMessage: "",

      turn: { order: ["forager", "security"], idx: 0, movesUsed: 0, maxMoves: maxMovesPerTurn, humanAgent, token: 0 },
      round: { current: 1, total: totalRounds },

      policies: {
        forager: policies.forager || RandomPolicy,
        security: policies.security || RandomPolicy,
      },

      timers: { humanIdle: null },
      scriptedRunning: false,

      overlayActive: true,
      overlayDurationMs: 600,
      turnFlowToken: 0,
    };

    // ---------- Core getters ----------
    const curKey = () => state.turn.order[state.turn.idx % state.turn.order.length];
    const isHumanTurn = () => curKey() === state.turn.humanAgent;
    const turnInRound = () => (state.turn.idx % state.turn.order.length);
    const turnGlobal = () => state.turn.idx + 1;

    const tileAt = (x, y) => state.map[y][x];
    const alienById = (id) => state.aliens.find((a) => a.id === id) || null;

    const snapshot = () => ({
      forager_x: state.agents.forager.x,
      forager_y: state.agents.forager.y,
      security_x: state.agents.security.x,
      security_y: state.agents.security.y,
      gold_total: state.goldTotal,
      forager_stun_turns: state.foragerStunTurns,
    });

    const logSystem = (name, extra = {}) =>
      logger.log({
        trial_index: state.trialIndex,
        event_type: "system",
        event_name: name,
        round: state.round.current,
        round_total: state.round.total,
        turn_global: turnGlobal(),
        turn_index_in_round: turnInRound(),
        active_agent: curKey(),
        human_agent: state.turn.humanAgent,
        ...snapshot(),
        ...extra,
      });

    // ---------- UI ----------
    mount.appendChild(el("style", {}, [`
      html, body { height:100%; overflow:hidden; }
      body { margin:0; }

      .stage{
        width:100vw; height:100vh;
        display:flex; align-items:center; justify-content:center;
        background:#f7f7f7;
      }

      .card{
        width:min(92vw, 1200px);
        height:min(92vh, 980px);
        background:#fff;
        border:1px solid #e6e6e6;
        border-radius:16px;
        box-shadow:0 2px 12px rgba(0,0,0,.06);
        padding:14px;
        display:flex; flex-direction:column;
        gap:12px;
        position:relative;
        overflow:hidden;
      }

      .top{
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:12px;
      }

      .round{ font-weight:900; font-size:16px; }
      .badge{
        display:flex; align-items:center; gap:10px;
        padding:10px 14px;
        border-radius:999px;
        border:1px solid #e6e6e6;
        background:#fafafa;
        font-weight:900;
        font-size:18px;
        white-space:nowrap;
      }
      .dot{ width:14px; height:14px; border-radius:999px; }
      .dot.forager{ background:#16a34a; }
      .dot.security{ background:#eab308; }

      .turn{ display:flex; align-items:center; gap:10px; font-weight:900; font-size:22px; white-space:nowrap; }

      /* Big stable board: driven by vmin so it does NOT shrink due to side panels */
      .boardWrap{
        flex:1;
        display:flex;
        align-items:center;
        justify-content:center;
        min-height:0;
      }
      .board{
        width:min(76vmin, 900px);
        height:min(76vmin, 900px);
        border:2px solid #ddd;
        border-radius:14px;
        display:grid;
        background:#fff;
        user-select:none;
        overflow:hidden;
      }
      .cell{
        border:1px solid #f1f1f1;
        position:relative;
        display:flex; align-items:center; justify-content:center;
        box-sizing:border-box;
      }
      .cell.unrev{ background:#bdbdbd; }
      .cell.rev{ background:#ffffff; }

      .marker{
        position:absolute;
        width:12px; height:12px;
        border-radius:999px;
        top:6px; left:6px;
        opacity:.95;
      }
      .marker.gold{ background:#facc15; }
      .marker.alien{ background:#a855f7; }

      .agent2{ width:80%; height:80%; display:grid; grid-template-columns:1fr 1fr; gap:6px; }
      .agent{ width:72%; height:72%; border-radius:12px; }
      .agent.forager{ background:#16a34a; }
      .agent.security{ background:#eab308; }

      /* Bottom HUD (compact) */
      .hud{
        border:1px solid #e6e6e6;
        border-radius:14px;
        background:#fafafa;
        padding:10px 12px;
        display:grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap:10px;
        font-size:14px;
        min-height: 0;
      }
      .hud b{ font-weight:900; }
      .hud .msg{
        grid-column: 1 / -1;
        background:#fff;
        border:1px solid #e6e6e6;
        border-radius:12px;
        padding:10px 12px;
        font-weight:800;
      }
      .hud details{
        grid-column: 1 / -1;
        color:#555;
      }

      .overlay{
        position:absolute; inset:0;
        display:flex; align-items:center; justify-content:center;
        background:rgba(0,0,0,0.25);
        z-index: 50;
      }
      .overlayBox{
        background:rgba(255,255,255,0.96);
        border:1px solid #e6e6e6;
        border-radius:14px;
        padding:16px 20px;
        box-shadow:0 8px 24px rgba(0,0,0,0.15);
        font-weight:900;
        font-size:26px;
        text-align:center;
        width:min(520px, 86%);
      }
      .overlaySub{ margin-top:6px; font-size:13px; font-weight:700; color:#666; }
    `]));

    const roundEl = el("div", { class: "round" });
    const badgeDot = el("span", { class: "dot" });
    const badgeTxt = el("span");
    const badge = el("div", { class: "badge" }, [badgeDot, badgeTxt]);
    const turnEl = el("div", { class: "turn" });

    const top = el("div", { class: "top" }, [roundEl, badge, turnEl]);

    const board = el("div", { class: "board", id: "board" });
    const boardWrap = el("div", { class: "boardWrap" }, [board]);

    const hud = el("div", { class: "hud", id: "hud" });
    const card = el("div", { class: "card" }, [top, boardWrap, hud]);

    const overlay = el("div", { class: "overlay", id: "overlay" }, [
      el("div", { class: "overlayBox" }, [
        el("div", { id: "overlayText" }, ["Loading map…"]),
        el("div", { class: "overlaySub", id: "overlaySub" }, [""])
      ])
    ]);

    const stage = el("div", { class: "stage" }, [card, overlay]);
    mount.appendChild(stage);

    // Board cell refs
    let cells = [];
    const cellAt = (x, y) => cells[y * state.gridSize + x];

    function setMessage(msg) {
      state.uiMessage = msg || "";
      renderHUD();
    }

    function renderTop() {
      roundEl.textContent = `Round ${state.round.current} / ${state.round.total}`;

      const you = state.turn.humanAgent;
      badgeDot.className = "dot " + (you === "forager" ? "forager" : "security");
      badgeTxt.textContent = `You are: ${you === "forager" ? "Forager (Green)" : "Security (Yellow)"}`;

      const a = state.agents[curKey()];
      turnEl.innerHTML = "";
      turnEl.appendChild(el("span", { class: "dot " + a.cls }, []));
      turnEl.appendChild(el("span", {}, [`${a.name}'s Turn`]));
    }

    function buildBoard() {
      board.innerHTML = "";
      board.style.gridTemplateColumns = `repeat(${state.gridSize}, 1fr)`;
      board.style.gridTemplateRows = `repeat(${state.gridSize}, 1fr)`;
      cells = [];

      for (let y = 0; y < state.gridSize; y++) {
        for (let x = 0; x < state.gridSize; x++) {
          const c = el("div", { class: "cell unrev", "data-x": x, "data-y": y });
          board.appendChild(c);
          cells.push(c);
        }
      }
    }

    function tileLabel(tile) {
      if (!tile.revealed) return { label: "Unknown", detail: "" };
      if (tile.goldMine) return { label: "Gold Mine", detail: tile.mineType || "" };
      if (tile.alienCenterId) {
        const al = alienById(tile.alienCenterId);
        if (al && al.discovered && !al.removed) return { label: `Alien ${al.id} (discovered)`, detail: "Press P to chase away" };
      }
      return { label: "Empty", detail: tile.highReward ? "High-reward zone" : "" };
    }

    function renderBoard() {
      if (!cells.length) return;

      const fx = state.agents.forager.x, fy = state.agents.forager.y;
      const sx = state.agents.security.x, sy = state.agents.security.y;

      for (let y = 0; y < state.gridSize; y++) for (let x = 0; x < state.gridSize; x++) {
        const c = cellAt(x, y);
        const t = tileAt(x, y);
        c.className = "cell " + (t.revealed ? "rev" : "unrev");
        c.innerHTML = "";

        if (t.revealed && t.goldMine) c.appendChild(el("div", { class: "marker gold", title: t.mineType }, []));
        if (t.revealed && t.alienCenterId) {
          const al = alienById(t.alienCenterId);
          if (al && al.discovered && !al.removed) c.appendChild(el("div", { class: "marker alien", title: `Alien ${al.id}` }, []));
        }

        const hasF = (x === fx && y === fy);
        const hasS = (x === sx && y === sy);

        if (hasF && hasS) {
          c.appendChild(el("div", { class: "agent2" }, [
            el("div", { class: "agent forager", title: "Forager" }),
            el("div", { class: "agent security", title: "Security" }),
          ]));
        } else if (hasF) c.appendChild(el("div", { class: "agent forager", title: "Forager" }));
        else if (hasS) c.appendChild(el("div", { class: "agent security", title: "Security" }));
      }
    }

    function renderHUD() {
      const aKey = curKey();
      const a = state.agents[aKey];
      const t = tileAt(a.x, a.y);
      const info = tileLabel(t);

      const stun = state.foragerStunTurns > 0 ? `${state.foragerStunTurns} turn(s)` : "No";
      const msg = state.uiMessage ? `<div class="msg">${state.uiMessage}</div>` : "";

      hud.innerHTML = `
        <div><b>Active</b><br>${a.name}</div>
        <div><b>Gold</b><br>${state.goldTotal}</div>
        <div><b>Forager Stunned</b><br>${stun}</div>

        <div style="grid-column:1 / -1">
          <b>Current Tile</b><br>${info.label}${info.detail ? ` — ${info.detail}` : ""}
        </div>

        ${msg}

        <details>
          <summary><b>Controls</b></summary>
          Arrow keys move. Forager: <b>E</b> forge. Security: <b>Q</b> scan, <b>P</b> chase alien, <b>E</b> revive (stand on forager if stunned).
        </details>
      `;
    }

    function renderAll() {
      renderTop();
      renderBoard();
      renderHUD();
    }

    // ---------- Overlay ----------
    async function showOverlay(text, subText) {
      state.overlayActive = true;
      clearHumanIdleTimer();

      const t = document.getElementById("overlayText");
      const s = document.getElementById("overlaySub");
      if (t) t.textContent = text || "";
      if (s) s.textContent = subText || "";
      overlay.style.display = "flex";

      await sleep(state.overlayDurationMs);

      overlay.style.display = "none";
      state.overlayActive = false;

      if (state.running && isHumanTurn()) scheduleHumanIdleEnd();
    }

    // ---------- Timers ----------
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

    // ---------- Mechanics ----------
    function reveal(agentKey, x, y, cause) {
      const t = tileAt(x, y);
      if (t.revealed) return;
      t.revealed = true;
      logger.log({
        trial_index: state.trialIndex,
        event_type: "system",
        event_name: "tile_reveal",
        agent: agentKey,
        cause: cause || "enter",
        tile_x: x,
        tile_y: y,
        tile_gold_mine: t.goldMine ? 1 : 0,
        tile_mine_type: t.mineType || "",
        tile_high_reward: t.highReward ? 1 : 0,
        tile_alien_center_id: t.alienCenterId || 0,
        ...snapshot(),
      });
    }

    function logMove(agentKey, source, act, fromX, fromY, attemptedX, attemptedY, toX, toY, clampedFlag) {
      logger.log({
        trial_index: state.trialIndex,
        event_type: source === "human" ? "key" : "model",
        event_name: "move",
        round: state.round.current,
        round_total: state.round.total,
        turn_global: turnGlobal(),
        turn_index_in_round: turnInRound(),
        active_agent: curKey(),
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
        clamped: clampedFlag ? 1 : 0,
        key: act.label || "",
        ...snapshot(),
      });
    }

    function logAction(agentKey, actionName, source, payload = {}) {
      logger.log({
        trial_index: state.trialIndex,
        event_type: source === "human" ? "action" : "model_action",
        event_name: actionName,
        round: state.round.current,
        round_total: state.round.total,
        turn_global: turnGlobal(),
        turn_index_in_round: turnInRound(),
        active_agent: curKey(),
        human_agent: state.turn.humanAgent,
        controller: source,
        agent: agentKey,
        move_index_in_turn: state.turn.movesUsed + 1,
        agent_x: state.agents[agentKey].x,
        agent_y: state.agents[agentKey].y,
        ...snapshot(),
        ...payload,
      });
    }

    function consumeMove(source) {
      state.turn.movesUsed += 1;
      renderAll();
      if (source === "human") scheduleHumanIdleEnd();
      if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");
    }

    function endGame(reason) {
      if (!state.running) return;
      state.running = false;
      clearHumanIdleTimer();
      logSystem("game_end", { reason: reason || "" });
      if (typeof onEnd === "function") onEnd({ reason: reason || "completed" });
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
          renderAll();
          endGame("round_limit_reached");
          return;
        }
      }
      startTurnFlow();
    }

    function attemptMove(agentKey, act, source) {
      if (!state.running || state.overlayActive) return false;

      const a = state.agents[agentKey];
      const fromX = a.x, fromY = a.y;
      const attemptedX = fromX + act.dx;
      const attemptedY = fromY + act.dy;

      const toX = clamp(attemptedX, 0, state.gridSize - 1);
      const toY = clamp(attemptedY, 0, state.gridSize - 1);
      const clampedFlag = (toX !== attemptedX) || (toY !== attemptedY);

      logMove(agentKey, source, act, fromX, fromY, attemptedX, attemptedY, toX, toY, clampedFlag);

      a.x = toX; a.y = toY;
      reveal(agentKey, toX, toY, "move");

      state.turn.movesUsed += 1;
      renderAll();

      if (source === "human") scheduleHumanIdleEnd();
      if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");

      return true;
    }

    function anyAlienCanAttack(fx, fy) {
      for (const al of state.aliens) {
        if (al.removed) continue;
        if (chebDist(fx, fy, al.x, al.y) <= 1) return al;
      }
      return null;
    }

    async function stunEndTurn(attacker) {
      await showOverlay("Forager is stunned", attacker ? `Alien ${attacker.id} attacked` : "Alien attacked");
      endTurn("stunned_by_alien");
    }

    async function doAction(agentKey, keyLower, source) {
      if (!state.running || state.overlayActive) return;

      const a = state.agents[agentKey];
      const t = tileAt(a.x, a.y);

      // FORAGER: E forge
      if (agentKey === "forager" && keyLower === "e") {
        const before = state.goldTotal;
        let success = 0, delta = 0, note = "";

        if (t.revealed && t.goldMine) {
          state.goldTotal += 1;
          success = 1; delta = 1;
          note = `Forged +1 on ${t.mineType}`;
          setMessage(`Forged +1 gold (${t.mineType}). Total: ${state.goldTotal}`);
        } else {
          note = "No gold mine here";
          setMessage("No gold mine here.");
        }

        logAction(agentKey, "forge", source, {
          success,
          gold_before: before,
          gold_after: state.goldTotal,
          gold_delta: delta,
          tile_gold_mine: t.goldMine ? 1 : 0,
          tile_mine_type: t.mineType || "",
          key: "e",
          note,
        });

        consumeMove(source);

        // Alien detection only if successful forge
        const attacker = success ? anyAlienCanAttack(a.x, a.y) : null;
        if (attacker) {
          state.foragerStunTurns = Math.max(state.foragerStunTurns, 3);
          logSystem("alien_attack", {
            attacker_alien_id: attacker.id,
            alien_x: attacker.x, alien_y: attacker.y,
            forge_x: a.x, forge_y: a.y,
            stun_turns_set: state.foragerStunTurns,
          });
          setMessage("Alien attacks! Forager is stunned.");
          await stunEndTurn(attacker);
        }
        return;
      }

      // SECURITY: Q scan
      if (agentKey === "security" && keyLower === "q") {
        let success = 0, found = 0, note = "";

        if (t.alienCenterId) {
          const al = alienById(t.alienCenterId);
          if (al && !al.removed) {
            found = 1; success = 1;
            if (!al.discovered) { al.discovered = true; note = `Discovered alien ${al.id}`; setMessage("Scan: Alien discovered."); }
            else { note = `Alien ${al.id} already discovered`; setMessage("Scan: Alien already discovered."); }
          } else { note = "Alien removed"; setMessage("Scan: no alien detected."); }
        } else { note = "No alien center"; setMessage("Scan: no alien detected."); }

        logAction(agentKey, "scan", source, {
          success, found_alien: found,
          tile_alien_center_id: t.alienCenterId || 0,
          key: "q", note
        });

        consumeMove(source);
        return;
      }

      // SECURITY: P chase (must be discovered, on center)
      if (agentKey === "security" && keyLower === "p") {
        let success = 0, note = "";

        if (t.alienCenterId) {
          const al = alienById(t.alienCenterId);
          if (al && !al.removed && al.discovered) {
            al.removed = true;
            success = 1;
            note = `Alien ${al.id} chased away`;
            setMessage("Alien chased away.");
            logSystem("alien_chased_away", { alien_id: al.id, alien_x: al.x, alien_y: al.y });
          } else if (al && !al.removed && !al.discovered) {
            note = "Not discovered"; setMessage("Scan (Q) first to discover the alien.");
          } else {
            note = "No alien"; setMessage("No alien on this tile.");
          }
        } else { note = "No alien center"; setMessage("No alien on this tile."); }

        logAction(agentKey, "push_alien", source, {
          success,
          tile_alien_center_id: t.alienCenterId || 0,
          key: "p", note
        });

        consumeMove(source);
        return;
      }

      // SECURITY: E revive forager
      if (agentKey === "security" && keyLower === "e") {
        const fx = state.agents.forager.x, fy = state.agents.forager.y;
        const sx = state.agents.security.x, sy = state.agents.security.y;

        let success = 0, note = "";
        if (state.foragerStunTurns > 0 && fx === sx && fy === sy) {
          state.foragerStunTurns = 0;
          success = 1; note = "Revived"; setMessage("Forager revived.");
        } else if (state.foragerStunTurns === 0) {
          note = "Not stunned"; setMessage("Forager is not stunned.");
        } else {
          note = "Not on forager"; setMessage("Stand on forager tile to revive.");
        }

        logAction(agentKey, "revive_forager", source, {
          success,
          on_forager_tile: (fx === sx && fy === sy) ? 1 : 0,
          forager_stun_turns_after: state.foragerStunTurns,
          key: "e", note
        });

        consumeMove(source);
        return;
      }

      // Other key: no effect but consumes move
      logAction(agentKey, "action_no_effect", source, { pressed_key: keyLower, note: "No effect" });
      setMessage("No effect.");
      consumeMove(source);
    }

    // ---------- Turn flow ----------
    async function startTurnFlow() {
      if (!state.running) return;
      const flowToken = ++state.turnFlowToken;

      renderAll();

      const aKey = curKey();

      // if forager is stunned, skip this forager turn
      if (aKey === "forager" && state.foragerStunTurns > 0) {
        const before = state.foragerStunTurns;
        await showOverlay("Forager is stunned", `${before} turn(s) remaining`);
        if (!state.running || state.turnFlowToken !== flowToken) return;

        state.foragerStunTurns -= 1;
        logSystem("stun_turn_skipped", { stun_before: before, stun_after: state.foragerStunTurns });
        endTurn("stunned_skip_turn");
        return;
      }

      const a = state.agents[aKey];
      await showOverlay(`${a.name}'s Turn`, "");
      if (!state.running || state.turnFlowToken !== flowToken) return;

      logSystem("start_turn", { controller: isHumanTurn() ? "human" : "model" });

      if (isHumanTurn()) scheduleHumanIdleEnd();
      else runScriptedTurn();
    }

    async function runScriptedTurn() {
      if (!state.running || state.scriptedRunning || state.overlayActive) return;

      state.scriptedRunning = true;

      const agentKey = curKey();
      const policy = state.policies[agentKey] || RandomPolicy;
      const token = state.turn.token;

      logSystem("scripted_turn_start", { agent: agentKey, policy: policy.name || "custom" });

      while (
        state.running &&
        state.turn.token === token &&
        curKey() === agentKey &&
        state.turn.movesUsed < state.turn.maxMoves
      ) {
        const act = policy.nextAction({ gridSize: state.gridSize, agents: JSON.parse(JSON.stringify(state.agents)), round: state.round.current });
        if (!act || act.kind !== "move") break;

        await sleep(modelMoveMs);
        if (!state.running || state.turn.token !== token || curKey() !== agentKey || state.overlayActive) break;

        attemptMove(agentKey, act, "model");
      }

      state.scriptedRunning = false;

      if (state.running && state.turn.token === token && curKey() === agentKey) {
        endTurn("scripted_turn_complete");
      }
    }

    // ---------- Input ----------
    function onKeyDown(e) {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea") return;
      if (!state.running || state.overlayActive || !isHumanTurn()) return;

      const agentKey = curKey();
      const mk = (dx, dy, dir, label) => ({ kind: "move", dx, dy, dir, label });

      if (e.key === "ArrowUp")    { e.preventDefault(); attemptMove(agentKey, mk(0, -1, "up", "ArrowUp"), "human"); return; }
      if (e.key === "ArrowDown")  { e.preventDefault(); attemptMove(agentKey, mk(0,  1, "down","ArrowDown"), "human"); return; }
      if (e.key === "ArrowLeft")  { e.preventDefault(); attemptMove(agentKey, mk(-1, 0, "left","ArrowLeft"), "human"); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); attemptMove(agentKey, mk( 1, 0, "right","ArrowRight"), "human"); return; }

      const k = (e.key || "").toLowerCase();
      if (k === "e" || k === "q" || k === "p") {
        e.preventDefault();
        doAction(agentKey, k, "human");
      }
    }

    // ---------- Init ----------
    async function initFromCSV() {
      try {
        overlay.style.display = "flex";
        state.overlayActive = true;

        const { gridSize, rows } = await loadMapCSV(MAP_CSV_URL);
        const built = buildMapFromCSV(gridSize, rows);

        state.gridSize = gridSize;
        state.map = built.map;
        state.aliens = built.aliens;
        state.mines = built.mines;

        // Spawn both at center
        const c = Math.floor((state.gridSize - 1) / 2);
        state.agents.forager.x = c; state.agents.forager.y = c;
        state.agents.security.x = c; state.agents.security.y = c;

        buildBoard();

        reveal("forager", c, c, "spawn");
        reveal("security", c, c, "spawn");

        logSystem("map_loaded_csv", {
          map_csv_url: MAP_CSV_URL,
          grid_size: state.gridSize,
          aliens_json: JSON.stringify(state.aliens.map((a) => ({ id: a.id, x: a.x, y: a.y }))),
          mines_json: JSON.stringify(state.mines),
        });

        window.addEventListener("keydown", onKeyDown);

        overlay.style.display = "none";
        state.overlayActive = false;

        renderAll();
        startTurnFlow();

      } catch (err) {
        setMessage(`Map load failed: ${String(err.message || err)}`);
        logger.log({ trial_index: state.trialIndex, event_type: "system", event_name: "map_load_error", error: String(err.message || err) });

        overlay.style.display = "flex";
        const t = document.getElementById("overlayText");
        const s = document.getElementById("overlaySub");
        if (t) t.textContent = "Map load failed";
        if (s) s.textContent = "Check MAP_CSV_URL and that the CSV is included in your GitHub Pages build.";
      }
    }

    initFromCSV();

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
