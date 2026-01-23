/* ===========================
   practice_phase.js
   - 4 instruction screens + 4 tiny movement games
   - Each game is a 3-tile line; reach the GOAL to continue
   - Cleanly mounts into #app, logs to DataSaver, then calls onEnd()
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
    const {
      participantId,
      logger,
      trialIndex = 0,
      onEnd = null,
    } = config || {};

    if (!participantId) throw new Error("startPractice requires participantId");
    if (!logger || typeof logger.log !== "function") throw new Error("startPractice requires logger.log(evt)");

    const mount = typeof containerId === "string" ? document.getElementById(containerId) : containerId;
    if (!mount) throw new Error("Could not find container element for practice.");
    mount.innerHTML = "";

    // --------- Practice stages (4 instruction + 4 games) ---------
    // 3-tile "line" boards (either 1x3 or 3x1)
    const STAGES = [
      {
        id: "left",
        title: "Practice 1/4 — Move Left",
        body: "Press the Left Arrow key to move left. Reach the GOAL tile to continue.",
        cols: 3, rows: 1,
        start: { x: 2, y: 0 },
        goal:  { x: 0, y: 0 },
        key: "ArrowLeft",
        dx: -1, dy: 0,
        hint: "Use Left Arrow (←).",
      },
      {
        id: "right",
        title: "Practice 2/4 — Move Right",
        body: "Press the Right Arrow key to move right. Reach the GOAL tile to continue.",
        cols: 3, rows: 1,
        start: { x: 0, y: 0 },
        goal:  { x: 2, y: 0 },
        key: "ArrowRight",
        dx: 1, dy: 0,
        hint: "Use Right Arrow (→).",
      },
      {
        id: "up",
        title: "Practice 3/4 — Move Up",
        body: "Press the Up Arrow key to move up. Reach the GOAL tile to continue.",
        cols: 1, rows: 3,
        start: { x: 0, y: 2 },
        goal:  { x: 0, y: 0 },
        key: "ArrowUp",
        dx: 0, dy: -1,
        hint: "Use Up Arrow (↑).",
      },
      {
        id: "down",
        title: "Practice 4/4 — Move Down",
        body: "Press the Down Arrow key to move down. Reach the GOAL tile to finish practice.",
        cols: 1, rows: 3,
        start: { x: 0, y: 0 },
        goal:  { x: 0, y: 2 },
        key: "ArrowDown",
        dx: 0, dy: 1,
        hint: "Use Down Arrow (↓).",
      },
    ];

    // --------- State ---------
    const state = {
      participantId,
      trialIndex,
      running: true,
      stageIndex: 0,
      overlayActive: true,
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
        player_x: state.pos.x,
        player_y: state.pos.y,
        moves_in_stage: state.movesInStage,
        ...extra,
      });
    };

    // --------- UI ---------
    mount.appendChild(
      el("style", {}, [`
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
        .pBoard{
          width:min(70vmin, 520px);
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
        .pGoal{
          background:#f3f4f6;
        }
        .pGoalLabel{
          position:absolute;
          bottom:8px;
          font-weight:900;
          font-size:12px;
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
          height:48px;
          border:1px solid #e6e6e6;
          border-radius:14px;
          background:#fafafa;
          display:flex;
          align-items:center;
          justify-content:center;
          font-weight:900;
          font-size:15px;
          color:#111;
        }
        .pOverlay{
          position:absolute;
          inset:0;
          display:flex;
          align-items:center;
          justify-content:center;
          background:rgba(0,0,0,0.25);
          z-index:50;
        }
        .pOverlayBox{
          background:rgba(255,255,255,0.98);
          border:1px solid #e6e6e6;
          border-radius:14px;
          padding:18px 20px;
          box-shadow:0 8px 24px rgba(0,0,0,0.15);
          width:min(640px, 90%);
        }
        .pOverlayH{
          font-weight:900;
          font-size:22px;
          margin:0 0 8px 0;
        }
        .pOverlayP{
          margin:0 0 14px 0;
          color:#444;
          font-weight:700;
          font-size:14px;
          line-height:1.45;
        }
        .pBtnRow{ display:flex; gap:10px; justify-content:flex-end; align-items:center; }
        .pBtn{
          padding:10px 14px;
          border-radius:12px;
          border:1px solid #ccc;
          background:#fff;
          cursor:pointer;
          font-weight:800;
          font-size:14px;
        }
        .pBtnPrimary{
          background:#111;
          color:#fff;
          border-color:#111;
        }
      `])
    );

    const titleEl = el("div", { class: "pTitle" }, [""]);
    const subEl = el("div", { class: "pSub" }, [""]);
    const hintEl = el("div", { class: "pHint" }, [""]);

    const top = el("div", { class: "pTop" }, [
      el("div", { style: "display:flex;flex-direction:column;" }, [titleEl, subEl]),
      hintEl,
    ]);

    const board = el("div", { class: "pBoard", id: "pBoard" });
    const boardWrap = el("div", { class: "pBoardWrap" }, [board]);

    const footer = el("div", { class: "pFooter" }, ["Use the arrow key shown above."]);

    // Overlay (instruction / transition)
    const overlayH = el("div", { class: "pOverlayH", id: "pOverlayH" }, [""]);
    const overlayP = el("div", { class: "pOverlayP", id: "pOverlayP" }, [""]);

    const overlayBtn = el("button", {
      class: "pBtn pBtnPrimary",
      onclick: () => {
        if (!state.running) return;
        hideOverlay();
      },
    }, ["Start"]);

    const overlay = el("div", { class: "pOverlay", id: "pOverlay" }, [
      el("div", { class: "pOverlayBox" }, [
        overlayH,
        overlayP,
        el("div", { class: "pBtnRow" }, [overlayBtn]),
      ]),
    ]);

    const card = el("div", { class: "pCard" }, [top, boardWrap, footer, overlay]);
    const stage = el("div", { class: "pStage" }, [card]);
    mount.appendChild(stage);

    let cells = [];
    const cellAt = (x, y, cols) => cells[y * cols + x];

    function showOverlay(header, body, buttonText) {
      state.overlayActive = true;
      overlayH.textContent = header || "";
      overlayP.textContent = body || "";
      overlayBtn.textContent = buttonText || "Start";
      overlay.style.display = "flex";
    }

    function hideOverlay() {
      overlay.style.display = "none";
      state.overlayActive = false;
      // start accepting keys immediately
      log("instruction_dismissed");
    }

    function buildBoardForStage(stageObj) {
      const { cols, rows } = stageObj;

      board.innerHTML = "";
      board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      board.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
      board.style.aspectRatio = `${cols} / ${rows}`;

      cells = [];
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const c = el("div", { class: "pCell", "data-x": x, "data-y": y });
          board.appendChild(c);
          cells.push(c);
        }
      }
    }

    function renderStage() {
      const st = STAGES[state.stageIndex];
      if (!st) return;

      titleEl.textContent = st.title;
      subEl.textContent = st.body;
      hintEl.textContent = st.hint;

      // Clear cells
      for (const c of cells) c.className = "pCell", (c.innerHTML = "");

      // Goal styling
      const g = cellAt(st.goal.x, st.goal.y, st.cols);
      if (g) {
        g.className = "pCell pGoal";
        g.appendChild(el("div", { class: "pGoalLabel" }, ["GOAL"]));
      }

      // Player
      const p = cellAt(state.pos.x, state.pos.y, st.cols);
      if (p) p.appendChild(el("div", { class: "pPlayer" }));

      footer.textContent = `Moves in this practice: ${state.movesInStage}`;
    }

    function resetStage(stageIndex) {
      state.stageIndex = stageIndex;
      state.movesInStage = 0;

      const st = STAGES[state.stageIndex];
      state.pos.x = st.start.x;
      state.pos.y = st.start.y;

      buildBoardForStage(st);
      renderStage();

      log("stage_start", {
        stage_title: st.title,
        cols: st.cols,
        rows: st.rows,
        start_x: st.start.x,
        start_y: st.start.y,
        goal_x: st.goal.x,
        goal_y: st.goal.y,
        required_key: st.key,
      });

      showOverlay(st.title, st.body, "Start");
    }

    function completeStage() {
      const st = STAGES[state.stageIndex];
      log("stage_complete", {
        moves_used: state.movesInStage,
      });

      // Transition overlay (short)
      showOverlay("Nice.", "Goal reached. Moving to the next step.", "Continue");
      overlayBtn.textContent = (state.stageIndex === STAGES.length - 1) ? "Finish" : "Continue";

      // When they click Continue/Finish, we either advance or end.
      overlayBtn.onclick = () => {
        if (!state.running) return;

        if (state.stageIndex >= STAGES.length - 1) {
          endPractice("completed");
        } else {
          resetStage(state.stageIndex + 1);
        }
      };
    }

    function endPractice(reason) {
      if (!state.running) return;
      state.running = false;

      log("practice_end", { reason: reason || "" });

      window.removeEventListener("keydown", onKeyDown);

      if (typeof onEnd === "function") onEnd({ reason: reason || "completed" });
    }

    function onKeyDown(e) {
      const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea") return;
      if (!state.running || state.overlayActive) return;

      const st = STAGES[state.stageIndex];
      if (!st) return;

      // Only accept the stage’s required arrow key (keeps the practice focused)
      if (e.key !== st.key) {
        // Optional: log "wrong key" to see confusion patterns
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

      renderStage();

      if (toX === st.goal.x && toY === st.goal.y) {
        completeStage();
      }
    }

    // --------- Init ---------
    log("practice_start", { stage_total: STAGES.length });
    window.addEventListener("keydown", onKeyDown);

    // Start at stage 1
    resetStage(0);

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
