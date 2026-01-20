/* ===========================
   task.js (auto flow)
   - Randomize role
   - Auto-run 20 rounds (handled by main_phase.js)
   - Auto-download CSV on end
   =========================== */

(function () {
  "use strict";

  let pid = null;
  let game = null;
  let humanAgent = "forager";

  const $ = (id) => document.getElementById(id);

  function showApp() {
    $("welcome").classList.add("hidden");
    $("app").classList.remove("hidden");
    // keep footer hidden (no manual download/end)
    $("footerControls").classList.add("hidden");
  }

  function showRoleThenStart() {
    const roleName = humanAgent === "forager" ? "Forager (Green)" : "Security (Yellow)";
    $("app").innerHTML = `
      <div style="background:#fff;border:1px solid #e6e6e6;border-radius:12px;padding:18px;box-shadow:0 1px 2px rgba(0,0,0,.04);max-width:720px;">
        <h2>Your Role</h2>
        <div style="font-weight:800;font-size:20px;margin:10px 0 6px 0;">${roleName}</div>
        <div style="color:#666;font-size:14px;">Starting automatically...</div>
      </div>
    `;

    // short reveal, then start
    setTimeout(() => startGame(), 1200);
  }

  function startGame() {
    $("app").innerHTML = `<div id="gameMount"></div>`;
    if (game) game.destroy();

    game = window.startGame("gameMount", {
      participantId: pid,
      logger: window.DataSaver,
      trialIndex: 0,

      humanAgent: humanAgent,

      // 20 rounds, model move timing
      totalRounds: 20,
      modelMoveMs: 1000,

      // placeholder policies (random direction for both if model-controlled)
      policies: {
        forager: { name: "random_direction", nextAction: () => {
          const m = [
            { dx: 0, dy: -1, label: "ArrowUp" },
            { dx: 0, dy:  1, label: "ArrowDown" },
            { dx: -1, dy: 0, label: "ArrowLeft" },
            { dx:  1, dy: 0, label: "ArrowRight" },
          ];
          return m[Math.floor(Math.random() * m.length)];
        }},
        security: { name: "random_direction", nextAction: () => {
          const m = [
            { dx: 0, dy: -1, label: "ArrowUp" },
            { dx: 0, dy:  1, label: "ArrowDown" },
            { dx: -1, dy: 0, label: "ArrowLeft" },
            { dx:  1, dy: 0, label: "ArrowRight" },
          ];
          return m[Math.floor(Math.random() * m.length)];
        }},
      },

      onEnd: ({ reason }) => {
        window.DataSaver.log({ trial_index: 0, event_type: "system", event_name: "task_end", reason: reason || "" });
        window.DataSaver.downloadCSV();

        $("app").innerHTML = `
          <div style="background:#fff;border:1px solid #e6e6e6;border-radius:12px;padding:18px;box-shadow:0 1px 2px rgba(0,0,0,.04);max-width:720px;">
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

      window.DataSaver.init(pid);
      window.DataSaver.log({ trial_index: 0, event_type: "ui", event_name: "click_start" });

      showApp();
      randomizeRole();
      showRoleThenStart();
    },
  };
})();
