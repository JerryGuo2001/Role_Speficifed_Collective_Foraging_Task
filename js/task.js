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

  const DEBUG_SKIP_PRACTICE = false;
  let DEBUG_MAIN_PHASE = true;
  let totaltrial, observationtotalrounds
  if (DEBUG_MAIN_PHASE){
    totaltrial=1
    observationtotalrounds=5
  }else{
    totaltrial=12
    observationtotalrounds=8
  }

  // Turn observation phase on/off here.
  // true  = show observation intro + 3 demo teams
  // false = skip observation and go directly to team choice
  const ENABLE_OBSERVATION_PHASE = true;

  const REWARD_SOUND_URLS = {
    high: "./Sound/high_reward.mp4",
    mid: "./Sound/mid_reward.mp4",
    low: "./Sound/low_reward.mp4",
  };

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

  function ensureRewardAudio() {
    if (window.TaskRewardAudio && typeof window.TaskRewardAudio === "object") return window.TaskRewardAudio;

    const makeAudio = (src) => {
      const audio = new Audio(src);
      audio.preload = "auto";
      audio.playsInline = true;
      audio.volume = 1;
      return audio;
    };

    const tracks = {
      high: makeAudio(REWARD_SOUND_URLS.high),
      mid: makeAudio(REWARD_SOUND_URLS.mid),
      low: makeAudio(REWARD_SOUND_URLS.low),
    };

    window.TaskRewardAudio = {
      enabled: false,
      tracks,
      keyForReward(goldDelta) {
        if (Number(goldDelta) === 10) return "high";
        if (Number(goldDelta) === 5) return "mid";
        if (Number(goldDelta) === 2) return "low";
        return "";
      },
      async unlock() {
        const results = await Promise.all(Object.values(tracks).map(async (audio) => {
          try {
            audio.muted = true;
            audio.currentTime = 0;
            const playResult = audio.play();
            if (playResult && typeof playResult.then === "function") await playResult;
            audio.pause();
            audio.currentTime = 0;
            audio.muted = false;
            return true;
          } catch (err) {
            audio.muted = false;
            console.warn("Could not unlock reward sound", err);
            return false;
          }
        }));
        this.enabled = results.some(Boolean);
        return this.enabled;
      },
      playReward(goldDelta) {
        if (!this.enabled) return;
        const key = this.keyForReward(goldDelta);
        const audio = key ? this.tracks[key] : null;
        if (!audio) return;
        try {
          audio.pause();
          audio.currentTime = 0;
          const playResult = audio.play();
          if (playResult && typeof playResult.catch === "function") playResult.catch((err) => {
            console.warn("Reward sound playback failed", err);
          });
        } catch (err) {
          console.warn("Reward sound playback failed", err);
        }
      },
    };

    return window.TaskRewardAudio;
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
      title: "Survey 1",
      subtitle: " ",
    });

    await runSurvey("startBISBASSurvey", "bis_bas", {
      title: "Survey 2",
      subtitle: " ",
    });

    await runSurvey("startFiveDCRSurvey", "five_dcr", {
      title: "Survey 3",
      subtitle: " ",
    });

    await runSurvey("startDemographicsSurvey", "final_survey", {
      title: "Survey 4",
      subtitle: " ",
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

  function showAudioPermissionInstruction(onContinue) {
    ensureRewardAudio();
    const app = $("app");
    app.innerHTML = `
      <div style="
        min-height:100%;width:100%;display:flex;align-items:center;justify-content:center;
        background:#F3E9C6;color:#1F2328;padding:28px;box-sizing:border-box;
        font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
      ">
        <div style="
          width:min(860px, 94vw);background:#fff;border:2px solid #D8CC9E;border-radius:18px;
          box-shadow:0 14px 38px rgba(0,0,0,.16);padding:40px 44px;text-align:center;
        ">
          <div style="font-size:clamp(30px, 5vw, 54px);line-height:1.08;font-weight:850;margin-bottom:22px;letter-spacing:0;">
            Please turn on your laptop sound.
          </div>
          <div style="font-size:clamp(20px, 2.8vw, 30px);line-height:1.25;font-weight:650;color:#363B42;margin:0 auto 30px auto;max-width:760px;letter-spacing:0;">
            This task required sound to be played. Click below to allow audio play before continuing.
          </div>
          <button id="audioPermissionContinue" type="button" style="
            border:0;border-radius:999px;background:#1F2328;color:#fff;padding:16px 30px;
            font-size:20px;font-weight:800;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.16);
          ">
            Enable Sound & Continue
          </button>
          <div id="audioPermissionStatus" style="margin-top:14px;color:#5A5F66;font-size:15px;min-height:22px;"></div>
        </div>
      </div>
    `;

    logSafe({
      trial_index: 0,
      event_type: "system",
      event_name: "audio_permission_show",
    });

    const btn = document.getElementById("audioPermissionContinue");
    const status = document.getElementById("audioPermissionStatus");
    if (!btn) return;

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.style.opacity = "0.72";
      if (status) status.textContent = "Enabling sound...";

      const audio = ensureRewardAudio();
      const enabled = await audio.unlock();

      logSafe({
        trial_index: 0,
        event_type: "system",
        event_name: "audio_permission_ack",
        audio_enabled: enabled ? 1 : 0,
      });

      if (typeof onContinue === "function") onContinue();
    }, { once: true });
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
      observationRoundsPerDemo: observationtotalrounds,

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

      const continueAfterAudio = () => {
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
      };

      showAudioPermissionInstruction(continueAfterAudio);

    },
  };
})();
