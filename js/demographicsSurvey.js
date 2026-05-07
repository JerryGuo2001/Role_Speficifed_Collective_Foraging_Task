// ========================== demographicsSurvey.js ==========================
// Full-screen final survey overlay.
// Public API:
//   window.startDemographicsSurvey(onComplete?, options?)
//   window.finishDemographicsSurvey()
// Saves:
//   participantData.finalSurvey
//   participantData.demographics
//   participantData.trials row with trial_type = "final_survey"
// ===========================================================================

(function () {
  "use strict";

  window.startDemographicsSurvey = startDemographicsSurvey;
  window.finishDemographicsSurvey = finishDemographicsSurvey;

  const DEFAULT_OPTIONS = {
    title: "Final Survey",
    subtitle: "Demographic and Final Questions",
    participantDataKey: "finalSurvey",
    mergeIntoPostSurveyIfPresent: true,
  };

  const THEME = {
    pageBg: "#F3E9C6",
    cardBg: "#FFFFFF",
    border: "#E4D8AE",
    text: "#1F2328",
    muted: "#5A5F66",
    button: "#1F2328",
    buttonText: "#FFFFFF",
    shadow: "0 10px 30px rgba(0,0,0,0.10)",
    radius: "16px",
  };

  const SEX_OPTIONS = [
    { value: "male", label: "Male" },
    { value: "female", label: "Female" },
    { value: "other", label: "Other" },
  ];

  const GENDER_OPTIONS = [
    { value: "man", label: "Man" },
    { value: "woman", label: "Woman" },
    { value: "non_binary", label: "Non-binary" },
    { value: "transgender", label: "Transgender" },
    { value: "other", label: "Other / self-describe" },
    { value: "prefer_not_to_answer", label: "Prefer not to answer" },
  ];

  const ETHNICITY_OPTIONS = [
    { value: "hispanic_latino", label: "Hispanic or Latino/a/x" },
    { value: "american_indian_alaska_native", label: "American Indian or Alaska Native" },
    { value: "asian", label: "Asian" },
    { value: "black_african_american", label: "Black or African American" },
    { value: "middle_eastern_north_african", label: "Middle Eastern or North African" },
    { value: "native_hawaiian_pacific_islander", label: "Native Hawaiian or Other Pacific Islander" },
    { value: "white", label: "White" },
    { value: "other", label: "Other / self-describe" },
    { value: "prefer_not_to_answer", label: "Prefer not to answer" },
  ];

  const AGENT_OPTIONS = [
    { value: "Tom", label: "Tom — Security" },
    { value: "Jerry", label: "Jerry — Forager" },
    { value: "Cindy", label: "Cindy — Security" },
    { value: "Frank", label: "Frank — Forager" },
    { value: "Alice", label: "Alice — Security" },
    { value: "Grace", label: "Grace — Forager" },
  ];

  const _prev = { htmlOverflow: null, bodyOverflow: null, bodyMinHeight: null, bodyBg: null };

  let _started = false;
  let _opts = { ...DEFAULT_OPTIONS };
  let _onComplete = null;
  let _surveyStartT = null;

  function startDemographicsSurvey(onComplete, options) {
    if (_started) return;
    _started = true;

    _onComplete = typeof onComplete === "function" ? onComplete : null;
    _opts = { ...DEFAULT_OPTIONS, ...(options || {}) };
    _surveyStartT = performance.now();

    applyOverlayAndLockBackgroundScroll();
    const overlay = getOrCreateOverlay();
    overlay.innerHTML = "";
    overlay.style.display = "block";

    const outer = el("div", { style: "min-height:100%;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;" });
    overlay.appendChild(outer);

    const card = el("div", {
      style: [
        "width:100%;max-width:920px;background:#fff;border:1px solid #E4D8AE;border-radius:16px",
        "box-shadow:0 10px 30px rgba(0,0,0,0.10);padding:26px 28px;color:#1F2328",
        "font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.45",
      ].join(";"),
    });
    outer.appendChild(card);

    const header = el("div", { style: "display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:10px;" });
    header.appendChild(el("h2", { style: "margin:0;font-size:24px;letter-spacing:.2px;" }, [_opts.title || "Final Survey"]));
    header.appendChild(el("div", { style: "font-size:13px;color:#5A5F66;" }, ["Page 1 of 1"]));
    card.appendChild(header);

    card.appendChild(el("div", { style: "margin:0 0 10px 0;color:#5A5F66;font-size:14px;" }, [_opts.subtitle || "Demographic and Final Questions"]));
    card.appendChild(el("div", { style: "height:1px;background:#EFE7C9;margin:16px 0 18px 0;" }));

    const form = el("form", { id: "demographicsSurveyForm", novalidate: "novalidate" });
    form.appendChild(makeAgeField());
    form.appendChild(makeRadioGroup("sex", "Sex", SEX_OPTIONS, true));
    form.appendChild(makeRadioGroup("gender", "Gender", GENDER_OPTIONS, true, "gender_other_text"));
    form.appendChild(makeCheckboxGroup("ethnicity", "Ethnicity (select all that apply)", ETHNICITY_OPTIONS, true, "ethnicity_other_text"));
    form.appendChild(makeStrategyField());
    form.appendChild(makeAgentRankingField());

    const error = el("div", { id: "demographicsError", style: "display:none;margin:16px 0 0 0;padding:10px 12px;border:1px solid #E5A0A0;background:#FFF4F4;border-radius:10px;color:#8A1F1F;font-size:14px;" });
    form.appendChild(error);

    const nav = el("div", { style: "display:flex;justify-content:flex-end;margin-top:22px;" });
    const submit = el("button", { type: "submit", style: primaryButtonStyle() }, ["Finish Survey"]);
    nav.appendChild(submit);
    form.appendChild(nav);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const summary = readAndValidateForm(form);
      if (!summary) return;
      finalizeSurvey(summary);
    });

    card.appendChild(form);
    overlay.scrollTop = 0;
  }

  function finishDemographicsSurvey() {
    const overlay = document.getElementById("demographicsSurveyOverlay");
    if (overlay) overlay.style.display = "none";
    restoreBackgroundScroll();
    _started = false;

    const done = _onComplete;
    _onComplete = null;
    if (typeof done === "function") {
      const pd = getParticipantData();
      done(pd[_opts.participantDataKey] || null);
    }
  }

  function makeAgeField() {
    const wrap = makeSection("Age");
    const input = el("input", {
      type: "number",
      id: "demographics_age",
      name: "age",
      min: "18",
      max: "100",
      step: "1",
      required: "required",
      inputmode: "numeric",
      style: fieldStyle(),
    });
    wrap.appendChild(input);
    return wrap;
  }

  function makeRadioGroup(name, title, options, required, otherInputId) {
    const wrap = makeSection(title);
    const grid = el("div", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px 14px;" });

    options.forEach((opt) => {
      const id = `demographics_${name}_${opt.value}`;
      const label = el("label", { for: id, style: choiceStyle() });
      const input = el("input", { type: "radio", id, name, value: opt.value });
      if (required) input.required = true;
      label.appendChild(input);
      label.appendChild(el("span", {}, [opt.label]));
      grid.appendChild(label);
    });

    wrap.appendChild(grid);
    if (otherInputId) {
      wrap.appendChild(el("input", {
        type: "text",
        id: otherInputId,
        name: otherInputId,
        placeholder: "Optional self-description",
        style: fieldStyle("margin-top:10px;"),
      }));
    }
    return wrap;
  }

  function makeCheckboxGroup(name, title, options, required, otherInputId) {
    const wrap = makeSection(title);
    const grid = el("div", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px 14px;" });

    options.forEach((opt) => {
      const id = `demographics_${name}_${opt.value}`;
      const label = el("label", { for: id, style: choiceStyle() });
      const input = el("input", { type: "checkbox", id, name, value: opt.value });
      label.appendChild(input);
      label.appendChild(el("span", {}, [opt.label]));
      grid.appendChild(label);
    });

    wrap.appendChild(grid);
    if (otherInputId) {
      wrap.appendChild(el("input", {
        type: "text",
        id: otherInputId,
        name: otherInputId,
        placeholder: "Optional self-description",
        style: fieldStyle("margin-top:10px;"),
      }));
    }
    if (required) wrap.dataset.requiredCheckboxGroup = name;
    return wrap;
  }

  function makeStrategyField() {
    const wrap = makeSection("Describe your strategy");
    wrap.appendChild(el("div", { style: "margin:-4px 0 10px 0;color:#5A5F66;font-size:14px;" }, [
      "Briefly describe how you made decisions during the task.",
    ]));
    wrap.appendChild(el("textarea", {
      id: "strategy_description",
      name: "strategy_description",
      rows: "5",
      required: "required",
      placeholder: "Type your strategy here...",
      style: fieldStyle("resize:vertical;min-height:110px;"),
    }));
    return wrap;
  }

  function makeAgentRankingField() {
    const wrap = makeSection("Rank the agents from best to worst");
    wrap.appendChild(el("div", { style: "margin:-4px 0 12px 0;color:#5A5F66;font-size:14px;" }, [
      "Choose each agent once. Rank 1 is the best agent and Rank 6 is the worst agent.",
    ]));

    const grid = el("div", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px 16px;" });
    for (let rank = 1; rank <= AGENT_OPTIONS.length; rank++) {
      const field = el("label", { style: "display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:700;" });
      field.appendChild(el("span", {}, [`Rank ${rank}${rank === 1 ? " (best)" : rank === AGENT_OPTIONS.length ? " (worst)" : ""}`]));
      const select = el("select", {
        id: `agent_rank_${rank}`,
        name: `agent_rank_${rank}`,
        required: "required",
        style: fieldStyle(),
      });
      select.appendChild(el("option", { value: "" }, ["Select one agent"]));
      AGENT_OPTIONS.forEach((agent) => {
        select.appendChild(el("option", { value: agent.value }, [agent.label]));
      });
      field.appendChild(select);
      grid.appendChild(field);
    }

    wrap.appendChild(grid);
    return wrap;
  }

  function readAndValidateForm(form) {
    const error = form.querySelector("#demographicsError");
    const showError = (msg) => {
      error.textContent = msg;
      error.style.display = "block";
      error.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    error.style.display = "none";

    const age = Number(form.elements.age.value);
    if (!Number.isInteger(age) || age < 18 || age > 100) {
      showError("Please enter an age between 18 and 100.");
      return null;
    }

    const sex = getRadioValue(form, "sex");
    if (!sex) {
      showError("Please select sex.");
      return null;
    }

    const gender = getRadioValue(form, "gender");
    if (!gender) {
      showError("Please select gender.");
      return null;
    }

    const ethnicity = getCheckedValues(form, "ethnicity");
    if (!ethnicity.length) {
      showError("Please select at least one ethnicity option.");
      return null;
    }

    const strategyDescription = String(form.elements.strategy_description.value || "").trim();
    if (!strategyDescription) {
      showError("Please describe your strategy.");
      return null;
    }

    const agentRanking = [];
    for (let rank = 1; rank <= AGENT_OPTIONS.length; rank++) {
      const agent = String(form.elements[`agent_rank_${rank}`]?.value || "").trim();
      if (!agent) {
        showError("Please complete all agent ranking fields.");
        return null;
      }
      agentRanking.push(agent);
    }
    if (new Set(agentRanking).size !== AGENT_OPTIONS.length) {
      showError("Please choose each agent only once in the ranking question.");
      return null;
    }

    const now = performance.now();
    const pd = getParticipantData();
    const id = pd.id || "unknown";
    const startTime = Number.isFinite(Number(pd.startTime)) ? Number(pd.startTime) : now;

    return {
      id,
      survey_name: "final_survey",
      age,
      sex,
      gender,
      gender_other_text: String(form.elements.gender_other_text?.value || "").trim(),
      ethnicity: ethnicity.join("|"),
      ethnicity_count: ethnicity.length,
      ethnicity_other_text: String(form.elements.ethnicity_other_text?.value || "").trim(),
      strategy_description: strategyDescription,
      agent_ranking_order: agentRanking.join("|"),
      agent_rank_1_best: agentRanking[0],
      agent_rank_2: agentRanking[1],
      agent_rank_3: agentRanking[2],
      agent_rank_4: agentRanking[3],
      agent_rank_5: agentRanking[4],
      agent_rank_6_worst: agentRanking[5],
      final_survey_rt_total: Math.round(now - (_surveyStartT || now)),
      demographics_survey_rt_total: Math.round(now - (_surveyStartT || now)),
      time_elapsed: Math.round(now - startTime),
    };
  }

  function finalizeSurvey(summary) {
    const pd = getParticipantData();
    pd[_opts.participantDataKey] = summary;

    pd.demographics = {
      age: summary.age,
      sex: summary.sex,
      gender: summary.gender,
      gender_other_text: summary.gender_other_text,
      ethnicity: summary.ethnicity,
      ethnicity_count: summary.ethnicity_count,
      ethnicity_other_text: summary.ethnicity_other_text,
    };

    if (_opts.mergeIntoPostSurveyIfPresent) {
      if (!pd.postSurvey || typeof pd.postSurvey !== "object") pd.postSurvey = {};
      pd.postSurvey[_opts.participantDataKey] = summary;
      pd.postSurvey.demographics = pd.demographics;
    }

    if (!Array.isArray(pd.trials)) pd.trials = [];
    pd.trials.push({
      trial_type: "final_survey",
      event_type: "survey",
      event_name: "final_survey_complete",
      rt: summary.final_survey_rt_total,
      ...summary,
    });

    finishDemographicsSurvey();
  }

  function getRadioValue(form, name) {
    const checked = form.querySelector(`input[name="${name}"]:checked`);
    return checked ? checked.value : "";
  }

  function getCheckedValues(form, name) {
    return Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map((x) => x.value);
  }

  function getParticipantData() {
    let pd = null;
    try {
      if (typeof participantData !== "undefined" && participantData && typeof participantData === "object") pd = participantData;
    } catch (_) {}
    if (!pd && typeof window !== "undefined" && window.participantData && typeof window.participantData === "object") pd = window.participantData;
    if (!pd) pd = {};
    if (!Array.isArray(pd.trials)) pd.trials = [];
    if (!pd.startTime) pd.startTime = performance.now();
    if (typeof window !== "undefined") window.participantData = pd;
    return pd;
  }

  function makeSection(title) {
    const wrap = el("section", { style: "margin:0 0 20px 0;padding:16px;border:1px solid #EFE7C9;border-radius:14px;background:#FFFDF7;" });
    wrap.appendChild(el("div", { style: "font-weight:700;margin-bottom:10px;font-size:16px;" }, [title]));
    return wrap;
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k === "style") node.style.cssText = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    children.forEach((c) => node.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return node;
  }

  function getOrCreateOverlay() {
    let overlay = document.getElementById("demographicsSurveyOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "demographicsSurveyOverlay";
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.zIndex = "999999";
      overlay.style.background = THEME.pageBg;
      overlay.style.overflowY = "auto";
      overlay.style.overflowX = "hidden";
      overlay.style.webkitOverflowScrolling = "touch";
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  function applyOverlayAndLockBackgroundScroll() {
    if (_prev.htmlOverflow === null) _prev.htmlOverflow = document.documentElement.style.overflow;
    if (_prev.bodyOverflow === null) _prev.bodyOverflow = document.body.style.overflow;
    if (_prev.bodyMinHeight === null) _prev.bodyMinHeight = document.body.style.minHeight;
    if (_prev.bodyBg === null) _prev.bodyBg = document.body.style.background;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.background = THEME.pageBg;
    document.body.style.minHeight = "100vh";
  }

  function restoreBackgroundScroll() {
    if (_prev.htmlOverflow !== null) document.documentElement.style.overflow = _prev.htmlOverflow;
    if (_prev.bodyOverflow !== null) document.body.style.overflow = _prev.bodyOverflow;
    if (_prev.bodyMinHeight !== null) document.body.style.minHeight = _prev.bodyMinHeight;
    if (_prev.bodyBg !== null) document.body.style.background = _prev.bodyBg;
  }

  function fieldStyle(extra) {
    return [
      "width:100%;box-sizing:border-box;border:1px solid #D8CC9E;border-radius:10px",
      "padding:10px 12px;font-size:15px;background:#fff;color:#1F2328;outline:none",
      extra || "",
    ].join(";");
  }

  function choiceStyle() {
    return [
      "display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid #E8DDB9",
      "border-radius:10px;background:#fff;cursor:pointer;font-size:15px;min-height:22px",
    ].join(";");
  }

  function primaryButtonStyle() {
    return [
      "border:0;border-radius:999px;background:#1F2328;color:#fff;padding:11px 18px",
      "font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.12)",
    ].join(";");
  }
})();
