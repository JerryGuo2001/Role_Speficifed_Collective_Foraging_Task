/* ===========================
   task.js (auto flow) — FULL REPLACEMENT (TASK.JS ONLY)

   - Start button -> (optional) practice -> main_phase.js startGame()
   - Auto-download CSV at the end
   - Provides 9 UNIQUE maps (3 demos + 6 main) via explicit list OR manifest

   REQUIREMENTS (HTML):
     - An input with id="participantIdInput"
     - A start button with id="startBtn" (or "startButton")
     - A container with id="game" (or "gameContainer"/"gameMount"/"main"/"content")
     - Optional: a div with id="thankyou" to show at the end
   =========================== */

(function () {
  "use strict";

  // ----------------------------
  // MAPS: provide 9 UNIQUE maps total
  //  - First 3: observation demos (pair 1/2/3)
  //  - Next 6: main repetitions (rep 1..6)
  // Put these files under ./gridworld/
  // ----------------------------

  // Option A (recommended): explicit list of 9 maps (order fixed)
const GRIDWORLD_DIR = "./gridworld/";

const GRID_MAP_CSVS = [
  "high_reward_high_risk_01.csv",
  "high_reward_middle_risk_01.csv",
  "high_reward_low_risk_01.csv",
  "middle_reward_high_risk_01.csv",
  "middle_reward_middle_risk_01.csv",
  "middle_reward_middle_risk_02.csv",
  "middle_reward_low_risk_01.csv",
  "low_reward_high_risk_01.csv",
  "low_reward_middle_risk_01.csv",
  "low_reward_low_risk_01.csv",
  "very_low_reward_low_risk_01.csv",
].map((f) => GRIDWORLD_DIR + f);

  // Option B (fallback): manifest file (only used if GRID_MAP_CSVS is null)
  // Create: ./gridworld/maps_manifest.json
  // Format: ["grid_map01.csv", ...] OR {"files":["grid_map01.csv", ...]}
  const MAP_MANIFEST_URL = GRIDWORLD_DIR + "maps_manifest.json";

  // ----------------------------
  // SETTINGS
  // ----------------------------
  const DEBUG_SKIP_PRACTICE = false;

  const REPS = 6;
  const ROUNDS_PER_REP = 10;

  const DEMO_ROUNDS = 5; // each demo pair plays 5 rounds
  const MAX_MOVES_PER_TURN = 5;

  const MODEL_MOVE_MS = 900;
  const HUMAN_IDLE_TIMEOUT_MS = 10000;

  // ----------------------------
  // DOM helpers
  // ----------------------------
  const $ = (id) => document.getElementById(id);

  function requestFullscreenSafe() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
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

  function disableNoScroll() {
    document.documentElement.classList.remove("noScroll");
    document.body.classList.remove("noScroll");
  }

  function getMountEl() {
    return $("game") || $("gameContainer") || $("gameMount") || $("main") || $("content");
  }

  // ----------------------------
  // CSV export (minimal, robust)
  // ----------------------------
  function escapeCSV(v) {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function toCSV(rows) {
    if (!rows || !rows.length) return "empty\n";
    const keys = [];
    const seen = new Set();
    for (const r of rows) {
      for (const k of Object.keys(r)) {
        if (!seen.has(k)) {
          seen.add(k);
          keys.push(k);
        }
      }
    }
    const head = keys.join(",");
    const lines = rows.map((r) => keys.map((k) => escapeCSV(r[k])).join(","));
    return [head, ...lines].join("\n") + "\n";
  }

  function downloadText(text, filename) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function downloadCSV(rows, filename) {
    downloadText(toCSV(rows), filename);
  }

  // ----------------------------
  // Participant data + logger
  // ----------------------------
  const participantData = {
    id: null,
    startTime: null,
    trials: [],
  };

  const logger = {
    log: (evt) => {
      participantData.trials.push({
        pid: participantData.id || "",
        t_ms: performance.now(),
        ...evt,
      });
    },
  };

  // ----------------------------
  // Practice launcher (optional)
  // ----------------------------
  async function runPracticeIfAvailable() {
    if (DEBUG_SKIP_PRACTICE) return;

    // If you have practice exposed as:
    //   window.PracticePhase.start({ onDone })
    // OR window.practiceStart({ onDone })
    // then we'll run it; otherwise no-op.
    if (window.PracticePhase && typeof window.PracticePhase.start === "function") {
      await new Promise((resolve) => window.PracticePhase.start({ onDone: resolve }));
      return;
    }
    if (typeof window.practiceStart === "function") {
      await new Promise((resolve) => window.practiceStart({ onDone: resolve }));
      return;
    }
  }

  // ----------------------------
  // Main start
  // ----------------------------
  async function startFlow() {
    const idInput = $("participantIdInput");
    const startBtn = $("startBtn") || $("startButton");

    const pid = idInput ? idInput.value.trim() : "";
    if (!pid) {
      alert("Please enter your participant ID.");
      return;
    }

    participantData.id = pid;
    participantData.startTime = performance.now();
    participantData.trials = [];

    requestFullscreenSafe();
    enableNoScroll();

    // Hide welcome if present
    const welcome = $("welcome");
    if (welcome) welcome.style.display = "none";

    // Practice first
    try {
      logger.log({ event_type: "system", event_name: "practice_begin" });
      await runPracticeIfAvailable();
      logger.log({ event_type: "system", event_name: "practice_end" });
    } catch (err) {
      logger.log({
        event_type: "system",
        event_name: "practice_error",
        error: String(err && err.message ? err.message : err),
      });
      // continue anyway
    }

    // Start main game
    const mount = getMountEl();
    if (!mount) {
      alert("Internal error: cannot find game mount element (expected #game or #gameContainer).");
      disableNoScroll();
      return;
    }

    logger.log({ event_type: "system", event_name: "main_begin" });

    if (typeof window.startGame !== "function") {
      alert("Internal error: startGame() not found. Make sure main_phase.js is loaded before task.js.");
      disableNoScroll();
      return;
    }

    // Use explicit list (fixed order). If you want manifest instead, set GRID_MAP_CSVS to null.
    const mapCsvPaths = Array.isArray(GRID_MAP_CSVS) && GRID_MAP_CSVS.length ? GRID_MAP_CSVS : null;

    window.startGame(mount, {
      participantId: participantData.id,
      logger,
      trialIndex: 0,

      repetitions: REPS,
      roundsPerRep: ROUNDS_PER_REP,
      observationRoundsPerDemo: DEMO_ROUNDS,

      maxMovesPerTurn: MAX_MOVES_PER_TURN,
      modelMoveMs: MODEL_MOVE_MS,
      humanIdleTimeoutMs: HUMAN_IDLE_TIMEOUT_MS,

      mapCsvPaths,
      mapManifestUrl: MAP_MANIFEST_URL,
      shuffleMaps: false, // keep your explicit order stable

      onEnd: ({ reason } = {}) => {
        logger.log({
          event_type: "system",
          event_name: "main_end",
          reason: reason || "",
        });

        try {
          const fn = `data_${participantData.id}.csv`;
          downloadCSV(participantData.trials, fn);
        } catch (err) {
          console.error(err);
          alert("Failed to download CSV. Check console.");
        } finally {
          disableNoScroll();
        }

        const thanks = $("thankyou");
        if (thanks) thanks.style.display = "block";
      },
    });

    // prevent double-start
    if (startBtn) startBtn.disabled = true;
  }

  // ----------------------------
  // Hook up start button
  // ----------------------------
  window.addEventListener("load", () => {
    const startBtn = $("startBtn") || $("startButton");
    if (startBtn) startBtn.addEventListener("click", startFlow);
  });

  // Expose for debugging
  window.__gridTask = { startFlow, participantData };
})();
