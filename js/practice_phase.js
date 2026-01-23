/* ===========================
   practice_phase.js
   - 4 instruction pages + 4 tiny movement games
   - Instruction page is separate from gameplay page
   - Gameplay uses a small 3-tile board (correct sizing for 3x1 and 1x3)
   - Logs to DataSaver and calls onEnd()
   =========================== */

(function () {
  "use strict";

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

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

  function startPractice(containerId, config) {
    const { participantId, logger, trialIndex = 0, onEnd = null } = config || {};

    if (!participantId) throw new Error("startPractice requires participantId");
    if (!logger || typeof logger.log !== "function") throw new Error("startPractice requires logger.log(evt)");

    const mount = typeof containerId === "string" ? document.getElementById(containerId) : containerId;
    if (!mount) throw new Error("Could not find container element for practice.");
    mount.innerHTML = "";

    // --------- Stages (instruction -> tiny game) ---------
    const STAGES = [
      {
        id: "left",
        title: "Practice 1/4 — Move Left",
        body: "Press the Left Arrow key to move left. Reach the GOAL tile to continue.",
        cols: 3,
        rows: 1,
        start: { x: 2, y: 0 },
        goal: { x: 0, y: 0 },
        key: "ArrowLeft",
        dx: -1,
        dy: 0,
        hint: "Use Left Arrow (←).",
      },
      {
        id: "right",
        title: "Practice 2/4 — Move Right",
        body: "Press the Right Arrow key to move right. Reach the GOAL tile to continue.",
        cols: 3,
        rows: 1,
        start: { x: 0, y: 0 },
        goal: { x: 2, y: 0 },
        key: "ArrowRight",
        dx: 1,
        dy: 0,
        hint: "Use Right Arrow (→).",
      },
      {
        id: "up",
        title: "Practice 3/4 — Move Up",
        body: "Press the Up Arrow key to move up. Reach the GOAL tile to continue.",
        cols: 1,
        rows: 3,
        start: { x: 0, y: 2 },
        goal: { x: 0, y: 0 },
        key: "ArrowUp",
        dx: 0,
        dy: -1,
        hint: "Use Up Arrow (↑).",
      },
      {
        id: "down",
        title: "Practice 4/4 — Move Down",
        body: "Press the Down Arrow key to move down. Reach the GOAL tile to finish practice.",
        cols: 1,
        rows: 3,
        start: { x: 0, y: 0 },
        goal: { x: 0, y: 2 },
        key: "ArrowDown",
        dx: 0,
        dy: 1,
        hint: "Use Down Arrow (↓).",
      },
    ];

    // --------- State ---------
    const state = {
      participantId,
      trialIndex,
      running: true,
      stageIndex: 0,
      mode: "instruction", // "instruction" | "game"
      pos: { x: STAGES[0].start.x, y: STAGES[0].start.y },
      movesInStage: 0,
    };

    const log = (event_name, extra = {}) => {
      logger.log({
        trial_index: state.trialIndex,
        event_type: "practice",
        event_name,
        stage_index: state.stageIndex + 1,
        stage_total: STAGES.length,
        stage_id: STAGES[state.stageIndex]?.id || "",
        mode: state.mode,
        player_x: state.pos.x,
        player_y: state.pos.y,
        moves_in_stage: state.movesInStage,
        ...extra,
      });
    };

    // --------- UI Styles ---------
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
          height:min(92vh, 760px);
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
          align-items:center;     /* CHANGED */
          text-align:center;      /* NEW */
          gap:10px;
          padding:6px;
        }
        .pInstrTitle{ font-weight:900; font-size:22px; }
        .pInstrBody{
          color:#444;
          font-weight:700;
          font-size:15px;
          line-height:1.5;
          max-width:820px;
          text-align:center;      /* NEW */
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
          justify-content:center; /* CHANGED */
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
        }
        .pTop{
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:12px;
        }
        .pTitle{ font-weight:900; font-size:18px; }
        .pSub{ margin-top:4px; color:#666; font-weight:700; font-size:13px; line-height:1.35; max-width:720px; }
        .pHint{
          font-weight:800;
          font-size:14px;
          color:#444;
          padding:10px 12px;
          border:1px solid #e6e6e6;
          border-radius:12px;
          background:#fafafa;
          min-width:220px;
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

        /* Board size will be set in JS (fixes 1x3 vs 3x1 sizing) */
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
          background:#fff;
        }
        .pGoal{ background:#f3f4f6; }
        .pGoalLabel{
          position:absolute;
          bottom:6px;
          font-weight:900;
          font-size:11px;
          letter-spacing:0.06em;
          color:#111;
          opacity:0.9;
        }
        .pPlayer{
          width:72%;
          height:72%;
          border-radius:14px;
          background:#111;
          box-shadow:0 2px 10px rgba(0,0,0,.18);
        }
        .pFooter{
          flex:0 0 auto;
          height:44px;
          border:1px solid #e6e6e6;
          border-radius:14px;
          background:#fafafa;
          display:flex;
          align-items:center;
          justify-content:center;
          font-weight:900;
          font-size:14px;
          color:#111;
        }

        .hidden{ display:none; }
        `,
      ])
    );

    // --------- Build DOM ---------
    const instrTitleEl = el("div", { class: "pInstrTitle" }, [""]);
    const instrBodyEl = el("div", { class: "pInstrBody" }, [""]);
    const instrHintEl = el("div", { class: "pInstrHint" }, [""]);
    const instrBtn = el("button", { class: "pBtn pBtnPrimary" }, ["Start"]);

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
    const footer = el("div", { class: "pFooter" }, [""]);

    const gameView = el("div", { class: "pGame hidden" }, [top, boardWrap, footer]);

    const card = el("div", { class: "pCard" }, [instrView, gameView]);
    const stage = el("div", { class: "pStage" }, [card]);
    mount.appendChild(stage);

    // Board cells
    let cells = [];
    const cellAt = (x, y, cols) => cells[y * cols + x];

    // --------- View Switching ---------
    function showInstruction() {
      const st = STAGES[state.stageIndex];
      state.mode = "instruction";

      instrTitleEl.textContent = st.title;
      instrBodyEl.textContent = st.body;
      instrHintEl.textContent = st.hint;

      instrBtn.textContent = "Start";
      instrBtn.onclick = () => startGameForStage(); // ALWAYS reset correctly

      instrView.classList.remove("hidden");
      gameView.classList.add("hidden");

      log("instruction_shown");
    }

    function startGameForStage() {
      const st = STAGES[state.stageIndex];
      state.mode = "game";
      state.movesInStage = 0;
      state.pos.x = st.start.x;
      state.pos.y = st.start.y;

      buildBoardForStage(st);
      renderGame();

      instrView.classList.add("hidden");
      gameView.classList.remove("hidden");

      log("game_start", {
        required_key: st.key,
        start_x: st.start.x,
        start_y: st.start.y,
        goal_x: st.goal.x,
        goal_y: st.goal.y,
      });
    }

    // FIX: size board using explicit width/height (prevents 1x3 looking "wrong")
    function buildBoardForStage(st) {
      board.innerHTML = "";
      board.style.gridTemplateColumns = `repeat(${st.cols}, 1fr)`;
      board.style.gridTemplateRows = `repeat(${st.rows}, 1fr)`;

      // Make 3x1 and 1x3 symmetric: long side ~ MAX_BOARD_PX
      const MAX_BOARD_PX = 260;
      const minCell = 58; // keeps tiles readable
      const maxCell = 96; // prevents huge tiles
      const maxDim = Math.max(st.cols, st.rows);

      let cellPx = Math.floor(MAX_BOARD_PX / maxDim);
      cellPx = clamp(cellPx, minCell, maxCell);

      board.style.width = `${st.cols * cellPx}px`;
      board.style.height = `${st.rows * cellPx}px`;

      cells = [];
      for (let y = 0; y < st.rows; y++) {
        for (let x = 0; x < st.cols; x++) {
          const c = el("div", { class: "pCell", "data-x": x, "data-y": y });
          board.appendChild(c);
          cells.push(c);
        }
      }
    }

    function renderGame() {
      const st = STAGES[state.stageIndex];

      gameTitleEl.textContent = st.title;
      gameSubEl.textContent = "Move to the GOAL tile using the instructed arrow key.";
      gameHintEl.textContent = st.hint;

      // Clear cells
      for (const c of cells) {
        c.className = "pCell";
        c.innerHTML = "";
      }

      // Goal
      const g = cellAt(st.goal.x, st.goal.y, st.cols);
      if (g) {
        g.className = "pCell pGoal";
        g.appendChild(el("div", { class: "pGoalLabel" }, ["GOAL"]));
      }

      // Player
      const p = cellAt(state.pos.x, state.pos.y, st.cols);
      if (p) p.appendChild(el("div", { class: "pPlayer" }));

      footer.textContent = `Moves: ${state.movesInStage}`;
    }

    function completeStageAndAdvance() {
      log("stage_complete", { moves_used: state.movesInStage });

      state.stageIndex += 1;

      if (state.stageIndex >= STAGES.length) {
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

    // --------- Input ---------
    function onKeyDown(e) {
      const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea") return;
      if (!state.running) return;
      if (state.mode !== "game") return;

      const st = STAGES[state.stageIndex];
      if (!st) return;

      // Only accept the stage’s required arrow key
      if (e.key !== st.key) {
        logger.log({
          trial_index: state.trialIndex,
          event_type: "practice",
          event_name: "wrong_key",
          stage_index: state.stageIndex + 1,
          stage_id: st.id,
          key: String(e.key || ""),
          required_key: st.key,
          player_x: state.pos.x,
          player_y: state.pos.y,
        });
        return;
      }

      e.preventDefault();

      const fromX = state.pos.x;
      const fromY = state.pos.y;

      const toX = clamp(fromX + st.dx, 0, st.cols - 1);
      const toY = clamp(fromY + st.dy, 0, st.rows - 1);

      state.pos.x = toX;
      state.pos.y = toY;
      state.movesInStage += 1;

      logger.log({
        trial_index: state.trialIndex,
        event_type: "practice",
        event_name: "move",
        stage_index: state.stageIndex + 1,
        stage_id: st.id,
        key: st.key,
        dx: st.dx,
        dy: st.dy,
        from_x: fromX,
        from_y: fromY,
        to_x: toX,
        to_y: toY,
        move_index_in_stage: state.movesInStage,
      });

      renderGame();

      if (toX === st.goal.x && toY === st.goal.y) {
        completeStageAndAdvance();
      }
    }

    // --------- Init ---------
    log("practice_start", { stage_total: STAGES.length });
    window.addEventListener("keydown", onKeyDown);

    // Start on instruction page for stage 1
    showInstruction();

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
