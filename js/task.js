/* ===========================
   task.js (auto flow) — UPDATED
   - Randomize role
   - PRACTICE FIRST (no role banner yet)
   - THEN show role banner
   - THEN main_phase.js game
   - Auto-download CSV on end
   =========================== */

(function () {
  "use strict";

  let pid = null;
  let game = null;
  let practice = null;
  let humanAgent = "forager";

  // How long to show the role banner (ms)
  const ROLE_BANNER_MS = 2000; // CHANGED: longer role message

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

  function randomizeRole() {
    humanAgent = (Math.random() < 0.5) ? "forager" : "security";
    window.DataSaver.log({
      trial_index: 0,
      event_type: "system",
      event_name: "role_assigned",
      assigned_role: humanAgent,
      rng: "Math.random_50_50",
    });
  }

  // CHANGED: role banner is now shown AFTER practice, right before main_phase
  function showRoleThenMain() {
    const roleName = humanAgent === "forager" ? "Forager (Green)" : "Security (Yellow)";

    $("app").innerHTML = `
      <div style="
        background:#fff;border:1px solid #e6e6e6;border-radius:12px;
        padding:18px;box-shadow:0 1px 2px rgba(0,0,0,.04);
        width:min(520px, 92vw);
      ">
        <h2>Your Role</h2>
        <div style="font-weight:800;font-size:20px;margin:10px 0 6px 0;">${roleName}</div>
        <div style="color:#666;font-size:14px;">Main task starts automatically...</div>
      </div>
    `;

    setTimeout(() => startGame(), ROLE_BANNER_MS);
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

        // CHANGED: show role right before main game (not before practice)
        showRoleThenMain();
      },
    });
  }

  function startGame() {
    $("app").innerHTML = `<div id="gameMount" style="width:100%;height:100%;"></div>`;
    if (game && game.destroy) game.destroy();

    game = window.startGame("gameMount", {
      participantId: pid,
      logger: window.DataSaver,
      trialIndex: 0,

      // IMPORTANT: pass the already-randomized role so main_phase does NOT re-randomize
      humanAgent: humanAgent,

      totalRounds: 10,
      modelMoveMs: 1000,

      policies: {
        forager: {
          name: "random_direction",
          nextAction: () => {
            const m = [
              { dx: 0, dy: -1, label: "ArrowUp" },
              { dx: 0, dy:  1, label: "ArrowDown" },
              { dx: -1, dy: 0, label: "ArrowLeft" },
              { dx:  1, dy: 0, label: "ArrowRight" },
            ];
            return m[Math.floor(Math.random() * m.length)];
          }
        },
        security: {
          name: "random_direction",
          nextAction: () => {
            const m = [
              { dx: 0, dy: -1, label: "ArrowUp" },
              { dx: 0, dy:  1, label: "ArrowDown" },
              { dx: -1, dy: 0, label: "ArrowLeft" },
              { dx:  1, dy: 0, label: "ArrowRight" },
            ];
            return m[Math.floor(Math.random() * m.length)];
          }
        },
      },

      onEnd: ({ reason }) => {
        window.DataSaver.log({
          trial_index: 0,
          event_type: "system",
          event_name: "task_end",
          reason: reason || ""
        });

        window.DataSaver.downloadCSV();

        $("app").innerHTML = `
          <div style="
            background:#fff;border:1px solid #e6e6e6;border-radius:12px;
            padding:18px;box-shadow:0 1px 2px rgba(0,0,0,.04);
            width:min(520px, 92vw);
          ">
            <h2>Finished</h2>
            <div style="color:#666;font-size:14px;">Your CSV was downloaded automatically.</div>
          </div>
        `;
      },
    });
  }

  window.TaskController = {
    start(participantId) {
      pid = participantId;

      enableNoScroll();
      requestFullscreenSafe();

      window.DataSaver.init(pid);
      window.DataSaver.log({ trial_index: 0, event_type: "ui", event_name: "click_start" });

      showApp();
      randomizeRole();
      startPracticePhase();
    },
  };
})();
