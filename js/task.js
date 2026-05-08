/* ===========================
   task.js (auto flow) — CLEAN
   - PRACTICE FIRST
   - THEN main_phase.js (which includes observation + choice + main)
   - Auto-download CSV on end
   =========================== */

(function () {
  "use strict";

  let pid = null;
  let game = null;
  let practice = null;

  const DEBUG_SKIP_PRACTICE = flase;
  let DEBUG_MAIN_PHASE = true;
  let totaltrial
  if (DEBUG_MAIN_PHASE){
    totaltrial=1
  }else{
    totaltrial=12
  }

  // Turn observation phase on/off here.
  // true  = show observation intro + 3 demo teams
  // false = skip observation and go directly to team choice
  const ENABLE_OBSERVATION_PHASE = true;

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


  function ensureParticipantData() {
    let pd = window.participantData && typeof window.participantData === "object" ? window.participantData : {};
    window.participantData = pd;
    if (!pd.id && pid) pd.id = pid;
    if (!pd.startTime) pd.startTime = performance.now();
    if (!Array.isArray(pd.trials)) pd.trials = [];
    return pd;
  }

  function logSafe(row) {
    if (!window.DataSaver || typeof window.DataSaver.log !== "function") return;
    try {
      window.DataSaver.log(row);
    } catch (err) {
      console.warn("DataSaver.log failed", err);
    }
  }

  function forwardSurveyRowsToDataSaver(rows) {
    if (!rows || !rows.length || !window.DataSaver || typeof window.DataSaver.log !== "function") return;
    const pd = ensureParticipantData();

    for (const row of rows) {
      if (!row || typeof row !== "object") continue;

      const beforeLen = Array.isArray(pd.trials) ? pd.trials.length : 0;
      const out = {
        trial_index: row.trial_index || beforeLen + 1,
        event_type: row.event_type || "survey",
        event_name: row.event_name || row.trial_type || row.survey_name || "survey_row",
        ...row,
      };

      try {
        window.DataSaver.log(out);
      } catch (err) {
        console.warn("Could not forward survey row to DataSaver", err);
      }

      // If DataSaver.log writes into participantData.trials, remove that forwarded
      // duplicate and keep only the original survey-created row in participantData.
      if (Array.isArray(pd.trials) && pd.trials.length > beforeLen) {
        pd.trials.splice(beforeLen, pd.trials.length - beforeLen);
      }
    }
  }

  function runSurvey(starterName, surveyLabel, options) {
    return new Promise((resolve) => {
      ensureParticipantData();
      const starter = window[starterName];

      if (typeof starter !== "function") {
        logSafe({
          trial_index: 0,
          event_type: "system",
          event_name: "survey_skipped_missing_script",
          survey_name: surveyLabel,
          starter_name: starterName,
        });
        resolve();
        return;
      }

      const beforeLen = window.participantData.trials.length;
      let finished = false;

      const done = () => {
        if (finished) return;
        finished = true;
        const pd = ensureParticipantData();
        const newRows = Array.isArray(pd.trials) ? pd.trials.slice(beforeLen) : [];
        forwardSurveyRowsToDataSaver(newRows);
        logSafe({
          trial_index: 0,
          event_type: "system",
          event_name: "survey_finished",
          survey_name: surveyLabel,
          survey_rows_added: newRows.length,
        });
        resolve();
      };

      try {
        starter(done, options || {});
      } catch (err) {
        logSafe({
          trial_index: 0,
          event_type: "system",
          event_name: "survey_error",
          survey_name: surveyLabel,
          error_message: err && err.message ? err.message : String(err),
        });
        resolve();
      }
    });
  }

  async function runPostTaskSurveysThenSave(reason) {
    ensureParticipantData();

    $("app").innerHTML = `
      <div style="
        background:#fff;border:1px solid #e6e6e6;border-radius:12px;
        padding:18px;box-shadow:0 1px 2px rgba(0,0,0,.04);
        width:min(560px, 92vw);
        margin:auto;
      ">
        <h2>Surveys</h2>
        <div style="color:#666;font-size:14px;line-height:1.5;">
          Please complete the surveys. The CSV will download after all surveys are finished.
        </div>
      </div>
    `;

    logSafe({
      trial_index: 0,
      event_type: "system",
      event_name: "post_task_surveys_start",
      task_end_reason: reason || "",
    });

    await runSurvey("startNeedForCognitionSurvey", "need_for_cognition", {
      title: "Survey",
      subtitle: "Need for Cognition",
    });

    await runSurvey("startBISBASSurvey", "bis_bas", {
      title: "Survey",
      subtitle: "BIS/BAS",
    });

    await runSurvey("startFiveDCRSurvey", "five_dcr", {
      title: "Survey",
      subtitle: "Five-Dimensional Curiosity Scale Revised (5DCR)",
    });

    await runSurvey("startDemographicsSurvey", "final_survey", {
      title: "Survey",
      subtitle: "Demographic and Final Questions",
    });

    logSafe({
      trial_index: 0,
      event_type: "system",
      event_name: "post_task_surveys_end",
    });

    if (window.DataSaver && typeof window.DataSaver.downloadCSV === "function") {
      window.DataSaver.downloadCSV();
    }

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

  function startMainGame() {
    $("app").innerHTML = `<div id="gameMount" style="width:100%;height:100%;"></div>`;
    if (game && game.destroy) game.destroy();

    game = window.startGame("gameMount", {
      participantId: pid,
      logger: window.DataSaver,
      trialIndex: 0,

            // NEW: maps
      observationMapCsvs: [
        "./gridworld//middle_reward_middle_risk_01.csv",
        "./gridworld/middle_reward_middle_risk_02.csv",
        "./gridworld/middle_reward_middle_risk_03.csv",
      ],

      mainMapCsvs: [
        "./gridworld//low_reward_low_risk_01.csv", //Q1
        "./gridworld/middle_reward_middle_risk_04.csv", //Q2
        "./gridworld/middle_reward_middle_risk_05.csv", //Q3
        "./gridworld//high_reward_high_risk_01.csv", //Q4
        "./gridworld/high_reward_high_risk_02.csv", //Q5
        "./gridworld/middle_reward_middle_risk_06.csv", //Q6
        "./gridworld//low_reward_low_risk_02.csv", //Q7
        "./gridworld//high_reward_high_risk_03.csv", //Q8
        "./gridworld//low_reward_low_risk_03.csv", //Q9
        "./gridworld//middle_reward_middle_risk_07.csv", //Q10
        "./gridworld//high_reward_high_risk_04.csv", //Q11
        "./gridworld//low_reward_low_risk_04.csv", //Q12
      ],

      repetitions: totaltrial,
      roundsPerRep: 15,

      // observation config
      enableObservationPhase: ENABLE_OBSERVATION_PHASE,
      observationRoundsPerDemo: 5,

      modelMoveMs: 900,

      onEnd: ({ reason }) => {
        window.DataSaver.log({
          trial_index: 0,
          event_type: "system",
          event_name: "task_end",
          reason: reason || "",
        });

        runPostTaskSurveysThenSave(reason || "");
      },
    });
  }

  window.TaskController = {
    start(participantId) {
      pid = participantId;

      enableNoScroll();
      requestFullscreenSafe();

      window.DataSaver.init(pid);
      ensureParticipantData();
      window.DataSaver.log({ trial_index: 0, event_type: "ui", event_name: "click_start" });

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
