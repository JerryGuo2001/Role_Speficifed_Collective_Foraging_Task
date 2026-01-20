/* ===========================
   task.js (short + randomized role)
   - Randomly assigns participant role: forager or security
   - Shows role at the beginning
   - All logging/CSV handled by DataSaver
   =========================== */

(function () {
  "use strict";

  let pid = null;
  let trial = 0;
  let game = null;
  let footerBound = false;
  let humanAgent = "forager";

  const $ = (id) => document.getElementById(id);

  function status(msg) {
    const el = $("status");
    if (el) el.textContent = msg;
  }

  function showApp() {
    $("welcome").classList.add("hidden");
    $("app").classList.remove("hidden");
    $("footerControls").classList.remove("hidden");
  }

  function bindFooterOnce() {
    if (footerBound) return;
    footerBound = true;

    $("downloadBtn").onclick = () => {
      window.DataSaver.log({ trial_index: trial, event_type: "ui", event_name: "click_download_csv" });
      window.DataSaver.downloadCSV();
      status("CSV downloaded.");
    };

    $("endBtn").onclick = () => {
      window.DataSaver.log({ trial_index: trial, event_type: "ui", event_name: "click_end_session" });
      if (game) game.destroy();
      game = null;
      window.DataSaver.log({ trial_index: trial, event_type: "system", event_name: "session_end" });
      $("app").innerHTML = "";
      status("Session ended.");
    };
  }

  function mountGame() {
    $("app").innerHTML = `<div id="gameMount"></div>`;
    if (game) game.destroy();

    game = window.startGame("gameMount", {
      participantId: pid,
      logger: window.DataSaver,
      trialIndex: trial,

      // role assignment
      humanAgent: humanAgent,

      // optional: keep placeholder policies explicit
      policies: {
        forager: { name: "idle", nextAction: () => null },
        security: { name: "idle", nextAction: () => null },
      },

      onEnd: ({ reason }) => {
        window.DataSaver.log({ trial_index: trial, event_type: "system", event_name: "phase_end", reason: reason || "" });
        trial += 1;
        showEnd();
      },
    });

    status(`Running. PID=${pid}. You are: ${humanAgent}`);
  }

  function showRoleReveal() {
    const roleName = humanAgent === "forager" ? "Forager (Green)" : "Security (Yellow)";

    $("app").innerHTML = `
      <div style="background:#fff;border:1px solid #e6e6e6;border-radius:12px;padding:18px;box-shadow:0 1px 2px rgba(0,0,0,.04);max-width:720px;">
        <h2>Your Role</h2>
        <p style="color:#666;font-size:14px;margin-top:6px;">
          You have been assigned to:
        </p>
        <div style="font-weight:800;font-size:20px;margin:10px 0 14px 0;">
          ${roleName}
        </div>
        <button id="beginBtn"
          style="padding:10px 14px;border-radius:10px;border:1px solid #111;background:#111;color:#fff;cursor:pointer;font-size:15px;">
          Begin
        </button>
      </div>
    `;

    $("beginBtn").onclick = () => {
      window.DataSaver.log({ trial_index: trial, event_type: "ui", event_name: "click_begin_after_role", assigned_role: humanAgent });
      mountGame();
    };

    status(`Role assigned: ${roleName}`);
  }

  function showEnd() {
    $("app").innerHTML = `
      <div style="background:#fff;border:1px solid #e6e6e6;border-radius:12px;padding:18px;box-shadow:0 1px 2px rgba(0,0,0,.04);">
        <h2>Session Complete</h2>
        <p style="color:#666;font-size:14px;">Download your CSV or end the session.</p>
        <button id="endDownloadBtn"
          style="padding:10px 14px;border-radius:10px;border:1px solid #ccc;background:#fff;cursor:pointer;font-size:15px;">
          Download CSV
        </button>
      </div>
    `;

    $("endDownloadBtn").onclick = () => {
      window.DataSaver.log({ trial_index: trial, event_type: "ui", event_name: "click_download_csv_end_screen" });
      window.DataSaver.downloadCSV();
      status("CSV downloaded.");
    };

    status("Complete.");
  }

  function randomizeRole() {
    // 50/50 assignment
    humanAgent = (Math.random() < 0.5) ? "forager" : "security";

    window.DataSaver.log({
      trial_index: 0,
      event_type: "system",
      event_name: "role_assigned",
      assigned_role: humanAgent,
      rng: "Math.random_50_50",
    });
  }

  // Public API used by index.html
  window.TaskController = {
    start(participantId) {
      pid = participantId;
      trial = 0;

      window.DataSaver.init(pid);
      window.DataSaver.log({ trial_index: 0, event_type: "ui", event_name: "click_start" });

      showApp();
      bindFooterOnce();

      randomizeRole();
      showRoleReveal();
    },
  };
})();
