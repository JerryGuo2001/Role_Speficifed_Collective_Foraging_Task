/* ===========================
  main_phase.js
  - 6-model roster (Tom/Jerry/Cindy/Frank/Alice/Grace)
  - 3 pairs: (1-2), (3-4), (5-6)
  - 6 big rounds total:
      each pair appears twice:
        once with human as forager (AI security)
        once with human as security (AI forager)
    randomized per participant
  - AI initial letter shown on agent tile
  =========================== */

(function () {
  "use strict";

  const MAP_CSV_URL = "./gridworld/grid_map.csv";

  // ---------- Sprites ----------
  const GOLD_SPRITE_URL = "./TexturePack/gold_mine.png";

  // IMPORTANT: GitHub Pages is case-sensitive.
  const ALIEN_SPRITE_CANDIDATES = ["./TexturePack/allien.png"];

  const DEFAULT_TOTAL_ROUNDS = 6;
  const DEFAULT_MAX_MOVES_PER_TURN = 5;

  // ---------- Message timings ----------
  const TURN_BANNER_MS = 450;
  const EVENT_FREEZE_MS = 1500;

  const ATTACK_PHASE1_MS = 1500;
  const ATTACK_PHASE2_MS = 1500;
  const STUN_SKIP_MS = 2000;

  // ---------- Mine decay ----------
  const MINE_DECAY = { A: 0.30, B: 0.50, C: 0.70 };

  // ---------- Alien attack probability ----------
  const ALIEN_ATTACK_PROB = 0.50;

  // ---------- Model switch (kept) ----------
  const USE_CSB_MODEL = false;
  const getCSBModel = () => window.CSB || window.csb || window.CSBModel || null;

  // ---------- Small helpers ----------
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

  // Robust image load test
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

  // ===================== HEURISTIC HELPERS =====================
  const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

  function stepToward(fromX, fromY, toX, toY) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    if (dx === 0 && dy === 0) return null;

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

  function stepTowardConstrained(fromX, fromY, toX, toY, isAllowedCell) {
    // Choose among 4-neighbor moves that reduce Manhattan distance and are allowed.
    const curD = manDist(fromX, fromY, toX, toY);
    const moves = [
      { dx: 0, dy: -1, dir: "up", label: "ArrowUp" },
      { dx: 0, dy: 1, dir: "down", label: "ArrowDown" },
      { dx: -1, dy: 0, dir: "left", label: "ArrowLeft" },
      { dx: 1, dy: 0, dir: "right", label: "ArrowRight" },
    ];

    const candidates = [];
    for (const m of moves) {
      const nx = fromX + m.dx;
      const ny = fromY + m.dy;
      if (!isAllowedCell(nx, ny)) continue;
      const d = manDist(nx, ny, toX, toY);
      if (d < curD) candidates.push({ ...m, kind: "move", score: d });
    }

    if (candidates.length) {
      candidates.sort((a, b) => a.score - b.score);
      const best = candidates[0];
      return { kind: "move", dx: best.dx, dy: best.dy, dir: best.dir, label: best.label };
    }

    // If no improving move, still allow a "safe" allowed step to avoid freezing.
    const safe = [];
    for (const m of moves) {
      const nx = fromX + m.dx;
      const ny = fromY + m.dy;
      if (!isAllowedCell(nx, ny)) continue;
      safe.push({ ...m, kind: "move" });
    }
    if (!safe.length) return null;
    return safe[(Math.random() * safe.length) | 0];
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
      const label =
        dir === "right" ? "ArrowRight" :
        dir === "left" ? "ArrowLeft" :
        dir === "down" ? "ArrowDown" : "ArrowUp";
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
    let cur = "",
      inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else inQ = false;
        } else cur += ch;
      } else {
        if (ch === ",") {
          out.push(cur);
          cur = "";
        } else if (ch === '"') inQ = true;
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

    const ix = idx("x"),
      iy = idx("y"),
      im = idx("mine_type"),
      ia = idx("alien_id");
    if (ix < 0 || iy < 0 || im < 0 || ia < 0) throw new Error("CSV must have headers: x,y,mine_type,alien_id");

    const rows = [];
    let maxX = 0,
      maxY = 0;

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
          const x = a.x + dx,
            y = a.y + dy;
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
        forager: { name: "Forager", cls: "forager", x: 0, y: 0, label: "" },
        security: { name: "Security", cls: "security", x: 0, y: 0, label: "" },
      },

      goldTotal: 0,
      foragerStunTurns: 0,

      // 6-round roster schedule (generated after init)
      roster: {
        plan: [],
        current: null, // {roundIndex, pairId, humanRole, models:{forager:{id,name,initial}, security:{...}} }
      },

      turn: {
        order: ["forager", "security"],
        idx: 0,
        movesUsed: 0,
        maxMoves: maxMovesPerTurn,
        humanAgent: "forager", // overwritten by roster on round start
        token: 0,
      },
      round: { current: 1, total: totalRounds },

      timers: { humanIdle: null },
      scriptedRunning: false,

      overlayActive: true,
      turnFlowToken: 0,
    };

    // ---------- Core getters ----------
    const curKey = () => state.turn.order[state.turn.idx % state.turn.order.length];
    const isHumanTurn = () => curKey() === state.turn.humanAgent;
    const turnInRound = () => state.turn.idx % state.turn.order.length;
    const turnGlobal = () => state.turn.idx + 1;

    const tileAt = (x, y) => state.map[y][x];
    const alienById = (id) => state.aliens.find((a) => a.id === id) || null;

    // ===================== ROSTER + POLICIES =====================

    // Models (IDs match your spec)
    const MODELS = {
      1: { id: 1, role: "security", name: "Tom", initial: "T" },
      2: { id: 2, role: "forager", name: "Jerry", initial: "J" },
      3: { id: 3, role: "security", name: "Cindy", initial: "C" },
      4: { id: 4, role: "forager", name: "Frank", initial: "F" },
      5: { id: 5, role: "security", name: "Alice", initial: "A" },
      6: { id: 6, role: "forager", name: "Grace", initial: "G" },
    };

    const PAIRS = [
      { pairId: 12, securityId: 1, foragerId: 2 },
      { pairId: 34, securityId: 3, foragerId: 4 },
      { pairId: 56, securityId: 5, foragerId: 6 },
    ];

    function buildSixRoundPlan() {
      // Each pair appears twice: once with human as forager, once with human as security.
      const rounds = [];
      for (const p of PAIRS) {
        rounds.push({
          pairId: p.pairId,
          humanRole: "forager",
          models: {
            security: MODELS[p.securityId],
            forager: MODELS[p.foragerId],
          },
        });
        rounds.push({
          pairId: p.pairId,
          humanRole: "security",
          models: {
            security: MODELS[p.securityId],
            forager: MODELS[p.foragerId],
          },
        });
      }
      return shuffleInPlace(rounds);
    }

    function applyRosterRound(roundIndex1Based) {
      const entry = state.roster.plan[roundIndex1Based - 1];
      state.roster.current = {
        roundIndex: roundIndex1Based,
        pairId: entry.pairId,
        humanRole: entry.humanRole,
        models: entry.models,
      };

      state.turn.humanAgent = entry.humanRole;

      // Put initials only on AI-controlled agent (human agent label blank)
      const humanRole = entry.humanRole;
      state.agents.forager.label = humanRole === "forager" ? "" : entry.models.forager.initial;
      state.agents.security.label = humanRole === "security" ? "" : entry.models.security.initial;

      logSystem("round_assignment", {
        roster_round: roundIndex1Based,
        roster_pair_id: entry.pairId,
        roster_human_role: entry.humanRole,
        roster_forager_model: entry.models.forager.id,
        roster_forager_name: entry.models.forager.name,
        roster_security_model: entry.models.security.id,
        roster_security_name: entry.models.security.name,
      });
    }

    function rosterMeta() {
      const r = state.roster.current;
      if (!r) return {};
      return {
        roster_round: r.roundIndex,
        roster_pair_id: r.pairId,
        roster_human_role: r.humanRole,
        roster_forager_model: r.models.forager.id,
        roster_forager_name: r.models.forager.name,
        roster_security_model: r.models.security.id,
        roster_security_name: r.models.security.name,
      };
    }

    // ---------- Policy helper queries ----------
    function listAllGoldTiles(includeUnrevealed = true) {
      const out = [];
      for (let y = 0; y < state.gridSize; y++) {
        for (let x = 0; x < state.gridSize; x++) {
          const t = tileAt(x, y);
          if (!t.goldMine) continue;
          if (!includeUnrevealed && !t.revealed) continue;
          out.push({ x, y, revealed: !!t.revealed });
        }
      }
      return out;
    }

    function listUnrevealedTiles() {
      const out = [];
      for (let y = 0; y < state.gridSize; y++) {
        for (let x = 0; x < state.gridSize; x++) {
          const t = tileAt(x, y);
          if (!t.revealed) out.push({ x, y, highReward: !!t.highReward });
        }
      }
      return out;
    }

    function nearestByManhattan(fromX, fromY, pts) {
      if (!pts || !pts.length) return null;
      let best = null;
      let bestD = Infinity;
      for (const p of pts) {
        const d = manDist(fromX, fromY, p.x, p.y);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      return best;
    }

    function allTilesRevealed() {
      for (let y = 0; y < state.gridSize; y++) {
        for (let x = 0; x < state.gridSize; x++) {
          if (!tileAt(x, y).revealed) return false;
        }
      }
      return true;
    }

    // ===================== YOUR 1–6 POLICIES =====================

    // 1) Security Tom: passive follow forager
    function policySecurityTom() {
      const S = state.agents.security;
      const F = state.agents.forager;

      if (state.foragerStunTurns > 0) {
        if (S.x === F.x && S.y === F.y) return { kind: "action", key: "e" };
        return stepToward(S.x, S.y, F.x, F.y);
      }

      return stepToward(S.x, S.y, F.x, F.y) || null;
    }

    // 2) Forager Jerry: knows all gold; closest → next
    function policyForagerJerry() {
      const F = state.agents.forager;
      const here = tileAt(F.x, F.y);

      if (here.revealed && here.goldMine) return { kind: "action", key: "e" };

      const mines = listAllGoldTiles(true); // includes unrevealed
      const tgt = nearestByManhattan(F.x, F.y, mines);
      if (!tgt) return null;

      return stepToward(F.x, F.y, tgt.x, tgt.y) || null;
    }

    // 3) Security Cindy:
    //    - knows all aliens; go to alien center; scan if needed then push
    //    - if forager stunned: revive immediately
    //    - after all aliens removed: explore unrevealed
    //    - if all explored: stay near forager
    function policySecurityCindy() {
      const S = state.agents.security;
      const F = state.agents.forager;

      // revive priority
      if (state.foragerStunTurns > 0) {
        if (S.x === F.x && S.y === F.y) return { kind: "action", key: "e" };
        return stepToward(S.x, S.y, F.x, F.y);
      }

      // handle aliens
      const alive = state.aliens.filter((a) => !a.removed);
      if (alive.length) {
        // go nearest alive alien center
        let best = null;
        let bestD = Infinity;
        for (const a of alive) {
          const d = manDist(S.x, S.y, a.x, a.y);
          if (d < bestD) {
            bestD = d;
            best = a;
          }
        }
        if (best) {
          if (S.x === best.x && S.y === best.y) {
            // Must scan first (q), then push (p)
            if (!best.discovered) return { kind: "action", key: "q" };
            return { kind: "action", key: "p" };
          }
          return stepToward(S.x, S.y, best.x, best.y);
        }
      }

      // explore unrevealed
      const unrevealed = listUnrevealedTiles();
      if (unrevealed.length) {
        const tgt = nearestByManhattan(S.x, S.y, unrevealed);
        return stepToward(S.x, S.y, tgt.x, tgt.y);
      }

      // all explored: stay near forager
      return stepToward(S.x, S.y, F.x, F.y) || null;
    }

    // 4) Forager Frank:
    //    - only move on revealed tiles
    //    - forge closest revealed mine when revealed
    function policyForagerFrank() {
      const F = state.agents.forager;
      const here = tileAt(F.x, F.y);

      if (here.revealed && here.goldMine) return { kind: "action", key: "e" };

      const mines = listAllGoldTiles(false); // revealed only
      const tgt = nearestByManhattan(F.x, F.y, mines);
      const isAllowed = (x, y) => {
        if (x < 0 || y < 0 || x >= state.gridSize || y >= state.gridSize) return false;
        return tileAt(x, y).revealed;
      };

      if (tgt) {
        return stepTowardConstrained(F.x, F.y, tgt.x, tgt.y, isAllowed);
      }

      // no revealed mines: remain within revealed area (lightly drift toward security if possible)
      const S = state.agents.security;
      return stepTowardConstrained(F.x, F.y, S.x, S.y, isAllowed);
    }

    // 5) Security Alice:
    //    - explores freely
    //    - biases exploration toward highReward + near-gold regions
    //    - scans when on likely tiles; pushes discovered aliens
    function policySecurityAlice() {
      const S = state.agents.security;

      // If standing on an alien tile and not removed: scan or push
      const t = tileAt(S.x, S.y);
      if (t.alienCenterId) {
        const al = alienById(t.alienCenterId);
        if (al && !al.removed) {
          if (!al.discovered) return { kind: "action", key: "q" };
          return { kind: "action", key: "p" };
        }
      }

      // If any discovered-but-not-removed alien exists, go clear it
      const discoveredAlive = state.aliens.filter((a) => !a.removed && a.discovered);
      if (discoveredAlive.length) {
        const tgt = nearestByManhattan(S.x, S.y, discoveredAlive.map((a) => ({ x: a.x, y: a.y })));
        if (tgt) return stepToward(S.x, S.y, tgt.x, tgt.y);
      }

      // Exploration target scoring:
      // prefer unrevealed, prefer highReward, prefer near any gold tile
      const unrevealed = listUnrevealedTiles();
      if (unrevealed.length) {
        const gold = listAllGoldTiles(true);
        let best = null;
        let bestScore = Infinity;

        for (const u of unrevealed) {
          const dToU = manDist(S.x, S.y, u.x, u.y);

          // nearest gold distance from that tile (if none, 0)
          let dToGold = 0;
          if (gold.length) {
            let minG = Infinity;
            for (const g of gold) {
              const dg = manDist(u.x, u.y, g.x, g.y);
              if (dg < minG) minG = dg;
            }
            dToGold = minG;
          }

          const bonus = u.highReward ? -2.0 : 0.0; // strong bias to highReward
          const score = dToU + 0.6 * dToGold + bonus;

          if (score < bestScore) {
            bestScore = score;
            best = u;
          }
        }

        if (best) return stepToward(S.x, S.y, best.x, best.y);
      }

      // If everything revealed, stay somewhat near forager
      const F = state.agents.forager;
      return stepToward(S.x, S.y, F.x, F.y) || null;
    }

    // 6) Forager Grace:
    //    - passive follow security
    //    - forge revealed gold when seen and within security range
    function policyForagerGrace() {
      const F = state.agents.forager;
      const S = state.agents.security;

      const here = tileAt(F.x, F.y);
      const inSecRange = chebDist(F.x, F.y, S.x, S.y) <= 2;

      if (here.revealed && here.goldMine && inSecRange) return { kind: "action", key: "e" };

      // find revealed mines that are also within security range (by tile distance to security)
      const candidates = [];
      for (let y = 0; y < state.gridSize; y++) {
        for (let x = 0; x < state.gridSize; x++) {
          const t = tileAt(x, y);
          if (!(t.revealed && t.goldMine)) continue;
          if (chebDist(x, y, S.x, S.y) > 2) continue;
          candidates.push({ x, y });
        }
      }

      if (candidates.length) {
        const tgt = nearestByManhattan(F.x, F.y, candidates);
        if (tgt) return stepToward(F.x, F.y, tgt.x, tgt.y);
      }

      // otherwise follow security
      return stepToward(F.x, F.y, S.x, S.y) || null;
    }

    function getRosterPolicyForAgent(agentKey) {
      const r = state.roster.current;
      if (!r) return null;

      // If it's the human-controlled agent, no policy needed.
      if (agentKey === r.humanRole) return null;

      // Otherwise, apply the correct model policy based on which role is AI this round.
      if (agentKey === "security") {
        const sid = r.models.security.id;
        if (sid === 1) return policySecurityTom;
        if (sid === 3) return policySecurityCindy;
        if (sid === 5) return policySecurityAlice;
      }
      if (agentKey === "forager") {
        const fid = r.models.forager.id;
        if (fid === 2) return policyForagerJerry;
        if (fid === 4) return policyForagerFrank;
        if (fid === 6) return policyForagerGrace;
      }
      return null;
    }

    // ===================== MODEL ACTION ROUTER =====================
    function getModelAction(agentKey) {
      // CSB mode retained (optional)
      if (USE_CSB_MODEL) {
        const csb = getCSBModel();
        if (csb && typeof csb.nextAction === "function") {
          const act = csb.nextAction({ agent: agentKey, state: JSON.parse(JSON.stringify(state)) });
          return normalizeModelAct(act);
        }
      }

      const fn = getRosterPolicyForAgent(agentKey);
      if (!fn) return null;

      return normalizeModelAct(fn());
    }

    // ===================== LOGGING HELPERS =====================
    const snapshot = () => ({
      forager_x: state.agents.forager.x,
      forager_y: state.agents.forager.y,
      security_x: state.agents.security.x,
      security_y: state.agents.security.y,
      gold_total: state.goldTotal,
      forager_stun_turns: state.foragerStunTurns,
      ...rosterMeta(),
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

      .agent{ width:72%; height:72%; border-radius:14px; box-shadow:0 2px 8px rgba(0,0,0,.12); }
      .agent.forager{ background:#16a34a; }
      .agent.security{ background:#eab308; }

      .agent.forager.stunned{ background:#9ca3af; }
      .agentMini.forager.stunned{ background:#9ca3af; }

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

      /* NEW: model initial labels */
      .agentLabel{
        position:absolute;
        inset:0;
        display:flex;
        align-items:center;
        justify-content:center;
        font-weight:1000;
        color:rgba(255,255,255,0.96);
        text-shadow:0 2px 6px rgba(0,0,0,0.35);
        pointer-events:none;
        user-select:none;
        z-index: 45; /* above sprites */
        font-size:26px;
        letter-spacing:0.5px;
      }
      .agentMini .agentLabel{ font-size:20px; }

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
      .fallbackMarker.gold{ background:#facc15; }

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
    `,
      ])
    );

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
    const overlaySubEl = el("div", { class: "overlaySub", id: "overlaySub" }, [""]);
    const scanSpinnerEl = el("div", { class: "scanSpinner", id: "scanSpinner" }, []);

    const overlay = el("div", { class: "overlay", id: "overlay" }, [
      el("div", { class: "overlayBox" }, [overlayTextEl, overlaySubEl, scanSpinnerEl]),
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

    function addLabel(node, txt) {
      if (!txt) return;
      node.appendChild(el("div", { class: "agentLabel" }, [String(txt)]));
    }

    function renderBoard() {
      if (!cells.length) return;

      const fx = state.agents.forager.x,
        fy = state.agents.forager.y;
      const sx = state.agents.security.x,
        sy = state.agents.security.y;

      const foragerStunned = state.foragerStunTurns > 0;

      for (let y = 0; y < state.gridSize; y++)
        for (let x = 0; x < state.gridSize; x++) {
          const c = cellAt(x, y);
          const t = tileAt(x, y);
          c.className = "cell " + (t.revealed ? "rev" : "unrev");
          c.innerHTML = "";

          const hasF = x === fx && y === fy;
          const hasS = x === sx && y === sy;

          // 1) Agents first (behind sprites)
          if (hasF && hasS) {
            const fMini = el("div", { class: "agentMini forager" + (foragerStunned ? " stunned" : "") });
            addLabel(fMini, state.agents.forager.label);

            const sMini = el("div", { class: "agentMini security" });
            addLabel(sMini, state.agents.security.label);

            c.appendChild(el("div", { class: "agentPair" }, [fMini, sMini]));
          } else if (hasF) {
            const f = el("div", { class: "agent forager" + (foragerStunned ? " stunned" : "") });
            addLabel(f, state.agents.forager.label);
            c.appendChild(f);
          } else if (hasS) {
            const s = el("div", { class: "agent security" });
            addLabel(s, state.agents.security.label);
            c.appendChild(s);
          }

          // 2) Sprites last
          const showGold = t.revealed && t.goldMine;

          let showAlien = false;
          if (t.revealed && t.alienCenterId) {
            const al = alienById(t.alienCenterId);
            showAlien = !!(al && al.discovered && !al.removed);
          }

          if (showGold) {
            c.appendChild(
              el("img", {
                class: "sprite gold",
                src: state.spriteURL.gold,
                alt: "",
                draggable: "false",
              })
            );
          }

          if (showAlien) {
            if (state.spriteURL.alien) {
              c.appendChild(
                el("img", {
                  class: "sprite alien",
                  src: state.spriteURL.alien,
                  alt: "",
                  draggable: "false",
                })
              );
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

    // ---------- Center message ----------
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

    // ---------- Scan animation ----------
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

    // ---------- Attack animation ----------
    async function showAttackSequence(attacker) {
      state.overlayActive = true;
      clearHumanIdleTimer();

      overlay.style.display = "flex";
      scanSpinnerEl.style.display = "block";

      const attackerId = attacker && attacker.id ? attacker.id : 0;

      overlayTextEl.textContent = attackerId
        ? "Forager getting attacked by Alien!"
        : "Forager getting attacked!";
      overlaySubEl.textContent = attackerId ? `Alien ${attackerId}` : "";

      await sleep(ATTACK_PHASE1_MS);

      scanSpinnerEl.style.display = "none";
      overlayTextEl.textContent = "Forager is stunned";
      overlaySubEl.textContent = `Stunned for ${state.foragerStunTurns} turn(s)`;

      await sleep(ATTACK_PHASE2_MS);

      overlay.style.display = "none";
      state.overlayActive = false;
    }

    // ---------- Forge animation ----------
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

      // end of a big round (after security finishes)
      if (state.turn.idx % state.turn.order.length === 0) {
        logSystem("end_round", { ended_round: state.round.current });

        state.round.current += 1;
        if (state.round.current > state.round.total) {
          renderAll();
          endGame("round_limit_reached");
          return;
        }

        // Apply new roster assignment for the new round
        applyRosterRound(state.round.current);
      }

      startTurnFlow();
    }

    async function attemptMove(agentKey, act, source) {
      if (!state.running || state.overlayActive) return false;

      const a = state.agents[agentKey];
      const fromX = a.x,
        fromY = a.y;
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
          logInvalidAction(agentKey, "forge", source, "no_gold_mine_here", {
            tile_gold_mine: t.goldMine ? 1 : 0,
            tile_mine_type: t.mineType || "",
            key: "e",
          });
          if (source === "human") scheduleHumanIdleEnd();
          return false;
        }

        const before = state.goldTotal;
        state.goldTotal += 1;

        logAction(agentKey, "forge", source, {
          success: 1,
          gold_before: before,
          gold_after: state.goldTotal,
          gold_delta: 1,
          tile_gold_mine: 1,
          tile_mine_type: t.mineType || "",
          key: "e",
        });

        state.turn.movesUsed += 1;
        renderAll();
        if (source === "human") scheduleHumanIdleEnd();

        await showForgeSequence(state.goldTotal, 1);
        await maybeDepleteMineAtTile(t, a.x, a.y);

        const attacker = anyAlienInRange(a.x, a.y);
        if (attacker) {
          const u = Math.random();
          const willAttack = u < ALIEN_ATTACK_PROB;

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
            return true;
          }
        }

        if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");
        return true;
      }

      // SECURITY: Q scan
      if (agentKey === "security" && keyLower === "q") {
        let hasAlien = 0;
        let newlyFound = 0;
        let foundId = 0;

        if (t.alienCenterId) {
          const al = alienById(t.alienCenterId);
          if (al && !al.removed) {
            hasAlien = 1;
            foundId = al.id;
            if (!al.discovered) {
              al.discovered = true;
              newlyFound = 1;
            }
          }
        }

        logAction(agentKey, "scan", source, {
          success: 1,
          has_alien: hasAlien,
          newly_found: newlyFound,
          tile_alien_center_id: t.alienCenterId || 0,
          key: "q",
        });

        state.turn.movesUsed += 1;
        renderAll();
        if (source === "human") scheduleHumanIdleEnd();

        await showScanSequence(!!hasAlien, foundId, newlyFound);

        if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");
        return true;
      }

      // SECURITY: P push away
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
          logInvalidAction(agentKey, "push_alien", source, "no_revealed_alien_to_push", {
            tile_alien_center_id: t.alienCenterId || 0,
            key: "p",
          });
          if (source === "human") scheduleHumanIdleEnd();
          return false;
        }

        logAction(agentKey, "push_alien", source, {
          success: 1,
          tile_alien_center_id: t.alienCenterId || 0,
          key: "p",
        });

        state.turn.movesUsed += 1;
        renderAll();
        if (source === "human") scheduleHumanIdleEnd();

        await showCenterMessage("Alien chased away", chasedId ? `Alien ${chasedId}` : "", EVENT_FREEZE_MS);

        if (state.turn.movesUsed >= state.turn.maxMoves) endTurn("auto_max_moves");
        return true;
      }

      // SECURITY: E revive
      if (agentKey === "security" && keyLower === "e") {
        const fx = state.agents.forager.x,
          fy = state.agents.forager.y;
        const sx = state.agents.security.x,
          sy = state.agents.security.y;

        if (!(state.foragerStunTurns > 0 && fx === sx && fy === sy)) {
          logInvalidAction(agentKey, "revive_forager", source, "forager_not_down_or_not_same_tile", {
            on_forager_tile: fx === sx && fy === sy ? 1 : 0,
            forager_stun_turns: state.foragerStunTurns,
            key: "e",
          });
          if (source === "human") scheduleHumanIdleEnd();
          return false;
        }

        state.foragerStunTurns = 0;

        logAction(agentKey, "revive_forager", source, {
          success: 1,
          on_forager_tile: 1,
          forager_stun_turns_after: state.foragerStunTurns,
          key: "e",
        });

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

      // If we're at the first turn of a round (forager), show role banner first
      if (turnInRound() === 0) {
        const roleName = state.turn.humanAgent === "forager" ? "Forager (Green)" : "Security (Yellow)";
        await showCenterMessage(`Round ${state.round.current}`, `You are ${roleName}`, TURN_BANNER_MS + 350);
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

    // ---------- Input ----------
    function onKeyDown(e) {
      const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea") return;
      if (!state.running || state.overlayActive || !isHumanTurn()) return;

      const agentKey = curKey();

      if (e.key === "0") {
        e.preventDefault();
        logAction(agentKey, "skip_turn", "human", { key: "0", moves_used_before: state.turn.movesUsed });
        endTurn("human_skip");
        return;
      }

      const mk = (dx, dy, dir, label) => ({ kind: "move", dx, dy, dir, label });

      if (e.key === "ArrowUp") {
        e.preventDefault();
        void attemptMove(agentKey, mk(0, -1, "up", "ArrowUp"), "human");
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        void attemptMove(agentKey, mk(0, 1, "down", "ArrowDown"), "human");
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        void attemptMove(agentKey, mk(-1, 0, "left", "ArrowLeft"), "human");
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        void attemptMove(agentKey, mk(1, 0, "right", "ArrowRight"), "human");
        return;
      }

      const k = (e.key || "").toLowerCase();
      if (k === "e" || k === "q" || k === "p") {
        e.preventDefault();
        void doAction(agentKey, k, "human");
      }
    }

    // ---------- Init ----------
    async function initFromCSV() {
      try {
        overlay.style.display = "flex";
        state.overlayActive = true;
        overlayTextEl.textContent = "Loading…";
        overlaySubEl.textContent = "Map + assets";
        scanSpinnerEl.style.display = "none";

        const resolvedAlien = await resolveFirstWorkingImage(ALIEN_SPRITE_CANDIDATES, 2500);
        state.spriteURL.alien = resolvedAlien.url;

        if (!state.spriteURL.alien) {
          console.warn("Alien sprite not found or not decodable. Tried:", resolvedAlien.tried);
        } else {
          logSystem("alien_sprite_resolved", { alien_sprite_url: state.spriteURL.alien });
        }

        const { gridSize, rows } = await loadMapCSV(MAP_CSV_URL);
        const built = buildMapFromCSV(gridSize, rows);

        state.gridSize = gridSize;
        state.map = built.map;
        state.aliens = built.aliens;

        // Spawn both at center
        const c = Math.floor((state.gridSize - 1) / 2);
        state.agents.forager.x = c;
        state.agents.forager.y = c;
        state.agents.security.x = c;
        state.agents.security.y = c;

        buildBoard();

        overlay.style.display = "none";
        state.overlayActive = false;

        await reveal("forager", c, c, "spawn");
        await reveal("security", c, c, "spawn");

        // Generate roster schedule (length should match totalRounds)
        state.roster.plan = buildSixRoundPlan();

        // If caller set totalRounds != 6, truncate or cycle (safe default: truncate)
        if (state.round.total !== 6) {
          state.roster.plan = state.roster.plan.slice(0, state.round.total);
        }

        logSystem("roster_plan_generated", {
          roster_plan_json: JSON.stringify(state.roster.plan.map((r, i) => ({
            i: i + 1,
            pairId: r.pairId,
            humanRole: r.humanRole,
            forager: r.models.forager.id,
            security: r.models.security.id,
          }))),
        });

        // Apply round 1 assignment
        applyRosterRound(1);

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
