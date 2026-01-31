/* ===========================
  main_phase.js
  - 10 game rounds (Round 1/10)
  - grouped into 6 big rounds (blocks)
  - each block = collaborate with one agent (Tom/Jerry/Cindy/Frank/Alice/Grace)
  - start-of-block banner + persistent top-right partner name
  - policies stored here
  =========================== */

(function () {
  "use strict";

  const MAP_CSV_URL = "./gridworld/grid_map.csv";

  const GOLD_SPRITE_URL = "./TexturePack/gold_mine.png";
  const ALIEN_SPRITE_CANDIDATES = ["./TexturePack/allien.png"];

  const DEFAULT_TOTAL_ROUNDS = 10;
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

  // ===================== MOVEMENT HELPERS =====================
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

    const alienCenters = new Map();

    for (const r of rows) {
      if (r.x < 0 || r.y < 0 || r.x >= gridSize || r.y >= gridSize) continue;
      const t = map[r.y][r.x];

      if (r.mineType) { t.goldMine = true; t.mineType = r.mineType; }

      if (r.alienId && r.alienId > 0) {
        t.alienCenterId = r.alienId;
        alienCenters.set(r.alienId, { id: r.alienId, x: r.x, y: r.y, discovered: false, removed: false });
      }
    }

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

  // ===================== GAME =====================
  function startGame(containerId, config) {
    const {
      participantId,
      logger,
      trialIndex = 0,

      maxMovesPerTurn = DEFAULT_MAX_MOVES_PER_TURN,
      totalRounds = DEFAULT_TOTAL_ROUNDS,

      modelMoveMs = 1000,
      humanIdleTimeoutMs = 10000,

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

      spriteURL: {
        gold: absURL(GOLD_SPRITE_URL),
        alien: null,
      },

      agents: {
        forager: { name: "Forager", cls: "forager", x: 0, y: 0 },
        security: { name: "Security", cls: "security", x: 0, y: 0 },
      },

      goldTotal: 0,
      foragerStunTurns: 0,

      // ===== NEW: partner schedule (6 blocks over 10 rounds) =====
      partner: {
        plan: [],          // length totalRounds, one entry per game round
        current: null,     // current round's partner entry
        blockJustStarted: false,
      },

      turn: {
        order: ["forager", "security"],
        idx: 0,
        movesUsed: 0,
        maxMoves: maxMovesPerTurn,
        humanAgent: "forager",
        token: 0,
      },
      round: { current: 1, total: totalRounds },

      timers: { humanIdle: null },
      scriptedRunning: false,

      overlayActive: true,
      turnFlowToken: 0,
    };

    const curKey = () => state.turn.order[state.turn.idx % state.turn.order.length];
    const isHumanTurn = () => curKey() === state.turn.humanAgent;
    const turnInRound = () => state.turn.idx % state.turn.order.length;
    const turnGlobal = () => state.turn.idx + 1;

    const tileAt = (x, y) => state.map[y][x];
    const alienById = (id) => state.aliens.find((a) => a.id === id) || null;

    // ===== NEW: agent definitions + schedule builder =====
    const AGENTS = {
      Tom:   { id: 1, name: "Tom",   role: "security" },
      Jerry: { id: 2, name: "Jerry", role: "forager"  },
      Cindy: { id: 3, name: "Cindy", role: "security" },
      Frank: { id: 4, name: "Frank", role: "forager"  },
      Alice: { id: 5, name: "Alice", role: "security" },
      Grace: { id: 6, name: "Grace", role: "forager"  },
    };

    const AGENT_LIST = [
      AGENTS.Tom, AGENTS.Jerry, AGENTS.Cindy, AGENTS.Frank, AGENTS.Alice, AGENTS.Grace
    ];

    function oppositeRole(r) {
      return r === "forager" ? "security" : "forager";
    }

    function buildPartnerPlan(totalRounds) {
      // 6 blocks, one per agent, each block length distributed as evenly as possible
      // base = floor(totalRounds/6), remainder distributed to first 'rem' blocks after shuffle
      const agents = shuffleInPlace(AGENT_LIST.slice());
      const base = Math.floor(totalRounds / agents.length);
      const rem = totalRounds % agents.length;

      const blocks = agents.map((a, i) => ({
        block_index: i + 1,
        partner_id: a.id,
        partner_name: a.name,
        partner_role: a.role,
        n_rounds: base + (i < rem ? 1 : 0),
      }));

      const plan = [];
      let gameRound = 1;
      for (const b of blocks) {
        for (let k = 0; k < b.n_rounds; k++) {
          if (gameRound > totalRounds) break;
          plan.push({
            game_round: gameRound,
            block_index: b.block_index,
            partner_id: b.partner_id,
            partner_name: b.partner_name,
            partner_role: b.partner_role,
            human_role: oppositeRole(b.partner_role),
          });
          gameRound++;
        }
      }

      // Safety: if any rounding weirdness, pad with last block
      while (plan.length < totalRounds) {
        const last = plan[plan.length - 1];
        plan.push({ ...last, game_round: plan.length + 1 });
      }

      return plan;
    }

    function applyPartnerForGameRound(roundIdx1Based) {
      const entry = state.partner.plan[roundIdx1Based - 1];
      const prevBlock = state.partner.current ? state.partner.current.block_index : null;

      state.partner.current = entry;
      state.partner.blockJustStarted = (roundIdx1Based === 1) || (entry.block_index !== prevBlock);

      // Human controls opposite role of partner
      state.turn.humanAgent = entry.human_role;

      logger.log({
        trial_index: state.trialIndex,
        event_type: "system",
        event_name: "partner_assigned",
        round: roundIdx1Based,
        big_round_block: entry.block_index,
        partner_id: entry.partner_id,
        partner_name: entry.partner_name,
        partner_role: entry.partner_role,
        human_role: entry.human_role,
      });
    }

    function partnerMeta() {
      const p = state.partner.current;
      if (!p) return {};
      return {
        big_round_block: p.block_index,
        partner_id: p.partner_id,
        partner_name: p.partner_name,
        partner_role: p.partner_role,
        human_role: p.human_role,
      };
    }

    // ===== Your 1–6 agent policies (kept here) =====
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
      // “knows all gold”: choose nearest gold mine from CSV truth
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
      // knows all aliens; clears them; revives if needed; explores if none left
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

      // explore unrevealed
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
      // only uses revealed tiles
      const F = state.agents.forager;
      const here = tileAt(F.x, F.y);
      if (here.revealed && here.goldMine) return { kind: "action", key: "e" };

      // nearest revealed gold
      let best = null, bestD = Infinity;
      for (let y = 0; y < state.gridSize; y++)
        for (let x = 0; x < state.gridSize; x++) {
          const t = tileAt(x, y);
          if (!(t.revealed && t.goldMine)) continue;
          const d = manDist(F.x, F.y, x, y);
          if (d < bestD) { bestD = d; best = { x, y }; }
        }
      if (!best) return null;

      // choose step that stays on revealed tiles
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
      // explore biased to highReward; scan/push if on alien center
      const S = state.agents.security;
      const t = tileAt(S.x, S.y);

      if (t.alienCenterId) {
        const al = alienById(t.alienCenterId);
        if (al && !al.removed) {
          if (!al.discovered) return { kind: "action", key: "q" };
          return { kind: "action", key: "p" };
        }
      }

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
      // passive follow security; forge when in security range (<=2) and on revealed mine
      const F = state.agents.forager;
      const S = state.agents.security;

      const here = tileAt(F.x, F.y);
      const inSecRange = chebDist(F.x, F.y, S.x, S.y) <= 2;

      if (here.revealed && here.goldMine && inSecRange) return { kind: "action", key: "e" };
      return stepToward(F.x, F.y, S.x, S.y) || null;
    }

    function policyForPartner(agentKey) {
      const p = state.partner.current;
      if (!p) return null;

      // Only the non-human agent is AI-controlled
      if (agentKey === state.turn.humanAgent) return null;

      // Partner controls their own role
      if (agentKey !== p.partner_role) return null;

      switch (p.partner_id) {
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
      if (USE_CSB_MODEL) {
        const csb = getCSBModel();
        if (csb && typeof csb.nextAction === "function") {
          const act = csb.nextAction({ agent: agentKey, state: JSON.parse(JSON.stringify(state)) });
          return normalizeModelAct(act);
        }
      }
      return normalizeModelAct(policyForPartner(agentKey));
    }

    // ===================== LOGGING =====================
    const snapshot = () => ({
      forager_x: state.agents.forager.x,
      forager_y: state.agents.forager.y,
      security_x: state.agents.security.x,
      security_y: state.agents.security.y,
      gold_total: state.goldTotal,
      forager_stun_turns: state.foragerStunTurns,
      ...partnerMeta(),
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

    // ===================== UI (top-right partner label) =====================
    mount.appendChild(
      el("style", {}, [`
        html, body { height:100%; overflow:hidden; }
        body { margin:0; }
        .stage{ width:100vw; height:100vh; display:flex; align-items:center; justify-content:center; background:#f7f7f7; }
        .card{ width:min(92vw, 1200px); height:min(92vh, 980px); background:#fff; border:1px solid #e6e6e6; border-radius:16px;
               box-shadow:0 2px 12px rgba(0,0,0,.06); padding:14px; display:flex; flex-direction:column; gap:12px; position:relative; overflow:hidden; }
        .top{ display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
        .round{ font-weight:900; font-size:16px; }
        .moves{ font-weight:800; font-size:14px; color:#444; margin-top:2px; }
        .badge{ display:flex; align-items:center; gap:10px; padding:10px 14px; border-radius:999px; border:1px solid #e6e6e6;
                background:#fafafa; font-weight:900; font-size:18px; white-space:nowrap; }
        .dot{ width:14px; height:14px; border-radius:999px; }
        .dot.forager{ background:#16a34a; }
        .dot.security{ background:#eab308; }
        .turn{ display:flex; align-items:center; gap:10px; font-weight:900; font-size:22px; white-space:nowrap; }

        /* ===== NEW: right-side partner label ===== */
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

        .boardWrap{ flex:1; display:flex; align-items:center; justify-content:center; min-height:0; }
        .board{ width:min(82vmin, 900px); height:min(82vmin, 900px); border:2px solid #ddd; border-radius:14px; display:grid;
                background:#fff; user-select:none; overflow:hidden; }
        .cell{ border:1px solid #f1f1f1; position:relative; display:flex; align-items:center; justify-content:center; box-sizing:border-box; overflow:hidden; }
        .cell.unrev{ background:#bdbdbd; }
        .cell.rev{ background:#ffffff; }
        .agent, .agentPair, .agentMini{ position:relative; z-index:10; }
        .agent{ width:72%; height:72%; border-radius:14px; box-shadow:0 2px 8px rgba(0,0,0,.12); }
        .agent.forager{ background:#16a34a; }
        .agent.security{ background:#eab308; }
        .agent.forager.stunned{ background:#9ca3af; }
        .agentPair{ width:82%; height:82%; position:relative; }
        .agentMini{ position:absolute; width:66%; height:66%; border-radius:14px; border:2px solid rgba(255,255,255,.95); box-shadow:0 3px 10px rgba(0,0,0,.16); }
        .agentMini.forager{ left:0; top:0; background:#16a34a; }
        .agentMini.security{ right:0; bottom:0; background:#eab308; }
        .agentMini.forager.stunned{ background:#9ca3af; }
        .sprite{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); pointer-events:none; user-select:none; z-index:30; object-fit:contain; image-rendering:pixelated; }
        .sprite.gold{ width:88%; height:88%; z-index:30; }
        .sprite.alien{ width:96%; height:96%; z-index:31; }
        .fallbackMarker{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:40%; height:40%; border-radius:999px; z-index:32; opacity:0.95; pointer-events:none; }
        .fallbackMarker.alien{ background:#a855f7; }
        .bottomBar{ flex:0 0 auto; height:52px; border:1px solid #e6e6e6; border-radius:14px; background:#fafafa; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:18px; }
        .overlay{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.25); z-index:50; }
        .overlayBox{ background:rgba(255,255,255,0.98); border:1px solid #e6e6e6; border-radius:14px; padding:18px 22px;
                     box-shadow:0 8px 24px rgba(0,0,0,0.15); font-weight:900; font-size:28px; text-align:center; width:min(560px, 86%); }
        .overlaySub{ margin-top:8px; font-size:14px; font-weight:800; color:#666; }
        .scanSpinner{ width:42px; height:42px; border-radius:999px; border:4px solid #d7d7d7; border-top-color:#111; margin:14px auto 0;
                      animation:spin 0.85s linear infinite; display:none; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `])
    );

    const roundEl = el("div", { class: "round" });
    const movesEl = el("div", { class: "moves" });
    const leftStack = el("div", { style: "display:flex;flex-direction:column;gap:2px;" }, [roundEl, movesEl]);

    const badgeDot = el("span", { class: "dot" });
    const badgeTxt = el("span");
    const badge = el("div", { class: "badge" }, [badgeDot, badgeTxt]);

    // ===== NEW: partner pill (top-right persistent) =====
    const partnerPill = el("div", { class: "partnerPill", id: "partnerPill" }, ["Partner: …"]);

    const turnEl = el("div", { class: "turn" });
    const rightStack = el("div", { class: "rightStack" }, [partnerPill, turnEl]);

    const top = el("div", { class: "top" }, [leftStack, badge, rightStack]);

    const board = el("div", { class: "board", id: "board" });
    const boardWrap = el("div", { class: "boardWrap" }, [board]);
    const bottomBar = el("div", { class: "bottomBar", id: "bottomBar" }, ["Gold: 0"]);

    const overlayTextEl = el("div", { id: "overlayText" }, ["Loading map…"]);
    const overlaySubEl = el("div", { class: "overlaySub", id: "overlaySub" }, [""]);
    const scanSpinnerEl = el("div", { class: "scanSpinner", id: "scanSpinner" }, []);

    const overlay = el("div", { class: "overlay", id: "overlay" }, [
      el("div", { class: "overlayBox" }, [overlayTextEl, overlaySubEl, scanSpinnerEl]),
    ]);

    const card = el("div", { class: "card" }, [top, boardWrap, bottomBar, overlay]);
    const stage = el("div", { class: "stage" }, [card]);
    mount.appendChild(stage);

    let cells = [];
    const cellAt = (x, y) => cells[y * state.gridSize + x];

    function renderTop() {
      roundEl.textContent = `Round ${state.round.current} / ${state.round.total}`;
      movesEl.textContent = `Moves: ${state.turn.movesUsed} / ${state.turn.maxMoves}`;

      const you = state.turn.humanAgent;
      badgeDot.className = "dot " + (you === "forager" ? "forager" : "security");
      badgeTxt.textContent = `You are: ${you === "forager" ? "Forager (Green)" : "Security (Yellow)"}`;

      // ===== NEW: set partner pill text =====
      const p = state.partner.current;
      partnerPill.textContent = p ? `Partner: ${p.partner_name}` : "Partner: …";

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
                el("div", { class: "agentMini forager" + (foragerStunned ? " stunned" : "") }),
                el("div", { class: "agentMini security" }),
              ])
            );
          } else if (hasF) {
            c.appendChild(el("div", { class: "agent forager" + (foragerStunned ? " stunned" : "") }));
          } else if (hasS) {
            c.appendChild(el("div", { class: "agent security" }));
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

    // ---------- Mechanics (same as your version) ----------
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
        trial_index: state.trialIndex,
        event_type: source === "human" ? "key" : "model",
        event_name: "move",
        round: state.round.current,
        round_total: state.round.total,
        turn_global: state.turn.idx + 1,
        turn_index_in_round: state.turn.idx % state.turn.order.length,
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
        turn_index_in_round: state.turn.idx % state.turn.order.length,
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

    function logInvalidAction(agentKey, actionName, source, reason, payload = {}) {
      logger.log({
        trial_index: state.trialIndex,
        event_type: source === "human" ? "action_invalid" : "model_action_invalid",
        event_name: actionName,
        reason: String(reason || ""),
        round: state.round.current,
        round_total: state.round.total,
        turn_global: state.turn.idx + 1,
        turn_index_in_round: state.turn.idx % state.turn.order.length,
        active_agent: curKey(),
        human_agent: state.turn.humanAgent,
        controller: source,
        agent: agentKey,
        move_index_in_turn_attempted: state.turn.movesUsed + 1,
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

      // end of a game round after both agents moved
      if (state.turn.idx % state.turn.order.length === 0) {
        logSystem("end_round", { ended_round: state.round.current });
        state.round.current += 1;

        if (state.round.current > state.round.total) {
          renderAll();
          endGame("round_limit_reached");
          return;
        }

        // ===== NEW: apply partner for the next game round =====
        applyPartnerForGameRound(state.round.current);
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

      if (agentKey === "security" && keyLower === "q") {
        let hasAlien = 0;
        let newlyFound = 0;
        let foundId = 0;

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

      if (agentKey === "security" && keyLower === "p") {
        let success = 0;
        let chasedId = 0;

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

    // ---------- Turn flow ----------
    async function startTurnFlow() {
      if (!state.running) return;
      const flowToken = ++state.turnFlowToken;

      renderAll();

      const aKey = curKey();

      // ===== NEW: show partner banner only when big round changes =====
      if (turnInRound() === 0 && state.partner.blockJustStarted) {
        const p = state.partner.current;
        const roleName = state.turn.humanAgent === "forager" ? "Forager (Green)" : "Security (Yellow)";
        await showCenterMessage(`New partner: ${p.partner_name}`, `You are ${roleName}`, TURN_BANNER_MS + 350);
        state.partner.blockJustStarted = false;
        if (!state.running || state.turnFlowToken !== flowToken) return;
      }

      // if forager is stunned, skip this forager turn
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

    function onKeyDown(e) {
      const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea") return;
      if (!state.running || state.overlayActive || !isHumanTurn()) return;

      const agentKey = curKey();

      const mk = (dx, dy, dir, label) => ({ kind: "move", dx, dy, dir, label });

      if (e.key === "ArrowUp") { e.preventDefault(); void attemptMove(agentKey, mk(0, -1, "up", "ArrowUp"), "human"); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); void attemptMove(agentKey, mk(0, 1, "down", "ArrowDown"), "human"); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); void attemptMove(agentKey, mk(-1, 0, "left", "ArrowLeft"), "human"); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); void attemptMove(agentKey, mk(1, 0, "right", "ArrowRight"), "human"); return; }

      const k = (e.key || "").toLowerCase();
      if (k === "e" || k === "q" || k === "p") {
        e.preventDefault();
        void doAction(agentKey, k, "human");
      }
    }

    async function initFromCSV() {
      try {
        overlay.style.display = "flex";
        state.overlayActive = true;
        overlayTextEl.textContent = "Loading…";
        overlaySubEl.textContent = "Map + assets";
        scanSpinnerEl.style.display = "none";

        const resolvedAlien = await resolveFirstWorkingImage(ALIEN_SPRITE_CANDIDATES, 2500);
        state.spriteURL.alien = resolvedAlien.url;

        const { gridSize, rows } = await loadMapCSV(MAP_CSV_URL);
        const built = buildMapFromCSV(gridSize, rows);

        state.gridSize = gridSize;
        state.map = built.map;
        state.aliens = built.aliens;

        const c = Math.floor((state.gridSize - 1) / 2);
        state.agents.forager.x = c; state.agents.forager.y = c;
        state.agents.security.x = c; state.agents.security.y = c;

        buildBoard();

        overlay.style.display = "none";
        state.overlayActive = false;

        await reveal("forager", c, c, "spawn");
        await reveal("security", c, c, "spawn");

        // ===== NEW: generate partner plan + apply round 1 =====
        state.partner.plan = buildPartnerPlan(state.round.total);
        logger.log({
          trial_index: state.trialIndex,
          event_type: "system",
          event_name: "partner_plan_generated",
          partner_plan_json: JSON.stringify(state.partner.plan),
        });
        applyPartnerForGameRound(1);

        window.addEventListener("keydown", onKeyDown);

        renderAll();
        startTurnFlow();
      } catch (err) {
        logger.log({
          trial_index: state.trialIndex,
          event_type: "system",
          event_name: "map_load_error",
          error: String(err && err.message ? err.message : err),
        });
        overlay.style.display = "flex";
        overlayTextEl.textContent = "Map load failed";
        overlaySubEl.textContent = "Check MAP_CSV_URL and that the CSV is included in your build.";
        scanSpinnerEl.style.display = "none";
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
