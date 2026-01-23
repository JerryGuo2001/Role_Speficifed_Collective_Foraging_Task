/* ===========================
   practice_phase.js (EXPANDED)
   - Role instructions + 5 practice modules:
     0) Roles overview (instruction only)
     1) Explore fog-of-war map (movement + tile reveal + find mine)
     2) Dig for gold (Forager: E)
     3) Scan for alien (Security: Q)
     4) Get stunned by alien (Forager: E near alien; forced stun)
     5) Revive the forager (Security: E on same tile)
   - Uses the same “freeze + spinner” style as scanning in main
   =========================== */

(function () {
  "use strict";

  // ---------- Sprites (same paths as main phase) ----------
  const GOLD_SPRITE_URL = "./TexturePack/gold_mine.png";
  const ALIEN_SPRITE_CANDIDATES = ["./TexturePack/allien.png"];

  // ---------- Timings ----------
  const EVENT_FREEZE_MS = 800;

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const chebDist = (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));

  // Absolute URL helper (handles GitHub Pages subpath correctly)
  const absURL = (p) => new URL(p, document.baseURI).href;

  // Robust image load test (detects 404 AND invalid/undecodable images)
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

  function makeEmptyTile() {
    return { revealed: false, goldMine: false, alienCenterId: 0 };
  }

  function buildEmptyMap(cols, rows) {
    return Array.from({ length: rows }, () => Array.from({ length: cols }, () => makeEmptyTile()));
  }

  function startPractice(containerId, config) {
    const { participantId, logger, trialIndex = 0, onEnd = null } = config || {};

    if (!participantId) throw new Error("startPractice requires participantId");
    if (!logger || typeof logger.log !== "function") throw new Error("startPractice requires logger.log(evt)");

    const mount = typeof containerId === "string" ? document.getElementById(containerId) : containerId;
    if (!mount) throw new Error("Could not find container element for practice.");
    mount.innerHTML = "";

    // =========================
    // Practice stage definitions
    // =========================
    const STAGES = [
      {
        id: "roles_intro",
        kind: "instructionOnly",
        title: "Practice — Roles and Controls",
        body:
          "There are two roles in this task:\n\n" +
          "• Forager (Green): explores the fog-of-war map and collects gold. When standing on a revealed gold mine, press E to forage (+1 gold).\n\n" +
          "• Security (Yellow): scans for hidden aliens. When standing on a tile, press Q to scan. If an alien is revealed, it can be chased away later in the main task.\n\n" +
          "Aliens can stun the Forager if the Forager forages near an alien. When the Forager is stunned, they cannot act on their turn. Security can revive the Forager by standing on the same tile and pressing E.\n\n" +
          "In the main task, turns alternate between roles. You will be randomly assigned one role.",
        hint: "Click Continue to start practice.",
      },

      // 1) Explore fog-of-war + find mine
      {
        id: "explore_fog",
        kind: "game",
        title: "Practice 1/5 — Explore the Fog-of-War",
        body:
          "Use the Arrow keys to move. Tiles start covered by fog.\n" +
          "When you step on a tile, it becomes revealed.\n\n" +
          "Goal: Find the hidden gold mine by exploring.",
        hint: "Move with Arrow keys.",
        role: "forager",
        cols: 5,
        rows: 5,
        setup: (S) => {
          S.map = buildEmptyMap(5, 5);
          S.aliens = [{ id: 1, x: 4, y: 4, discovered: false, removed: false }]; // not used here
          S.goldTotal = 0;
          S.foragerStunTurns = 0;

          // Place a mine (hidden until revealed)
          S.map[3][3].goldMine = true;

          // Spawn
          S.agents.forager.x = 0;
          S.agents.forager.y = 0;
          S.agents.security.x = 0;
          S.agents.security.y = 0;

          // Reveal spawn
          S.map[0][0].revealed = true;
        },
        onMove: async (S) => {
          const t = S.map[S.agents.forager.y][S.agents.forager.x];
          if (t.goldMine && t.revealed) {
            await showCenterMessage("Found a gold mine", "", EVENT_FREEZE_MS);
            return { complete: true };
          }
          return { complete: false };
        },
      },

      // 2) Dig for gold (Forager: E)
      {
        id: "dig_gold",
        kind: "game",
        title: "Practice 2/5 — Dig for Gold (Forager)",
        body:
          "You are the Forager (Green).\n\n" +
          "When you are standing on a revealed gold mine, press E to forage and collect gold.",
        hint: "Press E to forage.",
        role: "forager",
        cols: 3,
        rows: 3,
        setup: (S) => {
          S.map = buildEmptyMap(3, 3);
          S.aliens = [{ id: 1, x: 2, y: 2, discovered: false, removed: false }];
          S.goldTotal = 0;
          S.foragerStunTurns = 0;

          // Mine under the forager
          S.map[1][1].goldMine = true;
          S.map[1][1].revealed = true;

          S.agents.forager.x = 1;
          S.agents.forager.y = 1;
          S.agents.security.x = 0;
          S.agents.security.y = 0;

          S.map[0][0].revealed = true;
        },
        onActionE: async (S) => {
          const t = S.map[S.agents.forager.y][S.agents.forager.x];
          if (!(t.revealed && t.goldMine)) return { complete: false };

          const before = S.goldTotal;
          S.goldTotal += 1;

          await showForgeSequence(S.goldTotal, 1);

          return { complete: S.goldTotal > before };
        },
      },

      // 3) Scan for alien (Security: Q)
      {
        id: "scan_alien",
        kind: "game",
        title: "Practice 3/5 — Scan for Aliens (Security)",
        body:
          "You are the Security (Yellow).\n\n" +
          "Press Q to scan the tile you are standing on.\n" +
          "If there is an alien on that tile, the scan will reveal it.",
        hint: "Press Q to scan.",
        role: "security",
        cols: 3,
        rows: 3,
        setup: (S) => {
          S.map = buildEmptyMap(3, 3);

          // Put alien center under Security
          S.map[1][1].alienCenterId = 1;
          S.map[1][1].revealed = true;

          // Track alien
          S.aliens = [{ id: 1, x: 1, y: 1, discovered: false, removed: false }];

          S.goldTotal = 0;
          S.foragerStunTurns = 0;

          S.agents.security.x = 1;
          S.agents.security.y = 1;
          S.agents.forager.x = 0;
          S.agents.forager.y = 0;

          S.map[0][0].revealed = true;
        },
        onActionQ: async (S) => {
          const t = S.map[S.agents.security.y][S.agents.security.x];
          let hasAlien = 0;
          let newlyFound = 0;
          let foundId = 0;

          if (t.alienCenterId) {
            const al = S.aliens.find((a) => a.id === t.alienCenterId) || null;
            if (al && !al.removed) {
              hasAlien = 1;
              foundId = al.id;
              if (!al.discovered) {
                al.discovered = true;
                newlyFound = 1;
              }
            }
          }

          await showScanSequence(!!hasAlien, foundId, newlyFound);
          return { complete: !!hasAlien };
        },
      },

      // 4) Get stunned (Forager: E near alien; forced stun)
      {
        id: "stunned",
        kind: "game",
        title: "Practice 4/5 — Getting Stunned",
        body:
          "You are the Forager (Green).\n\n" +
          "If you forage near an alien, the alien can attack and stun you.\n" +
          "In the main task, a stunned Forager cannot act on their turn.",
        hint: "Press E to forage (this will trigger a stun).",
        role: "forager",
        cols: 3,
        rows: 3,
        setup: (S) => {
          S.map = buildEmptyMap(3, 3);

          // Alien center at (1,1)
          S.map[1][1].alienCenterId = 1;
          S.map[1][1].revealed = true;
          S.aliens = [{ id: 1, x: 1, y: 1, discovered: true, removed: false }];

          // Mine adjacent to alien (within Chebyshev 1)
          S.map[1][0].goldMine = true;
          S.map[1][0].revealed = true;

          S.goldTotal = 0;
          S.foragerStunTurns = 0;

          // Forager starts on the mine
          S.agents.forager.x = 0;
          S.agents.forager.y = 1;

          // Security present but not controlled here
          S.agents.security.x = 2;
          S.agents.security.y = 1;

          S.map[2][1].revealed = true;
        },
        onActionE: async (S) => {
          const t = S.map[S.agents.forager.y][S.agents.forager.x];
          if (!(t.revealed && t.goldMine)) return { complete: false };

          S.goldTotal += 1;
          await showForgeSequence(S.goldTotal, 1);

          // Forced stun (demonstration)
          const attacker = anyAlienInRange(S, S.agents.forager.x, S.agents.forager.y);
          if (attacker) {
            S.foragerStunTurns = 3;
            await showCenterMessage("Forager is stunned", `Alien ${attacker.id} attacked`, 1200);
            return { complete: true };
          }

          return { complete: false };
        },
      },

      // 5) Revive (Security: E on same tile as stunned forager)
      {
        id: "revive",
        kind: "game",
        title: "Practice 5/5 — Revive the Forager (Security)",
        body:
          "You are the Security (Yellow).\n\n" +
          "To revive a stunned Forager, stand on the same tile as the Forager and press E.",
        hint: "Press E to revive.",
        role: "security",
        cols: 3,
        rows: 3,
        setup: (S) => {
          S.map = buildEmptyMap(3, 3);

          // Put both on the same tile for a clean revive demo
          S.agents.forager.x = 1;
          S.agents.forager.y = 1;
          S.agents.security.x = 1;
          S.agents.security.y = 1;

          // Reveal that tile
          S.map[1][1].revealed = true;

          // Forager is stunned at start
          S.foragerStunTurns = 3;
          S.goldTotal = 0;

          S.aliens = [{ id: 1, x: 2, y: 2, discovered: false, removed: false }];
        },
        onActionE: async (S) => {
          const fx = S.agents.forager.x,
            fy = S.agents.forager.y;
          const sx = S.agents.security.x,
            sy = S.agents.security.y;

          if (!(S.foragerStunTurns > 0 && fx === sx && fy === sy)) return { complete: false };

          S.foragerStunTurns = 0;
          await showCenterMessage("Forager revived", "", EVENT_FREEZE_MS);
          return { complete: true };
        },
      },
    ];

    // =========================
    // State
    // =========================
    const state = {
      participantId,
      trialIndex,
      running: true,

      stageIndex: 0,
      mode: "instruction", // instruction | game
      overlayActive: false,

      cols: 0,
      rows: 0,
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

      controlledRole: null, // "forager" | "security" | null
      goldTotal: 0,
      foragerStunTurns: 0,
    };

    const log = (event_name, extra = {}) => {
      const st = STAGES[state.stageIndex] || {};
      logger.log({
        trial_index: state.trialIndex,
        event_type: "practice",
        event_name,
        stage_index: state.stageIndex + 1,
        stage_total: STAGES.length,
        stage_id: st.id || "",
        mode: state.mode,
        controlled_role: state.controlledRole || "",
        forager_x: state.agents.forager.x,
        forager_y: state.agents.forager.y,
        security_x: state.agents.security.x,
        security_y: state.agents.security.y,
        gold_total: state.goldTotal,
        forager_stun_turns: state.foragerStunTurns,
        ...extra,
      });
    };

    function tileAt(x, y) {
      return state.map[y][x];
    }

    function alienById(id) {
      return state.aliens.find((a) => a.id === id) || null;
    }

    function anyAlienInRange(S, fx, fy) {
      for (const al of S.aliens) {
        if (al.removed) continue;
        if (chebDist(fx, fy, al.x, al.y) <= 1) return al;
      }
      return null;
    }

    // =========================
    // UI
    // =========================
    mount.appendChild(
      el("style", {}, [
        `
        .pStage{
          width:100%;
          height:100%;
          display:flex;
          align-items:center;
          justify-content:center;
          background:#fafafa;
        }
        .pCard{
          width:min(92vw, 980px);
          height:min(92vh, 820px);
          background:#fff;
          border:1px solid #e6e6e6;
          border-radius:16px;
          box-shadow:0 2px 12px rgba(0,0,0,.06);
          padding:16px;
          display:flex;
          flex-direction:column;
          gap:12px;
          position:relative;
          overflow:hidden;
        }

        /* Instruction page (CENTERED) */
        .pInstr{
          flex:1;
          display:flex;
          flex-direction:column;
          justify-content:center;
          align-items:center;
          text-align:center;
          gap:10px;
          padding:6px;
        }
        .pInstrTitle{ font-weight:900; font-size:22px; }
        .pInstrBody{
          color:#444;
          font-weight:700;
          font-size:15px;
          line-height:1.6;
          max-width:860px;
          white-space:pre-wrap;
        }
        .pInstrHint{
          margin-top:6px;
          font-weight:900;
          font-size:14px;
          color:#111;
          padding:10px 12px;
          border:1px solid #e6e6e6;
          border-radius:12px;
          background:#fafafa;
          display:inline-block;
        }
        .pBtnRow{
          margin-top:14px;
          width:100%;
          display:flex;
          justify-content:center;
        }
        .pBtn{
          padding:10px 14px;
          border-radius:12px;
          border:1px solid #ccc;
          background:#fff;
          cursor:pointer;
          font-weight:800;
          font-size:14px;
        }
        .pBtnPrimary{ background:#111; color:#fff; border-color:#111; }

        /* Game page */
        .pGame{
          flex:1;
          display:flex;
          flex-direction:column;
          gap:12px;
          min-height:0;
        }
        .pTop{
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:12px;
        }
        .pTitle{ font-weight:900; font-size:18px; }
        .pSub{ margin-top:4px; color:#666; font-weight:700; font-size:13px; line-height:1.45; max-width:720px; white-space:pre-wrap; }
        .pHint{
          font-weight:900;
          font-size:14px;
          color:#111;
          padding:10px 12px;
          border:1px solid #e6e6e6;
          border-radius:12px;
          background:#fafafa;
          min-width:260px;
          text-align:center;
          white-space:nowrap;
        }

        .pBoardWrap{
          flex:1;
          min-height:0;
          display:flex;
          align-items:center;
          justify-content:center;
        }
        .pBoard{
          border:2px solid #ddd;
          border-radius:14px;
          display:grid;
          background:#fff;
          user-select:none;
          overflow:hidden;
        }

        .pCell{
          border:1px solid #f1f1f1;
          display:flex;
          align-items:center;
          justify-content:center;
          position:relative;
          box-sizing:border-box;
          overflow:hidden;
        }
        .pCell.unrev{ background:#bdbdbd; }
        .pCell.rev{ background:#ffffff; }

        .pAgent, .pAgentPair, .pAgentMini{
          position:relative;
          z-index:10;
        }
        .pAgent{ width:72%; height:72%; border-radius:14px; box-shadow:0 2px 8px rgba(0,0,0,.12); }
        .pAgent.forager{ background:#16a34a; }
        .pAgent.security{ background:#eab308; }

        .pAgentPair{ width:82%; height:82%; position:relative; }
        .pAgentMini{
          position:absolute;
          width:66%;
          height:66%;
          border-radius:14px;
          border:2px solid rgba(255,255,255,.95);
          box-shadow:0 3px 10px rgba(0,0,0,.16);
        }
        .pAgentMini.forager{ left:0; top:0; background:#16a34a; }
        .pAgentMini.security{ right:0; bottom:0; background:#eab308; }

        .pSprite{
          position:absolute;
          left:50%;
          top:50%;
          transform:translate(-50%,-50%);
          pointer-events:none;
          user-select:none;
          z-index:30;
          object-fit:contain;
          image-rendering: pixelated;
        }
        .pSprite.gold{ width:88%; height:88%; z-index:30; }
        .pSprite.alien{ width:96%; height:96%; z-index:31; }

        .pFallback{
          position:absolute;
          left:50%; top:50%;
          transform:translate(-50%,-50%);
          width:40%;
          height:40%;
          border-radius:999px;
          z-index:32;
          opacity:0.95;
          pointer-events:none;
        }
        .pFallback.alien{ background:#a855f7; }
        .pFallback.gold{ background:#facc15; }

        .pFooter{
          flex:0 0 auto;
          height:44px;
          border:1px solid #e6e6e6;
          border-radius:14px;
          background:#fafafa;
          display:flex;
          align-items:center;
          justify-content:space-between;
          padding:0 12px;
          font-weight:900;
          font-size:14px;
          color:#111;
          gap:10px;
        }
        .pFooterLeft{ display:flex; gap:10px; align-items:center; }
        .pBadge{
          display:flex;
          align-items:center;
          gap:8px;
          padding:6px 10px;
          border:1px solid #e6e6e6;
          border-radius:999px;
          background:#fff;
          font-weight:900;
          white-space:nowrap;
        }
        .pDot{ width:12px; height:12px; border-radius:999px; }
        .pDot.forager{ background:#16a34a; }
        .pDot.security{ background:#eab308; }

        /* Overlay (freeze + spinner) */
        .pOverlay{
          position:absolute; inset:0;
          display:none;
          align-items:center;
          justify-content:center;
          background:rgba(0,0,0,0.25);
          z-index:50;
        }
        .pOverlayBox{
          background:rgba(255,255,255,0.98);
          border:1px solid #e6e6e6;
          border-radius:14px;
          padding:18px 22px;
          box-shadow:0 8px 24px rgba(0,0,0,0.15);
          font-weight:900;
          font-size:26px;
          text-align:center;
          width:min(560px, 86%);
        }
        .pOverlaySub{ margin-top:8px; font-size:14px; font-weight:800; color:#666; white-space:pre-wrap; }

        .pSpinner{
          width:42px;
          height:42px;
          border-radius:999px;
          border:4px solid #d7d7d7;
          border-top-color:#111;
          margin:14px auto 0;
          animation: pSpin 0.85s linear infinite;
          display:none;
        }
        @keyframes pSpin { to { transform: rotate(360deg); } }

        .hidden{ display:none; }
        `,
      ])
    );

    // DOM
    const instrTitleEl = el("div", { class: "pInstrTitle" }, [""]);
    const instrBodyEl = el("div", { class: "pInstrBody" }, [""]);
    const instrHintEl = el("div", { class: "pInstrHint" }, [""]);
    const instrBtn = el("button", { class: "pBtn pBtnPrimary" }, ["Continue"]);

    const instrView = el("div", { class: "pInstr" }, [
      instrTitleEl,
      instrBodyEl,
      instrHintEl,
      el("div", { class: "pBtnRow" }, [instrBtn]),
    ]);

    const gameTitleEl = el("div", { class: "pTitle" }, [""]);
    const gameSubEl = el("div", { class: "pSub" }, [""]);
    const gameHintEl = el("div", { class: "pHint" }, [""]);

    const top = el("div", { class: "pTop" }, [
      el("div", { style: "display:flex;flex-direction:column;" }, [gameTitleEl, gameSubEl]),
      gameHintEl,
    ]);

    const board = el("div", { class: "pBoard", id: "pBoard" });
    const boardWrap = el("div", { class: "pBoardWrap" }, [board]);

    const footerRoleDot = el("span", { class: "pDot" });
    const footerRoleTxt = el("span", {}, [""]);
    const footerRoleBadge = el("div", { class: "pBadge" }, [footerRoleDot, footerRoleTxt]);

    const footerLeft = el("div", { class: "pFooterLeft" }, [footerRoleBadge, el("div", {}, ["Gold: 0"])]);
    const footerRight = el("div", {}, [""]);

    const footer = el("div", { class: "pFooter" }, [footerLeft, footerRight]);

    // Overlay
    const overlayTextEl = el("div", {}, [""]);
    const overlaySubEl = el("div", { class: "pOverlaySub" }, [""]);
    const spinnerEl = el("div", { class: "pSpinner" }, []);
    const overlay = el("div", { class: "pOverlay", id: "pOverlay" }, [
      el("div", { class: "pOverlayBox" }, [overlayTextEl, overlaySubEl, spinnerEl]),
    ]);

    const gameView = el("div", { class: "pGame hidden" }, [top, boardWrap, footer]);

    const card = el("div", { class: "pCard" }, [instrView, gameView, overlay]);
    const stage = el("div", { class: "pStage" }, [card]);
    mount.appendChild(stage);

    // Board cells
    let cells = [];
    const cellAt = (x, y) => cells[y * state.cols + x];

    function buildBoard(cols, rows) {
      board.innerHTML = "";
      board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      board.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

      const MAX_BOARD_PX = 420;
      const minCell = 58;
      const maxCell = 92;
      const maxDim = Math.max(cols, rows);

      let cellPx = Math.floor(MAX_BOARD_PX / maxDim);
      cellPx = clamp(cellPx, minCell, maxCell);

      board.style.width = `${cols * cellPx}px`;
      board.style.height = `${rows * cellPx}px`;

      cells = [];
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const c = el("div", { class: "pCell unrev", "data-x": x, "data-y": y });
          board.appendChild(c);
          cells.push(c);
        }
      }
    }

    function renderFooter() {
      const you = state.controlledRole;
      footerRoleDot.className = "pDot " + (you === "forager" ? "forager" : "security");
      footerRoleTxt.textContent =
        you === "forager" ? "You control: Forager (Green)" : "You control: Security (Yellow)";

      // Gold
      footerLeft.children[1].textContent = `Gold: ${state.goldTotal}`;

      // Status
      footerRight.textContent =
        state.foragerStunTurns > 0 ? `Forager stunned: ${state.foragerStunTurns}` : "";
    }

    function renderBoard() {
      if (!cells.length) return;

      const fx = state.agents.forager.x,
        fy = state.agents.forager.y;
      const sx = state.agents.security.x,
        sy = state.agents.security.y;

      for (let y = 0; y < state.rows; y++) {
        for (let x = 0; x < state.cols; x++) {
          const c = cellAt(x, y);
          const t = tileAt(x, y);

          c.className = "pCell " + (t.revealed ? "rev" : "unrev");
          c.innerHTML = "";

          const hasF = x === fx && y === fy;
          const hasS = x === sx && y === sy;

          // Agents first
          if (hasF && hasS) {
            c.appendChild(
              el("div", { class: "pAgentPair" }, [
                el("div", { class: "pAgentMini forager" }),
                el("div", { class: "pAgentMini security" }),
              ])
            );
          } else if (hasF) c.appendChild(el("div", { class: "pAgent forager" }));
          else if (hasS) c.appendChild(el("div", { class: "pAgent security" }));

          // Sprites last
          const showGold = t.revealed && t.goldMine;

          let showAlien = false;
          if (t.revealed && t.alienCenterId) {
            const al = alienById(t.alienCenterId);
            showAlien = !!(al && al.discovered && !al.removed);
          }

          if (showGold) {
            c.appendChild(
              el("img", {
                class: "pSprite gold",
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
                  class: "pSprite alien",
                  src: state.spriteURL.alien,
                  alt: "",
                  draggable: "false",
                })
              );
            } else {
              c.appendChild(el("div", { class: "pFallback alien" }, []));
            }
          }
        }
      }
    }

    function renderAll() {
      renderBoard();
      renderFooter();
    }

    // =========================
    // Overlay helpers (same “logic” as main)
    // =========================
    async function showCenterMessage(text, subText = "", ms = EVENT_FREEZE_MS) {
      state.overlayActive = true;

      spinnerEl.style.display = "none";
      overlayTextEl.textContent = text || "";
      overlaySubEl.textContent = subText || "";

      overlay.style.display = "flex";
      await sleep(ms);
      overlay.style.display = "none";

      state.overlayActive = false;
    }

    async function showScanSequence(hasAlien, foundId = 0, newlyFound = 0) {
      state.overlayActive = true;

      overlay.style.display = "flex";
      spinnerEl.style.display = "block";
      overlayTextEl.textContent = "Scanning…";
      overlaySubEl.textContent = "";

      await sleep(520);

      spinnerEl.style.display = "none";

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
    }

    async function showForgeSequence(goldAfter, goldDelta = 1) {
      state.overlayActive = true;

      overlay.style.display = "flex";
      spinnerEl.style.display = "block";
      overlayTextEl.textContent = "Foraging…";
      overlaySubEl.textContent = "";

      await sleep(520);

      spinnerEl.style.display = "none";
      overlayTextEl.textContent = "Gold collected";
      overlaySubEl.textContent = `+${goldDelta} (Total: ${goldAfter})`;

      await sleep(520);

      overlay.style.display = "none";
      state.overlayActive = false;
    }

    // =========================
    // Stage flow
    // =========================
    function currentStage() {
      return STAGES[state.stageIndex] || null;
    }

    function showInstruction() {
      const st = currentStage();
      state.mode = "instruction";

      instrTitleEl.textContent = st?.title || "Practice";
      instrBodyEl.textContent = st?.body || "";
      instrHintEl.textContent = st?.hint || "";

      instrBtn.textContent = st?.kind === "instructionOnly" ? "Continue" : "Start";
      instrBtn.onclick = () => {
        if (!state.running) return;
        if (st?.kind === "instructionOnly") {
          advanceStage("continue_from_instruction");
        } else {
          startGameForStage();
        }
      };

      instrView.classList.remove("hidden");
      gameView.classList.add("hidden");
      renderAll();

      log("instruction_shown");
    }

    function startGameForStage() {
      const st = currentStage();
      if (!st || st.kind !== "game") return;

      state.mode = "game";
      state.controlledRole = st.role;
      state.cols = st.cols;
      state.rows = st.rows;

      // Stage-specific setup
      st.setup(state);

      buildBoard(state.cols, state.rows);
      renderAll();

      instrView.classList.add("hidden");
      gameView.classList.remove("hidden");

      gameTitleEl.textContent = st.title;
      gameSubEl.textContent = st.body;
      gameHintEl.textContent = st.hint;

      log("game_start", { stage_id: st.id, role: state.controlledRole });
    }

    async function advanceStage(reason) {
      log("stage_complete", { reason: reason || "" });

      state.stageIndex += 1;
      if (state.stageIndex >= STAGES.length) {
        await showCenterMessage("Practice complete", "You are ready to begin the main task.", 900);
        endPractice("completed");
        return;
      }

      showInstruction();
    }

    function endPractice(reason) {
      if (!state.running) return;
      state.running = false;

      log("practice_end", { reason: reason || "" });

      window.removeEventListener("keydown", onKeyDown);

      if (typeof onEnd === "function") onEnd({ reason: reason || "completed" });
    }

    // =========================
    // Mechanics
    // =========================
    async function reveal(x, y) {
      const t = tileAt(x, y);
      if (t.revealed) return false;
      t.revealed = true;
      log("tile_reveal", { tile_x: x, tile_y: y, tile_gold_mine: t.goldMine ? 1 : 0, tile_alien_center_id: t.alienCenterId || 0 });
      renderAll();
      return true;
    }

    async function doMove(dx, dy, keyLabel) {
      const st = currentStage();
      if (!st || st.kind !== "game") return;
      if (state.overlayActive) return;

      // In this practice, we do NOT block movement while stunned globally,
      // but we keep the revive stage deterministic by not requiring movement.
      const role = state.controlledRole;
      const a = state.agents[role];

      const fromX = a.x, fromY = a.y;
      const toX = clamp(fromX + dx, 0, state.cols - 1);
      const toY = clamp(fromY + dy, 0, state.rows - 1);

      // Log even if clamped
      log("move", {
        role,
        key: keyLabel,
        dx, dy,
        from_x: fromX, from_y: fromY,
        to_x: toX, to_y: toY,
        clamped: (toX !== fromX + dx || toY !== fromY + dy) ? 1 : 0,
      });

      a.x = toX; a.y = toY;

      await reveal(toX, toY);
      renderAll();

      if (typeof st.onMove === "function") {
        const res = await st.onMove(state);
        if (res && res.complete) {
          await advanceStage("objective_reached");
        }
      }
    }

    async function doAction(keyLower) {
      const st = currentStage();
      if (!st || st.kind !== "game") return;
      if (state.overlayActive) return;

      const role = state.controlledRole;
      log("action", { role, key: keyLower });

      if (keyLower === "e" && role === "forager" && typeof st.onActionE === "function") {
        const res = await st.onActionE(state);
        renderAll();
        if (res && res.complete) await advanceStage("action_e_complete");
        return;
      }

      if (keyLower === "q" && role === "security" && typeof st.onActionQ === "function") {
        const res = await st.onActionQ(state);
        renderAll();
        if (res && res.complete) await advanceStage("action_q_complete");
        return;
      }

      if (keyLower === "e" && role === "security" && typeof st.onActionE === "function") {
        const res = await st.onActionE(state);
        renderAll();
        if (res && res.complete) await advanceStage("action_e_complete");
        return;
      }

      // Wrong/unused action for this stage
      log("action_invalid", { role, key: keyLower, reason: "not_used_in_this_stage" });
    }

    // =========================
    // Input
    // =========================
    function onKeyDown(e) {
      const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea") return;
      if (!state.running) return;
      if (state.mode !== "game") return;
      if (state.overlayActive) return;

      if (e.key === "ArrowUp") { e.preventDefault(); void doMove(0, -1, "ArrowUp"); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); void doMove(0, 1, "ArrowDown"); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); void doMove(-1, 0, "ArrowLeft"); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); void doMove(1, 0, "ArrowRight"); return; }

      const k = (e.key || "").toLowerCase();
      if (k === "e" || k === "q") {
        e.preventDefault();
        void doAction(k);
        return;
      }

      // ignore other keys
    }

    // =========================
    // Init
    // =========================
    (async function init() {
      log("practice_start", { stage_total: STAGES.length });

      // Resolve alien sprite once
      const resolvedAlien = await resolveFirstWorkingImage(ALIEN_SPRITE_CANDIDATES, 2500);
      state.spriteURL.alien = resolvedAlien.url;

      if (!state.spriteURL.alien) {
        console.warn("Practice: alien sprite not found or not decodable. Tried:", resolvedAlien.tried);
        log("alien_sprite_missing", { tried: JSON.stringify(resolvedAlien.tried) });
      } else {
        log("alien_sprite_resolved", { url: state.spriteURL.alien });
      }

      window.addEventListener("keydown", onKeyDown);
      showInstruction();
    })();

    return {
      destroy: () => {
        if (!state.running) return;
        endPractice("destroy");
        mount.innerHTML = "";
      },
    };
  }

  window.startPractice = startPractice;
})();
