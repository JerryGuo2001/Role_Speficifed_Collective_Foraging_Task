/* ===========================
   task.js
   - Controls timeline flow
   - Calls startGame() to mount the game
   - Owns logger + CSV download
   =========================== */

(function () {
  "use strict";

  const TaskController = {
    participantId: null,
    logger: null,
    trialIndex: 0,
    gameHandle: null,

    start(participantId) {
      this.participantId = participantId;
      this.logger = new window.CsvLogger({ participantId });
      this.trialIndex = 0;

      // Log start click
      this.logger.log({
        trial_index: this.trialIndex,
        event_type: "ui",
        event_name: "click_start",
        key: "",
        from_x: "",
        from_y: "",
        to_x: "",
        to_y: "",
      });

      // Toggle UI
      document.getElementById("welcome").classList.add("hidden");
      document.getElementById("app").classList.remove("hidden");
      document.getElementById("footerControls").classList.remove("hidden");

      // Wire footer
      this._wireFooterButtons();

      // Start timeline
      this._runMainPhase();
      this._setStatus(`Running. PID=${participantId}`);
    },

    _wireFooterButtons() {
      const downloadBtn = document.getElementById("downloadBtn");
      const endBtn = document.getElementById("endBtn");

      // Remove existing listeners by cloning (simple, clean)
      const d2 = downloadBtn.cloneNode(true);
      downloadBtn.parentNode.replaceChild(d2, downloadBtn);

      const e2 = endBtn.cloneNode(true);
      endBtn.parentNode.replaceChild(e2, endBtn);

      d2.addEventListener("click", () => {
        this.logger.log({
          trial_index: this.trialIndex,
          event_type: "ui",
          event_name: "click_download_csv",
          key: "",
          from_x: "",
          from_y: "",
          to_x: "",
          to_y: "",
        });
        this.downloadCSV();
      });

      e2.addEventListener("click", () => {
        this.logger.log({
          trial_index: this.trialIndex,
          event_type: "ui",
          event_name: "click_end_session",
          key: "",
          from_x: "",
          from_y: "",
          to_x: "",
          to_y: "",
        });
        this.endSession();
      });
    },

    _runMainPhase() {
      const app = document.getElementById("app");
      app.innerHTML = ""; // clean mount

      // Create container div for game
      const gameDiv = document.createElement("div");
      gameDiv.id = "gameMount";
      app.appendChild(gameDiv);

      // Destroy prior handle if any
      if (this.gameHandle) this.gameHandle.destroy();

      this.gameHandle = window.startGame("gameMount", {
        participantId: this.participantId,
        logger: this.logger,
        trialIndex: this.trialIndex,
        gridSize: 5,
        spawn: { x: 2, y: 2 },
        onEnd: ({ reason }) => {
          // Next clicked inside game
          this.logger.log({
            trial_index: this.trialIndex,
            event_type: "system",
            event_name: "phase_end",
            key: "",
            from_x: "",
            from_y: "",
            to_x: "",
            to_y: "",
            reason: reason || "",
          });

          // Simple timeline: increment trial or end
          this.trialIndex += 1;

          // For now: end after 1 trial. Extend here for more trials.
          this._showEndScreen();
        },
      });
    },

    _showEndScreen() {
      const app = document.getElementById("app");
      app.innerHTML = "";

      const card = document.createElement("div");
      card.style.cssText = "background:#fff;border:1px solid #e6e6e6;border-radius:12px;padding:18px;box-shadow:0 1px 2px rgba(0,0,0,.04);";
      card.innerHTML = `
        <h2>Session Complete</h2>
        <p style="color:#666;font-size:14px;">
          You can download your CSV now. You may also end the session.
        </p>
        <button id="endDownloadBtn" style="padding:10px 14px;border-radius:10px;border:1px solid #ccc;background:#fff;cursor:pointer;font-size:15px;">
          Download CSV
        </button>
      `;
      app.appendChild(card);

      const btn = document.getElementById("endDownloadBtn");
      btn.addEventListener("click", () => {
        this.logger.log({
          trial_index: this.trialIndex,
          event_type: "ui",
          event_name: "click_download_csv_end_screen",
          key: "",
          from_x: "",
          from_y: "",
          to_x: "",
          to_y: "",
        });
        this.downloadCSV();
      });

      this._setStatus("Complete. Please download CSV.");
    },

    downloadCSV() {
      const csv = this.logger.toCSV();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      const safePid = String(this.participantId || "unknown").replaceAll(/[^a-zA-Z0-9_-]/g, "_");
      a.href = url;
      a.download = `gridgame_${safePid}_${new Date().toISOString().replaceAll(/[:.]/g, "-")}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);
      this._setStatus("CSV downloaded.");
    },

    endSession() {
      if (this.gameHandle) {
        this.gameHandle.destroy();
        this.gameHandle = null;
      }

      this.logger.log({
        trial_index: this.trialIndex,
        event_type: "system",
        event_name: "session_end",
        key: "",
        from_x: "",
        from_y: "",
        to_x: "",
        to_y: "",
      });

      const app = document.getElementById("app");
      app.innerHTML = "";

      this._setStatus("Session ended.");
    },

    _setStatus(msg) {
      const el = document.getElementById("status");
      if (el) el.textContent = msg;
    },
  };

  window.TaskController = TaskController;
})();
