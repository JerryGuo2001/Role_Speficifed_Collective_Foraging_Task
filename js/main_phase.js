/* ===========================
  main_phase.js
  - AFTER practice:
      (1) Optional observation instruction
      (2) Optional observation of configured demo pairs (both AI)
      (3) Main: configured repetitions x rounds, ONE AI partner per repetition
          - one 4-agent cycle per block of 4 repetitions
          - each active named agent appears once per cycle
  - Agent letter tags rendered on tiles: T/A/F/G
  - Policies implemented here
  =========================== */

(function () {
  "use strict";

  // ---------------- CONFIG ----------------
  const MAP_CSV_URL = "./gridworld/grid_map.csv";

  const GOLD_SPRITE_URL = "./TexturePack/gold_mine.png";
  const GOLD_DEPLETED_SPRITE_URL = "./TexturePack/gold_mine_depleted.png";
  const ALIEN_SPRITE_CANDIDATES = ["./TexturePack/allien.png"];

  const DEFAULT_MAX_MOVES_PER_TURN = 5;

  const TURN_BANNER_MS = 200;
  const EVENT_FREEZE_MS = 1500;
  const SCAN_PROGRESS_MS = 1500;
  const SCAN_RESULT_MS = 2000;
  const SCAN_NO_ALIEN_RESULT_MS = 800;
  const SCAN_RADIUS = 0;

  const ATTACK_PHASE1_MS = 1500;
  const ATTACK_PHASE2_MS = 1500;
  const AUTO_STUN_RECOVERY_MS = 5500;
  const STUN_SKIP_MS = 2000;

  const MINE_INITIAL_VALUES = { A: 20, B: 10, C: 5 };
  const MINE_DECAY_AMOUNTS = [
    { amount: 1, prob: 1 / 3 },
    { amount: 3, prob: 1 / 3 },
    { amount: 5, prob: 1 / 3 },
  ];
  const ALIEN_ATTACK_PROB = 0.50;

  const USE_CSB_MODEL = false;
  const getCSBModel = () => window.CSB || window.csb || window.CSBModel || null;

  // ---------------- HELPERS ----------------
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const chebDist = (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
  const manDist = (x1, y1, x2, y2) => Math.abs(x1 - x2) + Math.abs(y1 - y2);

  const absURL = (p) => new URL(p, document.baseURI).href;

  function mineTypeKey(mineTypeRaw) {
    const s = String(mineTypeRaw || "").toUpperCase();
    const m = s.match(/[ABC]/);
    return m ? m[0] : "";
  }

  function initialMineValue(mineTypeRaw) {
    const k = mineTypeKey(mineTypeRaw);
    return MINE_INITIAL_VALUES[k] ?? 0;
  }

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
      if (k === "d" || k === "s" || k === "r" || k === "e" || k === "q" || k === "0") return { kind: "action", key: k };
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
    return {
      revealed: false,
      goldMine: false,
      depletedGoldMineForDisplay: false,
      mineType: "",
      mineInitialValue: 0,
      mineValue: 0,
      highReward: false,
      alienCenterId: 0,
    };
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
        t.depletedGoldMineForDisplay = false;
        t.mineType = r.mineType;
        t.mineInitialValue = initialMineValue(r.mineType);
        t.mineValue = t.mineInitialValue;
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

      repetitions = 4,
      roundsPerRep = 20,

      enableObservationPhase = true,
      observationRoundsPerDemo = 5,

      modelMoveMs = 100,
      humanIdleTimeoutMs = 10000,
        // NEW: multi-map support
      observationMapCsvs = null, // array of csv paths for demos
      mainMapCsvs = null,        // array of csv paths for each repetition
      mapCsvPattern = null,      // e.g. "./gridworld/high_reward_middle_risk_{NN}.csv"
      observationMapStart = 1,
      observationMapCount = 2,
      mainMapStart = null,       // defaults to observationMapStart + observationMapCount


      onEnd = null,
    } = config;

    if (!participantId) throw new Error("startGame requires participantId");
    if (!logger || typeof logger.log !== "function") throw new Error("startGame requires logger.log(evt)");

    // ===================== NEW: MAP ROTATION =====================
    function mapFileName(csvUrl) {
      try {
        const clean = String(csvUrl).split("?")[0].split("#")[0];
        return clean.split("/").pop() || clean;
      } catch (_) {
        return String(csvUrl || "");
      }
    }

    // parse "high_reward_middle_risk_01.csv" -> rewardLevel="high", riskLevel="middle", mapNum="01"
    function parseMapFromName(fileName) {
      const base = String(fileName || "").replace(/\.csv$/i, "");
      const parts = base.split("_");
      if (parts.length >= 5 && parts[1] === "reward" && parts[3] === "risk") {
        return { rewardLevel: parts[0], riskLevel: parts[2], mapNum: parts[4] };
      }
      const m = base.match(/(\d+)$/);
      return { rewardLevel: "", riskLevel: "", mapNum: m ? m[1] : "" };
    }

    function formatMapPattern(pattern, idx) {
      const n = String(idx);
      const nn = n.padStart(2, "0");
      return String(pattern).replaceAll("{NN}", nn).replaceAll("{N}", n);
    }

    function buildMapListFromPattern(pattern, startIdx, count) {
      const out = [];
      for (let i = 0; i < count; i++) out.push(formatMapPattern(pattern, startIdx + i));
      return out;
    }

    function resolveMapLists() {
      const obsCount = observationMapCount || 3;
      const mainCount = repetitions;

      const mainStartResolved =
        mainMapStart != null ? mainMapStart : (observationMapStart || 1) + obsCount;

      let obs = [];
      if (Array.isArray(observationMapCsvs) && observationMapCsvs.length) obs = observationMapCsvs.slice(0, obsCount);
      else if (mapCsvPattern) obs = buildMapListFromPattern(mapCsvPattern, observationMapStart || 1, obsCount);
      else obs = Array.from({ length: obsCount }, () => MAP_CSV_URL);

      let main = [];
      if (Array.isArray(mainMapCsvs) && mainMapCsvs.length) main = mainMapCsvs.slice(0, mainCount);
      else if (mapCsvPattern) main = buildMapListFromPattern(mapCsvPattern, mainStartResolved, mainCount);
      else main = Array.from({ length: mainCount }, () => MAP_CSV_URL);

      return { obs, main };
    }

    const MAP_LISTS = resolveMapLists();

    // cache baselines so maps load once
    const baselineCache = new Map(); // absCsvUrl -> Promise<{csvUrl,gridSize,map,aliens}>
    function loadBaseline(csvUrl) {
      const abs = absURL(csvUrl);
      if (!baselineCache.has(abs)) {
        baselineCache.set(abs, (async () => {
          const { gridSize, rows } = await loadMapCSV(abs);
          const built = buildMapFromCSV(gridSize, rows);
          return { csvUrl: abs, gridSize, map: built.map, aliens: built.aliens };
        })());
      }
      return baselineCache.get(abs);
    }
    // =============================================================


    const mount = typeof containerId === "string" ? document.getElementById(containerId) : containerId;
    if (!mount) throw new Error("Could not find container element for game.");
    mount.innerHTML = "";

    // ===== 4 named agents =====
    const AGENT_SHAPES = ["diamond", "triangle", "square", "pentagon"];
    const HUMAN_SHAPE = "circle";
    const VALID_AGENT_SHAPES = new Set([HUMAN_SHAPE, ...AGENT_SHAPES]);

    const AGENTS = {
      Tom:   { id: 1, name: "Tom",   role: "forager",  tag: "T" },
      Alice: { id: 2, name: "Alice", role: "forager",  tag: "A" },
      Frank: { id: 3, name: "Frank", role: "security", tag: "F" },
      Grace: { id: 4, name: "Grace", role: "security", tag: "G" },
    };

    // Edit only this table to change each named agent's universal-policy lambda.
    // All other universal-policy parameters are shared below in UNIVERSAL_BASE_PARAMS.
    const AGENT_LAMBDA_VALUES = Object.freeze({
      Tom: 0.50,
      Alice: -0.50,
      Frank: 0.50,
      Grace: -0.50,
    });

    const ACTIVE_AGENTS = [AGENTS.Tom, AGENTS.Alice, AGENTS.Frank, AGENTS.Grace];

    function agentLambdaValue(agent) {
      if (!agent) return "";
      const value = Number(AGENT_LAMBDA_VALUES[agent.name]);
      return Number.isFinite(value) ? value : "";
    }

    function normalizeShape(shape, fallback = HUMAN_SHAPE) {
      const s = String(shape || "").trim().toLowerCase();
      return VALID_AGENT_SHAPES.has(s) ? s : fallback;
    }

    function assignRandomAgentShapes() {
      const shuffledShapes = shuffleInPlace(AGENT_SHAPES.slice());
      Object.values(AGENTS)
        .sort((a, b) => a.id - b.id)
        .forEach((agent, idx) => {
          agent.shape = shuffledShapes[idx % shuffledShapes.length];
        });
    }

    function shapeClass(shape) {
      return `shape-${normalizeShape(shape)}`;
    }

    function makeAgentGlyph(baseClass, agent, label = "", extraClass = "") {
      const roleClass = agent && agent.cls ? agent.cls : agent && agent.role ? agent.role : "";
      const cls = [baseClass, roleClass, shapeClass(agent && agent.shape), extraClass].filter(Boolean).join(" ");
      return el("div", { class: cls }, [
        el("span", { class: "agentGlyphLabel" }, [label || ""]),
      ]);
    }

    function agentShapeLogFields() {
      const agents = Object.values(AGENTS).sort((a, b) => a.id - b.id);
      const out = {
        agent_shape_names: agents.map((a) => a.name).join("|"),
        agent_shape_ids: agents.map((a) => a.id).join("|"),
        agent_shape_roles: agents.map((a) => a.role).join("|"),
        agent_shape_order: agents.map((a) => a.shape).join("|"),
        agent_lambda_order: agents.map((a) => agentLambdaValue(a)).join("|"),
        participant_shape: HUMAN_SHAPE,
      };
      agents.forEach((agent) => {
        out[`agent_${agent.id}_name`] = agent.name;
        out[`agent_${agent.id}_role`] = agent.role;
        out[`agent_${agent.id}_shape`] = agent.shape;
        out[`agent_${agent.id}_lambda`] = agentLambdaValue(agent);
      });
      return out;
    }

    assignRandomAgentShapes();

    // demo pairs (fixed)
    const DEMO_PAIRS = [
      { label: "Tom & Grace", security: AGENTS.Grace, forager: AGENTS.Tom },
      { label: "Alice & Frank", security: AGENTS.Frank, forager: AGENTS.Alice },
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
        partner_shape: state.partner ? normalizeShape(state.partner.shape, "") : "",
        partner_lambda: state.partner ? agentLambdaValue(state.partner) : "",
        human_role: state.turn ? state.turn.humanAgent : "",
        human_shape: state && state.turn && state.turn.humanAgent ? normalizeShape(state.agents[state.turn.humanAgent].shape) : "",
        forager_x: state.agents.forager.x,
        forager_y: state.agents.forager.y,
        forager_shape: normalizeShape(state.agents.forager.shape),
        security_x: state.agents.security.x,
        security_y: state.agents.security.y,
        security_shape: normalizeShape(state.agents.security.shape),
        gold_total: state.goldTotal,
        forager_stun_turns: state.foragerStunTurns,
        map_csv: state.mapMeta ? state.mapMeta.csvUrl : "",
        map_name: state.mapMeta ? state.mapMeta.name : "",
        map_reward_level: state.mapMeta ? state.mapMeta.rewardLevel : "",
        map_risk_level: state.mapMeta ? state.mapMeta.riskLevel : "",
        map_num: state.mapMeta ? state.mapMeta.mapNum : "",
        map_phase: state.mapMeta ? state.mapMeta.phase : "",
        map_index: state.mapMeta ? state.mapMeta.index : 0,
      };
    };

    const curKey = () => state.turn.order[state.turn.idx % state.turn.order.length];
    const isHumanTurn = () => state.turn.humanAgent && curKey() === state.turn.humanAgent;
    const turnInRound = () => state.turn.idx % state.turn.order.length;
    const turnGlobal = () => state.turn.idx + 1;

    const tileAt = (x, y) => state.map[y][x];
    const alienById = (id) => state.aliens.find((a) => a.id === id) || null;
    const coordKey = (x, y) => `${x},${y}`;

    function getScanCells(cx, cy) {
      if (cx < 0 || cy < 0 || cx >= state.gridSize || cy >= state.gridSize) return [];
      return [{ x: cx, y: cy, tile: tileAt(cx, cy) }];
    }

    function isScanMineTile(tile) {
      return !!(tile && (tile.goldMine || tile.depletedGoldMineForDisplay));
    }

    function canScanAt(x, y) {
      if (x < 0 || y < 0 || x >= state.gridSize || y >= state.gridSize) return false;
      return isScanMineTile(tileAt(x, y));
    }

    function markScannedCells(scanCells) {
      if (!state.scannedCells) state.scannedCells = {};
      for (const p of scanCells) state.scannedCells[coordKey(p.x, p.y)] = 1;
    }

    function wasScanned(x, y) {
      return !!(state && state.scannedCells && state.scannedCells[coordKey(x, y)]);
    }

    function findAliensInScanCells(scanCells) {
      const seen = new Set();
      const found = [];
      for (const p of scanCells) {
        const alienId = p.tile && p.tile.alienCenterId ? p.tile.alienCenterId : 0;
        if (!alienId || seen.has(alienId)) continue;
        seen.add(alienId);
        const al = alienById(alienId);
        if (al && !al.removed) found.push(al);
      }
      return found;
    }

    function ensurePolicyMemory(agentKey) {
      if (!state.policyMemory) state.policyMemory = {};
      if (!state.policyMemory[agentKey]) state.policyMemory[agentKey] = {};
      const memory = state.policyMemory[agentKey];

      if (!(memory.visited instanceof Set)) memory.visited = new Set(memory.visited || []);
      if (!(memory.chased instanceof Set)) memory.chased = new Set(memory.chased || []);
      if (!(memory.chaseAreas instanceof Set)) memory.chaseAreas = new Set(memory.chaseAreas || []);
      if (!(memory.stunHotspots instanceof Set)) memory.stunHotspots = new Set(memory.stunHotspots || []);
      if (!memory.goldValueEstimates || typeof memory.goldValueEstimates !== "object") memory.goldValueEstimates = {};
      if (!memory.securityDepartedGoldDiscounts || typeof memory.securityDepartedGoldDiscounts !== "object") {
        memory.securityDepartedGoldDiscounts = {};
      }

      memory.prev = memory.prev || null;
      memory.totalReward = Number(memory.totalReward || 0);
      memory.roundReward = Number(memory.roundReward || 0);
      memory.t = Number(memory.t || 0);
      memory.alpha = Number(memory.alpha || 0);
      memory.Vdig = Number(memory.Vdig || 0);
      memory.Vmove = Number(memory.Vmove || 0);
      memory.Vscan = Number(memory.Vscan || 0);

      return memory;
    }

    function rememberPolicyGoldValue(memory, x, y, value) {
      if (!memory.goldValueEstimates || typeof memory.goldValueEstimates !== "object") memory.goldValueEstimates = {};
      const rememberedValue = Math.max(0, Number(value) || 0);
      memory.goldValueEstimates[coordKey(x, y)] = rememberedValue;
      return rememberedValue;
    }

    function updateForagerPolicyMemoryAfterDig(x, y, rewardRoll) {
      const memory = ensurePolicyMemory("forager");
      const observedReward = Number(rewardRoll && rewardRoll.reward_value) || 0;
      const nextValue = Math.max(0, Number(rewardRoll && rewardRoll.mine_value_after) || 0);
      memory.totalReward += observedReward;
      memory.roundReward += observedReward;
      rememberPolicyGoldValue(memory, x, y, nextValue);
    }

    function updateSecurityPolicyMemoryAfterScan(scanCells) {
      const memory = ensurePolicyMemory("security");
      for (const p of scanCells) {
        const k = coordKey(p.x, p.y);
        memory.chased.add(k);
        memory.chaseAreas.add(k);
      }
    }

    const logSystem = (name, extra = {}) =>
      logger.log({
        trial_index: trialIndex,
        event_type: "system",
        event_name: name,
        active_agent: state ? curKey() : "",
        active_agent_shape: state ? normalizeShape(state.agents[curKey()].shape) : "",
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

      .goldBig{
        margin-top:8px;
        padding:10px 12px;
        border:1px solid #e6e6e6;
        border-radius:14px;
        background:#fff;
      }
      .goldLabel{
        font-size:12px;
        font-weight:900;
        letter-spacing:0.08em;
        text-transform:uppercase;
        color:#666;
      }
      .goldValue{
        margin-top:2px;
        font-size:34px;
        font-weight:1000;
        line-height:1.05;
        color:#111;
      }

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
      .cell.scanScanned::after{
        content:"";
        position:absolute;
        inset:3px;
        border:3px solid #22c55e;
        border-radius:9px;
        box-sizing:border-box;
        z-index:4;
        pointer-events:none;
      }

      .agent, .agentPair, .agentMini{
        position: relative;
        z-index: 10;
      }

      .agent{
        width:72%; height:72%;
        display:flex; align-items:center; justify-content:center;
        font-weight:1000;
        font-size:22px;
        letter-spacing:0;
      }

      .agentPair{ width:82%; height:82%; position:relative; }
      .agentMini{
        position:absolute;
        width:66%;
        height:66%;
        display:flex; align-items:center; justify-content:center;
        font-weight:1000;
        font-size:18px;
      }
      .agentMini.forager{ left:0; top:0; }
      .agentMini.security{ right:0; bottom:0; }

      .agent, .agentMini, .rankCardTag, .turnGlyph, .partnerGlyph{
        --agent-color:#111;
        --agent-label-color:#fff;
        background:transparent;
        color:var(--agent-label-color);
        position:relative;
        isolation:isolate;
      }
      .agent::before, .agentMini::before, .rankCardTag::before, .turnGlyph::before, .partnerGlyph::before{
        content:"";
        position:absolute;
        inset:0;
        z-index:0;
        background:var(--agent-color);
        border-radius:999px;
        filter:drop-shadow(0 2px 5px rgba(0,0,0,.2));
      }
      .agentGlyphLabel{
        position:relative;
        z-index:1;
        color:var(--agent-label-color);
        text-shadow:0 2px 6px rgba(0,0,0,.35);
      }
      .security .agentGlyphLabel{
        text-shadow:none;
      }
      .forager{ --agent-color:#16a34a; --agent-label-color:#fff; }
      .security{ --agent-color:#eab308; --agent-label-color:#111; }
      .forager.stunned{ --agent-color:#9ca3af; --agent-label-color:#fff; }
            .shape-circle::before,
      .attackForagerGlyph.shape-circle::before{
        border-radius:999px;
      }

      .shape-diamond::before,
      .attackForagerGlyph.shape-diamond::before{
        border-radius:0;
        clip-path:polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
      }

      .shape-triangle::before,
      .attackForagerGlyph.shape-triangle::before{
        border-radius:0;
        clip-path:polygon(50% 4%, 96% 94%, 4% 94%);
      }

      .shape-square::before,
      .attackForagerGlyph.shape-square::before{
        border-radius:8px;
      }

      .shape-pentagon::before,
      .attackForagerGlyph.shape-pentagon::before{
        border-radius:0;
        clip-path:polygon(50% 2%, 96% 36%, 78% 96%, 22% 96%, 4% 36%);
      }

      .turnGlyph{
        width:24px;
        height:24px;
        flex:0 0 auto;
        font-size:10px;
        font-weight:1000;
        display:flex;
        align-items:center;
        justify-content:center;
      }
      .partnerGlyph{
        width:30px;
        height:30px;
        flex:0 0 auto;
        font-size:12px;
        font-weight:1000;
        display:flex;
        align-items:center;
        justify-content:center;
      }

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
      .overlay.recoveryOverlay{ background:#fff; }
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
      .overlay.recoveryOverlay .overlayBox{
        width:min(820px, 88%);
        border:0;
        box-shadow:none;
      }
      .overlay.recoveryOverlay #overlayText{
        font-size:clamp(34px, 5vw, 56px);
        color:#202124;
      }
      .overlay.recoveryOverlay .overlaySub{
        margin-top:20px;
        font-size:clamp(17px, 2.4vw, 24px);
        line-height:1.38;
        font-weight:750;
        color:#202124;
        white-space:pre-line;
      }
      .overlay.recoveryOverlay .overlaySub.recoveryProcessSub{
        font-size:16px;
        line-height:1.35;
        font-weight:700;
        text-align:left;
        white-space:normal;
      }

      .attackShapeSim{
        position:relative;
        width:min(360px, 100%);
        height:150px;
        margin:18px auto 0;
      }
      .attackForagerGlyph{
        --agent-color:#16a34a;
        --agent-label-color:#fff;
        position:absolute;
        left:calc(50% - 29px);
        top:46px;
        width:58px;
        height:58px;
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:22px;
        font-weight:1000;
        color:var(--agent-label-color);
        isolation:isolate;
        animation:attackForagerFreeze 2600ms ease forwards;
      }
      .attackForagerGlyph::before{
        content:"";
        position:absolute;
        inset:0;
        z-index:0;
        background:var(--agent-color);
        border-radius:999px;
        filter:drop-shadow(0 3px 10px rgba(0,0,0,.16));
      }
      .attackForagerGlyph::after{
        content:"";
        position:absolute;
        inset:-10px;
        z-index:2;
        border-radius:14px;
        background:rgba(186,230,253,.55);
        border:3px solid rgba(14,165,233,.85);
        box-shadow:
          inset 0 0 18px rgba(255,255,255,.85),
          0 0 16px rgba(14,165,233,.35);
        opacity:0;
        transform:scale(.85);
        animation:attackIceBlock 2600ms ease forwards;
      }
      .attackAlienMover{
        position:absolute;
        left:calc(88% - 34px);
        top:38px;
        width:68px;
        height:68px;
        display:flex;
        align-items:center;
        justify-content:center;
        animation:attackAlienMove 2600ms ease-in-out forwards;
      }
      .attackAlienSprite{
        width:68px;
        height:68px;
        object-fit:contain;
        image-rendering:pixelated;
      }
      .attackAlienFallback{
        width:58px;
        height:58px;
        border-radius:999px;
        background:#a855f7;
        box-shadow:0 3px 10px rgba(0,0,0,.16);
      }
      .attackFreezeRing{
        position:absolute;
        left:50%;
        top:75px;
        width:82px;
        height:82px;
        border-radius:999px;
        border:4px solid #38bdf8;
        opacity:0;
        transform:translate(-50%, -50%) scale(.35);
        animation:attackFreezeRing 2600ms ease-out forwards;
      }
      @keyframes attackForagerFreeze{
        0%, 60%{ --agent-color:#16a34a; }
        100%{ --agent-color:#9ca3af; }
      }
      @keyframes attackIceBlock{
        0%, 62%{ opacity:0; transform:scale(.75); }
        78%{ opacity:.95; transform:scale(1.08); }
        100%{ opacity:.9; transform:scale(1); }
      }
      @keyframes attackFreezeRing{
        0%, 58%{ opacity:0; transform:translate(-50%, -50%) scale(.35); }
        78%{ opacity:.9; transform:translate(-50%, -50%) scale(1.12); }
        100%{ opacity:.35; transform:translate(-50%, -50%) scale(.95); }
      }
      @keyframes attackAlienMove{
        0%{ left:calc(88% - 34px); transform:scale(1); }
        70%{ left:calc(50% - 34px); transform:scale(.95); }
        100%{ left:calc(50% - 34px); transform:scale(.9); }
      }

      .recoveryProcess{
        display:flex;
        flex-direction:column;
        gap:14px;
        width:min(680px, 100%);
        margin:0 auto;
      }
      .recoveryStats{
        display:grid;
        grid-template-columns:repeat(2, minmax(0, 1fr));
        gap:10px;
      }
      .recoveryStat{
        border:1px solid #ddd;
        border-radius:8px;
        padding:12px;
        background:#fafafa;
        text-align:center;
      }
      .recoveryStatValue{
        font-size:34px;
        line-height:1;
        font-weight:1000;
        color:#111;
      }
      .recoveryStatLabel{
        margin-top:5px;
        font-size:12px;
        font-weight:900;
        color:#666;
        text-transform:uppercase;
        letter-spacing:.04em;
      }
      .recoveryStep{
        display:grid;
        grid-template-columns:34px minmax(0, 1fr) auto;
        align-items:center;
        gap:10px;
        border:1px solid #e2e2e2;
        border-radius:8px;
        padding:10px;
        background:#fff;
      }
      .recoveryStepNum{
        width:28px;
        height:28px;
        border-radius:999px;
        background:#111;
        color:#fff;
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:13px;
        font-weight:1000;
      }
      .recoveryStepTitle{ font-weight:1000; color:#111; }
      .recoveryStepDetail{
        margin-top:2px;
        font-size:13px;
        font-weight:750;
        color:#666;
      }
      .recoveryStepCount{
        font-size:13px;
        font-weight:1000;
        color:#111;
        white-space:nowrap;
      }
            .recoveryShapeSim{
        position:relative;
        width:min(420px, 100%);
        height:150px;
        margin:24px auto 0;
      }
      .recoveryShapeTrack{
        position:absolute;
        left:8%;
        right:8%;
        top:72px;
        height:4px;
        border-radius:999px;
        background:#e5e7eb;
      }
      .recoveryShapeGlyph{
        width:58px;
        height:58px;
        position:absolute;
        top:43px;
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:22px;
        font-weight:1000;
      }
      .recoveryShapeGlyph.forager{
        left:calc(50% - 29px);
      }
      .recoveryShapeGlyph.security{
        left:calc(8% - 29px);
        animation:recoverySecurityMove 1800ms ease-in-out infinite alternate;
      }
      .recoveryShapeGlyph.forager.stunned::after{
        content:"";
        position:absolute;
        inset:-12px;
        border:4px solid #ef4444;
        border-radius:999px;
        opacity:.75;
        animation:recoveryStunPulse 850ms ease-in-out infinite;
      }
      .recoveryReviveBurst{
        position:absolute;
        left:50%;
        top:72px;
        width:90px;
        height:90px;
        transform:translate(-50%, -50%);
        border-radius:999px;
        border:4px solid #22c55e;
        opacity:.65;
        animation:recoveryReviveBurst 1400ms ease-out infinite;
      }
      @keyframes recoverySecurityMove{
        from{ transform:translateX(0); }
        to{ transform:translateX(calc(42% + 29px)); }
      }
      @keyframes recoveryStunPulse{
        0%, 100%{ transform:scale(.85); opacity:.35; }
        50%{ transform:scale(1.08); opacity:.9; }
      }
      @keyframes recoveryReviveBurst{
        from{ transform:translate(-50%, -50%) scale(.35); opacity:.7; }
        to{ transform:translate(-50%, -50%) scale(1.15); opacity:0; }
      }

      .overlaySub{ margin-top:8px; font-size:14px; font-weight:800; color:#666; }
      .overlayRewardTotal{ margin-top:10px; font-size:22px; font-weight:800; color:#555; }
      .overlayContinueBtn{ margin:22px auto 0; }

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

      .rankHint{
        margin:0 0 12px 0;
        color:#333;
        font-size:14px;
        line-height:1.35;
      }
      .rankSourceTitle, .rankWindowTitle{
        font-size:13px;
        font-weight:1000;
        color:#333;
        margin-bottom:6px;
      }
      .rankSourcePool{
        display:grid;
        grid-template-columns:repeat(auto-fit, minmax(132px, 1fr));
        gap:8px;
        margin-bottom:14px;
      }
      .rankSourcePool.empty{
        min-height:42px;
        border:1px dashed #d6d6d6;
        border-radius:8px;
        align-items:center;
        justify-items:center;
        color:#777;
        font-weight:800;
        background:#fafafa;
      }
      .rankCard{
        display:grid;
        grid-template-columns:34px minmax(0, 1fr);
        gap:8px;
        border:1px solid #e6e6e6;
        border-radius:8px;
        padding:8px;
        background:#fff;
        cursor:grab;
        user-select:none;
        touch-action:none;
      }
      .rankCard:active{ cursor:grabbing; }
      .rankCard.dragging{ opacity:.45; }
      .rankDragGhost{
        position:fixed;
        pointer-events:none;
        z-index:1000;
        box-shadow:0 10px 24px rgba(0,0,0,.18);
      }
      .rankCardTag{
        width:30px;
        height:30px;
        display:flex;
        align-items:center;
        justify-content:center;
        font-weight:1000;
      }
      .rankName{ font-weight:1000; color:#111; }
      .rankMeta{ font-size:12px; font-weight:800; color:#666; margin-top:2px; }
      .rankWindow{
        display:flex;
        flex-direction:column;
        gap:8px;
        border:1px solid #e6e6e6;
        border-radius:8px;
        padding:10px;
        background:#fafafa;
      }
      .rankSlot{
        display:grid;
        grid-template-columns:96px minmax(0, 1fr);
        align-items:center;
        gap:10px;
        min-height:54px;
        border:1px dashed #cfcfcf;
        border-radius:8px;
        padding:8px 10px;
        background:#fff;
      }
      .rankSlot.filled{
        border-style:solid;
        border-color:#dcdcdc;
      }
      .rankSlot.dragOver{
        border-color:#111;
        background:#f2f2f2;
      }
      .rankSlotLabel{
        font-weight:1000;
        color:#111;
      }
      .rankSlotLabel small{
        display:block;
        color:#666;
        font-size:11px;
        margin-top:2px;
      }
      .rankPlaceholder{
        color:#777;
        font-weight:800;
      }
      .btn:disabled{ opacity:.45; cursor:not-allowed; }
    `,
      ])
    );

    const roundEl = el("div", { class: "roundLine" });

    // NEW: big gold counter (left side)
    const goldValueEl = el("div", { class: "goldValue" }, ["0"]);
    const goldBigEl = el("div", { class: "goldBig" }, [
      el("div", { class: "goldLabel" }, ["Gold dug"]),
      goldValueEl,
    ]);

    const movesEl = el("div", { class: "moves" });

    const leftStack = el("div", { class: "leftStack" }, [
      roundEl,
      goldBigEl,
      movesEl,
    ]);


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
    const overlayRewardTotalEl = el("div", { class: "overlayRewardTotal", id: "overlayRewardTotal", style: "display:none;" }, [""]);
    const scanSpinnerEl = el("div", { class: "scanSpinner", id: "scanSpinner" }, []);
    const overlayContinueBtn = el("button", { class: "btn overlayContinueBtn", type: "button", style: "display:none;" }, ["Continue"]);

    const overlay = el("div", { class: "overlay", id: "overlay" }, [
      el("div", { class: "overlayBox" }, [overlayTextEl, overlaySubEl, overlayRewardTotalEl, scanSpinnerEl, overlayContinueBtn]),
    ]);

    function rewardColor(goldDelta) {
      const value = Number(goldDelta);
      if (!Number.isFinite(value)) return "";
      if (value >= 14 && value <= 20) return "#F2B705";
      if (value >= 6 && value <= 13) return "#8A4FD3";
      if (value >= 0 && value <= 5) return "#2563EB";
      return "";
    }

    function resetOverlaySubStyle() {
      overlaySubEl.style.color = "";
      overlaySubEl.style.fontWeight = "";
      overlaySubEl.style.fontSize = "";
      overlaySubEl.style.lineHeight = "";
      overlaySubEl.style.marginTop = "";
      overlaySubEl.style.whiteSpace = "";
      overlaySubEl.classList.remove("recoveryProcessSub");
      overlayRewardTotalEl.textContent = "";
      overlayRewardTotalEl.style.display = "none";
      overlayContinueBtn.style.display = "none";
      overlayContinueBtn.onclick = null;
    }

    function playRewardSound(goldDelta) {
      const audio = window.TaskRewardAudio;
      if (!audio || typeof audio.playReward !== "function") return;
      audio.playReward(goldDelta);
    }

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

            // always keep gold display updated
      goldValueEl.textContent = String(state.goldTotal || 0);


      // --- INIT (loading / before observe/main starts) ---
      if (state.mode === "init") {
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
        roundEl.textContent = `Round ${state.round.current} / ${state.round.total}`;
        movesEl.textContent = `Moves: ${state.turn.movesUsed} / ${state.turn.maxMoves}`;

        badgeDot.className = "dot forager";
        badgeTxt.textContent = `Watching (no control)`;

        partnerPill.textContent = `Demo: ${state.demoLabel}`;

        const a = state.agents[curKey()];
        turnEl.innerHTML = "";
        turnEl.appendChild(makeAgentGlyph("turnGlyph", a, a.tag || ""));
        turnEl.appendChild(el("span", {}, [`${a.name}'s Turn`]));
        return;
      }

      // --- MAIN ---
      // state.rep/state.partner must exist here, but guard anyway to be safe
      const repCur = state.rep ? state.rep.current : 0;
      const repTot = state.rep ? state.rep.total : 0;

      roundEl.textContent = `Round ${state.round.current} / ${state.round.total}`;
      movesEl.textContent = `Moves: ${state.turn.movesUsed} / ${state.turn.maxMoves}`;

      const you = state.turn.humanAgent || "forager";
      badgeDot.className = "dot " + (you === "forager" ? "forager" : "security");
      badgeTxt.textContent = `You are: ${you === "forager" ? "Forager (Green)" : "Security (Yellow)"}`;

      partnerPill.textContent = state.partner ? `Partner: ${state.partner.name}` : `Partner: …`;

      const a = state.agents[curKey()];
      turnEl.innerHTML = "";
      turnEl.appendChild(makeAgentGlyph("turnGlyph", a, isHumanTurn() ? "" : (a.tag || "")));
      turnEl.appendChild(el("span", {}, [isHumanTurn() ? "Your Turn" : `${a.name}'s Turn`]));
    }

    function renderBottom() {
      if (!state) {
        bottomBar.textContent = "";
        return;
      }

      if (state.mode === "observe") {
        bottomBar.textContent = "Observation: you're watching the agents play.";
        return;
      }

      bottomBar.textContent = "Controls: Arrow keys = move, D = dig, S = scan current gold mine tile/chase alien";
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
          c.className = "cell " + (t.revealed ? "rev" : "unrev") + (wasScanned(x, y) ? " scanScanned" : "");
          c.innerHTML = "";

          const hasF = x === fx && y === fy;
          const hasS = x === sx && y === sy;

          if (hasF && hasS) {
            c.appendChild(
              el("div", { class: "agentPair" }, [
                makeAgentGlyph("agentMini", state.agents.forager, state.agents.forager.tag || "", foragerStunned ? "stunned" : ""),
                makeAgentGlyph("agentMini", state.agents.security, state.agents.security.tag || ""),
              ])
            );
          } else if (hasF) {
            c.appendChild(makeAgentGlyph("agent", state.agents.forager, state.agents.forager.tag || "", foragerStunned ? "stunned" : ""));
          } else if (hasS) {
            c.appendChild(makeAgentGlyph("agent", state.agents.security, state.agents.security.tag || ""));
          }

          const showGold = t.revealed && t.goldMine;
          const showDepletedGold = t.revealed && !t.goldMine && t.depletedGoldMineForDisplay;

          let showAlien = false;
          if (t.revealed && t.alienCenterId) {
            const al = alienById(t.alienCenterId);
            showAlien = !!(al && al.discovered && !al.removed);
          }

          if (showGold) {
            c.appendChild(el("img", { class: "sprite gold", src: state.spriteURL.gold, alt: "", draggable: "false" }));
          } else if (showDepletedGold) {
            c.appendChild(el("img", { class: "sprite gold depleted", src: state.spriteURL.goldDepleted, alt: "", draggable: "false" }));
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

    function showAgentRankingModal() {
      return new Promise((resolve) => {
        const agents = ACTIVE_AGENTS.slice();
        const ranking = Array(agents.length).fill(null);
        let draggingId = null;

        modalTitle.textContent = "Rank the agents";
        modalBody.innerHTML = "";
        modalBtns.innerHTML = "";

        const hint = el("div", { class: "rankHint" }, [
          "Rank all 4 agents from best to worst based on what you observed. Drag each agent from the list above into the ranking window."
        ]);
        const sourceTitle = el("div", { class: "rankSourceTitle" }, ["Available agents"]);
        const sourcePool = el("div", { class: "rankSourcePool" }, []);
        const rankTitle = el("div", { class: "rankWindowTitle" }, ["Ranking window"]);
        const rankWindow = el("div", { class: "rankWindow" }, []);
        modalBody.appendChild(hint);
        modalBody.appendChild(sourceTitle);
        modalBody.appendChild(sourcePool);
        modalBody.appendChild(rankTitle);
        modalBody.appendChild(rankWindow);

        const agentById = (id) => agents.find((agent) => agent.id === Number(id)) || null;
        const rankedIndex = (id) => ranking.findIndex((agent) => agent && agent.id === Number(id));
        const isComplete = () => ranking.every(Boolean);

        const updateSubmitState = () => {
          submitBtn.disabled = !isComplete();
        };

        const moveToSlot = (agentId, slotIdx) => {
          const agent = agentById(agentId);
          if (!agent || slotIdx < 0 || slotIdx >= ranking.length) return;
          const fromIdx = rankedIndex(agent.id);
          if (fromIdx === slotIdx) return;

          const displaced = ranking[slotIdx];
          if (fromIdx >= 0) ranking[fromIdx] = displaced || null;
          ranking[slotIdx] = agent;
          renderRanking();
        };

        const moveToSource = (agentId) => {
          const fromIdx = rankedIndex(agentId);
          if (fromIdx < 0) return;
          ranking[fromIdx] = null;
          renderRanking();
        };

        const moveToNextOpenSlot = (agentId) => {
          const slotIdx = ranking.findIndex((agent) => !agent);
          if (slotIdx >= 0) moveToSlot(agentId, slotIdx);
        };

        const readDraggedId = (e) => draggingId || Number(e.dataTransfer ? e.dataTransfer.getData("text/plain") : 0);

        const makeRankCard = (agent, inSlot) => {
          const card = el("div", {
            class: `rankCard ${agent.role}`,
            draggable: "true",
            "data-agent-id": String(agent.id),
          }, [
            makeAgentGlyph("rankCardTag", agent, agent.tag || agent.name.charAt(0)),
            el("div", {}, [
              el("div", { class: "rankName" }, [agent.name]),
              el("div", { class: "rankMeta" }, [agent.role === "security" ? "Yellow agent" : "Green agent"])
            ])
          ]);
          let pointerDrag = null;
          let suppressClick = false;

          const cleanupPointerDrag = () => {
            if (!pointerDrag) return;
            if (pointerDrag.ghost && pointerDrag.ghost.parentNode) {
              pointerDrag.ghost.parentNode.removeChild(pointerDrag.ghost);
            }
            card.classList.remove("dragging");
            try {
              if (card.releasePointerCapture) card.releasePointerCapture(pointerDrag.pointerId);
            } catch (_) {}
            pointerDrag = null;
          };

          const moveDragGhost = (e) => {
            if (!pointerDrag || !pointerDrag.ghost) return;
            pointerDrag.ghost.style.left = `${e.clientX - pointerDrag.offsetX}px`;
            pointerDrag.ghost.style.top = `${e.clientY - pointerDrag.offsetY}px`;
          };

          card.addEventListener("pointerdown", (e) => {
            if (e.button != null && e.button !== 0) return;
            const rect = card.getBoundingClientRect();
            pointerDrag = {
              pointerId: e.pointerId,
              startX: e.clientX,
              startY: e.clientY,
              offsetX: e.clientX - rect.left,
              offsetY: e.clientY - rect.top,
              moved: false,
              ghost: null,
            };
            if (card.setPointerCapture) card.setPointerCapture(e.pointerId);
          });

          card.addEventListener("pointermove", (e) => {
            if (!pointerDrag || pointerDrag.pointerId !== e.pointerId) return;
            const dx = e.clientX - pointerDrag.startX;
            const dy = e.clientY - pointerDrag.startY;
            if (!pointerDrag.moved && Math.hypot(dx, dy) < 5) return;
            e.preventDefault();

            if (!pointerDrag.moved) {
              const rect = card.getBoundingClientRect();
              const ghost = card.cloneNode(true);
              ghost.classList.add("rankDragGhost");
              ghost.style.width = `${rect.width}px`;
              ghost.style.left = `${rect.left}px`;
              ghost.style.top = `${rect.top}px`;
              document.body.appendChild(ghost);
              card.classList.add("dragging");
              pointerDrag.ghost = ghost;
              pointerDrag.moved = true;
            }

            moveDragGhost(e);
          });

          card.addEventListener("pointerup", (e) => {
            if (!pointerDrag || pointerDrag.pointerId !== e.pointerId) return;
            const didMove = pointerDrag.moved;
            cleanupPointerDrag();
            if (!didMove) return;

            suppressClick = true;
            setTimeout(() => { suppressClick = false; }, 0);
            e.preventDefault();

            const dropTarget = document.elementFromPoint(e.clientX, e.clientY);
            const slot = dropTarget ? dropTarget.closest(".rankSlot") : null;
            if (slot && slot.dataset.rankSlot != null) {
              moveToSlot(agent.id, Number(slot.dataset.rankSlot));
              return;
            }

            const source = dropTarget ? dropTarget.closest(".rankSourcePool") : null;
            if (source) moveToSource(agent.id);
          });

          card.addEventListener("pointercancel", cleanupPointerDrag);

          card.addEventListener("dragstart", (e) => {
            draggingId = agent.id;
            card.classList.add("dragging");
            if (e.dataTransfer) {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(agent.id));
            }
          });

          card.addEventListener("dragend", () => {
            draggingId = null;
            card.classList.remove("dragging");
          });

          card.addEventListener("click", (e) => {
            if (suppressClick) {
              e.preventDefault();
              return;
            }
            if (inSlot) moveToSource(agent.id);
            else moveToNextOpenSlot(agent.id);
          });

          return card;
        };

        const renderRanking = () => {
          sourcePool.innerHTML = "";
          rankWindow.innerHTML = "";

          const rankedIds = new Set(ranking.filter(Boolean).map((agent) => agent.id));
          const unrankedAgents = agents.filter((agent) => !rankedIds.has(agent.id));
          sourcePool.classList.toggle("empty", unrankedAgents.length === 0);
          if (unrankedAgents.length === 0) {
            sourcePool.appendChild(el("div", {}, ["All agents ranked"]));
          } else {
            unrankedAgents.forEach((agent) => sourcePool.appendChild(makeRankCard(agent, false)));
          }

          ranking.forEach((agent, idx) => {
            const slot = el("div", { class: "rankSlot" + (agent ? " filled" : ""), "data-rank-slot": String(idx) }, [
              el("div", { class: "rankSlotLabel" }, [
                `Rank ${idx + 1}`,
                el("small", {}, [idx === 0 ? "Best" : idx === ranking.length - 1 ? "Worst" : ""])
              ]),
              agent ? makeRankCard(agent, true) : el("div", { class: "rankPlaceholder" }, ["Drop agent here"])
            ]);

            slot.addEventListener("dragover", (e) => {
              e.preventDefault();
              slot.classList.add("dragOver");
              if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
            });

            slot.addEventListener("dragleave", () => {
              slot.classList.remove("dragOver");
            });

            slot.addEventListener("drop", (e) => {
              e.preventDefault();
              slot.classList.remove("dragOver");
              moveToSlot(readDraggedId(e), idx);
            });

            rankWindow.appendChild(slot);
          });

          updateSubmitState();
        };

        const submitBtn = el("button", { class: "btn", type: "button" }, ["Continue"]);
        submitBtn.addEventListener("click", () => {
          if (!isComplete()) return;
          modal.style.display = "none";
          resolve(ranking.map((agent, idx) => ({
            rank: idx + 1,
            id: agent.id,
            name: agent.name,
            role: agent.role,
            tag: agent.tag,
            shape: agent.shape,
          })));
        });

        modalBtns.appendChild(submitBtn);

        sourcePool.addEventListener("dragover", (e) => {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        });
        sourcePool.addEventListener("drop", (e) => {
          e.preventDefault();
          moveToSource(readDraggedId(e));
        });

        renderRanking();
        modal.style.display = "flex";
      });
    }

    async function showMainPhaseGoalInstruction() {
      logSystem("main_phase_goal_instruction_show");
      await showModal({
        title: "Main Task Goal",
        html: `
          <div style="
            font-size:clamp(30px, 5vw, 56px);line-height:1.08;font-weight:900;
            margin:4px 0 24px 0;text-align:center;letter-spacing:0;color:#1F2328;
          ">
            Your goal as a team is to maximize gold you dig.
          </div>
          <div style="
            font-size:clamp(22px, 3vw, 34px);line-height:1.22;font-weight:750;
            color:#363B42;text-align:center;letter-spacing:0;
          ">
            Please pay attention to your collaborator's behavior in order to maximize your reward.
          </div>
        `,
        buttons: [{ label: "Continue", value: "go" }],
      });
      logSystem("main_phase_goal_instruction_ack");
    }

    async function showCollaborationIntroInstruction() {
      logSystem("collaboration_intro_instruction_show");
      await showModal({
        title: "Main Task",
        html: `
          <div style="
            font-size:clamp(28px, 4.5vw, 50px);line-height:1.1;font-weight:900;
            margin:4px 0 22px 0;text-align:center;letter-spacing:0;color:#1F2328;
          ">
            You will now collaborate with different agents.
          </div>
          <div style="
            font-size:clamp(21px, 2.7vw, 32px);line-height:1.25;font-weight:750;
            color:#363B42;text-align:center;letter-spacing:0;
          ">
            Each agent behaves differently. Please pay close attention to your teammate and adapt to how they play.
          </div>
        `,
        buttons: [{ label: "Continue", value: "go" }],
      });
      logSystem("collaboration_intro_instruction_ack");
    }

    async function showPartnerReadyInstruction(partner, humanRole) {
      if (!partner) return;
      clearHumanIdleTimer();
      const previousOverlayActive = state ? !!state.overlayActive : false;
      if (state) state.overlayActive = true;

      logSystem("rep_partner_ready_instruction_show", {
        partner_id: partner.id,
        partner_name: partner.name,
        partner_role: partner.role,
        partner_lambda: agentLambdaValue(partner),
        human_role: humanRole || "",
        repetition: state && state.rep ? state.rep.current : "",
      });

      try {
        await showModal({
          title: "New Teammate",
          html: `
            <div style="
              display:flex;align-items:center;justify-content:center;gap:14px;
              font-size:clamp(28px, 4.5vw, 50px);line-height:1.1;font-weight:900;
              margin:4px 0 22px 0;text-align:center;letter-spacing:0;color:#1F2328;
            ">
              <span class="partnerGlyph ${partner.role} ${shapeClass(partner.shape)}"><span class="agentGlyphLabel">${partner.tag || ""}</span></span>
              <span>Now you are collaborating with ${partner.name}.</span>
            </div>
            <div style="
              font-size:clamp(22px, 3vw, 34px);line-height:1.22;font-weight:750;
              color:#363B42;text-align:center;letter-spacing:0;
            ">
              Are you ready?
            </div>
          `,
          buttons: [{ label: "Next", value: "go" }],
        });
      } finally {
        if (state) state.overlayActive = previousOverlayActive;
      }

      logSystem("rep_partner_ready_instruction_ack", {
        partner_id: partner.id,
        partner_name: partner.name,
        partner_role: partner.role,
        partner_lambda: agentLambdaValue(partner),
        human_role: humanRole || "",
        repetition: state && state.rep ? state.rep.current : "",
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
    function waitForOverlayContinue(eventName, label = "Continue") {
      return new Promise((resolve) => {
        overlayContinueBtn.textContent = label;
        overlayContinueBtn.style.display = "inline-block";
        overlayContinueBtn.onclick = () => {
          overlayContinueBtn.onclick = null;
          overlayContinueBtn.style.display = "none";
          if (eventName) logSystem(eventName, { no_rt: true });
          resolve();
        };
      });
    }

    async function showCenterMessage(text, subText = "", ms = EVENT_FREEZE_MS) {
      state.overlayActive = true;
      clearHumanIdleTimer();

      scanSpinnerEl.style.display = "none";
      resetOverlaySubStyle();
      overlayTextEl.textContent = text || "";
      overlaySubEl.textContent = subText || "";

      overlay.style.display = "flex";
      await sleep(ms);
      overlay.style.display = "none";

      state.overlayActive = false;
      if (state.running && isHumanTurn()) scheduleHumanIdleEnd();
    }

    async function showScanSequence(hasAlien, foundId = 0, newlyFound = 0, foundCount = 0) {
      state.overlayActive = true;
      clearHumanIdleTimer();

      overlay.style.display = "flex";
      scanSpinnerEl.style.display = "block";
      resetOverlaySubStyle();

      overlayTextEl.textContent = "Scanning 1×1 tile…";
      overlaySubEl.textContent = "";

      await sleep(SCAN_PROGRESS_MS);

      scanSpinnerEl.style.display = "none";

      if (hasAlien) {
        overlayTextEl.textContent = foundCount > 1 ? "Aliens found" : "Alien found";
        overlaySubEl.textContent = foundCount > 1
          ? `${foundCount} aliens chased away`
          : (foundId ? `Alien chased away` : "Chased away");
      } else {
        overlayTextEl.textContent = "No alien found";
        overlaySubEl.textContent = "";
      }

      await sleep(hasAlien ? SCAN_RESULT_MS : SCAN_NO_ALIEN_RESULT_MS);

      overlay.style.display = "none";
      state.overlayActive = false;

      if (state.running && isHumanTurn()) scheduleHumanIdleEnd();
    }

    function renderAlienAttackShapeSim(attacker) {
      const forager = state.agents.forager || {};
      const foragerShape = normalizeShape(forager.shape);

      const alienNode = state.spriteURL.alien
        ? el("img", {
            class: "attackAlienSprite",
            src: state.spriteURL.alien,
            alt: "",
            draggable: "false",
          })
        : el("div", { class: "attackAlienFallback" });

      return el("div", { class: "attackShapeSim" }, [
        el("div", { class: `attackForagerGlyph forager ${shapeClass(foragerShape)}` }, [
          el("span", { class: "agentGlyphLabel", style: "z-index:3;" }, [forager.tag || "F"]),
        ]),
        el("div", { class: "attackFreezeRing" }),
        el("div", { class: "attackAlienMover" }, [alienNode]),
      ]);
    }

    async function showAttackSequence(attacker) {
      state.overlayActive = true;
      clearHumanIdleTimer();

      overlay.style.display = "flex";
      resetOverlaySubStyle();

      const attackerId = attacker && attacker.id ? attacker.id : 0;

      scanSpinnerEl.style.display = "none";
      overlayTextEl.textContent = attackerId ? "Forager getting attacked by Alien!" : "Forager getting attacked!";
      overlaySubEl.innerHTML = "";

      if (attackerId) {
        overlaySubEl.appendChild(el("div", {}, [`Alien ${attackerId}`]));
      }

      overlaySubEl.appendChild(renderAlienAttackShapeSim(attacker));

      await sleep(ATTACK_PHASE1_MS);

      scanSpinnerEl.style.display = "none";
      overlayTextEl.textContent = "Forager is stunned";
      overlaySubEl.textContent = `Stunned for ${state.foragerStunTurns} turn(s)`;

      await sleep(ATTACK_PHASE2_MS);

      overlay.style.display = "none";
      state.overlayActive = false;
    }

    function renderRecoveryProcessDetails(details) {
      const movementSteps = details.securityDistance || 0;
      const scanDetail = details.foundAlienCount > 0
        ? `${details.foundAlienCount} alien${details.foundAlienCount === 1 ? "" : "s"} chased away`
        : "Gold mine tile scanned";

      overlaySubEl.classList.add("recoveryProcessSub");
      overlaySubEl.innerHTML = "";
      overlaySubEl.appendChild(el("div", { class: "recoveryProcess" }, [
        el("div", { class: "recoveryStats" }, [
          el("div", { class: "recoveryStat" }, [
            el("div", { class: "recoveryStatValue" }, [String(details.stepsRequired)]),
            el("div", { class: "recoveryStatLabel" }, ["Total steps"]),
          ]),
          el("div", { class: "recoveryStat" }, [
            el("div", { class: "recoveryStatValue" }, [String(details.roundsWasted)]),
            el("div", { class: "recoveryStatLabel" }, ["Rounds wasted"]),
          ]),
        ]),
        el("div", { class: "recoveryStep" }, [
          el("div", { class: "recoveryStepNum" }, ["1"]),
          el("div", {}, [
            el("div", { class: "recoveryStepTitle" }, ["Move to Forager"]),
            el("div", { class: "recoveryStepDetail" }, [
              `${details.securityLabel} moved from (${details.securityStartX}, ${details.securityStartY}) to (${details.foragerX}, ${details.foragerY}).`
            ]),
          ]),
          el("div", { class: "recoveryStepCount" }, [`${movementSteps} step${movementSteps === 1 ? "" : "s"}`]),
        ]),
        el("div", { class: "recoveryStep" }, [
          el("div", { class: "recoveryStepNum" }, ["2"]),
          el("div", {}, [
            el("div", { class: "recoveryStepTitle" }, ["Revive Forager"]),
            el("div", { class: "recoveryStepDetail" }, ["Forager is no longer stunned."]),
          ]),
          el("div", { class: "recoveryStepCount" }, ["1 step"]),
        ]),
        el("div", { class: "recoveryStep" }, [
          el("div", { class: "recoveryStepNum" }, ["3"]),
          el("div", {}, [
            el("div", { class: "recoveryStepTitle" }, ["Scan and chase"]),
            el("div", { class: "recoveryStepDetail" }, [scanDetail]),
          ]),
          el("div", { class: "recoveryStepCount" }, ["1 step"]),
        ]),
      ]));
    }

    function renderAutoStunRecoveryShapeSim(details) {
      const forager = state.agents.forager || {};
      const security = state.agents.security || {};
      const foragerShape = normalizeShape(forager.shape);
      const securityShape = normalizeShape(security.shape);

      return el("div", { class: "recoveryShapeSim" }, [
        el("div", { class: "recoveryShapeTrack" }),
        el("div", { class: "recoveryReviveBurst" }),
        el("div", { class: `recoveryShapeGlyph forager stunned ${shapeClass(foragerShape)}` }, [
          el("span", { class: "agentGlyphLabel" }, [forager.tag || "F"]),
        ]),
        el("div", { class: `recoveryShapeGlyph security ${shapeClass(securityShape)}` }, [
          el("span", { class: "agentGlyphLabel" }, [security.tag || "S"]),
        ]),
      ]);
    }

    async function showAutoStunRecoveryScreen(details) {
      state.overlayActive = true;
      clearHumanIdleTimer();

      const stepsLabel = details.stepsRequired === 1 ? "step" : "steps";
      const roundsLabel = details.roundsWasted === 1 ? "round" : "rounds";

      overlay.classList.add("recoveryOverlay");
      overlay.style.display = "flex";
      scanSpinnerEl.style.display = "none";
      resetOverlaySubStyle();

      overlayTextEl.textContent = "Forager is stunned";
      overlaySubEl.innerHTML = "";
      overlaySubEl.appendChild(el("div", {}, [
        `${details.securityLabel} went to the Forager's position and revived the Forager.\n` +
        `${details.securityLabel} scanned the local area and Alien is chased away.\n` +
        `In total of ${details.stepsRequired} ${stepsLabel} and total of ${details.roundsWasted} ${roundsLabel} wasted.`
      ]));

      try {
        if (state.mode === "main") {
          await waitForOverlayContinue("auto_stun_recovery_continue", "Next");
        } else {
          await sleep(AUTO_STUN_RECOVERY_MS / 2);
        }

        resetOverlaySubStyle();
        overlayTextEl.textContent = "Recovery process";
        renderRecoveryProcessDetails(details);

        if (state.mode === "main") {
          await waitForOverlayContinue("auto_stun_recovery_process_continue", "Continue");
        } else {
          await sleep(AUTO_STUN_RECOVERY_MS / 2);
        }
      } finally {
        overlay.classList.remove("recoveryOverlay");
        overlay.style.display = "none";
        state.overlayActive = false;
      }
    }

    async function showForgeSequence(goldAfter, goldDelta = 1) {
      state.overlayActive = true;
      clearHumanIdleTimer();

      overlay.style.display = "flex";
      scanSpinnerEl.style.display = "block";
      resetOverlaySubStyle();

      overlayTextEl.textContent = "Digging…";
      overlaySubEl.textContent = "";

      await sleep(520);

      scanSpinnerEl.style.display = "none";
      overlayTextEl.textContent = "";
      overlaySubEl.style.color = rewardColor(goldDelta);
      overlaySubEl.style.fontWeight = "900";
      overlaySubEl.style.fontSize = "72px";
      overlaySubEl.style.lineHeight = "1";
      overlaySubEl.style.marginTop = "0";
      overlaySubEl.textContent = `+${goldDelta}`;
      overlayRewardTotalEl.textContent = `Total: ${goldAfter}`;
      overlayRewardTotalEl.style.display = "block";
      playRewardSound(goldDelta);

      await sleep(1500);

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

      // if (t.goldMine) {
      //   await showCenterMessage("Found a gold mine", "", EVENT_FREEZE_MS);
      // }
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

        // defer repetition init (partner + map) to startTurnFlow()
        state.pendingRepInit = state.rep.current;
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

      if (clampedFlag) {
        logInvalidAction(agentKey, "move", source, "out_of_bounds_move", {
          dir: act.dir || "",
          dx: act.dx,
          dy: act.dy,
          from_x: fromX,
          from_y: fromY,
          attempted_x: attemptedX,
          attempted_y: attemptedY,
          to_x: toX,
          to_y: toY,
          clamped: 1,
          key: act.label || "",
        });
        if (source === "human") scheduleHumanIdleEnd();
        return false;
      }

      logMove(agentKey, source, act, fromX, fromY, attemptedX, attemptedY, toX, toY, false);

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

    function securityRecoveryLabel() {
      if (state.mode === "main" && state.turn.humanAgent === "security") return "You";
      return (state.agents.security && state.agents.security.name) || "Security";
    }

    function securityRecoverySource() {
      return state.mode === "main" && state.turn.humanAgent === "security" ? "human" : "model";
    }

    function getSecurityRecoveryPath(startX, startY, targetX, targetY) {
      const path = [];
      let x = startX;
      let y = startY;
      let guard = Math.max(1, state.gridSize * state.gridSize * 2);

      while ((x !== targetX || y !== targetY) && guard > 0) {
        const act = stepToward(x, y, targetX, targetY);
        if (!act) break;

        const toX = clamp(x + act.dx, 0, state.gridSize - 1);
        const toY = clamp(y + act.dy, 0, state.gridSize - 1);
        path.push({
          ...act,
          fromX: x,
          fromY: y,
          toX,
          toY,
        });

        x = toX;
        y = toY;
        guard -= 1;
      }

      return path;
    }

    function getAutoStunRecoveryDetails(attacker) {
      const F = state.agents.forager;
      const S = state.agents.security;
      const securityPath = getSecurityRecoveryPath(S.x, S.y, F.x, F.y);
      const securityDistance = securityPath.length;
      const stepsRequired = securityDistance + 2; // move to Forager, revive, then scan.
      const movesPerTurn = Math.max(1, state.turn.maxMoves || DEFAULT_MAX_MOVES_PER_TURN);
      const roundsWasted = Math.max(1, Math.ceil(stepsRequired / movesPerTurn));

      return {
        securityLabel: securityRecoveryLabel(),
        securityDistance,
        stepsRequired,
        roundsWasted,
        securityStartX: S.x,
        securityStartY: S.y,
        foragerX: F.x,
        foragerY: F.y,
        securityPath,
        securityPathTiles: securityPath.map((p) => `${p.toX},${p.toY}`).join("|"),
        attackerAlienId: attacker && attacker.id ? attacker.id : 0,
        attackerX: attacker && Number.isFinite(attacker.x) ? attacker.x : "",
        attackerY: attacker && Number.isFinite(attacker.y) ? attacker.y : "",
      };
    }

    function advanceAfterAutoStunRecovery(roundsWasted) {
      if (!state.running) return;
      clearHumanIdleTimer();

      const skipRounds = Math.max(1, Number(roundsWasted) || 1);
      const orderLen = state.turn.order.length;
      const fromRound = state.round.current;
      const currentRoundStartIdx = Math.floor(state.turn.idx / orderLen) * orderLen;

      state.turn.idx = currentRoundStartIdx + (skipRounds * orderLen);
      state.turn.movesUsed = 0;
      state.turn.token += 1;
      state.round.current += skipRounds;

      logSystem("auto_stun_round_skip", {
        no_rt: true,
        auto_recovery: 1,
        from_round: fromRound,
        to_round: state.round.current,
        rounds_wasted: skipRounds,
      });

      if (attemptEndIfRoundLimitReached()) return;
      startTurnFlow();
    }

    async function resolveAutoStunRecovery(attacker) {
      const details = getAutoStunRecoveryDetails(attacker);
      const source = securityRecoverySource();
      const F = state.agents.forager;
      const S = state.agents.security;

      for (let i = 0; i < details.securityPath.length; i++) {
        const step = details.securityPath[i];
        S.x = step.toX;
        S.y = step.toY;

        logSystem("auto_stun_recovery_move", {
          no_rt: true,
          auto_recovery: 1,
          step_number: i + 1,
          step_total: details.securityDistance,
          dir: step.dir || "",
          dx: step.dx,
          dy: step.dy,
          from_x: step.fromX,
          from_y: step.fromY,
          to_x: step.toX,
          to_y: step.toY,
          security_path_tiles: details.securityPathTiles,
        });

        await reveal("security", step.toX, step.toY, "auto_stun_recovery_move");
        renderAll();
      }

      state.foragerStunTurns = 0;

      const recoveryScanAllowed = canScanAt(F.x, F.y);
      const scanCells = recoveryScanAllowed ? getScanCells(F.x, F.y) : [];
      if (scanCells.length) {
        markScannedCells(scanCells);
        updateSecurityPolicyMemoryAfterScan(scanCells);
      }

      const foundAliens = findAliensInScanCells(scanCells);
      let newlyFound = 0;
      for (const al of foundAliens) {
        if (!al.discovered) {
          al.discovered = true;
          newlyFound += 1;
        }
      }

      const hasAlien = foundAliens.length ? 1 : 0;
      const foundIds = foundAliens.map((al) => al.id);
      const foundId = foundIds.length ? foundIds[0] : details.attackerAlienId;
      details.scanTileCount = scanCells.length;
      details.foundAlienCount = foundAliens.length;
      details.foundAlienIds = foundIds.join("|");

      logAction("security", "revive_forager", source, {
        success: 1,
        key: "auto",
        move_index_in_turn: 1,
        auto_recovery: 1,
        on_forager_tile: 1,
        from_x: details.securityStartX,
        from_y: details.securityStartY,
        to_x: details.foragerX,
        to_y: details.foragerY,
        dx: details.foragerX - details.securityStartX,
        dy: details.foragerY - details.securityStartY,
        security_distance: details.securityDistance,
        steps_required: details.stepsRequired,
        rounds_wasted: details.roundsWasted,
        security_path_tiles: details.securityPathTiles,
        forager_stun_turns_after: 0,
        attacker_alien_id: details.attackerAlienId,
      });

      logAction("security", "scan_chase", source, {
        success: 1,
        key: "auto",
        move_index_in_turn: 2,
        auto_recovery: 1,
        scan_center_x: F.x,
        scan_center_y: F.y,
        scan_radius: SCAN_RADIUS,
        scan_allowed: recoveryScanAllowed ? 1 : 0,
        scanned_tile_count: scanCells.length,
        scanned_tiles: scanCells.map((p) => `${p.x},${p.y}`).join("|"),
        has_alien: hasAlien,
        newly_found: newlyFound,
        chased_away: hasAlien ? 1 : 0,
        found_alien_count: foundAliens.length,
        found_alien_id: foundId,
        found_alien_ids: foundIds.join("|"),
        tile_alien_center_id: tileAt(F.x, F.y).alienCenterId || 0,
        security_distance: details.securityDistance,
        steps_required: details.stepsRequired,
        rounds_wasted: details.roundsWasted,
        security_path_tiles: details.securityPathTiles,
        attacker_alien_id: details.attackerAlienId,
      });

      for (const foundAlien of foundAliens) {
        if (foundAlien && !foundAlien.removed) {
          foundAlien.removed = true;
          logSystem("alien_chased_away", {
            no_rt: true,
            reason: "chased_away",
            chase_status: "chased_away",
            alien_id: foundAlien.id,
            found_alien_id: foundAlien.id,
            found_alien_count: foundAliens.length,
            alien_x: foundAlien.x,
            alien_y: foundAlien.y,
            tile_x: foundAlien.x,
            tile_y: foundAlien.y,
            cause: "auto_stun_recovery",
            auto_recovery: 1,
            scan_center_x: F.x,
            scan_center_y: F.y,
            scan_radius: SCAN_RADIUS,
          });
        }
      }

      logSystem("auto_stun_recovery", {
        auto_recovery: 1,
        security_label: details.securityLabel,
        security_distance: details.securityDistance,
        steps_required: details.stepsRequired,
        rounds_wasted: details.roundsWasted,
        security_start_x: details.securityStartX,
        security_start_y: details.securityStartY,
        security_path_tiles: details.securityPathTiles,
        scan_center_x: F.x,
        scan_center_y: F.y,
        scan_radius: SCAN_RADIUS,
        scan_allowed: recoveryScanAllowed ? 1 : 0,
        scanned_tile_count: scanCells.length,
        found_alien_count: foundAliens.length,
        found_alien_id: foundId,
        found_alien_ids: foundIds.join("|"),
        attacker_alien_id: details.attackerAlienId,
        alien_x: details.attackerX,
        alien_y: details.attackerY,
      });

      renderAll();
      await showAutoStunRecoveryScreen(details);
      advanceAfterAutoStunRecovery(details.roundsWasted);
    }

    function mineDecayKey(mineTypeRaw) {
      return mineTypeKey(mineTypeRaw);
    }

    function currentMineValue(tile) {
      if (!tile) return 0;
      const n = Number(tile.mineValue);
      if (Number.isFinite(n)) return n;
      return initialMineValue(tile.mineType);
    }

    function rewardBandForValue(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return "";
      if (n >= 14 && n <= 20) return "yellow";
      if (n >= 6 && n <= 13) return "purple";
      if (n >= 0 && n <= 5) return "blue";
      return "";
    }

    function expectedMineReward(tileOrMineType) {
      if (tileOrMineType && typeof tileOrMineType === "object") {
        return Math.max(0, currentMineValue(tileOrMineType));
      }
      return Math.max(0, initialMineValue(tileOrMineType));
    }

    function sampleMineDecayAmount() {
      const u = Math.random();
      let cumulative = 0;
      for (const opt of MINE_DECAY_AMOUNTS) {
        cumulative += opt.prob;
        if (u < cumulative) {
          return { decay_amount: opt.amount, decay_prob: opt.prob, decay_rng_u: u };
        }
      }
      const fallback = MINE_DECAY_AMOUNTS[MINE_DECAY_AMOUNTS.length - 1];
      return { decay_amount: fallback.amount, decay_prob: fallback.prob, decay_rng_u: u };
    }

    function sampleMineReward(tile) {
      const currentValue = Math.max(0, currentMineValue(tile));
      const decay = sampleMineDecayAmount();
      const valueAfterDecay = currentMineValue(tile) - decay.decay_amount;

      return {
        mine_type_key: mineDecayKey(tile && tile.mineType),
        reward_value: currentValue,
        reward_prob: 1,
        reward_rng: "",
        mine_initial_value: tile ? tile.mineInitialValue || initialMineValue(tile.mineType) : 0,
        mine_value_before: currentMineValue(tile),
        mine_value_after: valueAfterDecay,
        mine_decay_amount: decay.decay_amount,
        mine_reward_band: rewardBandForValue(currentValue),
        decay_prob: decay.decay_prob,
        decay_rng_u: decay.decay_rng_u,
      };
    }

    async function maybeDepleteMineAtTile(tile, x, y, rewardRoll = null) {
      if (!tile || !tile.goldMine) return { depleted: false };

      const k = mineDecayKey(tile.mineType);
      const hasRewardDecay = rewardRoll && Number.isFinite(Number(rewardRoll.mine_decay_amount));
      const fallbackDecay = hasRewardDecay ? null : sampleMineDecayAmount();
      const decayAmount = hasRewardDecay
        ? Number(rewardRoll.mine_decay_amount)
        : fallbackDecay.decay_amount;
      const decayProb = rewardRoll && Number.isFinite(Number(rewardRoll.decay_prob))
        ? Number(rewardRoll.decay_prob)
        : fallbackDecay.decay_prob;
      const decayRng = rewardRoll && rewardRoll.decay_rng_u != null && rewardRoll.decay_rng_u !== ""
        ? rewardRoll.decay_rng_u
        : fallbackDecay.decay_rng_u;
      const valueBefore = currentMineValue(tile);
      const valueAfter = valueBefore - decayAmount;
      const payload = {
        tile_x: x,
        tile_y: y,
        mine_type_raw: String(tile.mineType || ""),
        mine_type_key: k,
        decay_prob: decayProb,
        rng_u: decayRng,
        decay_rng_u: decayRng,
        mine_initial_value: tile.mineInitialValue || initialMineValue(tile.mineType),
        mine_value_before: valueBefore,
        mine_value_after: valueAfter,
        mine_decay_amount: decayAmount,
        mine_reward_band: rewardBandForValue(Math.max(0, valueBefore)),
      };

      logSystem("mine_decay_check", payload);

      tile.mineValue = valueAfter;

      if (valueAfter < 0) {
        logSystem("gold_mine_depleted", { no_rt: true, reason: "depleted", depletion_status: "depleted", ...payload });

        tile.depletedGoldMineForDisplay = true;
        tile.goldMine = false;
        tile.mineType = "";

        renderAll();
        await showCenterMessage("Gold mine fully dug", "", EVENT_FREEZE_MS);
        return { depleted: true, ...payload };
      }

      logSystem("mine_not_depleted", payload);
      return { depleted: false, ...payload };
    }

    async function stunEndTurn(attacker) {
      await resolveAutoStunRecovery(attacker);
    }

    function normalizeActionKeyForRole(agentKey, keyLower) {
      const k = String(keyLower || "").toLowerCase();
      if (agentKey === "forager" && (k === "d" || k === "e")) return "d";
      if (agentKey === "security" && (k === "s" || k === "q")) return "s";
      if (agentKey === "security" && (k === "r" || k === "e")) return "r";
      return k;
    }

    async function doAction(agentKey, keyLower, source) {
      if (!state.running || state.overlayActive) return false;

      const a = state.agents[agentKey];
      const t = tileAt(a.x, a.y);
      const actionKey = normalizeActionKeyForRole(agentKey, keyLower);

      // FORAGER: D dig
      if (agentKey === "forager" && actionKey === "d") {
        if (!(t.revealed && t.goldMine)) {
          logInvalidAction(agentKey, "dig", source, "no_gold_mine_here", { tile_gold_mine: t.goldMine ? 1 : 0, tile_mine_type: t.mineType || "", key: actionKey });
          if (source === "human") scheduleHumanIdleEnd();
          return false;
        }

        const rewardRoll = sampleMineReward(t);
        const goldDelta = rewardRoll.reward_value;
        const before = state.goldTotal;
        state.goldTotal += goldDelta;

        logAction(agentKey, "dig", source, {
          success: 1,
          gold_before: before,
          gold_after: state.goldTotal,
          gold_delta: goldDelta,
          mine_type_key: rewardRoll.mine_type_key,
          mine_reward_prob: rewardRoll.reward_prob,
          mine_reward_rng: rewardRoll.reward_rng,
          mine_initial_value: rewardRoll.mine_initial_value,
          mine_value_before: rewardRoll.mine_value_before,
          mine_value_after: rewardRoll.mine_value_after,
          mine_decay_amount: rewardRoll.mine_decay_amount,
          mine_reward_band: rewardRoll.mine_reward_band,
          decay_prob: rewardRoll.decay_prob,
          decay_rng_u: rewardRoll.decay_rng_u,
          tile_gold_mine: 1,
          tile_mine_type: t.mineType || "",
          key: actionKey,
        });
        updateForagerPolicyMemoryAfterDig(a.x, a.y, rewardRoll);

        state.turn.movesUsed += 1;
        renderAll();
        if (source === "human") scheduleHumanIdleEnd();

        await showForgeSequence(state.goldTotal, goldDelta);
        await maybeDepleteMineAtTile(t, a.x, a.y, rewardRoll);

        const attacker = anyAlienInRange(a.x, a.y);
        if (attacker) {
          if (wasScanned(a.x, a.y)) {
            logSystem("alien_attack_blocked_by_scan", {
              attacker_alien_id: attacker.id,
              alien_x: attacker.x,
              alien_y: attacker.y,
              dig_x: a.x,
              dig_y: a.y,
              scanned_tile: 1,
            });
          } else {
            const u = Math.random();
            const willAttack = u < ALIEN_ATTACK_PROB;

            logSystem("alien_attack_check", { attacker_alien_id: attacker.id, alien_x: attacker.x, alien_y: attacker.y, dig_x: a.x, dig_y: a.y, attack_prob: ALIEN_ATTACK_PROB, rng_u: u, will_attack: willAttack ? 1 : 0 });

            if (willAttack) {
              state.foragerStunTurns = Math.max(state.foragerStunTurns, 3);
              logSystem("alien_attack", {
                attacker_alien_id: attacker.id,
                alien_x: attacker.x,
                alien_y: attacker.y,
                dig_x: a.x,
                dig_y: a.y,
                stun_turns_set: state.foragerStunTurns
              });
            
              renderAll();
              await showAttackSequence(attacker);
            
              await stunEndTurn(attacker);
              return true;
            }
          }
        }

        if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");
        return true;
      }

      // SECURITY: S scans Security's current gold mine tile, then chases away found aliens
      if (agentKey === "security" && actionKey === "s") {
        if (!isScanMineTile(t)) {
          logInvalidAction(agentKey, "scan_chase", source, "no_gold_mine_here", {
            tile_gold_mine: t.goldMine ? 1 : 0,
            tile_depleted_gold_mine: t.depletedGoldMineForDisplay ? 1 : 0,
            tile_mine_type: t.mineType || "",
            key: actionKey,
          });
          if (source === "human") scheduleHumanIdleEnd();
          return false;
        }

        const scanCells = getScanCells(a.x, a.y);
        markScannedCells(scanCells);
        updateSecurityPolicyMemoryAfterScan(scanCells);

        const foundAliens = findAliensInScanCells(scanCells);
        let newlyFound = 0;
        for (const al of foundAliens) {
          if (!al.discovered) {
            al.discovered = true;
            newlyFound += 1;
          }
        }

        const hasAlien = foundAliens.length ? 1 : 0;
        const foundIds = foundAliens.map((al) => al.id);
        const foundId = foundIds.length ? foundIds[0] : 0;

        logAction(agentKey, "scan_chase", source, {
          success: 1,
          scan_center_x: a.x,
          scan_center_y: a.y,
          scan_radius: SCAN_RADIUS,
          scan_allowed: 1,
          scanned_tile_count: scanCells.length,
          scanned_tiles: scanCells.map((p) => `${p.x},${p.y}`).join("|"),
          has_alien: hasAlien,
          newly_found: newlyFound,
          chased_away: hasAlien ? 1 : 0,
          found_alien_count: foundAliens.length,
          found_alien_id: foundId,
          found_alien_ids: foundIds.join("|"),
          tile_alien_center_id: t.alienCenterId || 0,
          key: actionKey
        });

        state.turn.movesUsed += 1;
        renderAll();
        if (source === "human") scheduleHumanIdleEnd();

        await showScanSequence(!!hasAlien, foundId, newlyFound, foundAliens.length);

        for (const foundAlien of foundAliens) {
          if (foundAlien && !foundAlien.removed) {
            foundAlien.removed = true;
            logSystem("alien_chased_away", { no_rt: true, reason: "chased_away", chase_status: "chased_away", alien_id: foundAlien.id, found_alien_id: foundAlien.id, found_alien_count: foundAliens.length, alien_x: foundAlien.x, alien_y: foundAlien.y, tile_x: foundAlien.x, tile_y: foundAlien.y, cause: "scan_chase", scan_center_x: a.x, scan_center_y: a.y });
          }
        }
        renderAll();

        if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");
        return true;
      }

      // SECURITY: R revive
      if (agentKey === "security" && actionKey === "r") {
        const fx = state.agents.forager.x, fy = state.agents.forager.y;
        const sx = state.agents.security.x, sy = state.agents.security.y;

        if (!(state.foragerStunTurns > 0 && fx === sx && fy === sy)) {
          logInvalidAction(agentKey, "revive_forager", source, "forager_not_down_or_not_same_tile", { on_forager_tile: fx === sx && fy === sy ? 1 : 0, forager_stun_turns: state.foragerStunTurns, key: actionKey });
          if (source === "human") scheduleHumanIdleEnd();
          return false;
        }

        state.foragerStunTurns = 0;

        logAction(agentKey, "revive_forager", source, { success: 1, on_forager_tile: 1, forager_stun_turns_after: 0, key: actionKey });

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

    const UNIVERSAL_BASE_PARAMS = Object.freeze({
      lambdaValue: 0.0,
      epsilon: 20.0,
      vdigVmoveTradeoff: 0.50,
      rewardTotalDecay: 0.5,
      rewardInfo: 0.5,
      foragerGoldPrior: 10.0,
      fixedScanValue: 20.0,
      followerDistanceTarget: 3.0,
      leaderDistanceCutoff: 6.0,
      securityDepartedGoldDiscount: 0.35,
    });

    function defaultUniversalParams(agentKey) {
      return UNIVERSAL_BASE_PARAMS;
    }

    function universalParamsForNamedAgent(agentObj) {
      const roleText = String(agentObj && agentObj.role || "").toLowerCase();
      const agentKey = roleText.includes("security") ? "security" : "forager";
      const params = { ...defaultUniversalParams(agentKey) };
      const lambdaValue = agentLambdaValue(agentObj);
      if (lambdaValue !== "") params.lambdaValue = lambdaValue;
      return { agentKey, params };
    }

    function universal_policy(role, paramsOrLambda = null) {
      if (!state || !state.agents) return null;

      const agentKey = String(role || "").toLowerCase().includes("security") ? "security" : "forager";
      const params = { ...defaultUniversalParams(agentKey) };
      if (typeof paramsOrLambda === "number") {
        params.lambdaValue = Number(paramsOrLambda);
      } else if (paramsOrLambda && typeof paramsOrLambda === "object") {
        Object.assign(params, paramsOrLambda);
      }

      const self = state.agents[agentKey];
      const other = state.agents[agentKey === "security" ? "forager" : "security"];
      if (!self || !other) return null;

      if (!state.policyAlpha) state.policyAlpha = {};
      const memory = ensurePolicyMemory(agentKey);
      const currentKey = coordKey(self.x, self.y);
      memory.visited.add(currentKey);

      const softmaxChoice = (values, temperature = 0.5) => {
        if (!values.length) return [];
        const temp = Math.max(Number(temperature), 1e-9);
        const scaled = values.map((value) => Number(value) / temp);
        const maxVal = Math.max(...scaled);
        const exps = scaled.map((value) => Math.exp(value - maxVal));
        const total = exps.reduce((acc, value) => acc + value, 0);
        return exps.map((value) => value / total);
      };

      const sampleIndex = (probs) => {
        let r = Math.random();
        for (let i = 0; i < probs.length; i++) {
          r -= probs[i];
          if (r <= 0) return i;
        }
        return probs.length - 1;
      };

      const sampleChoice = (labels, scores, temperature = 0.5) => {
        const probs = softmaxChoice(scores, temperature);
        return labels[sampleIndex(probs)];
      };

      const neighbors = (x, y) => [
        { x: x - 1, y },
        { x: x + 1, y },
        { x, y: y - 1 },
        { x, y: y + 1 },
      ].filter((p) => p.x >= 0 && p.y >= 0 && p.x < state.gridSize && p.y < state.gridSize);

      const isActiveRevealedGold = (x, y) => {
        const tile = tileAt(x, y);
        return !!(tile && tile.revealed && tile.goldMine);
      };

      const learnedGoldValue = (x, y) => {
        const estimates = memory.goldValueEstimates || {};
        const key = coordKey(x, y);
        return Object.prototype.hasOwnProperty.call(estimates, key) ? Number(estimates[key]) : null;
      };

      const isSecurityScannedGold = (x, y) => memory.chased.has(coordKey(x, y));

      const securityDepartedGoldDiscount = (x, y) => {
        const discounts = memory.securityDepartedGoldDiscounts || {};
        const value = Number(discounts[coordKey(x, y)]);
        return Number.isFinite(value) ? value : 1.0;
      };

      const rememberSecurityDepartedGoldDiscount = (x, y, discount) => {
        const key = coordKey(x, y);
        const bounded = Math.min(1.0, Math.max(0.0, Number(discount)));
        const current = Number(memory.securityDepartedGoldDiscounts[key]);
        memory.securityDepartedGoldDiscounts[key] = Math.min(Number.isFinite(current) ? current : 1.0, bounded);
        return memory.securityDepartedGoldDiscounts[key];
      };

      const goldValueDetailsAt = (x, y) => {
        if (!isActiveRevealedGold(x, y)) return { value: 0.0, source: "none" };
        if (agentKey === "security") {
          if (isSecurityScannedGold(x, y)) return { value: 0.0, source: "security_memory_depleted" };
          return { value: Number(params.fixedScanValue), source: "fixed_scan_value" };
        }
        const learnedValue = learnedGoldValue(x, y);
        if (learnedValue !== null) return { value: learnedValue, source: "memory" };
        return { value: Number(params.foragerGoldPrior), source: "prior" };
      };

      const goldValueAt = (x, y) => goldValueDetailsAt(x, y).value;

      const visibleGoldTargets = (excludeKey = null, discountKey = null, discountMultiplier = 1.0) => {
        const targets = [];
        for (let y = 0; y < state.gridSize; y++) {
          for (let x = 0; x < state.gridSize; x++) {
            const key = coordKey(x, y);
            if (excludeKey && key === excludeKey) continue;
            const details = goldValueDetailsAt(x, y);
            let value = details.value;
            let valueSource = details.source;
            if (agentKey === "security" && value > 0) {
              const memoryDiscount = securityDepartedGoldDiscount(x, y);
              const oneStepDiscount = key === discountKey
                ? Math.min(1.0, Math.max(0.0, Number(discountMultiplier)))
                : 1.0;
              const totalDiscount = memoryDiscount * oneStepDiscount;
              if (totalDiscount < 1.0) {
                value *= totalDiscount;
                valueSource = "security_departed_discount";
              }
            }
            if (value > 0) targets.push({ x, y, value, valueSource });
          }
        }
        return targets;
      };

      const bestVisibleGoldValue = (
        point,
        excludeKey = null,
        distanceExtra = 0,
        discountKey = null,
        discountMultiplier = 1.0
      ) => {
        if (!point) return { value: 0.0, target: null };
        let bestValue = 0.0;
        let bestTarget = null;
        for (const target of visibleGoldTargets(excludeKey, discountKey, discountMultiplier)) {
          const dist = manDist(point.x, point.y, target.x, target.y) + Math.max(0, Number(distanceExtra) || 0);
          const value = target.value * (Number(params.rewardTotalDecay) ** dist);
          if (value > bestValue) {
            bestValue = value;
            bestTarget = target;
          }
        }
        return { value: bestValue, target: bestTarget };
      };

      const unexploredTotal = (point) => {
        let total = 0.0;
        const decay = Number(params.rewardTotalDecay);
        for (let y = 0; y < state.gridSize; y++) {
          for (let x = 0; x < state.gridSize; x++) {
            if (tileAt(x, y).revealed) continue;
            const dist = manDist(point.x, point.y, x, y);
            total += decay ** dist;
          }
        }
        return total;
      };

      const socialDistanceValue = (point, currentPoint = null) => {
        const lam = Number(params.lambdaValue);
        if (lam === 0) return 0.0;
        const scaledPenalty = (distance) => {
          const target = Math.max(lam > 0 ? Number(params.leaderDistanceCutoff) : Number(params.followerDistanceTarget), 1e-9);
          const violation = lam > 0
            ? Math.max(0.0, target - distance)
            : Math.max(0.0, distance - target);
          return (Math.exp(violation) - 1.0) / (Math.exp(target) - 1.0);
        };

        const nextDist = manDist(point.x, point.y, other.x, other.y);
        const nextPenalty = scaledPenalty(nextDist);
        if (!currentPoint) return -Math.abs(lam) * nextPenalty;

        const currentDist = manDist(currentPoint.x, currentPoint.y, other.x, other.y);
        const currentPenalty = scaledPenalty(currentDist);
        return Math.abs(lam) * (currentPenalty - nextPenalty);
      };

      const movementUtility = (
        point,
        excludeGoldKey = null,
        goldDistanceExtra = 0,
        discountGoldKey = null,
        discountGoldMultiplier = 1.0
      ) => {
        const currentPoint = { x: self.x, y: self.y };
        const goldValue = bestVisibleGoldValue(
          point,
          excludeGoldKey,
          goldDistanceExtra,
          discountGoldKey,
          discountGoldMultiplier
        ).value;
        const exploreValue = unexploredTotal(point);
        return (
          socialDistanceValue(point, currentPoint)
          + Number(params.rewardInfo) * goldValue
          + (1 - Number(params.rewardInfo)) * exploreValue
        );
      };

      const scoreNeighborMoves = (
        excludeGoldKey = null,
        goldDistanceExtra = 0,
        discountGoldKey = null,
        discountGoldMultiplier = 1.0
      ) => neighbors(self.x, self.y).map((point) => ({
        score: movementUtility(point, excludeGoldKey, goldDistanceExtra, discountGoldKey, discountGoldMultiplier),
        point,
      }));

      const bestNeighborMove = (
        excludeGoldKey = null,
        goldDistanceExtra = 0,
        discountGoldKey = null,
        discountGoldMultiplier = 1.0
      ) => {
        const scoredMoves = scoreNeighborMoves(excludeGoldKey, goldDistanceExtra, discountGoldKey, discountGoldMultiplier);
        if (!scoredMoves.length) return { score: 0.0, point: null, target: null };
        let best = scoredMoves[0];
        for (const item of scoredMoves) {
          if (item.score > best.score) best = item;
        }
        const target = bestVisibleGoldValue(
          best.point,
          excludeGoldKey,
          goldDistanceExtra,
          discountGoldKey,
          discountGoldMultiplier
        ).target;
        return { score: best.score, point: best.point, target };
      };

      const chooseMoveTarget = (
        excludeGoldKey = null,
        goldDistanceExtra = 0,
        discountGoldKey = null,
        discountGoldMultiplier = 1.0
      ) => {
        const scoredMoves = scoreNeighborMoves(excludeGoldKey, goldDistanceExtra, discountGoldKey, discountGoldMultiplier);
        if (!scoredMoves.length) return null;
        const scores = scoredMoves.map((item) => Number(params.epsilon) * item.score);
        const probs = softmaxChoice(scores, 0.5);
        return scoredMoves[sampleIndex(probs)].point;
      };

      const rememberPolicyStep = () => {
        memory.prev = { x: self.x, y: self.y };
        memory.t += 1;
      };

      const setAlpha = (alpha, extra = {}) => {
        memory.alpha = alpha;
        state.policyAlpha[agentKey] = {
          alpha,
          ...extra,
          x: self.x,
          y: self.y,
          role: agentKey,
        };
      };

      if (agentKey === "forager") {
        if (state.foragerStunTurns > 0) {
          memory.t += 1;
          setAlpha(0.0, { Vdig: NaN, Vmove: NaN, stunned: true });
          return null;
        }

        const Vdig = goldValueAt(self.x, self.y);
        const excludeGoldKey = Vdig > 0 ? currentKey : null;
        const move = bestNeighborMove(excludeGoldKey);
        const Vmove = move.score;
        const alpha = Vdig - Vmove;

        memory.Vdig = Vdig;
        memory.Vmove = Vmove;
        setAlpha(alpha, {
          Vdig,
          Vmove,
          moveTargetX: move.target ? move.target.x : null,
          moveTargetY: move.target ? move.target.y : null,
          moveTargetValue: move.target ? move.target.value : 0.0,
          moveTargetValueSource: move.target ? move.target.valueSource : "none",
        });

        const action = sampleChoice(
          ["dig", "move"],
          [
            Number(params.epsilon) * Number(params.vdigVmoveTradeoff) * Vdig,
            Number(params.epsilon) * (1 - Number(params.vdigVmoveTradeoff)) * Vmove,
          ],
          0.5
        );

        if (action === "dig" && isActiveRevealedGold(self.x, self.y)) {
          rememberPolicyStep();
          return { kind: "action", key: "d" };
        }

        const movePoint = chooseMoveTarget(excludeGoldKey);
        rememberPolicyStep();
        return movePoint ? stepToward(self.x, self.y, movePoint.x, movePoint.y) : null;
      }

      if (state.foragerStunTurns > 0) {
        if (self.x === other.x && self.y === other.y) {
          setAlpha(0.0, { rescue: true });
          rememberPolicyStep();
          return { kind: "action", key: "r" };
        }
        setAlpha(0.0, { rescue: true });
        rememberPolicyStep();
        return stepToward(self.x, self.y, other.x, other.y);
      }

      const scanMemoryDepleted = isSecurityScannedGold(self.x, self.y);
      const scanAllowedHere = isActiveRevealedGold(self.x, self.y) && !scanMemoryDepleted;
      const fixedScanValue = goldValueAt(self.x, self.y);
      const Vscan = scanAllowedHere
        ? socialDistanceValue({ x: self.x, y: self.y }, { x: self.x, y: self.y }) + Number(params.rewardInfo) * fixedScanValue
        : 0.0;

      const departedGoldDiscountKey = scanAllowedHere ? currentKey : null;
      const departedGoldDiscount = scanAllowedHere ? Number(params.securityDepartedGoldDiscount) : 1.0;
      const move = bestNeighborMove(null, 0, departedGoldDiscountKey, departedGoldDiscount);
      const Vmove = move.score;
      const alpha = Vscan - Vmove;

      memory.Vscan = Vscan;
      memory.Vmove = Vmove;
      setAlpha(alpha, {
        Vscan,
        Vmove,
        fixed_scan_value: fixedScanValue,
        moveTargetX: move.target ? move.target.x : null,
        moveTargetY: move.target ? move.target.y : null,
        moveTargetValue: move.target ? move.target.value : 0.0,
        moveTargetValueSource: move.target ? move.target.valueSource : "none",
        moveGoldWeight: Number(params.rewardInfo),
        moveDiscountedGoldKey: departedGoldDiscountKey || "",
        moveDiscountedGoldMultiplier: departedGoldDiscount,
        stunHotspot: memory.stunHotspots.has(currentKey),
        scanAllowedHere,
        scanMemoryDepleted,
      });

      if (scanAllowedHere) {
        const action = sampleChoice(
          ["scan", "move"],
          [Number(params.epsilon) * Vscan, Number(params.epsilon) * Vmove],
          1.0
        );

        if (action === "scan" && !memory.chased.has(currentKey)) {
          for (const point of getScanCells(self.x, self.y)) {
            const key = coordKey(point.x, point.y);
            memory.chased.add(key);
            memory.chaseAreas.add(key);
          }
          rememberPolicyStep();
          return { kind: "action", key: "s" };
        }
      }

      const movePoint = chooseMoveTarget(null, 0, departedGoldDiscountKey, departedGoldDiscount);
      if (scanAllowedHere && movePoint) {
        rememberSecurityDepartedGoldDiscount(self.x, self.y, params.securityDepartedGoldDiscount);
      }
      rememberPolicyStep();
      return movePoint ? stepToward(self.x, self.y, movePoint.x, movePoint.y) : null;
    }

    function policyForNamedAgent(agentObj) {
      if (!agentObj) return null;
      const { agentKey, params } = universalParamsForNamedAgent(agentObj);
      return universal_policy(agentKey, params);
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
      // NEW: if repetition advanced, initialize partner+map now
      if (state.mode === "main" && state.pendingRepInit) {
        const repToInit = state.pendingRepInit;
        state.pendingRepInit = 0;
        await applyMainPartnerForRep(repToInit);
        if (!state.running) return;
      }

      const flowToken = ++state.turnFlowToken;

      renderAll();

      const aKey = curKey();

      // stun skip for forager
      if (aKey === "forager" && state.foragerStunTurns > 0) {
        const before = state.foragerStunTurns;
        await showCenterMessage("Forager is stunned", STUN_SKIP_MS);
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
      if (k === "d" || k === "s" || k === "r") {
        e.preventDefault();
        void doAction(agentKey, k, "human");
      }
    }

    // ---------- Session constructors ----------
    function freshWorldFromBaseline(baseline) {
      if (!baseline || !baseline.map || !baseline.aliens) {
        throw new Error("freshWorldFromBaseline() requires a loaded baseline");
      }
      return {
        gridSize: baseline.gridSize,
        map: deepClone(baseline.map),
        aliens: deepClone(baseline.aliens),
      };
    }


    function horizontalSpawnPositions(gridSize) {
      const size = Math.max(1, Number(gridSize) || 1);
      const y = Math.floor((size - 1) / 2);

      // Start agents 4 tiles in from the left/right edges.
      // Coordinates are 0-indexed:
      // 4th tile from left  = x = 3
      // 4th tile from right = x = size - 4
      const edgeOffset = Math.min(3, Math.floor((size - 1) / 2));

      return {
        forager: { x: edgeOffset, y },
        security: { x: size - 1 - edgeOffset, y },
      };
    }

    function applyHorizontalSpawns() {
      const spawns = horizontalSpawnPositions(state.gridSize);

      state.agents.forager.x = spawns.forager.x;
      state.agents.forager.y = spawns.forager.y;

      state.agents.security.x = spawns.security.x;
      state.agents.security.y = spawns.security.y;

      return spawns;
    }

    function makeCommonState(world) {
      const spawns = horizontalSpawnPositions(world.gridSize);

      return {
        running: true,

        // IMPORTANT: start in init mode (no rep/partner yet)
        mode: "init", // "init" | "observe" | "main"
        demoLabel: "",
        observePair: null,

        gridSize: world.gridSize,
        map: world.map,
        aliens: world.aliens,
        scannedCells: {},

        spriteURL: {
          gold: absURL(GOLD_SPRITE_URL),
          goldDepleted: absURL(GOLD_DEPLETED_SPRITE_URL),
          alien: state && state.spriteURL ? state.spriteURL.alien : null,
        },

        agents: {
          forager:  { name: "Forager",  cls: "forager",  x: spawns.forager.x,  y: spawns.forager.y,  tag: "", shape: HUMAN_SHAPE },
          security: { name: "Security", cls: "security", x: spawns.security.x, y: spawns.security.y, tag: "", shape: HUMAN_SHAPE },
        },

        goldTotal: 0,
        foragerStunTurns: 0,

        turn: {
          order: ["security", "forager"],
          idx: 0,
          movesUsed: 0,
          maxMoves: maxMovesPerTurn,
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
        mapMeta: { csvUrl: "", name: "", rewardLevel: "", riskLevel: "", mapNum: "", phase: "", index: 0 },
        pendingRepInit: 0,
      };
    }


    // ----- MAIN repetition/partner order -----
    const ALL_MAIN_AGENTS = ACTIVE_AGENTS.slice();

    function makeOneAgentCycle() {
      return shuffleInPlace(ALL_MAIN_AGENTS.slice());
    }

    function buildMainPartnerOrder(totalRepetitions) {
      const total = Math.max(0, Number(totalRepetitions) || 0);
      const order = [];

      while (order.length < total) {
        order.push(...makeOneAgentCycle());
      }

      return order.slice(0, total);
    }
    function setMapMeta(csvUrl, phase, index) {
  const name = mapFileName(csvUrl);
  const parsed = parseMapFromName(name);
  state.mapMeta = {
    csvUrl: absURL(csvUrl),
    name,
    phase: String(phase || ""),
    index: Number(index || 0),
    rewardLevel: parsed.rewardLevel || "",
    riskLevel: parsed.riskLevel || "",
    mapNum: parsed.mapNum || "",
  };
}

    async function applyMapCsv(csvUrl, phase, index) {
      const baseline = await loadBaseline(csvUrl);

      // IMPORTANT: set meta before reveal() logs
      setMapMeta(baseline.csvUrl, phase, index);

      state.gridSize = baseline.gridSize;
      state.map = deepClone(baseline.map);
      state.aliens = deepClone(baseline.aliens);
      state.scannedCells = {};

      // reset per-map / per-repetition state
      state.goldTotal = 0;
      state.foragerStunTurns = 0;
      state.policyMemory = {};
      state.policyAlpha = {};

      const spawns = applyHorizontalSpawns();

      buildBoard();
      renderAll();

      logSystem("map_applied", {
        map_csv: state.mapMeta.csvUrl,
        map_name: state.mapMeta.name,
        map_phase: state.mapMeta.phase,
        map_index: state.mapMeta.index,
      });

      // reveal each role's horizontal spawn tile (and record it)
      await reveal("forager", spawns.forager.x, spawns.forager.y, "spawn");
      await reveal("security", spawns.security.x, spawns.security.y, "spawn");
    }

    async function applyMainPartnerForRep(repIdx1Based) {
      const partner = state.rep.partnerOrder[repIdx1Based - 1];
      if (!partner) {
        logSystem("missing_partner_for_repetition", { requested_repetition: repIdx1Based });
        endWholeTask("missing_partner_for_repetition");
        return;
      }

      const csvUrl =
        (state.rep.mapCsvs && state.rep.mapCsvs[repIdx1Based - 1]) ||
        MAP_CSV_URL;

      const partnerRole = partner.role;
      const humanRole = oppositeRole(partnerRole);

      // Set repetition/role state BEFORE applying the map, so map_applied + spawn
      // reveal logs belong to the correct repetition and human/partner role.
      state.rep.current = repIdx1Based;
      state.round.current = 1;
      state.round.total = state.rep.roundsPerRep;
      state.partner = partner;
      state.turn.humanAgent = humanRole;

      // Start every repetition from a clean security -> forager turn cycle.
      clearHumanIdleTimer();
      state.turn.idx = 0;
      state.turn.movesUsed = 0;
      state.turn.maxMoves = maxMovesPerTurn;
      state.turn.token += 1;
      state.scriptedRunning = false;

      state.agents[partnerRole].name = partner.name;
      state.agents[partnerRole].tag = partner.tag;
      state.agents[partnerRole].shape = normalizeShape(partner.shape);

      state.agents[humanRole].name = "You";
      state.agents[humanRole].tag = "";
      state.agents[humanRole].shape = HUMAN_SHAPE;

      await applyMapCsv(csvUrl, "main", repIdx1Based);

      logSystem("rep_partner_assigned", {
        repetition: state.rep.current,
        repetition_total: state.rep.total,
        repetition_cycle: Math.floor((state.rep.current - 1) / ALL_MAIN_AGENTS.length) + 1,
        repetition_in_cycle: ((state.rep.current - 1) % ALL_MAIN_AGENTS.length) + 1,
        rounds_per_rep: state.rep.roundsPerRep,
        partner_id: partner.id,
        partner_name: partner.name,
        partner_role: partner.role,
        partner_tag: partner.tag,
        partner_shape: partner.shape,
        partner_lambda: agentLambdaValue(partner),
        human_role: humanRole,
        human_shape: HUMAN_SHAPE,
        map_csv: state.mapMeta.csvUrl,
        map_name: state.mapMeta.name,
      });

      renderAll();

      await showPartnerReadyInstruction(partner, humanRole);
    }


    // ---------- Run an observation demo ----------
    async function runObservationDemo(pairObj, mapCsvUrl, demoIdx1Based) {
      const baseline = await loadBaseline(mapCsvUrl || MAP_CSV_URL);
      const world = freshWorldFromBaseline(baseline);
      state = makeCommonState(world);
      setMapMeta(baseline.csvUrl, "observe", demoIdx1Based);


      state.mode = "observe";
      state.demoLabel = pairObj.label;
      state.observePair = { security: pairObj.security, forager: pairObj.forager };

      state.round.current = 1;
      state.round.total = observationRoundsPerDemo;

      state.turn.humanAgent = null; // no control

      // names + tags for both
      state.agents.security.name = pairObj.security.name;
      state.agents.security.tag = pairObj.security.tag;
      state.agents.security.shape = normalizeShape(pairObj.security.shape);

      state.agents.forager.name = pairObj.forager.name;
      state.agents.forager.tag = pairObj.forager.tag;
      state.agents.forager.shape = normalizeShape(pairObj.forager.shape);

      // rebuild board only once (grid size constant)
      buildBoard();


      renderAll();

      // reveal each role's horizontal spawn tile
      const spawns = horizontalSpawnPositions(state.gridSize);
      await reveal("forager", spawns.forager.x, spawns.forager.y, "spawn");
      await reveal("security", spawns.security.x, spawns.security.y, "spawn");

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
    async function runMainWithPartnerCycle() {
      // Pick a real baseline to construct the initial state.
      // applyMainPartnerForRep(1) will immediately switch to the rep-1 map.
      const firstMainCsv =
        (MAP_LISTS && Array.isArray(MAP_LISTS.main) && MAP_LISTS.main.length)
          ? MAP_LISTS.main[0]
          : MAP_CSV_URL;

      const firstBase = await loadBaseline(firstMainCsv);
      const world = freshWorldFromBaseline(firstBase);

      state = makeCommonState(world);
      state.mode = "main";

      const order = buildMainPartnerOrder(repetitions);

      state.rep = {
        current: 1,
        total: repetitions,
        roundsPerRep: roundsPerRep,
        partnerOrder: order,
        mapCsvs: MAP_LISTS.main, // map rotation list for main reps
      };

      logSystem("main_partner_order_created", {
        repetitions: repetitions,
        agent_cycle_size: ALL_MAIN_AGENTS.length,
        partner_order_names: order.map((a) => a.name).join("|"),
        partner_order_ids: order.map((a) => a.id).join("|"),
        partner_order_roles: order.map((a) => a.role).join("|"),
        partner_order_lambdas: order.map((a) => agentLambdaValue(a)).join("|"),
      });

      // This applies map(rep1), resets positions/gold/stun, rebuilds board,
      // reveals spawn, assigns partner/human roles, and shows the rep banner.
      await applyMainPartnerForRep(1);

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

  // attach key listener once
  window.addEventListener("keydown", onKeyDown);

  // collect all map CSVs we intend to use
  const obsList = (enableObservationPhase && MAP_LISTS && Array.isArray(MAP_LISTS.obs)) ? MAP_LISTS.obs : [];
  const mainList = (MAP_LISTS && Array.isArray(MAP_LISTS.main)) ? MAP_LISTS.main : [];
  const uniqueCsvs = [...new Set([...obsList, ...mainList])];

  if (!uniqueCsvs.length) uniqueCsvs.push(MAP_CSV_URL);

  // log base info (helps diagnose GitHub Pages /docs vs root issues)
  logSystem("debug_paths", {
    location_href: String(location.href),
    base_uri: String(document.baseURI),
    first_csv_raw: String(uniqueCsvs[0]),
    first_csv_abs: absURL(uniqueCsvs[0]),
  });

  // preload all map CSVs (fail early if any missing)
  for (const u of uniqueCsvs) {
    const abs = absURL(u);
    const resp = await fetch(abs, { cache: "no-store" });
    if (!resp.ok) {
      throw new Error(`Missing map CSV (HTTP ${resp.status}): ${abs}`);
    }
    // cache it via your loader (keeps one consistent path)
    await loadBaseline(u);
  }

  // initialize UI using the first baseline
  const firstBase = await loadBaseline(uniqueCsvs[0]);
  const tmpWorld = freshWorldFromBaseline(firstBase);

  state = makeCommonState(tmpWorld);
  state.spriteURL.alien = resolvedAlien.url || null;

  // init meta so snapshot() has map fields from the beginning
  setMapMeta(firstBase.csvUrl, "init", 0);

  buildBoard();
  renderAll();

  logSystem("agent_shapes_assigned", agentShapeLogFields());

  logSystem("maps_configured", {
    observation_enabled: enableObservationPhase ? 1 : 0,
    observation_maps: obsList.map(absURL).join("|"),
    main_maps: mainList.map(absURL).join("|"),
    alien_sprite_url: resolvedAlien.url || "",
    grid_size: firstBase.gridSize,
    first_map_csv: firstBase.csvUrl,
    first_map_name: state.mapMeta ? state.mapMeta.name : "",
  });

  if (enableObservationPhase) {
    // ---- Observation intro instruction ----
    logSystem("observation_intro_show");
    await showModal({
      title: "Next: Observation",
      html: `
        <div style="margin-bottom:10px;">
          You will first <b>watch 2 pairs of agents</b> play the game.
        </div>
        <div>
          Each pair will play <b>${observationRoundsPerDemo} rounds</b>.
          After watching, you will rank the agents.
        </div>
      `,
      buttons: [{ label: "Continue", value: "go" }],
    });
    logSystem("observation_intro_ack");

    // ---- Run observation demos (map i) ----
    for (let i = 0; i < DEMO_PAIRS.length; i++) {
      const csv =
        (obsList && obsList[i]) ? obsList[i] :
        (obsList && obsList[0]) ? obsList[0] :
        MAP_CSV_URL;

      await runObservationDemo(DEMO_PAIRS[i], csv, i + 1);
    }
  } else {
    logSystem("observation_skipped");
  }

  if (enableObservationPhase) {
    // ---- Rank all active agents after observation ----
    logSystem("agent_ranking_show");
    const agentRanking = await showAgentRankingModal();
    const rankingExtra = {
      agent_rank_order: agentRanking.map((a) => a.name).join("|"),
      agent_rank_ids: agentRanking.map((a) => a.id).join("|"),
      agent_rank_roles: agentRanking.map((a) => a.role).join("|"),
      agent_rank_shapes: agentRanking.map((a) => a.shape).join("|"),
      agent_rank_lambdas: agentRanking.map((a) => agentLambdaValue(a)).join("|"),
    };
    agentRanking.forEach((a) => {
      rankingExtra[`rank_${a.rank}_agent`] = a.name;
      rankingExtra[`rank_${a.rank}_agent_id`] = a.id;
      rankingExtra[`rank_${a.rank}_agent_role`] = a.role;
      rankingExtra[`rank_${a.rank}_agent_shape`] = a.shape;
      rankingExtra[`rank_${a.rank}_agent_lambda`] = agentLambdaValue(a);
    });
    logSystem("agent_ranking_submitted", rankingExtra);
  } else {
    logSystem("agent_ranking_skipped", { reason: "observation_disabled" });
  }

  logSystem("pair_choice_skipped", { reason: "all_four_agents_included" });

  await showCollaborationIntroInstruction();
  await showMainPhaseGoalInstruction();

  // ---- Run main phase with the four-agent partner cycle ----
  await runMainWithPartnerCycle();
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
