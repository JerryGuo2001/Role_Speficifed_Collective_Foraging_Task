/* ===========================
   task.js (auto flow)
   - Randomize role
   - Auto-run rounds (handled by main_phase.js)
   - Auto-download CSV on end
   - Fullscreen + no scrolling during task
   =========================== */

(function () {
  "use strict";

  let pid = null;
  let game = null;
  let humanAgent = "forager";

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
    // Hide welcome
    $("welcome").classList.add("hidden");

    // Make app a fullscreen overlay
    const app = $("app");
    app.classList.add("fullscreen");
    app.innerHTML = ""; // clear mount
  }

  function showRoleThenStart() {
    const roleName = humanAgent === "forager" ? "Forager (Green)" : "Security (Yellow)";
    $("app").innerHTML = `
      <div style="
        background:#fff;border:1px solid #e6e6e6;border-radius:12px;
        padding:18px;box-shadow:0 1px 2px rgba(0,0,0,.04);
        width:min(520px, 92vw);
      ">
        <h2>Your Role</h2>
        <div style="font-weight:800;font-size:20px;margin:10px 0 6px 0;">${roleName}</div>
        <div style="color:#666;font-size:14px;">Starting automatically...</div>
      </div>
    `;

    setTimeout(() => startGame(), 900);
  }

  function startGame() {
    $("app").innerHTML = `<div id="gameMount" style="width:100%;height:100%;"></div>`;
    if (game) game.destroy();

    game = window.startGame("gameMount", {
      participantId: pid,
      logger: window.DataSaver,
      trialIndex: 0,

      humanAgent: humanAgent,

      // CHANGED: 10 rounds
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

  window.TaskController = {
    start(participantId) {
      pid = participantId;

      // Must happen on user gesture (Start click) for best fullscreen compatibility
      enableNoScroll();
      requestFullscreenSafe();

      window.DataSaver.init(pid);
      window.DataSaver.log({ trial_index: 0, event_type: "ui", event_name: "click_start" });

      showApp();
      randomizeRole();
      showRoleThenStart();
    },
  };
})();
