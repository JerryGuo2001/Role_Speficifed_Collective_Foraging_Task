/* ===========================
  main_phase.js
  - AFTER practice:
      (1) Observation instruction
      (2) Watch 3 demo pairs play 5 rounds each (both AI)
      (3) Participant chooses one pair
      (4) Main: 6 repetitions × 10 rounds (same rules), ONE AI partner per repetition
          - chosen pair's 2 agents go first (order randomized)
          - remaining 4 agents randomized after
  - Agent letter tags rendered on tiles: T/J/C/F/A/G
  - Policies implemented here
  =========================== */

(function () {
  "use strict";

  // ---------------- CONFIG ----------------
  const MAP_CSV_URL = "./gridworld/grid_map.csv";

  const GOLD_SPRITE_URL = "./TexturePack/gold_mine.png";
  const ALIEN_SPRITE_CANDIDATES = ["./TexturePack/allien.png"];

  const DEFAULT_MAX_MOVES_PER_TURN = 5;

  const TURN_BANNER_MS = 450;
  const EVENT_FREEZE_MS = 1500;

  const ATTACK_PHASE1_MS = 1500;
  const ATTACK_PHASE2_MS = 1500;
  const STUN_SKIP_MS = 2000;

  const MINE_DECAY = { A: 0.30, B: 0.50, C: 0.70 };
  const ALIEN_ATTACK_PROB = 0.50;

  const USE_CSB_MODEL = false;
  const getCSBModel = () => window.CSB || window.csb || window.CSBModel || null;

  // ---------------- HELPERS ----------------
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const chebDist = (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
  const manDist = (x1, y1, x2, y2) => Math.abs(x1 - x2) + Math.abs(y1 - y2);

  const absURL = (p) => new URL(p, document.baseURI).href;

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function tryLoadImage(url, timeoutMs = 2500) {
    return new Promise((resolve) => {
      let done = false;
      const img = new Image();
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        img.onload = null;
        img.onerror = null;
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.src = url;
    });
  }

  async function resolveFirstWorkingImage(candidates, timeoutMs = 2500) {
    const tried = [];
    for (const c of candidates) {
      const u = absURL(c);
      tried.push(u);
      const ok = await tryLoadImage(u, timeoutMs);
      if (ok) return { url: u, tried };
    }
    return { url: null, tried };
  }

  const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

  function stepToward(fromX, fromY, toX, toY) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    if (dx === 0 && dy === 0) return null;

    if (Math.abs(dx) >= Math.abs(dy)) {
      const sx = sgn(dx);
      return { kind: "move", dx: sx, dy: 0, dir: sx > 0 ? "right" : "left", label: sx > 0 ? "ArrowRight" : "ArrowLeft" };
    } else {
      const sy = sgn(dy);
      return { kind: "move", dx: 0, dy: sy, dir: sy > 0 ? "down" : "up", label: sy > 0 ? "ArrowDown" : "ArrowUp" };
    }
  }

  function normalizeModelAct(act) {
    if (!act || typeof act !== "object") return null;

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

      dx = clamp(dx, -1, 1);
      dy = clamp(dy, -1, 1);

      if (dx !== 0 && dy !== 0) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      if (dx === 0 && dy === 0) return null;

      const dir = dx === 1 ? "right" : dx === -1 ? "left" : dy === 1 ? "down" : "up";
      const label = dir === "right" ? "ArrowRight" : dir === "left" ? "ArrowLeft" : dir === "down" ? "ArrowDown" : "ArrowUp";
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

  // ---------------- CSV ----------------
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

    for (const r of rows) {
      if (r.x < 0 || r.y < 0 || r.x >= gridSize || r.y >= gridSize) continue;
      const t = map[r.y][r.x];

      if (r.mineType) {
        t.goldMine = true;
        t.mineType = r.mineType;
      }

      if (r.alienId && r.alienId > 0) {
        t.alienCenterId = r.alienId;
        alienCenters.set(r.alienId, { id: r.alienId, x: r.x, y: r.y, discovered: false, removed: false });
      }
    }

    // highReward = union of 3x3 around each alien center
    for (const a of alienCenters.values()) {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = a.x + dx, y = a.y + dy;
          if (x >= 0 && y >= 0 && x < gridSize && y < gridSize) map[y][x].highReward = true;
        }
    }

    const aliens = [...alienCenters.values()].sort((p, q) => p.id - q.id);
    return { map, aliens };
  }

  // ---------------- START GAME ----------------
  function startGame(containerId, config) {
    const {
      participantId,
      logger,
      trialIndex = 0,

      maxMovesPerTurn = DEFAULT_MAX_MOVES_PER_TURN,

      repetitions = 6,
      roundsPerRep = 10,

      observationRoundsPerDemo = 5,

      modelMoveMs = 900,
      humanIdleTimeoutMs = 10000,

      onEnd = null,
    } = config;

    if (!participantId) throw new Error("startGame requires participantId");
    if (!logger || typeof logger.log !== "function") throw new Error("startGame requires logger.log(evt)");

    const mount = typeof containerId === "string" ? document.getElementById(containerId) : containerId;
    if (!mount) throw new Error("Could not find container element for game.");
    mount.innerHTML = "";

    // ===== 6 named agents =====
    const AGENTS = {
      Tom:   { id: 1, name: "Tom",   role: "security", tag: "T" },
      Jerry: { id: 2, name: "Jerry", role: "forager",  tag: "J" },
      Cindy: { id: 3, name: "Cindy", role: "security", tag: "C" },
      Frank: { id: 4, name: "Frank", role: "forager",  tag: "F" },
      Alice: { id: 5, name: "Alice", role: "security", tag: "A" },
      Grace: { id: 6, name: "Grace", role: "forager",  tag: "G" },
    };

    // three demo pairs (fixed)
    const DEMO_PAIRS = [
      { label: "Tom & Jerry",  security: AGENTS.Tom,   forager: AGENTS.Jerry },
      { label: "Cindy & Frank",security: AGENTS.Cindy, forager: AGENTS.Frank },
      { label: "Alice & Grace",security: AGENTS.Alice, forager: AGENTS.Grace },
    ];

    function oppositeRole(r) {
      return r === "forager" ? "security" : "forager";
    }

    // baseline world loaded once, then deep-cloned for each demo + main
    let BASELINE = { gridSize: 0, map: null, aliens: null };

    // mutable session state (we swap between demo and main sessions)
    let state = null;

    // session completion hook
    let sessionResolve = null;
    function finishSession(reason) {
      if (sessionResolve) {
        const r = sessionResolve;
        sessionResolve = null;
        r(reason || "done");
      }
    }

    // ---------- LOGGING ----------
    const snapshot = () => {
      if (!state) return {};
      return {
        mode: state.mode || "",
        repetition: state.rep ? state.rep.current : 0,
        repetition_total: state.rep ? state.rep.total : 0,
        round_in_rep: state.round ? state.round.current : 0,
        round_total_in_rep: state.round ? state.round.total : 0,
        demo_label: state.demoLabel || "",
        partner_name: state.partner ? state.partner.name : "",
        partner_role: state.partner ? state.partner.role : "",
        human_role: state.turn ? state.turn.humanAgent : "",
        forager_x: state.agents.forager.x,
        forager_y: state.agents.forager.y,
        security_x: state.agents.security.x,
        security_y: state.agents.security.y,
        gold_total: state.goldTotal,
        forager_stun_turns: state.foragerStunTurns,
      };
    };

    const curKey = () => state.turn.order[state.turn.idx % state.turn.order.length];
    const isHumanTurn = () => state.turn.humanAgent && curKey() === state.turn.humanAgent;
    const turnInRound = () => state.turn.idx % state.turn.order.length;
    const turnGlobal = () => state.turn.idx + 1;

    const tileAt = (x, y) => state.map[y][x];
    const alienById = (id) => state.aliens.find((a) => a.id === id) || null;

    const logSystem = (name, extra = {}) =>
      logger.log({
        trial_index: trialIndex,
        event_type: "system",
        event_name: name,
        active_agent: state ? curKey() : "",
        human_agent: state && state.turn ? state.turn.humanAgent : "",
        turn_global: state ? turnGlobal() : 0,
        turn_index_in_round: state ? turnInRound() : 0,
        ...snapshot(),
        ...extra,
      });

    // ---------- UI ----------
    mount.appendChild(
      el("style", {}, [
        `
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

      .leftStack{ display:flex; flex-direction:column; gap:2px; }
      .repLine{ font-weight:900; font-size:16px; }
      .roundLine{ font-weight:900; font-size:16px; }
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

      .rightStack{ display:flex; flex-direction:column; align-items:flex-end; gap:8px; }
      .partnerPill{
        display:flex; align-items:center; gap:8px;
        padding:8px 12px;
        border-radius:999px;
        border:1px solid #e6e6e6;
        background:#fff;
        font-weight:900;
        font-size:14px;
        color:#111;
        white-space:nowrap;
      }

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
        display:flex;
        align-items:center;
        justify-content:center;
        box-sizing:border-box;
        overflow:hidden;
      }
      .cell.unrev{ background:#bdbdbd; }
      .cell.rev{ background:#ffffff; }

      .agent, .agentPair, .agentMini{
        position: relative;
        z-index: 10;
      }

      .agent{
        width:72%; height:72%;
        border-radius:14px;
        box-shadow:0 2px 8px rgba(0,0,0,.12);
        display:flex; align-items:center; justify-content:center;
        font-weight:1000;
        color:#fff;
        font-size:22px;
        letter-spacing:0.5px;
        text-shadow:0 2px 6px rgba(0,0,0,.35);
      }
      .agent.forager{ background:#16a34a; }
      .agent.security{ background:#eab308; }
      .agent.forager.stunned{ background:#9ca3af; }

      .agentPair{ width:82%; height:82%; position:relative; }
      .agentMini{
        position:absolute;
        width:66%;
        height:66%;
        border-radius:14px;
        border:2px solid rgba(255,255,255,.95);
        box-shadow:0 3px 10px rgba(0,0,0,.16);
        display:flex; align-items:center; justify-content:center;
        font-weight:1000;
        color:#fff;
        font-size:18px;
        text-shadow:0 2px 6px rgba(0,0,0,.35);
      }
      .agentMini.forager{ left:0; top:0; background:#16a34a; }
      .agentMini.security{ right:0; bottom:0; background:#eab308; }
      .agentMini.forager.stunned{ background:#9ca3af; }

      .sprite{
        position:absolute;
        left:50%;
        top:50%;
        transform:translate(-50%,-50%);
        pointer-events:none;
        user-select:none;
        z-index: 30;
        object-fit:contain;
        image-rendering: pixelated;
      }
      .sprite.gold{ width:88%; height:88%; z-index:30; }
      .sprite.alien{ width:96%; height:96%; z-index:31; }

      .fallbackMarker{
        position:absolute;
        left:50%; top:50%;
        transform:translate(-50%,-50%);
        width:40%;
        height:40%;
        border-radius:999px;
        z-index: 32;
        opacity:0.95;
        pointer-events:none;
      }
      .fallbackMarker.alien{ background:#a855f7; }

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

      .scanSpinner{
        width:42px;
        height:42px;
        border-radius:999px;
        border:4px solid #d7d7d7;
        border-top-color:#111;
        margin:14px auto 0;
        animation:spin 0.85s linear infinite;
        display:none;
      }
      @keyframes spin { to { transform: rotate(360deg); } }

      /* Modal */
      .modal{
        position:absolute; inset:0;
        display:none;
        align-items:center;
        justify-content:center;
        background:rgba(0,0,0,0.35);
        z-index: 80;
      }
      .modalBox{
        width:min(700px, 92vw);
        background:#fff;
        border:1px solid #e6e6e6;
        border-radius:14px;
        padding:18px;
        box-shadow:0 12px 40px rgba(0,0,0,0.22);
      }
      .modalTitle{ font-weight:1000; font-size:20px; margin-bottom:8px; }
      .modalBody{ color:#333; font-size:14px; line-height:1.35; }
      .modalBtns{
        display:flex; gap:10px; flex-wrap:wrap;
        margin-top:14px;
        justify-content:flex-end;
      }
      .btn{
        border:1px solid #e6e6e6;
        background:#111;
        color:#fff;
        border-radius:10px;
        padding:10px 14px;
        font-weight:900;
        cursor:pointer;
        user-select:none;
      }
      .btn.secondary{
        background:#fff;
        color:#111;
      }
    `,
      ])
    );

    const repEl = el("div", { class: "repLine" });
    const roundEl = el("div", { class: "roundLine" });
    const movesEl = el("div", { class: "moves" });
    const leftStack = el("div", { class: "leftStack" }, [repEl, roundEl, movesEl]);

    const badgeDot = el("span", { class: "dot" });
    const badgeTxt = el("span");
    const badge = el("div", { class: "badge" }, [badgeDot, badgeTxt]);

    const partnerPill = el("div", { class: "partnerPill" }, ["…"]);
    const turnEl = el("div", { class: "turn" });
    const rightStack = el("div", { class: "rightStack" }, [partnerPill, turnEl]);

    const top = el("div", { class: "top" }, [leftStack, badge, rightStack]);

    const board = el("div", { class: "board", id: "board" });
    const boardWrap = el("div", { class: "boardWrap" }, [board]);

    const bottomBar = el("div", { class: "bottomBar", id: "bottomBar" }, ["Gold: 0"]);

    const overlayTextEl = el("div", { id: "overlayText" }, ["Loading…"]);
    const overlaySubEl = el("div", { class: "overlaySub", id: "overlaySub" }, [""]);
    const scanSpinnerEl = el("div", { class: "scanSpinner", id: "scanSpinner" }, []);

    const overlay = el("div", { class: "overlay", id: "overlay" }, [
      el("div", { class: "overlayBox" }, [overlayTextEl, overlaySubEl, scanSpinnerEl]),
    ]);

    // Modal
    const modal = el("div", { class: "modal", id: "modal" });
    const modalTitle = el("div", { class: "modalTitle" }, []);
    const modalBody = el("div", { class: "modalBody" }, []);
    const modalBtns = el("div", { class: "modalBtns" }, []);
    const modalBox = el("div", { class: "modalBox" }, [modalTitle, modalBody, modalBtns]);
    modal.appendChild(modalBox);

    const card = el("div", { class: "card" }, [top, boardWrap, bottomBar, overlay, modal]);
    const stage = el("div", { class: "stage" }, [card]);
    mount.appendChild(stage);

    // Board refs
    let cells = [];
    const cellAt = (x, y) => cells[y * state.gridSize + x];

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
    
    function renderTop() {
      if (!state) return;

      // --- INIT (loading / before observe/main starts) ---
      if (state.mode === "init") {
        repEl.textContent = "Loading…";
        roundEl.textContent = "";
        movesEl.textContent = "";

        badgeDot.className = "dot forager";
        badgeTxt.textContent = "Please wait";

        partnerPill.textContent = "Loading map…";
        turnEl.textContent = "";
        return;
      }

      // --- OBSERVE ---
      if (state.mode === "observe") {
        repEl.textContent = `Observation`;
        roundEl.textContent = `Round ${state.round.current} / ${state.round.total}`;
        movesEl.textContent = `Moves: ${state.turn.movesUsed} / ${state.turn.maxMoves}`;

        badgeDot.className = "dot forager";
        badgeTxt.textContent = `Watching (no control)`;

        partnerPill.textContent = `Demo: ${state.demoLabel}`;

        const a = state.agents[curKey()];
        turnEl.innerHTML = "";
        turnEl.appendChild(el("span", { class: "dot " + a.cls }, []));
        turnEl.appendChild(el("span", {}, [`${a.name}'s Turn`]));
        return;
      }

      // --- MAIN ---
      // state.rep/state.partner must exist here, but guard anyway to be safe
      const repCur = state.rep ? state.rep.current : 0;
      const repTot = state.rep ? state.rep.total : 0;

      repEl.textContent = `Repetition ${repCur} / ${repTot}`;
      roundEl.textContent = `Round ${state.round.current} / ${state.round.total}`;
      movesEl.textContent = `Moves: ${state.turn.movesUsed} / ${state.turn.maxMoves}`;

      const you = state.turn.humanAgent || "forager";
      badgeDot.className = "dot " + (you === "forager" ? "forager" : "security");
      badgeTxt.textContent = `You are: ${you === "forager" ? "Forager (Green)" : "Security (Yellow)"}`;

      partnerPill.textContent = state.partner ? `Partner: ${state.partner.name}` : `Partner: …`;

      const a = state.agents[curKey()];
      turnEl.innerHTML = "";
      turnEl.appendChild(el("span", { class: "dot " + a.cls }, []));
      turnEl.appendChild(el("span", {}, [isHumanTurn() ? "Your Turn" : `${a.name}'s Turn`]));
    }

    function renderBottom() {
      bottomBar.textContent = `Gold: ${state.goldTotal}`;
    }

    function renderBoard() {
      if (!cells.length) return;

      const fx = state.agents.forager.x, fy = state.agents.forager.y;
      const sx = state.agents.security.x, sy = state.agents.security.y;
      const foragerStunned = state.foragerStunTurns > 0;

      for (let y = 0; y < state.gridSize; y++)
        for (let x = 0; x < state.gridSize; x++) {
          const c = cellAt(x, y);
          const t = tileAt(x, y);
          c.className = "cell " + (t.revealed ? "rev" : "unrev");
          c.innerHTML = "";

          const hasF = x === fx && y === fy;
          const hasS = x === sx && y === sy;

          if (hasF && hasS) {
            c.appendChild(
              el("div", { class: "agentPair" }, [
                el("div", { class: "agentMini forager" + (foragerStunned ? " stunned" : "") }, [state.agents.forager.tag || ""]),
                el("div", { class: "agentMini security" }, [state.agents.security.tag || ""]),
              ])
            );
          } else if (hasF) {
            c.appendChild(el("div", { class: "agent forager" + (foragerStunned ? " stunned" : "") }, [state.agents.forager.tag || ""]));
          } else if (hasS) {
            c.appendChild(el("div", { class: "agent security" }, [state.agents.security.tag || ""]));
          }

          const showGold = t.revealed && t.goldMine;

          let showAlien = false;
          if (t.revealed && t.alienCenterId) {
            const al = alienById(t.alienCenterId);
            showAlien = !!(al && al.discovered && !al.removed);
          }

          if (showGold) {
            c.appendChild(el("img", { class: "sprite gold", src: state.spriteURL.gold, alt: "", draggable: "false" }));
          }

          if (showAlien) {
            if (state.spriteURL.alien) {
              c.appendChild(el("img", { class: "sprite alien", src: state.spriteURL.alien, alt: "", draggable: "false" }));
            } else {
              c.appendChild(el("div", { class: "fallbackMarker alien" }, []));
            }
          }
        }
    }

    function renderAll() {
      renderTop();
      renderBoard();
      renderBottom();
    }

    // ---------- Modal ----------
    function showModal({ title, html, buttons }) {
      return new Promise((resolve) => {
        modalTitle.textContent = title || "";
        modalBody.innerHTML = html || "";
        modalBtns.innerHTML = "";

        for (const b of buttons || []) {
          const btn = el("button", { class: "btn" + (b.secondary ? " secondary" : "") }, [b.label]);
          btn.addEventListener("click", () => {
            modal.style.display = "none";
            resolve(b.value);
          });
          modalBtns.appendChild(btn);
        }

        modal.style.display = "flex";
      });
    }

    // ---------- Timers ----------
    function clearHumanIdleTimer() {
      if (state && state.timers && state.timers.humanIdle) {
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

    // ---------- Overlays ----------
    async function showCenterMessage(text, subText = "", ms = EVENT_FREEZE_MS) {
      state.overlayActive = true;
      clearHumanIdleTimer();

      scanSpinnerEl.style.display = "none";
      overlayTextEl.textContent = text || "";
      overlaySubEl.textContent = subText || "";

      overlay.style.display = "flex";
      await sleep(ms);
      overlay.style.display = "none";

      state.overlayActive = false;
      if (state.running && isHumanTurn()) scheduleHumanIdleEnd();
    }

    async function showScanSequence(hasAlien, foundId = 0, newlyFound = 0) {
      state.overlayActive = true;
      clearHumanIdleTimer();

      overlay.style.display = "flex";
      scanSpinnerEl.style.display = "block";

      overlayTextEl.textContent = "Scanning…";
      overlaySubEl.textContent = "";

      await sleep(520);

      scanSpinnerEl.style.display = "none";

      if (hasAlien) {
        overlayTextEl.textContent = newlyFound ? "Alien revealed" : "Alien detected";
        overlaySubEl.textContent = foundId ? `Alien ${foundId}` : "";
      } else {
        overlayTextEl.textContent = "No alien detected";
        overlaySubEl.textContent = "";
      }

      await sleep(520);

      overlay.style.display = "none";
      state.overlayActive = false;

      if (state.running && isHumanTurn()) scheduleHumanIdleEnd();
    }

    async function showAttackSequence(attacker) {
      state.overlayActive = true;
      clearHumanIdleTimer();

      overlay.style.display = "flex";
      scanSpinnerEl.style.display = "block";

      const attackerId = attacker && attacker.id ? attacker.id : 0;

      overlayTextEl.textContent = attackerId ? "Forager getting attacked by Alien!" : "Forager getting attacked!";
      overlaySubEl.textContent = attackerId ? `Alien ${attackerId}` : "";

      await sleep(ATTACK_PHASE1_MS);

      scanSpinnerEl.style.display = "none";
      overlayTextEl.textContent = "Forager is stunned";
      overlaySubEl.textContent = `Stunned for ${state.foragerStunTurns} turn(s)`;

      await sleep(ATTACK_PHASE2_MS);

      overlay.style.display = "none";
      state.overlayActive = false;
    }

    async function showForgeSequence(goldAfter, goldDelta = 1) {
      state.overlayActive = true;
      clearHumanIdleTimer();

      overlay.style.display = "flex";
      scanSpinnerEl.style.display = "block";

      overlayTextEl.textContent = "Foraging…";
      overlaySubEl.textContent = "";

      await sleep(520);

      scanSpinnerEl.style.display = "none";
      overlayTextEl.textContent = "Gold collected";
      overlaySubEl.textContent = `+${goldDelta} (Total: ${goldAfter})`;

      await sleep(520);

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
        trial_index: trialIndex,
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

      renderAll();

      if (t.goldMine) {
        await showCenterMessage("Found a gold mine", "", EVENT_FREEZE_MS);
      }
    }

    function logMove(agentKey, source, act, fromX, fromY, attemptedX, attemptedY, toX, toY, clampedFlag) {
      logger.log({
        trial_index: trialIndex,
        event_type: source === "human" ? "key" : "model",
        event_name: "move",
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
        trial_index: trialIndex,
        event_type: source === "human" ? "action" : "model_action",
        event_name: actionName,
        controller: source,
        agent: agentKey,
        move_index_in_turn: state.turn.movesUsed + 1,
        agent_x: state.agents[agentKey].x,
        agent_y: state.agents[agentKey].y,
        ...snapshot(),
        ...payload,
      });
    }

    function logInvalidAction(agentKey, actionName, source, reason, payload = {}) {
      logger.log({
        trial_index: trialIndex,
        event_type: source === "human" ? "action_invalid" : "model_action_invalid",
        event_name: actionName,
        reason: String(reason || ""),
        controller: source,
        agent: agentKey,
        move_index_in_turn_attempted: state.turn.movesUsed + 1,
        agent_x: state.agents[agentKey].x,
        agent_y: state.agents[agentKey].y,
        ...snapshot(),
        ...payload,
      });
    }

    function endWholeTask(reason) {
      if (!state.running) return;
      state.running = false;
      clearHumanIdleTimer();
      logSystem("game_end", { reason: reason || "" });
      if (typeof onEnd === "function") onEnd({ reason: reason || "completed" });
      finishSession(reason || "completed");
    }

    function endSessionOnly(reason) {
      if (!state.running) return;
      state.running = false;
      clearHumanIdleTimer();
      logSystem("session_end", { reason: reason || "" });
      finishSession(reason || "completed");
    }

    function attemptEndIfRoundLimitReached() {
      // called after finishing a round
      if (state.round.current > state.round.total) {
        if (state.mode === "observe") {
          endSessionOnly("observation_demo_complete");
          return true;
        }

        // main mode: finished this repetition
        logSystem("end_repetition", { ended_repetition: state.rep.current });

        state.rep.current += 1;

        if (state.rep.current > state.rep.total) {
          endWholeTask("all_repetitions_complete");
          return true;
        }

        // start next repetition with next partner
        applyMainPartnerForRep(state.rep.current);
        return false;
      }
      return false;
    }

    function endTurn(reason) {
      if (!state.running) return;
      clearHumanIdleTimer();

      logSystem("end_turn", { reason: reason || "", moves_used: state.turn.movesUsed });

      state.turn.idx += 1;
      state.turn.movesUsed = 0;
      state.turn.token += 1;

      // end of round when both agents acted
      if (state.turn.idx % state.turn.order.length === 0) {
        logSystem("end_round", { ended_round: state.round.current });
        state.round.current += 1;

        // if round exceeded, handle session transitions
        if (attemptEndIfRoundLimitReached()) return;

        // if main: also reset to round 1 when repetition advanced in applyMainPartnerForRep()
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
      const clampedFlag = toX !== attemptedX || toY !== attemptedY;

      logMove(agentKey, source, act, fromX, fromY, attemptedX, attemptedY, toX, toY, clampedFlag);

      a.x = toX;
      a.y = toY;

      await reveal(agentKey, toX, toY, "move");

      state.turn.movesUsed += 1;
      renderAll();

      if (source === "human") scheduleHumanIdleEnd();
      if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");

      return true;
    }

    function anyAlienInRange(fx, fy) {
      for (const al of state.aliens) {
        if (al.removed) continue;
        if (chebDist(fx, fy, al.x, al.y) <= 1) return al;
      }
      return null;
    }

    function mineDecayKey(mineTypeRaw) {
      const s = String(mineTypeRaw || "").toUpperCase();
      const m = s.match(/[ABC]/);
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

      logSystem("mine_decay_check", { tile_x: x, tile_y: y, mine_type_raw: String(tile.mineType || ""), mine_type_key: k, decay_prob: p });

      if (p <= 0) return { depleted: false, mine_type_key: k, decay_prob: 0 };

      const u = Math.random();
      if (u < p) {
        logSystem("gold_mine_depleted", { tile_x: x, tile_y: y, mine_type_key: k, mine_type_raw: String(tile.mineType || ""), decay_prob: p, rng_u: u });

        tile.goldMine = false;
        tile.mineType = "";

        renderAll();
        await showCenterMessage("Gold mine fully dug", "", EVENT_FREEZE_MS);
        return { depleted: true, mine_type_key: k, decay_prob: p, rng_u: u };
      }

      logSystem("mine_not_depleted", { tile_x: x, tile_y: y, mine_type_key: k, decay_prob: p, rng_u: u });
      return { depleted: false, mine_type_key: k, decay_prob: p, rng_u: u };
    }

    async function stunEndTurn(attacker) {
      await showAttackSequence(attacker);
      endTurn("stunned_by_alien");
    }

    async function doAction(agentKey, keyLower, source) {
      if (!state.running || state.overlayActive) return false;

      const a = state.agents[agentKey];
      const t = tileAt(a.x, a.y);

      // FORAGER: E forge
      if (agentKey === "forager" && keyLower === "e") {
        if (!(t.revealed && t.goldMine)) {
          logInvalidAction(agentKey, "forge", source, "no_gold_mine_here", { tile_gold_mine: t.goldMine ? 1 : 0, tile_mine_type: t.mineType || "", key: "e" });
          if (source === "human") scheduleHumanIdleEnd();
          return false;
        }

        const before = state.goldTotal;
        state.goldTotal += 1;

        logAction(agentKey, "forge", source, { success: 1, gold_before: before, gold_after: state.goldTotal, gold_delta: 1, tile_gold_mine: 1, tile_mine_type: t.mineType || "", key: "e" });

        state.turn.movesUsed += 1;
        renderAll();
        if (source === "human") scheduleHumanIdleEnd();

        await showForgeSequence(state.goldTotal, 1);
        await maybeDepleteMineAtTile(t, a.x, a.y);

        const attacker = anyAlienInRange(a.x, a.y);
        if (attacker) {
          const u = Math.random();
          const willAttack = u < ALIEN_ATTACK_PROB;

          logSystem("alien_attack_check", { attacker_alien_id: attacker.id, alien_x: attacker.x, alien_y: attacker.y, forge_x: a.x, forge_y: a.y, attack_prob: ALIEN_ATTACK_PROB, rng_u: u, will_attack: willAttack ? 1 : 0 });

          if (willAttack) {
            state.foragerStunTurns = Math.max(state.foragerStunTurns, 3);
            logSystem("alien_attack", { attacker_alien_id: attacker.id, alien_x: attacker.x, alien_y: attacker.y, forge_x: a.x, forge_y: a.y, stun_turns_set: state.foragerStunTurns });
            await stunEndTurn(attacker);
            return true;
          }
        }

        if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");
        return true;
      }

      // SECURITY: Q scan
      if (agentKey === "security" && keyLower === "q") {
        let hasAlien = 0, newlyFound = 0, foundId = 0;

        if (t.alienCenterId) {
          const al = alienById(t.alienCenterId);
          if (al && !al.removed) {
            hasAlien = 1;
            foundId = al.id;
            if (!al.discovered) { al.discovered = true; newlyFound = 1; }
          }
        }

        logAction(agentKey, "scan", source, { success: 1, has_alien: hasAlien, newly_found: newlyFound, tile_alien_center_id: t.alienCenterId || 0, key: "q" });

        state.turn.movesUsed += 1;
        renderAll();
        if (source === "human") scheduleHumanIdleEnd();

        await showScanSequence(!!hasAlien, foundId, newlyFound);

        if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");
        return true;
      }

      // SECURITY: P push away
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

        if (!success) {
          logInvalidAction(agentKey, "push_alien", source, "no_revealed_alien_to_push", { tile_alien_center_id: t.alienCenterId || 0, key: "p" });
          if (source === "human") scheduleHumanIdleEnd();
          return false;
        }

        logAction(agentKey, "push_alien", source, { success: 1, tile_alien_center_id: t.alienCenterId || 0, key: "p" });

        state.turn.movesUsed += 1;
        renderAll();
        if (source === "human") scheduleHumanIdleEnd();

        await showCenterMessage("Alien chased away", chasedId ? `Alien ${chasedId}` : "", EVENT_FREEZE_MS);

        if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");
        return true;
      }

      // SECURITY: E revive
      if (agentKey === "security" && keyLower === "e") {
        const fx = state.agents.forager.x, fy = state.agents.forager.y;
        const sx = state.agents.security.x, sy = state.agents.security.y;

        if (!(state.foragerStunTurns > 0 && fx === sx && fy === sy)) {
          logInvalidAction(agentKey, "revive_forager", source, "forager_not_down_or_not_same_tile", { on_forager_tile: fx === sx && fy === sy ? 1 : 0, forager_stun_turns: state.foragerStunTurns, key: "e" });
          if (source === "human") scheduleHumanIdleEnd();
          return false;
        }

        state.foragerStunTurns = 0;

        logAction(agentKey, "revive_forager", source, { success: 1, on_forager_tile: 1, forager_stun_turns_after: 0, key: "e" });

        state.turn.movesUsed += 1;
        renderAll();
        if (source === "human") scheduleHumanIdleEnd();

        await showCenterMessage("Forager revived", "", EVENT_FREEZE_MS);

        if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");
        return true;
      }

      if (source === "human") scheduleHumanIdleEnd();
      return false;
    }

    // ---------------- POLICIES 1–6 ----------------
    function policySecurityTom() {
      const S = state.agents.security;
      const F = state.agents.forager;

      if (state.foragerStunTurns > 0) {
        if (S.x === F.x && S.y === F.y) return { kind: "action", key: "e" };
        return stepToward(S.x, S.y, F.x, F.y);
      }
      return stepToward(S.x, S.y, F.x, F.y) || null;
    }

    function policyForagerJerry() {
      const F = state.agents.forager;
      const here = tileAt(F.x, F.y);
      if (here.revealed && here.goldMine) return { kind: "action", key: "e" };

      const mines = [];
      for (let y = 0; y < state.gridSize; y++)
        for (let x = 0; x < state.gridSize; x++)
          if (tileAt(x, y).goldMine) mines.push({ x, y });

      let best = null, bestD = Infinity;
      for (const m of mines) {
        const d = manDist(F.x, F.y, m.x, m.y);
        if (d < bestD) { bestD = d; best = m; }
      }
      if (!best) return null;
      return stepToward(F.x, F.y, best.x, best.y) || null;
    }

    function policySecurityCindy() {
      const S = state.agents.security;
      const F = state.agents.forager;

      if (state.foragerStunTurns > 0) {
        if (S.x === F.x && S.y === F.y) return { kind: "action", key: "e" };
        return stepToward(S.x, S.y, F.x, F.y);
      }

      const alive = state.aliens.filter((a) => !a.removed);
      if (alive.length) {
        let best = null, bestD = Infinity;
        for (const a of alive) {
          const d = manDist(S.x, S.y, a.x, a.y);
          if (d < bestD) { bestD = d; best = a; }
        }
        if (best) {
          if (S.x === best.x && S.y === best.y) {
            if (!best.discovered) return { kind: "action", key: "q" };
            return { kind: "action", key: "p" };
          }
          return stepToward(S.x, S.y, best.x, best.y);
        }
      }

      const unrevealed = [];
      for (let y = 0; y < state.gridSize; y++)
        for (let x = 0; x < state.gridSize; x++)
          if (!tileAt(x, y).revealed) unrevealed.push({ x, y });

      if (unrevealed.length) {
        let best = null, bestD = Infinity;
        for (const u of unrevealed) {
          const d = manDist(S.x, S.y, u.x, u.y);
          if (d < bestD) { bestD = d; best = u; }
        }
        return best ? stepToward(S.x, S.y, best.x, best.y) : null;
      }

      return stepToward(S.x, S.y, F.x, F.y) || null;
    }

    function policyForagerFrank() {
      const F = state.agents.forager;
      const here = tileAt(F.x, F.y);
      if (here.revealed && here.goldMine) return { kind: "action", key: "e" };

      let best = null, bestD = Infinity;
      for (let y = 0; y < state.gridSize; y++)
        for (let x = 0; x < state.gridSize; x++) {
          const t = tileAt(x, y);
          if (!(t.revealed && t.goldMine)) continue;
          const d = manDist(F.x, F.y, x, y);
          if (d < bestD) { bestD = d; best = { x, y }; }
        }
      if (!best) return null;

      // step only into revealed tiles
      const candidates = [
        { dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }
      ];

      let step = null, stepD = Infinity;
      for (const c of candidates) {
        const nx = F.x + c.dx, ny = F.y + c.dy;
        if (nx < 0 || ny < 0 || nx >= state.gridSize || ny >= state.gridSize) continue;
        if (!tileAt(nx, ny).revealed) continue;
        const d = manDist(nx, ny, best.x, best.y);
        if (d < stepD) { stepD = d; step = c; }
      }
      if (!step) return null;
      return normalizeModelAct({ kind: "move", dx: step.dx, dy: step.dy });
    }

    function policySecurityAlice() {
      const S = state.agents.security;
      const t = tileAt(S.x, S.y);

      // uses scan/push when on alien center
      if (t.alienCenterId) {
        const al = alienById(t.alienCenterId);
        if (al && !al.removed) {
          if (!al.discovered) return { kind: "action", key: "q" };
          return { kind: "action", key: "p" };
        }
      }

      // explore; bias to highReward (where aliens tend to be)
      const unrevealed = [];
      for (let y = 0; y < state.gridSize; y++)
        for (let x = 0; x < state.gridSize; x++) {
          const tt = tileAt(x, y);
          if (!tt.revealed) unrevealed.push({ x, y, bonus: tt.highReward ? -2 : 0 });
        }

      if (!unrevealed.length) return stepToward(S.x, S.y, state.agents.forager.x, state.agents.forager.y) || null;

      let best = null, bestScore = Infinity;
      for (const u of unrevealed) {
        const score = manDist(S.x, S.y, u.x, u.y) + u.bonus;
        if (score < bestScore) { bestScore = score; best = u; }
      }
      return best ? stepToward(S.x, S.y, best.x, best.y) : null;
    }

    function policyForagerGrace() {
      const F = state.agents.forager;
      const S = state.agents.security;

      const here = tileAt(F.x, F.y);
      const inSecRange = chebDist(F.x, F.y, S.x, S.y) <= 2;

      if (here.revealed && here.goldMine && inSecRange) return { kind: "action", key: "e" };
      return stepToward(F.x, F.y, S.x, S.y) || null;
    }

    function policyForNamedAgent(agentObj) {
      if (!agentObj) return null;
      switch (agentObj.id) {
        case 1: return policySecurityTom();
        case 2: return policyForagerJerry();
        case 3: return policySecurityCindy();
        case 4: return policyForagerFrank();
        case 5: return policySecurityAlice();
        case 6: return policyForagerGrace();
        default: return null;
      }
    }

    function getModelAction(agentKey) {
      if (!USE_CSB_MODEL) {
        if (state.mode === "observe") {
          // both agents are AI in observation
          const a = agentKey === "forager" ? state.observePair.forager : state.observePair.security;
          return normalizeModelAct(policyForNamedAgent(a));
        }
        // main mode: only partner role is AI
        if (agentKey !== state.partner.role) return null;
        return normalizeModelAct(policyForNamedAgent(state.partner));
      }

      const csb = getCSBModel();
      if (csb && typeof csb.nextAction === "function") {
        const act = csb.nextAction({ agent: agentKey, state: JSON.parse(JSON.stringify(state)) });
        return normalizeModelAct(act);
      }

      return null;
    }

    // ---------- Turn flow ----------
    async function startTurnFlow() {
      if (!state.running) return;
      const flowToken = ++state.turnFlowToken;

      renderAll();

      const aKey = curKey();

      // stun skip for forager
      if (aKey === "forager" && state.foragerStunTurns > 0) {
        const before = state.foragerStunTurns;
        await showCenterMessage("Forager is stunned", `${before} turn(s) remaining`, STUN_SKIP_MS);
        if (!state.running || state.turnFlowToken !== flowToken) return;

        state.foragerStunTurns -= 1;
        logSystem("stun_turn_skipped", { stun_before: before, stun_after: state.foragerStunTurns });
        endTurn("stunned_skip_turn");
        return;
      }

      const a = state.agents[aKey];
      await showCenterMessage(isHumanTurn() ? "Your Turn" : `${a.name}'s Turn`, "", TURN_BANNER_MS);
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

      logSystem("scripted_turn_start", { agent: agentKey });

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
          const consumed = await doAction(agentKey, act.key, "model");
          if (!consumed) break;
        } else break;
      }

      state.scriptedRunning = false;

      if (state.running && state.turn.token === token && curKey() === agentKey) {
        endTurn("scripted_turn_complete");
      }
    }

    // ---------- Input ----------
    function onKeyDown(e) {
      const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea") return;
      if (!state || !state.running || state.overlayActive || !isHumanTurn()) return;

      const agentKey = curKey();

      const mk = (dx, dy, dir, label) => ({ kind: "move", dx, dy, dir, label });

      if (e.key === "ArrowUp")    { e.preventDefault(); void attemptMove(agentKey, mk(0, -1, "up", "ArrowUp"), "human"); return; }
      if (e.key === "ArrowDown")  { e.preventDefault(); void attemptMove(agentKey, mk(0,  1, "down", "ArrowDown"), "human"); return; }
      if (e.key === "ArrowLeft")  { e.preventDefault(); void attemptMove(agentKey, mk(-1, 0, "left", "ArrowLeft"), "human"); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); void attemptMove(agentKey, mk( 1, 0, "right", "ArrowRight"), "human"); return; }

      const k = (e.key || "").toLowerCase();
      if (k === "e" || k === "q" || k === "p") {
        e.preventDefault();
        void doAction(agentKey, k, "human");
      }
    }

    // ---------- Session constructors ----------
    function freshWorldFromBaseline() {
      const w = {
        gridSize: BASELINE.gridSize,
        map: deepClone(BASELINE.map),
        aliens: deepClone(BASELINE.aliens),
      };
      return w;
    }

    function makeCommonState(world) {
      const c = Math.floor((world.gridSize - 1) / 2);

      return {
        running: true,

        // IMPORTANT: start in init mode (no rep/partner yet)
        mode: "init", // "init" | "observe" | "main"
        demoLabel: "",
        observePair: null,

        gridSize: world.gridSize,
        map: world.map,
        aliens: world.aliens,

        spriteURL: {
          gold: absURL(GOLD_SPRITE_URL),
          alien: state && state.spriteURL ? state.spriteURL.alien : null,
        },

        agents: {
          forager:  { name: "Forager",  cls: "forager",  x: c, y: c, tag: "" },
          security: { name: "Security", cls: "security", x: c, y: c, tag: "" },
        },

        goldTotal: 0,
        foragerStunTurns: 0,

        turn: {
          order: ["forager", "security"],
          idx: 0,
          movesUsed: 0,
          maxMoves: DEFAULT_MAX_MOVES_PER_TURN,
          humanAgent: null,
          token: 0,
        },

        round: { current: 1, total: 1 },

        // only set later
        rep: null,
        partner: null,

        timers: { humanIdle: null },
        scriptedRunning: false,
        overlayActive: false,
        turnFlowToken: 0,
      };
    }


    // ----- MAIN repetition/partner order -----
    function seedMainOrderFromChosenPair(chosenIdx) {
      const chosen = DEMO_PAIRS[chosenIdx]; // {security, forager}
      const chosenTwo = [chosen.security, chosen.forager];
      shuffleInPlace(chosenTwo); // randomize who goes first within chosen pair

      const rest = [AGENTS.Tom, AGENTS.Jerry, AGENTS.Cindy, AGENTS.Frank, AGENTS.Alice, AGENTS.Grace]
        .filter((a) => a.id !== chosen.security.id && a.id !== chosen.forager.id);

      shuffleInPlace(rest);

      const full = chosenTwo.concat(rest);
      return full;
    }

    function applyMainPartnerForRep(repIdx1Based) {
      const partner = state.rep.partnerOrder[repIdx1Based - 1];
      state.rep.current = repIdx1Based;

      // reset round counter for this repetition
      state.round.current = 1;
      state.round.total = state.rep.roundsPerRep;

      // decide human role: opposite of partner role
      state.turn.humanAgent = oppositeRole(partner.role);

      // set role names + tags (AI gets letter)
      state.partner = partner;

      const partnerRole = partner.role;
      const humanRole = state.turn.humanAgent;

      state.agents[partnerRole].name = partner.name;
      state.agents[partnerRole].tag = partner.tag;

      state.agents[humanRole].name = "You";
      state.agents[humanRole].tag = ""; // keep human untagged

      logSystem("rep_partner_assigned", {
        repetition: state.rep.current,
        repetition_total: state.rep.total,
        rounds_per_rep: state.rep.roundsPerRep,
        partner_id: partner.id,
        partner_name: partner.name,
        partner_role: partner.role,
        partner_tag: partner.tag,
        human_role: humanRole,
      });

      // show banner for repetition change (not blocking the flow too long)
      const roleName = humanRole === "forager" ? "Forager (Green)" : "Security (Yellow)";
      void showCenterMessage(`Repetition ${state.rep.current}: Partner ${partner.name}`, `You are ${roleName}`, TURN_BANNER_MS + 600);
    }

    // ---------- Run an observation demo ----------
    async function runObservationDemo(pairObj) {
      const world = freshWorldFromBaseline();
      state = makeCommonState(world);

      state.mode = "observe";
      state.demoLabel = pairObj.label;
      state.observePair = { security: pairObj.security, forager: pairObj.forager };

      state.round.current = 1;
      state.round.total = observationRoundsPerDemo;

      state.turn.humanAgent = null; // no control

      // names + tags for both
      state.agents.security.name = pairObj.security.name;
      state.agents.security.tag = pairObj.security.tag;

      state.agents.forager.name = pairObj.forager.name;
      state.agents.forager.tag = pairObj.forager.tag;

      // rebuild board only once (grid size constant)
      if (!cells.length) buildBoard();

      renderAll();

      // reveal spawn tile
      const c = Math.floor((state.gridSize - 1) / 2);
      await reveal("forager", c, c, "spawn");
      await reveal("security", c, c, "spawn");

      logSystem("observation_demo_start", { demo_label: pairObj.label });

      await showCenterMessage("Observation", pairObj.label, TURN_BANNER_MS + 600);

      // run until session end
      await new Promise((resolve) => {
        sessionResolve = resolve;
        state.running = true;
        startTurnFlow();
      });

      logSystem("observation_demo_end", { demo_label: pairObj.label });

      await showCenterMessage("Demo finished", "", 700);
    }

    // ---------- Run MAIN session ----------
    async function runMainWithChosenPair(chosenIdx) {
      const world = freshWorldFromBaseline();
      state = makeCommonState(world);

      state.mode = "main";

      const order = seedMainOrderFromChosenPair(chosenIdx);

      state.rep = {
        current: 1,
        total: repetitions,
        roundsPerRep: roundsPerRep,
        partnerOrder: order,
      };

      state.round.current = 1;
      state.round.total = roundsPerRep;

      // init first partner
      applyMainPartnerForRep(1);

      // rebuild board if needed
      if (!cells.length) buildBoard();

      renderAll();

      // reveal spawn tile
      const c = Math.floor((state.gridSize - 1) / 2);
      await reveal("forager", c, c, "spawn");
      await reveal("security", c, c, "spawn");

      await showCenterMessage("Main phase begins", "", TURN_BANNER_MS + 600);

      // run until task end
      await new Promise((resolve) => {
        sessionResolve = resolve;
        state.running = true;
        startTurnFlow();
      });
    }

    // ---------- INIT + MASTER FLOW ----------
    async function initAndRun() {
      // resolve alien sprite once
      const resolvedAlien = await resolveFirstWorkingImage(ALIEN_SPRITE_CANDIDATES, 2500);

      // load baseline map
      const { gridSize, rows } = await loadMapCSV(MAP_CSV_URL);
      const built = buildMapFromCSV(gridSize, rows);

      BASELINE.gridSize = gridSize;
      BASELINE.map = built.map;
      BASELINE.aliens = built.aliens;

      // attach key listener once
      window.addEventListener("keydown", onKeyDown);

      // create a temporary state to carry spriteURL.alien
      const tmpWorld = freshWorldFromBaseline();
      state = makeCommonState(tmpWorld);
      state.spriteURL.alien = resolvedAlien.url;

      // build initial board
      buildBoard();
      renderAll();

      logSystem("map_loaded_csv", {
        map_csv_url: MAP_CSV_URL,
        grid_size: gridSize,
        alien_sprite_url: resolvedAlien.url || "",
      });

      // ---- Observation intro instruction ----
      logSystem("observation_intro_show");
      await showModal({
        title: "Next: Observation",
        html: `
          <div style="margin-bottom:10px;">
            You will first <b>watch 3 pairs of agents</b> play the game.
          </div>
          <div>
            Each pair will play <b>${observationRoundsPerDemo} rounds</b>.
            After watching, you will choose which pair you want to work with.
          </div>
        `,
        buttons: [{ label: "Continue", value: "go" }],
      });
      logSystem("observation_intro_ack");

      // ---- Run 3 observation demos ----
      for (const p of DEMO_PAIRS) {
        await runObservationDemo(p);
      }

      // ---- Choose a pair ----
      logSystem("pair_choice_show");
      const choice = await showModal({
        title: "Choose a team",
        html: `
          <div style="margin-bottom:10px;">
            Which team would you like to work with <b>first</b>?
          </div>
          <div style="color:#666;">
            You will still work with all agents later, but your chosen team goes first.
          </div>
        `,
        buttons: [
          { label: "Tom & Jerry", value: 0 },
          { label: "Cindy & Frank", value: 1 },
          { label: "Alice & Grace", value: 2 },
        ],
      });

      logSystem("pair_chosen", { chosen_index: choice, chosen_label: DEMO_PAIRS[choice].label });

      // ---- Run main phase seeded by choice ----
      await runMainWithChosenPair(choice);
    }

    initAndRun().catch((err) => {
      logger.log({
        trial_index: trialIndex,
        event_type: "system",
        event_name: "fatal_error",
        error: String(err && err.message ? err.message : err),
      });

      overlay.style.display = "flex";
      overlayTextEl.textContent = "Fatal error";
      overlaySubEl.textContent = String(err && err.message ? err.message : err);
      scanSpinnerEl.style.display = "none";
    });

    return {
      getState: () => (state ? JSON.parse(JSON.stringify(state)) : null),
      destroy: () => {
        try {
          if (state) state.running = false;
          clearHumanIdleTimer();
          window.removeEventListener("keydown", onKeyDown);
        } catch (_) {}
        mount.innerHTML = "";
      },
    };
  }

  window.startGame = startGame;
})();
