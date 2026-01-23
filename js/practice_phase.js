/* ===========================
   practice_phase.js (FULL REPLACEMENT)
   - Arrow-key practice FIRST (Left, Right, Up, Down)
   - Role instructions split into 3 pages (with role visuals)
   - NEW: “Try it out now” page before each practice GAME module (purpose statement)
   - Practice modules:
       1) Explore covered map (tile reveal + find mine)
       2) Dig for gold (Forager: E) -> must dig 3 times, mine breaks on 3rd dig
       3) Warning instruction after dig
       4) Scan for alien (Explorer: Q) + show revealed alien for 3s + countdown
       5) Get stunned by alien (Forager: E near alien; forced stun) + 3s delay to show effect
       6) Revive the forager (Explorer: E on same tile) — SAME MAP as stunned module
   - Uses “freeze + spinner” style for scanning and foraging
   - Instruction view: removed extra grey-ish hint-box element (single button only)
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

  function revealAll(map2d) {
    for (let y = 0; y < map2d.length; y++) {
      for (let x = 0; x < map2d[0].length; x++) map2d[y][x].revealed = true;
    }
  }

  function startPractice(containerId, config) {
    const { participantId, logger, trialIndex = 0, onEnd = null } = config || {};

    if (!participantId) throw new Error("startPractice requires participantId");
    if (!logger || typeof logger.log !== "function") throw new Error("startPractice requires logger.log(evt)");

    const mount = typeof containerId === "string" ? document.getElementById(containerId) : containerId;
    if (!mount) throw new Error("Could not find container element for practice.");
    mount.innerHTML = "";

    // =========================
    // Shared setup helpers
    // =========================
    function setupStunReviveSharedMap(S, opts) {
      const stunned = !!(opts && opts.stunned);

      S.map = buildEmptyMap(3, 3);

      // Alien center at (1,1) (revealed)
      S.map[1][1].alienCenterId = 1;
      S.map[1][1].revealed = true;

      // Mine adjacent at (0,1) (revealed) so forager can forage and get stunned
      S.map[1][0].goldMine = true;
      S.map[1][0].revealed = true;

      // Reveal explorer tile too
      S.map[1][2].revealed = true;

      // Track alien (already discovered so participant can see it while learning role switch)
      S.aliens = [{ id: 1, x: 1, y: 1, discovered: true, removed: false }];

      // Positions (same across stun + revive to emphasize role switch)
      S.agents.forager.x = 0;
      S.agents.forager.y = 1;

      S.agents.security.x = 2;
      S.agents.security.y = 1;

      S.goldTotal = 0;
      S.practiceMineHitsLeft = 0;
      S.foragerStunTurns = stunned ? 3 : 0;
    }

    function makeTryItPage(id, line) {
      return {
        id,
        kind: "instructionOnly",
        title: "Try it out now",
        body: line,
        hint: "Click Continue.",
        showRoleVisuals: false,
      };
    }

    // =========================
    // Practice stage definitions
    // =========================

    // Arrow-key modules first
    const ARROW_STAGES = [
      {
        id: "move_left",
        kind: "game",
        subtype: "arrow",
        title: "Practice 1/4 — Move Left",
        body: "Press the Left Arrow key to move left.\nReach the GOAL tile to continue.",
        hint: "Use Left Arrow (←).",
        role: "player",
        cols: 3,
        rows: 1,
        key: "ArrowLeft",
        dx: -1,
        dy: 0,
        start: { x: 2, y: 0 },
        goal: { x: 0, y: 0 },
        showRoleVisuals: false,
        setup: (S) => {
          S.map = buildEmptyMap(3, 1);
          revealAll(S.map);
          S.player.x = 2;
          S.player.y = 0;
          S.goldTotal = 0;
          S.foragerStunTurns = 0;
          S.practiceMineHitsLeft = 0;
          S.aliens = [];
        },
        onArrowGoalCheck: (S) => S.player.x === 0 && S.player.y === 0,
      },
      {
        id: "move_right",
        kind: "game",
        subtype: "arrow",
        title: "Practice 2/4 — Move Right",
        body: "Press the Right Arrow key to move right.\nReach the GOAL tile to continue.",
        hint: "Use Right Arrow (→).",
        role: "player",
        cols: 3,
        rows: 1,
        key: "ArrowRight",
        dx: 1,
        dy: 0,
        start: { x: 0, y: 0 },
        goal: { x: 2, y: 0 },
        showRoleVisuals: false,
        setup: (S) => {
          S.map = buildEmptyMap(3, 1);
          revealAll(S.map);
          S.player.x = 0;
          S.player.y = 0;
          S.goldTotal = 0;
          S.foragerStunTurns = 0;
          S.practiceMineHitsLeft = 0;
          S.aliens = [];
        },
        onArrowGoalCheck: (S) => S.player.x === 2 && S.player.y === 0,
      },
      {
        id: "move_up",
        kind: "game",
        subtype: "arrow",
        title: "Practice 3/4 — Move Up",
        body: "Press the Up Arrow key to move up.\nReach the GOAL tile to continue.",
        hint: "Use Up Arrow (↑).",
        role: "player",
        cols: 1,
        rows: 3,
        key: "ArrowUp",
        dx: 0,
        dy: -1,
        start: { x: 0, y: 2 },
        goal: { x: 0, y: 0 },
        showRoleVisuals: false,
        setup: (S) => {
          S.map = buildEmptyMap(1, 3);
          revealAll(S.map);
          S.player.x = 0;
          S.player.y = 2;
          S.goldTotal = 0;
          S.foragerStunTurns = 0;
          S.practiceMineHitsLeft = 0;
          S.aliens = [];
        },
        onArrowGoalCheck: (S) => S.player.x === 0 && S.player.y === 0,
      },
      {
        id: "move_down",
        kind: "game",
        subtype: "arrow",
        title: "Practice 4/4 — Move Down",
        body: "Press the Down Arrow key to move down.\nReach the GOAL tile to continue.",
        hint: "Use Down Arrow (↓).",
        role: "player",
        cols: 1,
        rows: 3,
        key: "ArrowDown",
        dx: 0,
        dy: 1,
        start: { x: 0, y: 0 },
        goal: { x: 0, y: 2 },
        showRoleVisuals: false,
        setup: (S) => {
          S.map = buildEmptyMap(1, 3);
          revealAll(S.map);
          S.player.x = 0;
          S.player.y = 0;
          S.goldTotal = 0;
          S.foragerStunTurns = 0;
          S.practiceMineHitsLeft = 0;
          S.aliens = [];
        },
        onArrowGoalCheck: (S) => S.player.x === 0 && S.player.y === 2,
      },
    ];

    // 3-page role instructions after arrow practice
    const ROLE_PAGES = [
      {
        id: "roles_1",
        kind: "instructionOnly",
        title: "Roles 1/3 — Overview",
        body:
          "In the main task there are two roles:\n\n" +
          "• Forager (Green)\n" +
          "• Explorer (Yellow)\n\n" +
          "Turns alternate between roles. You will be randomly assigned ONE role in the main task.\n\n" +
          "Next you will practice exploring a covered map, collecting gold, scanning for aliens, getting stunned, and reviving.",
        hint: "Click Continue.",
        showRoleVisuals: true,
      },
      {
        id: "roles_2",
        kind: "instructionOnly",
        title: "Roles 2/3 — Forager (Green)",
        body:
          "Forager (Green):\n\n" +
          "• Move with Arrow keys.\n" +
          "• The map is covered until your character steps on tiles.\n" +
          "• If you are standing on a revealed gold mine, press E to forage and collect gold.",
        hint: "Click Continue.",
        showRoleVisuals: true,
      },
      {
        id: "roles_3",
        kind: "instructionOnly",
        title: "Roles 3/3 — Explorer (Yellow)",
        body:
          "Explorer (Yellow):\n\n" +
          "• Move with Arrow keys.\n" +
          "• Press Q to scan the tile you are standing on.\n" +
          "• If an alien is revealed, the Forager can be stunned if they forage near it.\n" +
          "• If the Forager is stunned, the Explorer can revive them by standing on the same tile and pressing E.",
        hint: "Click Continue.",
        showRoleVisuals: true,
      },
    ];

    // Gameplay practice modules
    const PRACTICE_MODULES = [
      // 1) Explore covered map + find mine
      {
        id: "explore_covered",
        kind: "game",
        title: "Practice 1/5 — Explore the Covered Map",
        body:
          "Use the Arrow keys to move.\n\n" +
          "Tiles start covered. When your character steps on a tile, it becomes revealed.\n\n" +
          "Goal: Find the hidden gold mine by exploring.",
        hint: "Move with Arrow keys.",
        role: "forager",
        cols: 5,
        rows: 5,
        showRoleVisuals: true,
        setup: (S) => {
          S.map = buildEmptyMap(5, 5);
          S.aliens = [{ id: 1, x: 4, y: 4, discovered: false, removed: false }]; // not used here
          S.goldTotal = 0;
          S.foragerStunTurns = 0;
          S.practiceMineHitsLeft = 0;

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

      // 2) Dig for gold (3 times, forced break on 3rd)
      {
        id: "dig_gold_3x",
        kind: "game",
        title: "Practice 2/5 — Dig for Gold (Forager)",
        body:
          "You control the Forager (Green).\n\n" +
          "When you are standing on a revealed gold mine, press E to forage and collect gold.\n\n" +
          "In this practice, dig THREE times. The mine will break on the 3rd dig.",
        hint: "Press E (3 times).",
        role: "forager",
        cols: 3,
        rows: 3,
        showRoleVisuals: true,
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

          // Explorer not controlled here
          S.agents.security.x = 0;
          S.agents.security.y = 0;
          S.map[0][0].revealed = true;

          // Exactly 3 digs before forced break
          S.practiceMineHitsLeft = 3;
        },
        onActionE: async (S) => {
          const t = S.map[S.agents.forager.y][S.agents.forager.x];
          if (!(t.revealed && t.goldMine)) return { complete: false };

          const before = S.goldTotal;
          S.goldTotal += 1;

          await showForgeSequence(S.goldTotal, 1);

          if (S.practiceMineHitsLeft > 0) S.practiceMineHitsLeft -= 1;

          // Force break on the 3rd successful dig
          if (S.practiceMineHitsLeft <= 0) {
            t.goldMine = false;
            await showCenterMessage("Gold mine fully explored", "", EVENT_FREEZE_MS);
            return { complete: true };
          }

          return { complete: S.goldTotal > before && S.practiceMineHitsLeft <= 0 };
        },
      },

      // 3) Warning instruction after dig practice
      {
        id: "mine_warning",
        kind: "instructionOnly",
        title: "Note",
        body: "careful! Gold mine might be fully explored after a few dig",
        hint: "Click Continue.",
        showRoleVisuals: false,
      },

      // 4) Scan for alien (Explorer: Q)
      {
        id: "scan_alien",
        kind: "game",
        title: "Practice 3/5 — Scan for Aliens (Explorer)",
        body:
          "You control the Explorer (Yellow).\n\n" +
          "Press Q to scan the tile you are standing on.\n" +
          "If there is an alien on that tile, the scan will reveal it.",
        hint: "Press Q to scan.",
        role: "security",
        cols: 3,
        rows: 3,
        showRoleVisuals: true,
        setup: (S) => {
          S.map = buildEmptyMap(3, 3);

          // Put alien center under Explorer
          S.map[1][1].alienCenterId = 1;
          S.map[1][1].revealed = true;

          // Track alien
          S.aliens = [{ id: 1, x: 1, y: 1, discovered: false, removed: false }];

          S.goldTotal = 0;
          S.foragerStunTurns = 0;
          S.practiceMineHitsLeft = 0;

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

      // 5) Get stunned (Forager: E near alien; forced stun)
      {
        id: "stunned",
        kind: "game",
        title: "Practice 4/5 — Getting Stunned",
        body:
          "You control the Forager (Green).\n\n" +
          "If you forage near an alien, the alien can attack and stun you.\n" +
          "In the main task, a stunned Forager cannot act on their turn.",
        hint: "Press E to forage (this will trigger a stun).",
        role: "forager",
        cols: 3,
        rows: 3,
        showRoleVisuals: true,
        setup: (S) => {
          setupStunReviveSharedMap(S, { stunned: false });
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

            // Show message first
            await showCenterMessage("Forager is stunned", `Alien ${attacker.id} attacked`, 1200);

            // Then keep the game view visible for 3 seconds so participant sees the stun state
            renderAll();
            await pauseInputs(3000);

            return { complete: true };
          }

          return { complete: false };
        },
      },

      // 6) Revive (Explorer: E on same tile as stunned forager) — SAME MAP as stunned module
      {
        id: "revive",
        kind: "game",
        title: "Practice 5/5 — Revive the Forager (Explorer)",
        body:
          "You control the Explorer (Yellow).\n\n" +
          "To revive a stunned Forager, stand on the same tile as the Forager and press E.",
        hint: "Move onto the Forager, then press E to revive.",
        role: "security",
        cols: 3,
        rows: 3,
        showRoleVisuals: true,
        setup: (S) => {
          setupStunReviveSharedMap(S, { stunned: true });
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

    // NEW: “Try it out now” pages before each PRACTICE game module
    const PRE_PRACTICE_PAGES = [
      makeTryItPage("pre_explore_covered", "Try it out now: find the hidden gold on the map."),
      makeTryItPage("pre_dig_gold_3x", "Try it out now: forage on the gold mine three times (press E) until it breaks."),
      makeTryItPage("pre_scan_alien", "Try it out now: scan your tile to reveal the alien (press Q)."),
      makeTryItPage("pre_stunned", "Try it out now: forage near the alien to see the Forager get stunned."),
      makeTryItPage("pre_revive", "Try it out now: switch to the Explorer and revive the stunned Forager (stand together + press E)."),
    ];

    // Final stage list (interleave pre-pages before each PRACTICE game stage)
    const STAGES = [
      ...ARROW_STAGES,
      ...ROLE_PAGES,

      PRE_PRACTICE_PAGES[0],
      PRACTICE_MODULES[0],

      PRE_PRACTICE_PAGES[1],
      PRACTICE_MODULES[1],

      PRACTICE_MODULES[2], // mine_warning (instruction)

      PRE_PRACTICE_PAGES[2],
      PRACTICE_MODULES[3],

      PRE_PRACTICE_PAGES[3],
      PRACTICE_MODULES[4],

      PRE_PRACTICE_PAGES[4],
      PRACTICE_MODULES[5],
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

      // main roles (keep key "security", display "Explorer")
      agents: {
        forager: { name: "Forager", cls: "forager", x: 0, y: 0 },
        security: { name: "Explorer", cls: "security", x: 0, y: 0 },
      },

      // movement-only player (pre-role)
      player: { x: 0, y: 0 },

      controlledRole: null, // "player" | "forager" | "security"
      goldTotal: 0,
      foragerStunTurns: 0,

      // dig practice counter
      practiceMineHitsLeft: 0,
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
        player_x: state.player.x,
        player_y: state.player.y,
        forager_x: state.agents.forager.x,
        forager_y: state.agents.forager.y,
        explorer_x: state.agents.security.x,
        explorer_y: state.agents.security.y,
        gold_total: state.goldTotal,
        forager_stun_turns: state.foragerStunTurns,
        dig_hits_left: state.practiceMineHitsLeft,
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

        /* Role visuals row (instruction only) */
        .pRoleViz{
          margin-top:10px;
          display:flex;
          gap:14px;
          align-items:center;
          justify-content:center;
          flex-wrap:wrap;
        }
        .pRoleCard{
          display:flex;
          align-items:center;
          gap:10px;
          padding:10px 12px;
          border:1px solid #e6e6e6;
          border-radius:14px;
          background:#fff;
          box-shadow:0 2px 10px rgba(0,0,0,0.04);
          min-width:240px;
          justify-content:flex-start;
        }
        .pRoleAvatar{
          width:44px;
          height:44px;
          border-radius:14px;
          box-shadow:0 2px 8px rgba(0,0,0,0.10);
        }
        .pRoleAvatar.forager{ background:#16a34a; }
        .pRoleAvatar.explorer{ background:#eab308; }
        .pRoleLabel{
          text-align:left;
          font-weight:900;
          color:#111;
          line-height:1.2;
        }
        .pRoleSub{
          display:block;
          font-weight:800;
          font-size:12px;
          color:#666;
          margin-top:2px;
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

        /* Arrow practice goal label */
        .pGoalLabel{
          position:absolute;
          bottom:6px;
          font-weight:900;
          font-size:11px;
          letter-spacing:0.06em;
          color:#111;
          opacity:0.9;
          z-index:40;
        }

        /* Neutral player (pre-role) */
        .pPlayer{
          width:72%;
          height:72%;
          border-radius:14px;
          background:#111;
          box-shadow:0 2px 10px rgba(0,0,0,.18);
          position:relative;
          z-index:10;
        }

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
          image-rendering:pixelated;
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
        .pDot.player{ background:#111; }
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
          animation:pSpin 0.85s linear infinite;
          display:none;
        }
        @keyframes pSpin { to { transform: rotate(360deg); } }

        /* Top countdown banner (after scan) */
        .pTopCountdown{
          position:absolute;
          top:12px;
          left:50%;
          transform:translateX(-50%);
          z-index:60;
          padding:8px 12px;
          border-radius:999px;
          border:1px solid #e6e6e6;
          background:rgba(255,255,255,0.98);
          box-shadow:0 2px 10px rgba(0,0,0,0.10);
          font-weight:900;
          font-size:13px;
          color:#111;
          white-space:nowrap;
        }

        .hidden{ display:none; }
        `,
      ])
    );

    // DOM
    const instrTitleEl = el("div", { class: "pInstrTitle" }, [""]);
    const instrBodyEl = el("div", { class: "pInstrBody" }, [""]);
    const instrBtn = el("button", { class: "pBtn pBtnPrimary" }, ["Continue"]);

    // Role visuals (instruction)
    const roleViz = el("div", { class: "pRoleViz hidden", id: "pRoleViz" }, [
      el("div", { class: "pRoleCard" }, [
        el("div", { class: "pRoleAvatar forager" }, []),
        el("div", { class: "pRoleLabel" }, [
          "Forager (Green)",
          el("span", { class: "pRoleSub" }, ["Collects gold (E on mine)"]),
        ]),
      ]),
      el("div", { class: "pRoleCard" }, [
        el("div", { class: "pRoleAvatar explorer" }, []),
        el("div", { class: "pRoleLabel" }, [
          "Explorer (Yellow)",
          el("span", { class: "pRoleSub" }, ["Scans for aliens (Q), revives (E)"]),
        ]),
      ]),
    ]);

    const instrView = el("div", { class: "pInstr" }, [
      instrTitleEl,
      instrBodyEl,
      roleViz,
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

    const goldEl = el("div", {}, ["Gold: 0"]);
    const footerLeft = el("div", { class: "pFooterLeft" }, [footerRoleBadge, goldEl]);
    const footerRight = el("div", {}, [""]);

    const footer = el("div", { class: "pFooter" }, [footerLeft, footerRight]);

    // Overlay
    const overlayTextEl = el("div", {}, [""]);
    const overlaySubEl = el("div", { class: "pOverlaySub" }, [""]);
    const spinnerEl = el("div", { class: "pSpinner" }, []);
    const overlay = el("div", { class: "pOverlay", id: "pOverlay" }, [
      el("div", { class: "pOverlayBox" }, [overlayTextEl, overlaySubEl, spinnerEl]),
    ]);

    // Top countdown banner (for scan stage transition)
    const topCountdownEl = el("div", { class: "pTopCountdown hidden", id: "pTopCountdown" }, [""]);

    const gameView = el("div", { class: "pGame hidden" }, [top, boardWrap, footer]);

    const card = el("div", { class: "pCard" }, [instrView, gameView, overlay, topCountdownEl]);
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

    function currentStage() {
      return STAGES[state.stageIndex] || null;
    }

    function renderFooter() {
      const st = currentStage();
      const you = state.controlledRole;

      if (you === "player") {
        footerRoleDot.className = "pDot player";
        footerRoleTxt.textContent = "Movement practice";
        goldEl.textContent = "";
        footerRight.textContent = "";
        return;
      }

      if (you === "forager") {
        footerRoleDot.className = "pDot forager";
        footerRoleTxt.textContent = "You control: Forager (Green)";
      } else {
        footerRoleDot.className = "pDot security";
        footerRoleTxt.textContent = "You control: Explorer (Yellow)";
      }

      goldEl.textContent = `Gold: ${state.goldTotal}`;

      if (st && st.id === "dig_gold_3x" && state.practiceMineHitsLeft > 0) {
        footerRight.textContent = `Digs remaining: ${state.practiceMineHitsLeft}`;
      } else {
        footerRight.textContent =
          state.foragerStunTurns > 0 ? `Forager stunned: ${state.foragerStunTurns}` : "";
      }
    }

    function renderBoard() {
      if (!cells.length) return;
      const st = currentStage();

      const px = state.player.x,
        py = state.player.y;
      const fx = state.agents.forager.x,
        fy = state.agents.forager.y;
      const ex = state.agents.security.x,
        ey = state.agents.security.y;

      for (let y = 0; y < state.rows; y++) {
        for (let x = 0; x < state.cols; x++) {
          const c = cellAt(x, y);
          const t = tileAt(x, y);

          c.className = "pCell " + (t.revealed ? "rev" : "unrev");
          c.innerHTML = "";

          // Arrow tutorial: show neutral player + GOAL label
          if (st && st.subtype === "arrow") {
            if (st.goal && x === st.goal.x && y === st.goal.y) {
              c.appendChild(el("div", { class: "pGoalLabel" }, ["GOAL"]));
            }
            if (x === px && y === py) c.appendChild(el("div", { class: "pPlayer" }, []));
            continue;
          }

          // Role practice: agents first
          const hasF = x === fx && y === fy;
          const hasE = x === ex && y === ey;

          if (hasF && hasE) {
            c.appendChild(
              el("div", { class: "pAgentPair" }, [
                el("div", { class: "pAgentMini forager" }),
                el("div", { class: "pAgentMini security" }),
              ])
            );
          } else if (hasF) c.appendChild(el("div", { class: "pAgent forager" }));
          else if (hasE) c.appendChild(el("div", { class: "pAgent security" }));

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
    // Overlay helpers (freeze + spinner)
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

    // Freeze inputs without showing overlay (used for “show effect” delays)
    async function pauseInputs(ms) {
      state.overlayActive = true;
      overlay.style.display = "none";
      await sleep(ms);
      state.overlayActive = false;
    }

    // After scan: keep board visible, show alien for 3 seconds + countdown on top
    async function showNextInstructionCountdown(seconds = 3) {
      state.overlayActive = true;

      topCountdownEl.classList.remove("hidden");
      for (let s = seconds; s >= 1; s--) {
        topCountdownEl.textContent = `Next instruction starts in ${s}…`;
        await sleep(1000);
      }
      topCountdownEl.classList.add("hidden");

      state.overlayActive = false;
    }

    // =========================
    // Stage flow
    // =========================
    function showInstruction() {
      const st = currentStage();
      state.mode = "instruction";

      instrTitleEl.textContent = st?.title || "Practice";

      // Hint-box removed; hint text is folded into the body
      const body = st?.body || "";
      const hint = st?.hint ? `\n\n${st.hint}` : "";
      instrBodyEl.textContent = body + hint;

      if (st?.showRoleVisuals) roleViz.classList.remove("hidden");
      else roleViz.classList.add("hidden");

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
      log("tile_reveal", {
        tile_x: x,
        tile_y: y,
        tile_gold_mine: t.goldMine ? 1 : 0,
        tile_alien_center_id: t.alienCenterId || 0,
      });
      renderAll();
      return true;
    }

    async function doMove(dx, dy, keyLabel) {
      const st = currentStage();
      if (!st || st.kind !== "game") return;
      if (state.overlayActive) return;

      // Arrow tutorial (neutral player)
      if (st.subtype === "arrow") {
        const fromX = state.player.x,
          fromY = state.player.y;
        const toX = clamp(fromX + dx, 0, state.cols - 1);
        const toY = clamp(fromY + dy, 0, state.rows - 1);

        log("move", {
          role: "player",
          key: keyLabel,
          dx,
          dy,
          from_x: fromX,
          from_y: fromY,
          to_x: toX,
          to_y: toY,
          clamped: toX !== fromX + dx || toY !== fromY + dy ? 1 : 0,
        });

        state.player.x = toX;
        state.player.y = toY;
        renderAll();

        if (typeof st.onArrowGoalCheck === "function" && st.onArrowGoalCheck(state)) {
          await advanceStage("arrow_goal_reached");
        }
        return;
      }

      // Role-based movement
      const role = state.controlledRole;
      const a = state.agents[role];

      const fromX = a.x,
        fromY = a.y;
      const toX = clamp(fromX + dx, 0, state.cols - 1);
      const toY = clamp(fromY + dy, 0, state.rows - 1);

      log("move", {
        role,
        key: keyLabel,
        dx,
        dy,
        from_x: fromX,
        from_y: fromY,
        to_x: toX,
        to_y: toY,
        clamped: toX !== fromX + dx || toY !== fromY + dy ? 1 : 0,
      });

      a.x = toX;
      a.y = toY;

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

      if (st.subtype === "arrow") {
        log("action_invalid", { role: "player", key: keyLower, reason: "not_used_in_this_stage" });
        return;
      }

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

        if (res && res.complete) {
          // Special: after scan, show revealed alien for 3s + countdown banner, then proceed
          if (st.id === "scan_alien") {
            await showNextInstructionCountdown(3);
            await advanceStage("action_q_complete_after_countdown");
          } else {
            await advanceStage("action_q_complete");
          }
        }
        return;
      }

      if (keyLower === "e" && role === "security" && typeof st.onActionE === "function") {
        const res = await st.onActionE(state);
        renderAll();
        if (res && res.complete) await advanceStage("action_e_complete");
        return;
      }

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

      const st = currentStage();
      if (!st) return;

      // Arrow tutorial: ONLY accept required arrow key
      if (st.subtype === "arrow") {
        if (e.key !== st.key) {
          log("wrong_key", { required_key: st.key, key: String(e.key || "") });
          return;
        }
        e.preventDefault();
        void doMove(st.dx, st.dy, st.key);
        return;
      }

      // Normal movement
      if (e.key === "ArrowUp") {
        e.preventDefault();
        void doMove(0, -1, "ArrowUp");
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        void doMove(0, 1, "ArrowDown");
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        void doMove(-1, 0, "ArrowLeft");
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        void doMove(1, 0, "ArrowRight");
        return;
      }

      const k = (e.key || "").toLowerCase();
      if (k === "e" || k === "q") {
        e.preventDefault();
        void doAction(k);
        return;
      }
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
