/* ===========================
   task.js (auto flow) — CLEAN
   - PRACTICE FIRST
   - THEN main_phase.js game
   - main_phase handles: 6-round roster schedule + per-round role banner
   - Auto-download CSV on end

   DEBUG:
     * if true, skip PRACTICE and go straight to main game
   =========================== */

(function () {
  "use strict";

  let pid = null;
  let game = null;
  let practice = null;

  const DEBUG_SKIP_PRACTICE = false;

  const $ = (id) => document.getElementById(id);

  function requestFullscreenSafe() {
    const el = document.documentElement;
    const req =
      el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      el.msRequestFullscreen;

    if (!req) return;
    try {
      const p = req.call(el);
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (_) {}
  }

  function enableNoScroll() {
    document.documentElement.classList.add("noScroll");
    document.body.classList.add("noScroll");
  }

  function showApp() {
    $("welcome").classList.add("hidden");
    const app = $("app");
    app.classList.add("fullscreen");
    app.innerHTML = "";
  }

  function startMainGame() {
    $("app").innerHTML = `<div id="gameMount" style="width:100%;height:100%;"></div>`;
    if (game && game.destroy) game.destroy();

    game = window.startGame("gameMount", {
      participantId: pid,
      logger: window.DataSaver,
      trialIndex: 0,

      // You asked for 6 big rounds total
      totalRounds: 6,

      // Model step timing
      modelMoveMs: 1000,

      onEnd: ({ reason }) => {
        window.DataSaver.log({
          trial_index: 0,
          event_type: "system",
          event_name: "task_end",
          reason: reason || "",
        });

        window.DataSaver.downloadCSV();

        $("app").innerHTML = `
          <div style="
            background:#fff;border:1px solid #e6e6e6;border-radius:12px;
            padding:18px;box-shadow:0 1px 2px rgba(0,0,0,.04);
            width:min(520px, 92vw);
            margin:auto;
          ">
            <h2>Finished</h2>
            <div style="color:#666;font-size:14px;">Your CSV was downloaded automatically.</div>
          </div>
        `;
      },
    });
  }

  function startPracticePhase() {
    $("app").innerHTML = `<div id="practiceMount" style="width:100%;height:100%;"></div>`;

    if (practice && practice.destroy) practice.destroy();

    practice = window.startPractice("practiceMount", {
      participantId: pid,
      logger: window.DataSaver,
      trialIndex: 0,
      onEnd: ({ reason }) => {
        window.DataSaver.log({
          trial_index: 0,
          event_type: "system",
          event_name: "practice_end",
          reason: reason || "completed",
        });
        startMainGame();
      },
    });
  }

  window.TaskController = {
    start(participantId) {
      pid = participantId;

      enableNoScroll();
      requestFullscreenSafe();

      window.DataSaver.init(pid);
      window.DataSaver.log({
        trial_index: 0,
        event_type: "ui",
        event_name: "click_start",
      });

      showApp();

      if (DEBUG_SKIP_PRACTICE) {
        window.DataSaver.log({
          trial_index: 0,
          event_type: "system",
          event_name: "debug_skip_practice",
          debug_skip_practice: 1,
        });
        startMainGame();
        return;
      }

      startPracticePhase();
    },
  };
})();
