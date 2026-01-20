/* ===========================
   main_phase.js
   - Exports startGame(containerId, config)
   - Implements a 5x5 grid world + minimap
   - Logs all UI + key events via provided logger
   =========================== */

(function () {
  "use strict";

  // ---------------------------
  // CSV Logger
  // ---------------------------
  class CsvLogger {
    constructor({ participantId }) {
      this.participantId = participantId;
      this.rows = [];
      this.sessionStartPerf = performance.now();
      this.lastEventPerf = this.sessionStartPerf;
    }

    log(evt) {
      const nowPerf = performance.now();
      const rt = Math.round(nowPerf - this.lastEventPerf);
      this.lastEventPerf = nowPerf;

      const row = {
        participant_id: this.participantId,
        iso_time: new Date().toISOString(),
        rt_ms: rt,
        ...evt,
      };
      this.rows.push(row);
    }

    toCSV() {
      if (this.rows.length === 0) {
        return "participant_id,iso_time,rt_ms,event_type,event_name\n";
      }
      const headers = Object.keys(this.rows[0]);
      const escape = (v) => {
        const s = String(v ?? "");
        if (s.includes('"') || s.includes(",") || s.includes("\n")) {
          return `"${s.replaceAll('"', '""')}"`;
        }
        return s;
      };
      const lines = [headers.join(",")];
      for (const r of this.rows) {
        lines.push(headers.map((h) => escape(r[h])).join(","));
      }
      return lines.join("\n") + "\n";
    }
  }

  // Expose logger constructor (optional)
  window.CsvLogger = CsvLogger;

  // ---------------------------
  // Game UI helpers
  // ---------------------------
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "style") node.style.cssText = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) {
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  // ---------------------------
  // startGame
  // ---------------------------
  function startGame(containerId, config) {
    const {
      participantId,
      logger,
      trialIndex = 0,
      gridSize = 5,
      spawn = { x: 2, y: 2 }, // center of 5x5
      onEnd = null,
    } = config;

    if (!participantId) throw new Error("startGame requires participantId");
    if (!logger) throw new Error("startGame requires a logger instance");

    const mount = typeof containerId === "string"
      ? document.getElementById(containerId)
      : containerId;

    if (!mount) throw new Error("Could not find container element for game.");

    // Clear mount
    mount.innerHTML = "";

    // Local state
    const state = {
      x: spawn.x,
      y: spawn.y,
      gridSize,
      trialIndex,
      running: true,
    };

    // Styles scoped to game container
    const style = el("style", {}, [`
      .gameCard { background:#fff; border:1px solid #e6e6e6; border-radius:12px; padding:16px; box-shadow:0 1px 2px rgba(0,0,0,.04); }
      .gameRow { display:flex; gap:16px; flex-wrap:wrap; align-items:flex-start; }
      .world { width: 420px; height: 420px; border:1px solid #ddd; border-radius:10px; display:grid; }
      .cell { border:1px solid #f0f0f0; display:flex; align-items:center; justify-content:center; font-size:12px; color:#999; }
      .player { background:#111; width:70%; height:70%; border-radius:8px; }
      .panel { min-width:220px; flex:1; }
      .mini { width: 220px; height: 220px; border:1px solid #ddd; border-radius:10px; display:grid; margin-top:8px; }
      .miniCell { border:1px solid #f3f3f3; }
      .miniHere { background:#111; }
      .hud { display:flex; gap:10px; flex-wrap:wrap; margin-top:10px; }
      .hudBox { border:1px solid #eee; border-radius:10px; padding:10px 12px; }
      .btnRow { display:flex; gap:10px; margin-top:12px; flex-wrap:wrap; }
      button { padding: 10px 14px; border-radius: 10px; border: 1px solid #ccc; background: #fff; cursor: pointer; font-size: 15px; }
      button.primary { background:#111; color:#fff; border-color:#111; }
      .muted { color:#666; font-size:14px; }
    `]);

    // Build UI
    const title = el("h2", {}, ["Main Phase"]);
    const subtitle = el("div", { class: "muted" }, [
      `Use arrow keys to move on a ${gridSize}×${gridSize} grid. Press E for an action event (placeholder).`
    ]);

    const world = el("div", {
      class: "world",
      style: `grid-template-columns: repeat(${gridSize}, 1fr); grid-template-rows: repeat(${gridSize}, 1fr);`
    });

    const mini = el("div", {
      class: "mini",
      style: `grid-template-columns: repeat(${gridSize}, 1fr); grid-template-rows: repeat(${gridSize}, 1fr);`
    });

    const hud = el("div", { class: "hud" }, [
      el("div", { class: "hudBox" }, [`Position: `, el("strong", { id: "posText" }, [`(${state.x}, ${state.y})`])]),
      el("div", { class: "hudBox" }, [`Trial: `, el("strong", { id: "trialText" }, [String(trialIndex)])]),
    ]);

    const nextBtn = el("button", {
      class: "primary",
      id: "gameNextBtn",
      onclick: () => {
        logger.log({
          trial_index: state.trialIndex,
          event_type: "ui",
          event_name: "click_next",
          key: "",
          from_x: state.x,
          from_y: state.y,
          to_x: state.x,
          to_y: state.y,
        });
        if (typeof onEnd === "function") onEnd({ reason: "next_clicked" });
      }
    }, ["Next"]);

    const btnRow = el("div", { class: "btnRow" }, [nextBtn]);

    const panel = el("div", { class: "panel" }, [
      el("h3", {}, ["Map"]),
      el("div", { class: "muted" }, ["Mini-map shows your current grid location."]),
      mini,
      hud,
      btnRow,
    ]);

    const row = el("div", { class: "gameRow" }, [
      world,
      panel,
    ]);

    const card = el("div", { class: "gameCard" }, [
      title, subtitle, row
    ]);

    mount.appendChild(style);
    mount.appendChild(card);

    // Populate world + minimap cells
    const worldCells = [];
    const miniCells = [];
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const c = el("div", { class: "cell", "data-x": x, "data-y": y }, [""]);
        world.appendChild(c);
        worldCells.push(c);

        const m = el("div", { class: "miniCell", "data-x": x, "data-y": y }, []);
        mini.appendChild(m);
        miniCells.push(m);
      }
    }

    function getCell(cells, x, y) {
      return cells[y * gridSize + x];
    }

    function render() {
      // Clear player markers
      for (const c of worldCells) c.innerHTML = "";
      for (const m of miniCells) m.classList.remove("miniHere");

      // Draw player
      const here = getCell(worldCells, state.x, state.y);
      here.appendChild(el("div", { class: "player" }));

      const miniHere = getCell(miniCells, state.x, state.y);
      miniHere.classList.add("miniHere");

      const posText = mount.querySelector("#posText");
      if (posText) posText.textContent = `(${state.x}, ${state.y})`;
    }

    function tryMove(dx, dy, keyName) {
      if (!state.running) return;

      const fromX = state.x, fromY = state.y;
      const toX = clamp(fromX + dx, 0, gridSize - 1);
      const toY = clamp(fromY + dy, 0, gridSize - 1);

      // Log even if clamped (so you can see boundary attempts)
      logger.log({
        trial_index: state.trialIndex,
        event_type: "key",
        event_name: "move",
        key: keyName,
        from_x: fromX,
        from_y: fromY,
        to_x: toX,
        to_y: toY,
      });

      state.x = toX;
      state.y = toY;
      render();
    }

    function onKeyDown(e) {
      // Avoid interfering with typing fields (if any added later)
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea") return;

      switch (e.key) {
        case "ArrowUp":    e.preventDefault(); tryMove(0, -1, "ArrowUp"); break;
        case "ArrowDown":  e.preventDefault(); tryMove(0,  1, "ArrowDown"); break;
        case "ArrowLeft":  e.preventDefault(); tryMove(-1, 0, "ArrowLeft"); break;
        case "ArrowRight": e.preventDefault(); tryMove( 1, 0, "ArrowRight"); break;
        case "e":
        case "E": {
          e.preventDefault();
          logger.log({
            trial_index: state.trialIndex,
            event_type: "key",
            event_name: "action_e",
            key: e.key,
            from_x: state.x,
            from_y: state.y,
            to_x: state.x,
            to_y: state.y,
          });
          // Placeholder: later you can treat this as "go to next room"
          break;
        }
        default:
          break;
      }
    }

    // Initial log
    logger.log({
      trial_index: state.trialIndex,
      event_type: "system",
      event_name: "game_start",
      key: "",
      from_x: state.x,
      from_y: state.y,
      to_x: state.x,
      to_y: state.y,
    });

    window.addEventListener("keydown", onKeyDown);
    render();

    // Public API
    return {
      getState: () => ({ ...state }),
      destroy: () => {
        if (!state.running) return;
        state.running = false;
        window.removeEventListener("keydown", onKeyDown);
        logger.log({
          trial_index: state.trialIndex,
          event_type: "system",
          event_name: "game_destroy",
          key: "",
          from_x: state.x,
          from_y: state.y,
          to_x: state.x,
          to_y: state.y,
        });
        mount.innerHTML = "";
      },
    };
  }

  // Export
  window.startGame = startGame;
})();
