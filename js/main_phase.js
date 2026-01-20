/* ===========================
   main_phase.js (CSV-driven map + 4 aliens)
   =========================== */

(function () {
  "use strict";

  // -------------------- FILE PATH --------------------
  // Put your CSV next to index.html as ./grid_map.csv
  const MAP_CSV_URL = "./gridworld/grid_map.csv";

  // -------------------- DEBUG SWITCH --------------------
  // Set false for real participants
  const DEBUG_SHOW_TRUE_MAP_DEFAULT = true;

  // -------------------- DEFAULTS --------------------
  const DEFAULT_TOTAL_ROUNDS = 10;
  const DEFAULT_MAX_MOVES_PER_TURN = 5;

  // -------------------- Helpers --------------------
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
  const coordKey = (x, y) => `${x},${y}`;

  // Chebyshev distance (3x3 neighborhood)
  function chebDist(x1, y1, x2, y2) {
    return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
  }

  // Minimal CSV parser (handles quotes and commas safely)
  function splitCSVLine(line) {
    const out = [];
    let cur = "";
    let inQ = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i += 1; }
          else inQ = false;
        } else {
          cur += ch;
        }
      } else {
        if (ch === ",") {
          out.push(cur);
          cur = "";
        } else if (ch === '"') {
          inQ = true;
        } else {
          cur += ch;
        }
      }
    }
    out.push(cur);
    return out;
  }

  async function loadMapCSV(url) {
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to fetch CSV (${resp.status})`);
    const text = await resp.text();

    const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim().length > 0);
    if (lines.length < 2) throw new Error("CSV has no data rows");

    const headers = splitCSVLine(lines[0]).map(h => h.trim().toLowerCase());
    const idx = (name) => headers.indexOf(name);

    const ix = idx("x");
    const iy = idx("y");
    const im = idx("mine_type");
    const ia = idx("alien_id");

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

    const gridSize = Math.max(maxX, maxY) + 1;
    return { gridSize, rows, rawText: text };
  }

  function makeEmptyTile() {
    return {
      revealed: false,
      goldMine: false,
      mineType: "",
      highReward: false,
      alienCenterId: 0, // 0 = none, else integer id
    };
  }

  function buildMapFromCSV(gridSize, rows) {
    // Initialize blank map
    const map = [];
    for (let y = 0; y < gridSize; y++) {
      const row = [];
      for (let x = 0; x < gridSize; x++) row.push(makeEmptyTile());
      map.push(row);
    }

    // Collect alien centers + mines
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
        alienCenters.set(r.alienId, {
          id: r.alienId,
          x: r.x,
          y: r.y,
          discovered: false,
          removed: false,
        });
      }
    }

    // Mark highReward as union of all aliens' 3x3 neighborhoods
    for (const a of alienCenters.values()) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = a.x + dx;
          const y = a.y + dy;
          if (x < 0 || y < 0 || x >= gridSize || y >= gridSize) continue;
          map[y][x].highReward = true;
        }
      }
    }

    const aliens = [...alienCenters.values()].sort((p, q) => p.id - q.id);
    return { map, aliens, mines };
  }

  // -------------------- Policies --------------------
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

  // -------------------- Game --------------------
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

      debugTrueMap = DEBUG_SHOW_TRUE_MAP_DEFAULT,

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
      debugTrueMap: !!debugTrueMap,

      agents: {
        forager: { name: "Forager", color: "forager", x: 0, y: 0 },
        security:{ name: "Security",color: "security",x: 0, y: 0 },
      },

      goldTotal: 0,
      foragerStunTurns: 0,

      uiMessage: "",

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

      turnFlowToken: 0,
    };

    const currentAgentKey = () => state.turn.order[state.turn.idx % state.turn.order.length];
    const isHumanTurn = () => currentAgentKey() === state.turn.humanAgent;
    const turnIndexInRound = () => (state.turn.idx % state.turn.order.length);
    const turnGlobal = () => state.turn.idx + 1;

    const getTile = (x, y) => state.map[y][x];

    function getAlienById(id) {
      return state.aliens.find(a => a.id === id) || null;
    }

    function snapshotCore() {
      return {
        forager_x: state.agents.forager.x,
        forager_y: state.agents.forager.y,
        security_x: state.agents.security.x,
        security_y: state.agents.security.y,
        gold_total: state.goldTotal,
        forager_stun_turns: state.foragerStunTurns,
      };
    }

    function setMessage(msg) {
      state.uiMessage = msg || "";
      renderRightPanel();
    }

    // -------------------- UI --------------------
    const style = el("style", {}, [`
      html, body { height: 100%; overflow: hidden; }
      body { margin: 0; }

      .gameStage{
        width: 100vw;
        height: 100vh;
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

        width: min(70vw, 1100px);
        height: min(70vh, 900px);

        display:flex;
        flex-direction:column;
        gap:12px;
        overflow:hidden;
        position: relative;
      }

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

        padding:12px 16px;
        border-radius:999px;
        border:1px solid #e6e6e6;
        background:#fafafa;
        box-shadow: 0 1px 2px rgba(0,0,0,.04);

        font-size:20px;
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

      .midArea{
        flex:1;
        display:grid;
        grid-template-columns: auto 1fr auto;
        gap: 12px;
        align-items: stretch;
        overflow:hidden;
      }

      .panel{
        border:1px solid #e6e6e6;
        border-radius:14px;
        background:#fafafa;
        overflow:hidden;
        display:flex;
        flex-direction:column;
        min-height: 0;
      }

      .panelHeader{
        padding:10px 12px;
        border-bottom:1px solid #e6e6e6;
        background:#fff;
        font-weight:900;
        font-size:14px;
      }

      .panelBody{
        padding:10px 12px;
        overflow:auto;
        min-height: 0;
      }

      .debugHidden{
        display:none !important;
      }

      .debugGrid{
        display:grid;
        gap:2px;
      }
      .dbgCell{
        width: 12px;
        height: 12px;
        border-radius: 2px;
        border: 1px solid rgba(0,0,0,0.06);
        box-sizing:border-box;
      }
      .dbgEmpty{ background:#e5e7eb; }
      .dbgGold{ background:#facc15; }
      .dbgHigh{ background:#fbcfe8; }
      .dbgAlien{ background:#a855f7; }
      .dbgAlienRemoved{ background:#cbd5e1; }
      .dbgAgentOutline{
        outline: 2px solid #111;
        outline-offset: -2px;
      }

      .worldWrap{
        display:flex;
        justify-content:center;
        align-items:center;
        overflow:hidden;
      }

      .world{
        width: 100%;
        height: 100%;
        max-height: 100%;
        aspect-ratio: 1 / 1;
        border:2px solid #ddd;
        border-radius:14px;
        display:grid;
        user-select:none;
        overflow:hidden;
        background:#fff;
      }

      .cell{
        border:1px solid #f1f1f1;
        display:flex;
        align-items:center;
        justify-content:center;
        position: relative;
        box-sizing: border-box;
      }

      .cell.unrevealed{ background:#bdbdbd; }
      .cell.revealed{ background:#ffffff; }

      .marker{
        position:absolute;
        width: 12px;
        height: 12px;
        border-radius: 999px;
        top: 6px;
        left: 6px;
        opacity: 0.95;
      }
      .marker.gold{ background:#facc15; }
      .marker.alien{ background:#a855f7; }

      .agentWrap2{
        width: 80%;
        height: 80%;
        display:grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        align-items:center;
        justify-items:center;
      }

      .agent{
        width:72%;
        height:72%;
        aspect-ratio: 1 / 1;
        border-radius:12px;
      }
      .agent.forager{ background:#16a34a; }
      .agent.security{ background:#eab308; }

      .agentSmall{
        width: 100%;
        height: 100%;
        aspect-ratio: 1 / 1;
        border-radius:10px;
      }
      .agentSmall.forager{ background:#16a34a; }
      .agentSmall.security{ background:#eab308; }

      .kv{
        display:flex;
        justify-content:space-between;
        gap: 10px;
        margin: 6px 0;
        font-size: 14px;
      }
      .k{ color:#555; font-weight:800; }
      .v{ color:#111; font-weight:900; text-align:right; }
      .divider{
        height: 1px;
        background: #e6e6e6;
        margin: 10px 0;
      }
      .hint{
        font-size: 12px;
        color:#666;
        line-height:1.35;
        margin-top: 8px;
      }
      .msg{
        margin-top: 10px;
        padding: 10px 12px;
        background:#fff;
        border:1px solid #e6e6e6;
        border-radius:12px;
        font-weight:800;
        color:#111;
      }

      .turnOverlay{
        position:absolute;
        inset:0;
        display:none;
        align-items:center;
        justify-content:center;
        background: rgba(0,0,0,0.25);
        z-index: 50;
      }
      .turnOverlay.active{ display:flex; }

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
        width: min(520px, 86%);
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

    const debugPanel = el("div", { class: "panel", id: "debugPanel" }, [
      el("div", { class: "panelHeader" }, ["DEBUG: True Map"]),
      el("div", { class: "panelBody" }, [
        el("div", { class: "debugGrid", id: "debugGrid" }, [])
      ])
    ]);

    const world = el("div", { class: "world", id: "world" }, []);
    const worldWrap = el("div", { class: "worldWrap" }, [world]);

    const infoPanel = el("div", { class: "panel", id: "infoPanel" }, [
      el("div", { class: "panelHeader" }, ["Status"]),
      el("div", { class: "panelBody", id: "infoBody" }, [])
    ]);

    const midArea = el("div", { class: "midArea", id: "midArea" }, [debugPanel, worldWrap, infoPanel]);

    const overlay = el("div", { class: "turnOverlay", id: "turnOverlay" }, [
      el("div", { class: "turnOverlayBox" }, [
        el("div", { id: "turnOverlayText" }, ["Loading map…"]),
        el("div", { class: "turnOverlaySub", id: "turnOverlaySub" }, [""])
      ])
    ]);

    const card = el("div", { class: "gameCard" }, [topBar, midArea, overlay]);
    const stage = el("div", { class: "gameStage" }, [card]);

    mount.appendChild(style);
    mount.appendChild(stage);

    // Hide debug panel if debug off
    if (!state.debugTrueMap) {
      debugPanel.classList.add("debugHidden");
      midArea.style.gridTemplateColumns = "1fr auto";
      midArea.innerHTML = "";
      midArea.appendChild(worldWrap);
      midArea.appendChild(infoPanel);
    }

    // Dynamic refs (built after CSV loads)
    let cells = [];
    let debugCells = [];

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

    function buildWorldGrid() {
      world.innerHTML = "";
      world.style.gridTemplateColumns = `repeat(${state.gridSize}, 1fr)`;
      world.style.gridTemplateRows = `repeat(${state.gridSize}, 1fr)`;

      cells = [];
      for (let y = 0; y < state.gridSize; y++) {
        for (let x = 0; x < state.gridSize; x++) {
          const c = el("div", { class: "cell unrevealed", "data-x": x, "data-y": y }, []);
          world.appendChild(c);
          cells.push(c);
        }
      }
    }

    const cellAt = (x, y) => cells[y * state.gridSize + x];

    function buildDebugGrid() {
      if (!state.debugTrueMap) return;

      const dbg = document.getElementById("debugGrid");
      dbg.innerHTML = "";
      dbg.style.gridTemplateColumns = `repeat(${state.gridSize}, 12px)`;
      dbg.style.gridTemplateRows = `repeat(${state.gridSize}, 12px)`;

      debugCells = [];
      for (let y = 0; y < state.gridSize; y++) {
        for (let x = 0; x < state.gridSize; x++) {
          const t = getTile(x, y);
          let cls = "dbgCell dbgEmpty ";

          if (t.highReward) cls += "dbgHigh ";
          if (t.goldMine) cls += "dbgGold ";

          if (t.alienCenterId) {
            const a = getAlienById(t.alienCenterId);
            if (a && a.removed) cls += "dbgAlienRemoved ";
            else cls += "dbgAlien ";
          }

          const d = el("div", { class: cls, "data-x": x, "data-y": y }, []);
          dbg.appendChild(d);
          debugCells.push(d);
        }
      }
    }

    function renderDebugPanelAgentOutlines() {
      if (!state.debugTrueMap) return;
      for (const d of debugCells) d.classList.remove("dbgAgentOutline");

      const fx = state.agents.forager.x, fy = state.agents.forager.y;
      const sx = state.agents.security.x, sy = state.agents.security.y;

      const fIdx = fy * state.gridSize + fx;
      const sIdx = sy * state.gridSize + sx;

      if (debugCells[fIdx]) debugCells[fIdx].classList.add("dbgAgentOutline");
      if (debugCells[sIdx]) debugCells[sIdx].classList.add("dbgAgentOutline");
    }

    function renderWorld() {
      if (!cells.length) return;

      const fx = state.agents.forager.x, fy = state.agents.forager.y;
      const sx = state.agents.security.x, sy = state.agents.security.y;

      for (let y = 0; y < state.gridSize; y++) {
        for (let x = 0; x < state.gridSize; x++) {
          const c = cellAt(x, y);
          const t = getTile(x, y);

          c.innerHTML = "";
          c.classList.remove("revealed", "unrevealed");
          c.classList.add(t.revealed ? "revealed" : "unrevealed");

          // markers if revealed
          if (t.revealed && t.goldMine) {
            c.appendChild(el("div", { class: "marker gold", title: t.mineType }, []));
          }
          if (t.revealed && t.alienCenterId) {
            const a = getAlienById(t.alienCenterId);
            if (a && a.discovered && !a.removed) {
              c.appendChild(el("div", { class: "marker alien", title: `Alien ${a.id} (discovered)` }, []));
            }
          }

          const hasForager = (x === fx && y === fy);
          const hasSecurity = (x === sx && y === sy);

          if (hasForager && hasSecurity) {
            c.appendChild(el("div", { class: "agentWrap2" }, [
              el("div", { class: "agentSmall forager", title: "Forager" }, []),
              el("div", { class: "agentSmall security", title: "Security" }, []),
            ]));
          } else if (hasForager) {
            c.appendChild(el("div", { class: "agent forager", title: "Forager" }, []));
          } else if (hasSecurity) {
            c.appendChild(el("div", { class: "agent security", title: "Security" }, []));
          }
        }
      }
    }

    function tileSummaryForDisplay(tile) {
      if (!tile.revealed) return { label: "Unknown (unrevealed)", detail: "" };
      if (tile.goldMine) return { label: "Gold Mine", detail: tile.mineType };
      if (tile.alienCenterId) {
        const a = getAlienById(tile.alienCenterId);
        if (a && a.discovered && !a.removed) return { label: "Alien (discovered)", detail: "Security can press P to chase away" };
      }
      return { label: "Empty", detail: "" };
    }

    function renderRightPanel() {
      const body = document.getElementById("infoBody");
      if (!body) return;

      const aKey = currentAgentKey();
      const a = state.agents[aKey];
      const tile = getTile(a.x, a.y);
      const tileInfo = tileSummaryForDisplay(tile);

      const foragerPos = `(${state.agents.forager.x}, ${state.agents.forager.y})`;
      const securityPos = `(${state.agents.security.x}, ${state.agents.security.y})`;

      const stunText = state.foragerStunTurns > 0 ? `YES (${state.foragerStunTurns} turns)` : "NO";

      body.innerHTML = "";

      const addKV = (k, v) => body.appendChild(el("div", { class: "kv" }, [
        el("div", { class: "k" }, [k]),
        el("div", { class: "v" }, [v]),
      ]));

      addKV("Active Agent", a.name);
      addKV("Forager Pos", foragerPos);
      addKV("Security Pos", securityPos);

      body.appendChild(el("div", { class: "divider" }, []));

      addKV("Current Tile", tileInfo.label);
      if (tileInfo.detail) addKV("Tile Detail", tileInfo.detail);

      body.appendChild(el("div", { class: "divider" }, []));

      addKV("Gold Total", String(state.goldTotal));
      addKV("Forager Stunned", stunText);

      body.appendChild(el("div", { class: "divider" }, []));

      body.appendChild(el("div", { class: "hint" }, [
        "Controls: Arrow keys move. ",
        "Forager: E = forge. ",
        "Security: Q = scan, P = chase alien, E = revive (if on forager while stunned)."
      ]));

      if (state.uiMessage) body.appendChild(el("div", { class: "msg" }, [state.uiMessage]));
    }

    function render() {
      renderTop();
      renderWorld();
      renderRightPanel();
      renderDebugPanelAgentOutlines();
    }

    // -------------------- Timers --------------------
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

    // -------------------- Logging --------------------
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
        ...snapshotCore(),
        ...extra,
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
        clamped: clampedFlag ? 1 : 0,

        key: act.label || "",
        ...snapshotCore(),
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
        turn_index_in_round: turnIndexInRound(),
        active_agent: currentAgentKey(),
        human_agent: state.turn.humanAgent,
        controller: source,

        agent: agentKey,
        move_index_in_turn: state.turn.movesUsed + 1,

        agent_x: state.agents[agentKey].x,
        agent_y: state.agents[agentKey].y,

        ...snapshotCore(),
        ...payload,
      });
    }

    // -------------------- Overlay / RT freezing --------------------
    function adjustLoggerClock(ms) {
      try {
        if (logger && typeof logger.lastEventPerf === "number") {
          logger.lastEventPerf += ms;
        }
      } catch (_) {}
    }

    async function showOverlay(text, subText) {
      state.overlayActive = true;
      clearHumanIdleTimer();

      const txt = document.getElementById("turnOverlayText");
      const sub = document.getElementById("turnOverlaySub");

      if (txt) txt.textContent = text || "";
      if (sub) sub.textContent = subText || "";

      overlay.classList.add("active");

      const ms = state.overlayDurationMs;
      adjustLoggerClock(ms);

      await sleep(ms);

      overlay.classList.remove("active");
      state.overlayActive = false;

      if (state.running && isHumanTurn()) scheduleHumanIdleEnd();
    }

    // -------------------- Reveal --------------------
    function revealTileIfNeeded(agentKey, x, y, cause) {
      const t = getTile(x, y);
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
        ...snapshotCore(),
      });
    }

    // -------------------- Core mechanics --------------------
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
          render();
          endGame("round_limit_reached");
          return;
        }
      }

      startTurnFlow();
    }

    function attemptMove(agentKey, act, source) {
      if (!state.running) return false;
      if (state.overlayActive) return false;

      const a = state.agents[agentKey];

      const fromX = a.x, fromY = a.y;
      const attemptedX = fromX + act.dx;
      const attemptedY = fromY + act.dy;

      const toX = clamp(attemptedX, 0, state.gridSize - 1);
      const toY = clamp(attemptedY, 0, state.gridSize - 1);
      const clampedFlag = (toX !== attemptedX) || (toY !== attemptedY);

      logMove(agentKey, source, act, fromX, fromY, attemptedX, attemptedY, toX, toY, clampedFlag);

      a.x = toX;
      a.y = toY;

      revealTileIfNeeded(agentKey, toX, toY, "move");

      state.turn.movesUsed += 1;
      render();

      if (source === "human") scheduleHumanIdleEnd();
      if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");

      return true;
    }

    function anyAlienCanAttack(forgeX, forgeY) {
      // Finds first matching alien (stable order by id) that should attack
      for (const a of state.aliens) {
        if (a.removed) continue;
        if (chebDist(forgeX, forgeY, a.x, a.y) <= 1) return a;
      }
      return null;
    }

    async function stunEndTurnImmediate(attackerAlien) {
      await showOverlay("Forager is stunned", attackerAlien ? `Alien ${attackerAlien.id} attacked` : "Alien attacked");
      endTurn("stunned_by_alien");
    }

    async function doAction(agentKey, keyLower, source) {
      if (!state.running) return;
      if (state.overlayActive) return;

      const a = state.agents[agentKey];
      const t = getTile(a.x, a.y);

      // FORAGER: E = forge
      if (agentKey === "forager" && keyLower === "e") {
        const beforeGold = state.goldTotal;

        let success = 0;
        let goldDelta = 0;
        let note = "";

        if (t.revealed && t.goldMine) {
          state.goldTotal += 1;
          success = 1;
          goldDelta = 1;
          note = `Forged +1 on ${t.mineType}`;
          setMessage(`Forged +1 gold (${t.mineType}). Total: ${state.goldTotal}`);
        } else {
          note = "No gold mine on this tile";
          setMessage("No gold mine here.");
        }

        logAction(agentKey, "forge", source, {
          success,
          gold_before: beforeGold,
          gold_after: state.goldTotal,
          gold_delta: goldDelta,
          tile_gold_mine: t.goldMine ? 1 : 0,
          tile_mine_type: t.mineType || "",
          key: "e",
          note,
        });

        // Consume 1 move
        state.turn.movesUsed += 1;
        render();
        if (source === "human") scheduleHumanIdleEnd();

        // Alien detection (forging = digging)
        const attacker = (success === 1) ? anyAlienCanAttack(a.x, a.y) : null;
        if (attacker) {
          state.foragerStunTurns = Math.max(state.foragerStunTurns, 3);

          logSystem("alien_attack", {
            attacker_alien_id: attacker.id,
            alien_x: attacker.x,
            alien_y: attacker.y,
            forge_x: a.x,
            forge_y: a.y,
            stun_turns_set: state.foragerStunTurns,
          });

          setMessage("Alien attacks! Forager is stunned.");
          await stunEndTurnImmediate(attacker);
          return;
        }

        if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");
        return;
      }

      // SECURITY: Q = scan (only discovers alien if standing on alien center)
      if (agentKey === "security" && keyLower === "q") {
        let success = 0;
        let foundAlien = 0;
        let note = "";

        if (t.alienCenterId) {
          const al = getAlienById(t.alienCenterId);
          if (al && !al.removed) {
            foundAlien = 1;
            success = 1;
            if (!al.discovered) {
              al.discovered = true;
              note = `Discovered alien ${al.id}`;
              setMessage("Scan successful: Alien discovered on this tile.");
            } else {
              note = `Alien ${al.id} already discovered`;
              setMessage("Alien already discovered on this tile.");
            }
          } else {
            note = "Alien removed";
            setMessage("Scan: no alien detected on this tile.");
          }
        } else {
          note = "No alien center";
          setMessage("Scan: no alien detected on this tile.");
        }

        logAction(agentKey, "scan", source, {
          success,
          found_alien: foundAlien,
          tile_alien_center_id: t.alienCenterId || 0,
          key: "q",
          note,
        });

        state.turn.movesUsed += 1;
        render();
        if (source === "human") scheduleHumanIdleEnd();
        if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");
        return;
      }

      // SECURITY: P = chase away alien (only if discovered + on alien center)
      if (agentKey === "security" && keyLower === "p") {
        let success = 0;
        let note = "";

        if (t.alienCenterId) {
          const al = getAlienById(t.alienCenterId);
          if (al && !al.removed && al.discovered) {
            al.removed = true;
            success = 1;
            note = `Alien ${al.id} chased away`;
            setMessage("Alien has been chased away.");

            logSystem("alien_chased_away", {
              alien_id: al.id,
              alien_x: al.x,
              alien_y: al.y,
            });
          } else if (al && !al.removed && !al.discovered) {
            note = "Alien not discovered (scan with Q)";
            setMessage("You must scan (Q) to discover the alien first.");
          } else {
            note = "Alien already removed or invalid";
            setMessage("No alien on this tile.");
          }
        } else {
          note = "No alien center";
          setMessage("No alien on this tile.");
        }

        logAction(agentKey, "push_alien", source, {
          success,
          tile_alien_center_id: t.alienCenterId || 0,
          key: "p",
          note,
        });

        state.turn.movesUsed += 1;
        render();
        if (source === "human") scheduleHumanIdleEnd();
        if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");
        return;
      }

      // SECURITY: E = revive forager (only if stunned + on same tile)
      if (agentKey === "security" && keyLower === "e") {
        const fx = state.agents.forager.x, fy = state.agents.forager.y;
        const sx = state.agents.security.x, sy = state.agents.security.y;

        let success = 0;
        let note = "";

        if (state.foragerStunTurns > 0 && fx === sx && fy === sy) {
          state.foragerStunTurns = 0;
          success = 1;
          note = "Forager revived";
          setMessage("Forager revived.");
        } else if (state.foragerStunTurns === 0) {
          note = "Forager is not stunned";
          setMessage("Forager is not stunned.");
        } else {
          note = "Not on forager tile";
          setMessage("You must stand on the forager's tile to revive.");
        }

        logAction(agentKey, "revive_forager", source, {
          success,
          on_forager_tile: (fx === sx && fy === sy) ? 1 : 0,
          forager_stun_turns_after: state.foragerStunTurns,
          key: "e",
          note,
        });

        state.turn.movesUsed += 1;
        render();
        if (source === "human") scheduleHumanIdleEnd();
        if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");
        return;
      }

      // Any other action: counts as move (no effect)
      logAction(agentKey, "action_no_effect", source, {
        pressed_key: keyLower,
        note: "No effect / not available for this agent",
      });
      setMessage("No effect.");

      state.turn.movesUsed += 1;
      render();
      if (source === "human") scheduleHumanIdleEnd();
      if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");
    }

    // -------------------- Turn flow --------------------
    async function startTurnFlow() {
      if (!state.running) return;

      const myFlow = ++state.turnFlowToken;

      render();

      const aKey = currentAgentKey();

      // If forager is stunned, auto-skip this forager turn
      if (aKey === "forager" && state.foragerStunTurns > 0) {
        const before = state.foragerStunTurns;
        await showOverlay("Forager is stunned", `${before} turn(s) remaining`);
        if (!state.running || state.turnFlowToken !== myFlow) return;

        state.foragerStunTurns -= 1;

        logSystem("stun_turn_skipped", {
          stun_before: before,
          stun_after: state.foragerStunTurns,
        });

        endTurn("stunned_skip_turn");
        return;
      }

      const a = state.agents[aKey];
      await showOverlay(`${a.name}'s Turn`, "");
      if (!state.running || state.turnFlowToken !== myFlow) return;

      logSystem("start_turn", { controller: isHumanTurn() ? "human" : "model" });

      if (isHumanTurn()) scheduleHumanIdleEnd();
      else runScriptedTurn();
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
        if (act.kind !== "move") break;

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

    // -------------------- Input --------------------
    function onKeyDown(e) {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea") return;
      if (!state.running) return;
      if (state.overlayActive) return;
      if (!isHumanTurn()) return;

      const agentKey = currentAgentKey();
      const k = (e.key || "").toLowerCase();

      const mk = (dx, dy, dir, label) => ({ kind: "move", dx, dy, dir, label });

      if (e.key === "ArrowUp")    { e.preventDefault(); attemptMove(agentKey, mk(0, -1, "up", "ArrowUp"), "human"); return; }
      if (e.key === "ArrowDown")  { e.preventDefault(); attemptMove(agentKey, mk(0,  1, "down","ArrowDown"), "human"); return; }
      if (e.key === "ArrowLeft")  { e.preventDefault(); attemptMove(agentKey, mk(-1, 0, "left","ArrowLeft"), "human"); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); attemptMove(agentKey, mk( 1, 0, "right","ArrowRight"), "human"); return; }

      if (k === "e" || k === "q" || k === "p") {
        e.preventDefault();
        doAction(agentKey, k, "human");
        return;
      }
    }

    // -------------------- Init (load CSV) --------------------
    async function initFromCSV() {
      try {
        // Keep overlay on while loading
        overlay.classList.add("active");
        state.overlayActive = true;

        const { gridSize, rows } = await loadMapCSV(MAP_CSV_URL);
        const built = buildMapFromCSV(gridSize, rows);

        state.gridSize = gridSize;
        state.map = built.map;
        state.aliens = built.aliens;
        state.mines = built.mines;

        // Spawn both at center
        const center = Math.floor((state.gridSize - 1) / 2);
        state.agents.forager.x = center; state.agents.forager.y = center;
        state.agents.security.x = center; state.agents.security.y = center;

        buildWorldGrid();
        buildDebugGrid();

        // Reveal spawn tile
        revealTileIfNeeded("forager", center, center, "spawn");
        revealTileIfNeeded("security", center, center, "spawn");

        // Log map summary
        logSystem("map_loaded_csv", {
          map_csv_url: MAP_CSV_URL,
          grid_size: state.gridSize,
          aliens_json: JSON.stringify(state.aliens.map(a => ({ id: a.id, x: a.x, y: a.y }))),
          mines_json: JSON.stringify(state.mines),
          debug_true_map: state.debugTrueMap ? 1 : 0,
        });

        // Start
        window.addEventListener("keydown", onKeyDown);

        // Release overlay and begin first turn flow
        overlay.classList.remove("active");
        state.overlayActive = false;

        render();
        startTurnFlow();

      } catch (err) {
        // Show error + log
        setMessage(`Map load failed: ${String(err.message || err)}`);
        logger.log({
          trial_index: state.trialIndex,
          event_type: "system",
          event_name: "map_load_error",
          error: String(err.message || err),
        });

        // Keep overlay visible to block input
        overlay.classList.add("active");
        const txt = document.getElementById("turnOverlayText");
        const sub = document.getElementById("turnOverlaySub");
        if (txt) txt.textContent = "Map load failed";
        if (sub) sub.textContent = "Check that ./grid_map.csv exists in your GitHub Pages build.";
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
