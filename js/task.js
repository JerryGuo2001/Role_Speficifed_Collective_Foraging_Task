/* ===========================
   task.js (short)
   - Minimal timeline glue only
   - All logging/CSV handled by DataSaver
   =========================== */

(function () {
  "use strict";

  let pid = null;
  let trial = 0;
  let game = null;
  let footerBound = false;

  const $ = (id) => document.getElementById(id);

  function showApp() {
    $("welcome").classList.add("hidden");
    $("app").classList.remove("hidden");
    $("footerControls").classList.remove("hidden");
  }

  function status(msg) {
    const el = $("status");
    if (el) el.textContent = msg;
  }

  function mountGame() {
    $("app").innerHTML = `<div id="gameMount"></div>`;
    if (game) game.destroy();

    game = window.startGame("gameMount", {
      participantId: pid,
      logger: window.DataSaver,
      trialIndex: trial,
      gridSize: 5,
      spawn: { x: 2, y: 2 },
      onEnd: ({ reason }) => {
        window.DataSaver.log({ trial_index: trial, event_type: "system", event_name: "phase_end", reason: reason || "" });
        trial += 1;
        showEnd();
      },
    });

    status(`Running. PID=${pid}`);
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

  // Public API used by index.html
  window.TaskController = {
    start(participantId) {
      pid = participantId;
      trial = 0;

      window.DataSaver.init(pid);
      window.DataSaver.log({ trial_index: 0, event_type: "ui", event_name: "click_start" });

      showApp();
      bindFooterOnce();
      mountGame();
    },
  };
})();
