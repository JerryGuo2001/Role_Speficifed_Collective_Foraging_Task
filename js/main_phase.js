/* ===========================
   main_phase.js (CSV-driven map + 4 aliens) — MINIMAL UI + RANDOM ROLE
   - Center-screen freeze messages (0.8s) for events (mine found, alien revealed, stunned, mine depleted)
   - Gold mine type NEVER shown to participant (but still logged)
   - Mine decay after successful forging:
       A: 30% depleted
       B: 50% depleted
       C: 70% depleted
   - Alien attack chance (after successful forge within 3x3 of any alien center): 50%
   - Shows move counter under Round: "Moves: k / 5"
   =========================== */

(function () {
  "use strict";

  const MAP_CSV_URL = "./gridworld/grid_map.csv";

  const DEFAULT_TOTAL_ROUNDS = 10;
  const DEFAULT_MAX_MOVES_PER_TURN = 5;

  // ---------- Message timings ----------
  const TURN_BANNER_MS = 450;     // start-of-turn banner
  const EVENT_FREEZE_MS = 800;    // your requested freeze duration for events

  // ---------- Mine decay ----------
  const MINE_DECAY = { A: 0.30, B: 0.50, C: 0.70 };

  // ---------- Alien attack probability (after successful forge, if in range) ----------
  const ALIEN_ATTACK_PROB = 0.50;

  // ===================== MODEL SWITCH =====================
  const USE_CSB_MODEL = false;

  // Optional: provide a CSB model as window.CSB = { nextAction: ({agent, state}) => ({kind:'move',dx,dy}) or ({kind:'action', key:'e'}) }
  const getCSBModel = () => window.CSB || window.csb || window.CSBModel || null;

  // ---------- Small helpers ----------
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const chebDist = (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));

  // ===================== HEURISTIC HELPERS =====================
  const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

  function stepToward(fromX, fromY, toX, toY) {
    const dx = toX - fromX;
    const dy = toY - fromY;

    if (dx === 0 && dy === 0) return null;

    // 4-neighbor move: choose axis with larger distance (ties -> x)
    if (Math.abs(dx) >= Math.abs(dy)) {
      const sx = sgn(dx);
      return {
        kind: "move",
        dx: sx,
        dy: 0,
        dir: sx > 0 ? "right" : "left",
        label: sx > 0 ? "ArrowRight" : "ArrowLeft",
      };
    } else {
      const sy = sgn(dy);
      return {
        kind: "move",
        dx: 0,
        dy: sy,
        dir: sy > 0 ? "down" : "up",
        label: sy > 0 ? "ArrowDown" : "ArrowUp",
      };
    }
  }

  function normalizeModelAct(act) {
    if (!act || typeof act !== "object") return null;

    // Allow CSB/policies to omit kind but provide dx/dy or key
    if (!act.kind) {
      if (typeof act.dx === "number" && typeof act.dy === "number") act.kind = "move";
      else if (typeof act.key === "string") act.kind = "action";
      else return null;
    }

    if (act.kind === "action") {
      const k = String(act.key || "").toLowerCase();
      if (k === "e" || k === "q" || k === "p" || k === "0") return { kind: "action", key: k };
      return null;
    }

    if (act.kind === "move") {
      let dx = Number(act.dx || 0);
      let dy = Number(act.dy || 0);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;

      // force 4-neighbor
      dx = clamp(dx, -1, 1);
      dy = clamp(dy, -1, 1);
      if (dx !== 0 && dy !== 0) {
        // keep the larger component
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      if (dx === 0 && dy === 0) return null;

      const dir = dx === 1 ? "right" : dx === -1 ? "left" : dy === 1 ? "down" : "up";
      const label =
        dir === "right"
          ? "ArrowRight"
          : dir === "left"
          ? "ArrowLeft"
          : dir === "down"
          ? "ArrowDown"
          : "ArrowUp";
      return { kind: "move", dx, dy, dir, label };
    }

    return null;
  }

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
    if (ix < 0 || iy < 0 || im < 0 || ia < 0) throw new Error("CSV must have headers: x,y,mine_type,alien_id");

    const rows = [];
    let maxX = 0, maxY = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = splitCSVLine(lines[i]);
      const x = parseInt((cols[ix] || "").trim(), 10);
      const y = parseInt((cols[iy] || "").trim(), 10);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      const mineType = (cols[im] || "").trim(); // keep for logging/decay, NOT shown to participant
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

    // IMPORTANT: a tile can simultaneously be a gold mine AND an alien center.
    // This builder supports both (either in the same CSV row, or separate rows with same x,y).
    for (const r of rows) {
      if (r.x < 0 || r.y < 0 || r.x >= gridSize || r.y >= gridSize) continue;
      const t = map[r.y][r.x];

      if (r.mineType) {
        t.goldMine = true;
        t.mineType = r.mineType; // used for decay + logging only
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
    return { map, aliens };
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
      return moves[(Math.random() * moves.length) | 0];
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

      humanAgent = "random",
      modelMoveMs = 1000,
      humanIdleTimeoutMs = 10000,

      policies = { forager: RandomPolicy, security: RandomPolicy },
      onEnd = null,
    } = config;

    if (!participantId) throw new Error("startGame requires participantId");
    if (!logger || typeof logger.log !== "function") throw new Error("startGame requires logger.log(evt)");

    const mount = typeof containerId === "string" ? document.getElementById(containerId) : containerId;
    if (!mount) throw new Error("Could not find container element for game.");
    mount.innerHTML = "";

    let assignedHuman = humanAgent;
    if (!assignedHuman || assignedHuman === "random") assignedHuman = (Math.random() < 0.5) ? "forager" : "security";

    const state = {
      participantId,
      trialIndex,
      running: true,

      gridSize: 0,
      map: [],
      aliens: [],

      agents: {
        forager:  { name: "Forager",  cls: "forager",  x: 0, y: 0 },
        security: { name: "Security", cls: "security", x: 0, y: 0 },
      },

      goldTotal: 0,
      foragerStunTurns: 0,

      turn: { order: ["forager", "security"], idx: 0, movesUsed: 0, maxMoves: maxMovesPerTurn, humanAgent: assignedHuman, token: 0 },
      round: { current: 1, total: totalRounds },

      policies: {
        forager: policies.forager || RandomPolicy,
        security: policies.security || RandomPolicy,
      },

      timers: { humanIdle: null },
      scriptedRunning: false,

      overlayActive: true,
      turnFlowToken: 0,
    };

    // ---------- Core getters ----------
    const curKey = () => state.turn.order[state.turn.idx % state.turn.order.length];
    const isHumanTurn = () => curKey() === state.turn.humanAgent;
    const turnInRound = () => (state.turn.idx % state.turn.order.length);
    const turnGlobal = () => state.turn.idx + 1;

    const tileAt = (x, y) => state.map[y][x];
    const alienById = (id) => state.aliens.find((a) => a.id === id) || null;

    // ===================== HEURISTIC MODEL (when USE_CSB_MODEL === false) =====================
    function heuristicNextAction(agentKey) {
      if (agentKey === "security") return heuristicSecurity();
      if (agentKey === "forager") return heuristicForager();
      return null;
    }

    function heuristicSecurity() {
      const S = state.agents.security;
      const F = state.agents.forager;

      // Rule 1: If forager is stunned -> go to forager, revive when on same tile
      if (state.foragerStunTurns > 0) {
        if (S.x === F.x && S.y === F.y) return { kind: "action", key: "e" }; // revive
        return stepToward(S.x, S.y, F.x, F.y);
      }

      // Otherwise follow forager
      if (S.x === F.x && S.y === F.y) return null;
      return stepToward(S.x, S.y, F.x, F.y);
    }

    function heuristicForager() {
      const F = state.agents.forager;
      const S = state.agents.security;

      // Rule 2: If security is outside 2-block range, follow security
      if (chebDist(F.x, F.y, S.x, S.y) > 2) return stepToward(F.x, F.y, S.x, S.y);

      // If standing on a revealed gold mine -> mine it
      const here = tileAt(F.x, F.y);
      if (here.revealed && here.goldMine) return { kind: "action", key: "e" };

      // Find revealed gold mines within 2 blocks of SECURITY (Chebyshev <= 2)
      const candidates = [];
      for (let yy = S.y - 2; yy <= S.y + 2; yy++) {
        for (let xx = S.x - 2; xx <= S.x + 2; xx++) {
          if (xx < 0 || yy < 0 || xx >= state.gridSize || yy >= state.gridSize) continue;
          if (chebDist(xx, yy, S.x, S.y) > 2) continue;

          const t = tileAt(xx, yy);
          if (t.revealed && t.goldMine) candidates.push({ x: xx, y: yy, dF: chebDist(F.x, F.y, xx, yy) });
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => a.dF - b.dF || a.y - b.y || a.x - b.x);
        const target = candidates[0];
        if (target.x === F.x && target.y === F.y) return { kind: "action", key: "e" };
        return stepToward(F.x, F.y, target.x, target.y);
      }

      // No revealed mines nearby: follow security; if already on security -> stop
      if (F.x === S.x && F.y === S.y) return null;
      return stepToward(F.x, F.y, S.x, S.y);
    }

    // ===================== MODEL ACTION ROUTER =====================
    function getModelAction(agentKey) {
      if (!USE_CSB_MODEL) return heuristicNextAction(agentKey);

      const csb = getCSBModel();
      if (csb && typeof csb.nextAction === "function") {
        const act = csb.nextAction({ agent: agentKey, state: JSON.parse(JSON.stringify(state)) });
        return normalizeModelAct(act);
      }

      const policy = state.policies[agentKey] || RandomPolicy;
      const act = policy.nextAction({
        gridSize: state.gridSize,
        agents: JSON.parse(JSON.stringify(state.agents)),
        round: state.round.current,
      });
      return normalizeModelAct(act);
    }

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
      .moves{ font-weight:800; font-size:14px; color:#444; margin-top:2px; }

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

      .boardWrap{
        flex:1;
        display:flex;
        align-items:center;
        justify-content:center;
        min-height:0;
      }
      .board{
        width:min(82vmin, 900px);
        height:min(82vmin, 900px);
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

      .agent{ width:72%; height:72%; border-radius:14px; box-shadow:0 2px 8px rgba(0,0,0,.12); }
      .agent.forager{ background:#16a34a; }
      .agent.security{ background:#eab308; }

      .agentPair{ width:82%; height:82%; position:relative; }
      .agentMini{
        position:absolute;
        width:66%;
        height:66%;
        border-radius:14px;
        border:2px solid rgba(255,255,255,.95);
        box-shadow:0 3px 10px rgba(0,0,0,.16);
      }
      .agentMini.forager{ left:0; top:0; background:#16a34a; }
      .agentMini.security{ right:0; bottom:0; background:#eab308; }

      .bottomBar{
        flex:0 0 auto;
        height:52px;
        border:1px solid #e6e6e6;
        border-radius:14px;
        background:#fafafa;
        display:flex;
        align-items:center;
        justify-content:center;
        font-weight:900;
        font-size:18px;
      }

      .overlay{
        position:absolute; inset:0;
        display:flex; align-items:center; justify-content:center;
        background:rgba(0,0,0,0.25);
        z-index: 50;
      }
      .overlayBox{
        background:rgba(255,255,255,0.98);
        border:1px solid #e6e6e6;
        border-radius:14px;
        padding:18px 22px;
        box-shadow:0 8px 24px rgba(0,0,0,0.15);
        font-weight:900;
        font-size:28px;
        text-align:center;
        width:min(560px, 86%);
      }
      .overlaySub{ margin-top:8px; font-size:14px; font-weight:800; color:#666; }
    `]));

    const roundEl = el("div", { class: "round" });
    const movesEl = el("div", { class: "moves" });
    const leftStack = el("div", { style: "display:flex;flex-direction:column;gap:2px;" }, [roundEl, movesEl]);

    const badgeDot = el("span", { class: "dot" });
    const badgeTxt = el("span");
    const badge = el("div", { class: "badge" }, [badgeDot, badgeTxt]);

    const turnEl = el("div", { class: "turn" });
    const top = el("div", { class: "top" }, [leftStack, badge, turnEl]);

    const board = el("div", { class: "board", id: "board" });
    const boardWrap = el("div", { class: "boardWrap" }, [board]);

    const bottomBar = el("div", { class: "bottomBar", id: "bottomBar" }, ["Gold: 0"]);

    const overlayTextEl = el("div", { id: "overlayText" }, ["Loading map…"]);
    const overlaySubEl  = el("div", { class: "overlaySub", id: "overlaySub" }, [""]);

    const overlay = el("div", { class: "overlay", id: "overlay" }, [
      el("div", { class: "overlayBox" }, [overlayTextEl, overlaySubEl])
    ]);

    const card = el("div", { class: "card" }, [top, boardWrap, bottomBar, overlay]);
    const stage = el("div", { class: "stage" }, [card]);
    mount.appendChild(stage);

    // Board cell refs
    let cells = [];
    const cellAt = (x, y) => cells[y * state.gridSize + x];

    function renderTop() {
      roundEl.textContent = `Round ${state.round.current} / ${state.round.total}`;
      movesEl.textContent = `Moves: ${state.turn.movesUsed} / ${state.turn.maxMoves}`;

      const you = state.turn.humanAgent;
      badgeDot.className = "dot " + (you === "forager" ? "forager" : "security");
      badgeTxt.textContent = `You are: ${you === "forager" ? "Forager (Green)" : "Security (Yellow)"}`;

      const a = state.agents[curKey()];
      turnEl.innerHTML = "";
      turnEl.appendChild(el("span", { class: "dot " + a.cls }, []));
      turnEl.appendChild(el("span", {}, [`${a.name}'s Turn`]));
    }

    function renderBottom() {
      bottomBar.textContent = `Gold: ${state.goldTotal}`;
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

    function renderBoard() {
      if (!cells.length) return;

      const fx = state.agents.forager.x, fy = state.agents.forager.y;
      const sx = state.agents.security.x, sy = state.agents.security.y;

      for (let y = 0; y < state.gridSize; y++) for (let x = 0; x < state.gridSize; x++) {
        const c = cellAt(x, y);
        const t = tileAt(x, y);
        c.className = "cell " + (t.revealed ? "rev" : "unrev");
        c.innerHTML = "";

        // Visible markers only when revealed
        // IMPORTANT: do NOT leak mineType via title/hover
        if (t.revealed && t.goldMine) c.appendChild(el("div", { class: "marker gold", title: "Gold mine" }, []));
        if (t.revealed && t.alienCenterId) {
          const al = alienById(t.alienCenterId);
          if (al && al.discovered && !al.removed) c.appendChild(el("div", { class: "marker alien", title: "Alien" }, []));
        }

        const hasF = (x === fx && y === fy);
        const hasS = (x === sx && y === sy);

        if (hasF && hasS) {
          c.appendChild(el("div", { class: "agentPair", title: "Forager + Security" }, [
            el("div", { class: "agentMini forager", title: "Forager" }),
            el("div", { class: "agentMini security", title: "Security" }),
          ]));
        } else if (hasF) c.appendChild(el("div", { class: "agent forager", title: "Forager" }));
        else if (hasS) c.appendChild(el("div", { class: "agent security", title: "Security" }));
      }
    }

    function renderAll() {
      renderTop();
      renderBoard();
      renderBottom();
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

    // ---------- Center message (FREEZE) ----------
    async function showCenterMessage(text, subText = "", ms = EVENT_FREEZE_MS) {
      state.overlayActive = true;
      clearHumanIdleTimer();

      overlayTextEl.textContent = text || "";
      overlaySubEl.textContent = subText || "";

      overlay.style.display = "flex";
      await sleep(ms);
      overlay.style.display = "none";

      state.overlayActive = false;
      if (state.running && isHumanTurn()) scheduleHumanIdleEnd();
    }

    // ---------- Mechanics ----------
    async function reveal(agentKey, x, y, cause) {
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
        tile_mine_type: t.mineType || "",          // logged, not shown
        tile_high_reward: t.highReward ? 1 : 0,
        tile_alien_center_id: t.alienCenterId || 0,
        ...snapshot(),
      });

      renderAll();

      if (t.goldMine) {
        await showCenterMessage("Found a gold mine", "", EVENT_FREEZE_MS);
      }
    }

    function logMove(agentKey, source, act, fromX, fromY, attemptedX, attemptedY, toX, toY, clampedFlag) {
      logger.log({
        trial_index: state.trialIndex,
        event_type: source === "human" ? "key" : "model",
        event_name: "move",
        round: state.round.current,
        round_total: state.round.total,
        turn_global: state.turn.idx + 1,
        turn_index_in_round: (state.turn.idx % state.turn.order.length),
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
        turn_global: state.turn.idx + 1,
        turn_index_in_round: (state.turn.idx % state.turn.order.length),
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

    async function attemptMove(agentKey, act, source) {
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

      await reveal(agentKey, toX, toY, "move");

      state.turn.movesUsed += 1;
      renderAll();

      if (source === "human") scheduleHumanIdleEnd();
      if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");

      return true;
    }

    // Alien in-range check (3x3 around center => Chebyshev <= 1)
    function anyAlienInRange(fx, fy) {
      for (const al of state.aliens) {
        if (al.removed) continue;
        if (chebDist(fx, fy, al.x, al.y) <= 1) return al;
      }
      return null;
    }

    // ---- robust mine type parsing (A/B/C extraction) ----
    function mineDecayKey(mineTypeRaw) {
      const s = String(mineTypeRaw || "").toUpperCase();
      const m = s.match(/[ABC]/); // handles "A", "a", "A_mine", "mine A", etc.
      return m ? m[0] : "";
    }

    function mineDecayProb(mineTypeRaw) {
      const k = mineDecayKey(mineTypeRaw);
      return MINE_DECAY[k] ?? 0;
    }

    async function maybeDepleteMineAtTile(tile, x, y) {
      if (!tile || !tile.goldMine) return { depleted: false };

      const k = mineDecayKey(tile.mineType);
      const p = mineDecayProb(tile.mineType);

      logSystem("mine_decay_check", {
        tile_x: x,
        tile_y: y,
        mine_type_raw: String(tile.mineType || ""),
        mine_type_key: k,
        decay_prob: p,
      });

      if (p <= 0) return { depleted: false, mine_type_key: k, decay_prob: 0 };

      const u = Math.random();
      if (u < p) {
        logSystem("gold_mine_depleted", {
          tile_x: x,
          tile_y: y,
          mine_type_key: k,
          mine_type_raw: String(tile.mineType || ""),
          decay_prob: p,
          rng_u: u,
        });

        tile.goldMine = false;
        tile.mineType = "";

        renderAll();
        await showCenterMessage("Gold mine fully dug", "", EVENT_FREEZE_MS);
        return { depleted: true, mine_type_key: k, decay_prob: p, rng_u: u };
      }

      logSystem("mine_not_depleted", {
        tile_x: x,
        tile_y: y,
        mine_type_key: k,
        decay_prob: p,
        rng_u: u,
      });

      return { depleted: false, mine_type_key: k, decay_prob: p, rng_u: u };
    }

    async function stunEndTurn(attacker) {
      await showCenterMessage(
        "Forager is stunned",
        attacker ? `Alien ${attacker.id} attacked` : "Alien attacked",
        1200
        //EVENT_FREEZE_MS
      );
      endTurn("stunned_by_alien");
    }

    async function doAction(agentKey, keyLower, source) {
      if (!state.running || state.overlayActive) return;

      const a = state.agents[agentKey];
      const t = tileAt(a.x, a.y);

      // FORAGER: E forge
      if (agentKey === "forager" && keyLower === "e") {
        const before = state.goldTotal;
        let success = 0;

        if (t.revealed && t.goldMine) {
          state.goldTotal += 1;
          success = 1;
        }

        logAction(agentKey, "forge", source, {
          success,
          gold_before: before,
          gold_after: state.goldTotal,
          gold_delta: success ? 1 : 0,
          tile_gold_mine: t.goldMine ? 1 : 0,
          tile_mine_type: t.mineType || "",
          key: "e",
        });

        state.turn.movesUsed += 1;
        renderAll();
        if (source === "human") scheduleHumanIdleEnd();

        // If successful forge: mine may deplete, then alien may attack (50% chance when in range)
        if (success) {
          await maybeDepleteMineAtTile(t, a.x, a.y);

          const attacker = anyAlienInRange(a.x, a.y);
          if (attacker) {
            const u = Math.random();
            const willAttack = (u < ALIEN_ATTACK_PROB);

            // Always log the attack check so you can verify the probability gate
            logSystem("alien_attack_check", {
              attacker_alien_id: attacker.id,
              alien_x: attacker.x,
              alien_y: attacker.y,
              forge_x: a.x,
              forge_y: a.y,
              attack_prob: ALIEN_ATTACK_PROB,
              rng_u: u,
              will_attack: willAttack ? 1 : 0,
            });

            if (willAttack) {
              state.foragerStunTurns = Math.max(state.foragerStunTurns, 3);
              logSystem("alien_attack", {
                attacker_alien_id: attacker.id,
                alien_x: attacker.x,
                alien_y: attacker.y,
                forge_x: a.x,
                forge_y: a.y,
                stun_turns_set: state.foragerStunTurns,
              });
              await stunEndTurn(attacker);
              return;
            }
          }
        }

        if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");
        return;
      }

      // SECURITY: Q scan (center message ONLY on NEW discovery)
      if (agentKey === "security" && keyLower === "q") {
        let success = 0, newlyFound = 0, foundId = 0;

        if (t.alienCenterId) {
          const al = alienById(t.alienCenterId);
          if (al && !al.removed) {
            success = 1;
            foundId = al.id;
            if (!al.discovered) {
              al.discovered = true;
              newlyFound = 1;
            }
          }
        }

        logAction(agentKey, "scan", source, {
          success,
          newly_found: newlyFound,
          tile_alien_center_id: t.alienCenterId || 0,
          key: "q",
        });

        state.turn.movesUsed += 1;
        renderAll();
        if (source === "human") scheduleHumanIdleEnd();

        if (newlyFound) {
          await showCenterMessage("Alien revealed", foundId ? `Alien ${foundId}` : "", EVENT_FREEZE_MS);
        }

        if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");
        return;
      }

      // SECURITY: P chase away alien (center message on success)
      if (agentKey === "security" && keyLower === "p") {
        let success = 0, chasedId = 0;
        if (t.alienCenterId) {
          const al = alienById(t.alienCenterId);
          if (al && !al.removed && al.discovered) {
            al.removed = true;
            success = 1;
            chasedId = al.id;
            logSystem("alien_chased_away", { alien_id: al.id, alien_x: al.x, alien_y: al.y });
          }
        }

        logAction(agentKey, "push_alien", source, {
          success,
          tile_alien_center_id: t.alienCenterId || 0,
          key: "p",
        });

        state.turn.movesUsed += 1;
        renderAll();
        if (source === "human") scheduleHumanIdleEnd();

        if (success) {
          await showCenterMessage("Alien chased away", chasedId ? `Alien ${chasedId}` : "", EVENT_FREEZE_MS);
        }

        if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");
        return;
      }

      // SECURITY: E revive forager (center message on success)
      if (agentKey === "security" && keyLower === "e") {
        const fx = state.agents.forager.x, fy = state.agents.forager.y;
        const sx = state.agents.security.x, sy = state.agents.security.y;

        let success = 0;
        if (state.foragerStunTurns > 0 && fx === sx && fy === sy) {
          state.foragerStunTurns = 0;
          success = 1;
        }

        logAction(agentKey, "revive_forager", source, {
          success,
          on_forager_tile: (fx === sx && fy === sy) ? 1 : 0,
          forager_stun_turns_after: state.foragerStunTurns,
          key: "e",
        });

        state.turn.movesUsed += 1;
        renderAll();
        if (source === "human") scheduleHumanIdleEnd();

        if (success) {
          await showCenterMessage("Forager revived", "", EVENT_FREEZE_MS);
        }

        if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");
        return;
      }
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
        await showCenterMessage("Forager is stunned", `${before} turn(s) remaining`, EVENT_FREEZE_MS);
        if (!state.running || state.turnFlowToken !== flowToken) return;

        state.foragerStunTurns -= 1;
        logSystem("stun_turn_skipped", { stun_before: before, stun_after: state.foragerStunTurns });
        endTurn("stunned_skip_turn");
        return;
      }

      const a = state.agents[aKey];

      await showCenterMessage(`${a.name}'s Turn`, "", TURN_BANNER_MS);
      if (!state.running || state.turnFlowToken !== flowToken) return;

      logSystem("start_turn", { controller: isHumanTurn() ? "human" : "model" });

      if (isHumanTurn()) scheduleHumanIdleEnd();
      else runScriptedTurn();
    }

    async function runScriptedTurn() {
      if (!state.running || state.scriptedRunning || state.overlayActive) return;

      state.scriptedRunning = true;

      const agentKey = curKey();
      const token = state.turn.token;

      logSystem("scripted_turn_start", {
        agent: agentKey,
        model_source: USE_CSB_MODEL ? "csb_or_policy" : "heuristic_rules",
      });

      while (
        state.running &&
        state.turn.token === token &&
        curKey() === agentKey &&
        state.turn.movesUsed < state.turn.maxMoves
      ) {
        const act = getModelAction(agentKey);
        if (!act) break;

        await sleep(modelMoveMs);
        if (!state.running || state.turn.token !== token || curKey() !== agentKey || state.overlayActive) break;

        if (act.kind === "move") {
          await attemptMove(agentKey, act, "model");
        } else if (act.kind === "action") {
          await doAction(agentKey, act.key, "model");
        } else break;
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

      // press 0 to skip the rest of your turn immediately
      if (e.key === "0") {
        e.preventDefault();
        logAction(agentKey, "skip_turn", "human", {
          key: "0",
          moves_used_before: state.turn.movesUsed,
        });
        endTurn("human_skip");
        return;
      }

      const mk = (dx, dy, dir, label) => ({ kind: "move", dx, dy, dir, label });

      if (e.key === "ArrowUp")    { e.preventDefault(); void attemptMove(agentKey, mk(0, -1, "up", "ArrowUp"), "human"); return; }
      if (e.key === "ArrowDown")  { e.preventDefault(); void attemptMove(agentKey, mk(0,  1, "down","ArrowDown"), "human"); return; }
      if (e.key === "ArrowLeft")  { e.preventDefault(); void attemptMove(agentKey, mk(-1, 0, "left","ArrowLeft"), "human"); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); void attemptMove(agentKey, mk( 1, 0, "right","ArrowRight"), "human"); return; }

      const k = (e.key || "").toLowerCase();
      if (k === "e" || k === "q" || k === "p") { e.preventDefault(); void doAction(agentKey, k, "human"); }
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

        // Spawn both at center
        const c = Math.floor((state.gridSize - 1) / 2);
        state.agents.forager.x = c; state.agents.forager.y = c;
        state.agents.security.x = c; state.agents.security.y = c;

        buildBoard();

        // reveal spawn tiles (may freeze if spawn is on a mine)
        overlay.style.display = "none";
        state.overlayActive = false;

        await reveal("forager", c, c, "spawn");
        await reveal("security", c, c, "spawn");

        // Count overlaps: tiles that are both mine + alien center
        let overlapMineAlienCenters = 0;
        for (let y = 0; y < state.gridSize; y++) {
          for (let x = 0; x < state.gridSize; x++) {
            const t = state.map[y][x];
            if (t.goldMine && t.alienCenterId) overlapMineAlienCenters += 1;
          }
        }

        logSystem("map_loaded_csv", {
          map_csv_url: MAP_CSV_URL,
          grid_size: state.gridSize,
          human_agent_assigned: state.turn.humanAgent,
          aliens_json: JSON.stringify(state.aliens.map((a) => ({ id: a.id, x: a.x, y: a.y }))),
          overlap_mine_and_alien_centers: overlapMineAlienCenters,
        });

        window.addEventListener("keydown", onKeyDown);

        renderAll();
        startTurnFlow();

      } catch (err) {
        logger.log({
          trial_index: state.trialIndex,
          event_type: "system",
          event_name: "map_load_error",
          error: String(err.message || err),
        });
        overlay.style.display = "flex";
        overlayTextEl.textContent = "Map load failed";
        overlaySubEl.textContent = "Check MAP_CSV_URL and that the CSV is included in your build.";
        state.overlayActive = true;
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
