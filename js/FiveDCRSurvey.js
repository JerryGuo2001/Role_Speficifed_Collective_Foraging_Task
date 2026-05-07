// ========================== FiveDCRSurvey.js ==========================
// Stand-alone full-screen survey overlay styled to match PostSurvey.js.
//
// Public API:
//   window.startFiveDCRSurvey(onComplete?, options?)
//   window.finishFiveDCRSurvey()
//
// What it saves:
//   1) participantData.fiveDCR -> flat summary object with all item responses + scores
//   2) participantData.trials   -> one summary row with trial_type = "five_dcr_survey"
//
// Scoring:
//   - Compute the average item score for each dimension separately.
//   - Reverse-score Stress Tolerance items before averaging that dimension.
//   - Stress Tolerance items are items 9-12 in this file.
//
// Notes:
//   - Participants do NOT see subsection/dimension headers.
//   - Original raw responses are still saved.
//   - Reverse-scored values are also saved separately.
// =====================================================================

(function () {
  // -------------------- Public API --------------------
  window.startFiveDCRSurvey = startFiveDCRSurvey;
  window.finishFiveDCRSurvey = finishFiveDCRSurvey;

  // -------------------- Config --------------------
  const DEFAULT_OPTIONS = {
    title: 'Additional Survey',
    subtitle: 'Five-Dimensional Curiosity Scale Revised (5DCR)',
    scaleMin: 1,
    scaleMax: 7,
    minLabel: 'Does not describe me at all',
    maxLabel: 'Completely describes me',
    itemsPerPage: 8,
    participantDataKey: 'fiveDCR',
    mergeIntoPostSurveyIfPresent: true
  };

  const DIMENSIONS = [
    {
      key: 'joyous_exploration',
      label: 'Joyous Exploration',
      reverse: false,
      items: [1, 2, 3, 4]
    },
    {
      key: 'deprivation_sensitivity',
      label: 'Deprivation Sensitivity',
      reverse: false,
      items: [5, 6, 7, 8]
    },
    {
      key: 'stress_tolerance',
      label: 'Stress Tolerance',
      reverse: true,
      items: [9, 10, 11, 12]
    },
    {
      key: 'thrill_seeking',
      label: 'Thrill Seeking',
      reverse: false,
      items: [13, 14, 15, 16]
    },
    {
      key: 'general_social_curiosity',
      label: 'General Social Curiosity',
      reverse: false,
      items: [17, 18, 19, 20]
    },
    {
      key: 'covert_social_curiosity',
      label: 'Covert Social Curiosity',
      reverse: false,
      items: [21, 22, 23, 24]
    }
  ];

  const FIVE_DCR_ITEMS = [
    { n: 1,  dimension: 'joyous_exploration',        reverse: false, text: 'I view challenging situations as an opportunity to grow and learn.' },
    { n: 2,  dimension: 'joyous_exploration',        reverse: false, text: 'I seek out situations where it is likely that I will have to think in depth about something.' },
    { n: 3,  dimension: 'joyous_exploration',        reverse: false, text: 'I enjoy learning about subjects that are unfamiliar to me.' },
    { n: 4,  dimension: 'joyous_exploration',        reverse: false, text: 'I find it fascinating to learn new information.' },

    { n: 5,  dimension: 'deprivation_sensitivity',   reverse: false, text: 'Thinking about solutions to difficult conceptual problems can keep me awake at night.' },
    { n: 6,  dimension: 'deprivation_sensitivity',   reverse: false, text: "I can spend hours on a single problem because I just can't rest without knowing the answer." },
    { n: 7,  dimension: 'deprivation_sensitivity',   reverse: false, text: "I feel frustrated if I can't figure out the solution to a problem, so I work even harder to solve it." },
    { n: 8,  dimension: 'deprivation_sensitivity',   reverse: false, text: 'I work relentlessly at problems that I feel must be solved.' },

    { n: 9,  dimension: 'stress_tolerance',          reverse: true,  text: 'The smallest doubt can stop me from seeking out new experiences.' },
    { n: 10, dimension: 'stress_tolerance',          reverse: true,  text: 'I cannot handle the stress that comes from entering uncertain situations.' },
    { n: 11, dimension: 'stress_tolerance',          reverse: true,  text: 'I find it hard to explore new places when I lack confidence in my abilities.' },
    { n: 12, dimension: 'stress_tolerance',          reverse: true,  text: 'It is difficult to concentrate when there is a possibility that I will be taken by surprise.' },

    { n: 13, dimension: 'thrill_seeking',            reverse: false, text: 'Risk-taking is exciting to me.' },
    { n: 14, dimension: 'thrill_seeking',            reverse: false, text: 'When I have free time, I want to do things that are a little scary.' },
    { n: 15, dimension: 'thrill_seeking',            reverse: false, text: 'Creating an adventure as I go is much more appealing than a planned adventure.' },
    { n: 16, dimension: 'thrill_seeking',            reverse: false, text: 'I prefer friends who are excitingly unpredictable.' },

    { n: 17, dimension: 'general_social_curiosity',  reverse: false, text: 'I ask a lot of questions to figure out what interests other people.' },
    { n: 18, dimension: 'general_social_curiosity',  reverse: false, text: 'When talking to someone who is excited, I am curious to find out why.' },
    { n: 19, dimension: 'general_social_curiosity',  reverse: false, text: 'When talking to someone, I try to discover interesting details about them.' },
    { n: 20, dimension: 'general_social_curiosity',  reverse: false, text: 'I like finding out why people behave the way they do.' },

    { n: 21, dimension: 'covert_social_curiosity',   reverse: false, text: "When other people are having a conversation, I like to find out what it's about." },
    { n: 22, dimension: 'covert_social_curiosity',   reverse: false, text: 'When around other people, I like listening to their conversations.' },
    { n: 23, dimension: 'covert_social_curiosity',   reverse: false, text: "When people quarrel, I like to know what's going on." },
    { n: 24, dimension: 'covert_social_curiosity',   reverse: false, text: 'I seek out information about the private lives of people in my life.' }
  ];

  const STRESS_TOLERANCE_ITEMS = DIMENSIONS.find(d => d.key === 'stress_tolerance').items.slice();

  const THEME = {
    pageBg: '#F3E9C6',
    cardBg: '#FFFFFF',
    border: '#E4D8AE',
    text: '#1F2328',
    muted: '#5A5F66',
    shadow: '0 10px 30px rgba(0,0,0,0.10)',
    radius: '16px',
    focusShadow: '0 0 0 3px rgba(66, 133, 244, 0.25)'
  };

  const _prev = { htmlOverflow: null, bodyOverflow: null, bodyMinHeight: null, bodyBg: null };

  let _started = false;
  let _opts = { ...DEFAULT_OPTIONS };
  let _pageIndex = 0;
  let _pageStartT = null;
  let _surveyStartT = null;
  let _pageTimes = [];
  let _onComplete = null;
  let _responses = Object.create(null);

  // -------------------- Entry --------------------
  function startFiveDCRSurvey(onComplete, options) {
    if (_started) return;
    _started = true;

    _onComplete = typeof onComplete === 'function' ? onComplete : null;
    _opts = { ...DEFAULT_OPTIONS, ...(options || {}) };
    _surveyStartT = performance.now();
    _pageTimes = [];
    _responses = Object.create(null);

    if (!Number.isFinite(Number(_opts.scaleMin))) _opts.scaleMin = 1;
    if (!Number.isFinite(Number(_opts.scaleMax))) _opts.scaleMax = 7;
    if (Number(_opts.scaleMax) <= Number(_opts.scaleMin)) _opts.scaleMax = Number(_opts.scaleMin) + 6;
    if (!Number.isFinite(Number(_opts.itemsPerPage)) || Number(_opts.itemsPerPage) < 1) _opts.itemsPerPage = 8;
    _opts.itemsPerPage = Math.floor(Number(_opts.itemsPerPage));

    applyOverlayAndLockBackgroundScroll();
    const overlay = getOrCreateOverlay();
    overlay.innerHTML = '';
    overlay.style.display = 'block';

    const outer = document.createElement('div');
    outer.style.minHeight = '100%';
    outer.style.display = 'flex';
    outer.style.alignItems = 'flex-start';
    outer.style.justifyContent = 'center';
    outer.style.padding = '40px 16px';
    overlay.appendChild(outer);

    const card = document.createElement('div');
    card.style.width = '100%';
    card.style.maxWidth = '980px';
    card.style.background = THEME.cardBg;
    card.style.border = `1px solid ${THEME.border}`;
    card.style.borderRadius = THEME.radius;
    card.style.boxShadow = THEME.shadow;
    card.style.padding = '26px 28px';
    card.style.color = THEME.text;
    card.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
    card.style.lineHeight = '1.45';
    outer.appendChild(card);

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'baseline';
    header.style.justifyContent = 'space-between';
    header.style.gap = '12px';
    header.style.marginBottom = '10px';
    card.appendChild(header);

    const h2 = document.createElement('h2');
    h2.textContent = _opts.title || 'Additional Survey';
    h2.style.margin = '0';
    h2.style.fontSize = '24px';
    h2.style.letterSpacing = '0.2px';
    header.appendChild(h2);

    const progressText = document.createElement('div');
    progressText.id = 'fiveDCRProgressText';
    progressText.style.fontSize = '13px';
    progressText.style.color = THEME.muted;
    header.appendChild(progressText);

    const sub = document.createElement('div');
    sub.id = 'fiveDCRSubTitle';
    sub.style.margin = '0 0 10px 0';
    sub.style.color = THEME.muted;
    sub.style.fontSize = '14px';
    sub.textContent = _opts.subtitle || 'Five-Dimensional Curiosity Scale Revised (5DCR)';
    card.appendChild(sub);

    const divider = document.createElement('div');
    divider.style.height = '1px';
    divider.style.background = '#EFE7C9';
    divider.style.margin = '16px 0 18px 0';
    card.appendChild(divider);

    const pageRoot = document.createElement('div');
    pageRoot.id = 'fiveDCRPageRoot';
    card.appendChild(pageRoot);

    _pageIndex = 0;
    renderPage(card, overlay);
    overlay.scrollTop = 0;
  }

  function finishFiveDCRSurvey() {
    const overlay = document.getElementById('fiveDCRSurveyOverlay');
    if (overlay) overlay.style.display = 'none';
    restoreBackgroundScroll();

    _started = false;
    const done = _onComplete;
    _onComplete = null;
    if (typeof done === 'function') {
      const pd = getParticipantData();
      done(pd[_opts.participantDataKey] || null);
    }
  }

  // -------------------- Rendering --------------------
  function renderPage(card, overlay) {
    const root = card.querySelector('#fiveDCRPageRoot');
    const progress = card.querySelector('#fiveDCRProgressText');
    const sub = card.querySelector('#fiveDCRSubTitle');
    if (!root || !progress) return;

    const totalPages = Math.ceil(FIVE_DCR_ITEMS.length / _opts.itemsPerPage);
    const start = _pageIndex * _opts.itemsPerPage;
    const end = Math.min(FIVE_DCR_ITEMS.length, start + _opts.itemsPerPage);
    const items = FIVE_DCR_ITEMS.slice(start, end);

    progress.textContent = `Page ${_pageIndex + 1} of ${totalPages}`;
    sub.textContent = _opts.subtitle || 'Five-Dimensional Curiosity Scale Revised (5DCR)';

    root.innerHTML = '';

    const instructions = document.createElement('div');
    instructions.style.fontSize = '14px';
    instructions.style.color = THEME.muted;
    instructions.style.marginBottom = '14px';
    instructions.textContent = `Please indicate how well each statement describes you using the ${_opts.scaleMin}–${_opts.scaleMax} scale.`;
    root.appendChild(instructions);

    const form = document.createElement('div');
    form.style.display = 'grid';
    form.style.gap = '14px';
    root.appendChild(form);

    items.forEach(item => {
      form.appendChild(buildItemCard(item));
    });

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'space-between';
    footer.style.alignItems = 'center';
    footer.style.gap = '12px';
    footer.style.marginTop = '22px';
    root.appendChild(footer);

    const left = document.createElement('div');
    left.style.fontSize = '13px';
    left.style.color = THEME.muted;
    left.textContent = `${start + 1}–${end} of ${FIVE_DCR_ITEMS.length} items`;
    footer.appendChild(left);

    const nav = document.createElement('div');
    nav.style.display = 'flex';
    nav.style.gap = '10px';
    footer.appendChild(nav);

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.textContent = 'Back';
    styleButton(backBtn, true);
    backBtn.disabled = _pageIndex === 0;
    backBtn.style.opacity = backBtn.disabled ? '0.55' : '1';
    backBtn.style.cursor = backBtn.disabled ? 'not-allowed' : 'pointer';
    backBtn.addEventListener('click', () => {
      if (_pageIndex <= 0) return;
      capturePageTime();
      _pageIndex -= 1;
      renderPage(card, overlay);
      overlay.scrollTop = 0;
    });
    nav.appendChild(backBtn);

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.textContent = (_pageIndex === totalPages - 1) ? 'Finish' : 'Next';
    styleButton(nextBtn, false);
    nextBtn.addEventListener('click', () => {
      const missing = items.filter(it => !hasValidResponse(it.n));
      if (missing.length) {
        showInlineError(root, `Please answer all items on this page before continuing.`);
        focusFirstMissing(missing[0].n);
        return;
      }
      clearInlineError(root);

      capturePageTime();

      if (_pageIndex < totalPages - 1) {
        _pageIndex += 1;
        renderPage(card, overlay);
        overlay.scrollTop = 0;
      } else {
        finalizeSurvey();
      }
    });
    nav.appendChild(nextBtn);

    _pageStartT = performance.now();
  }

  function buildItemCard(item) {
    const wrap = document.createElement('div');
    wrap.style.border = '1px solid #EFE7C9';
    wrap.style.background = '#FFFCF1';
    wrap.style.borderRadius = '14px';
    wrap.style.padding = '14px 14px 12px 14px';

    const q = document.createElement('div');
    q.style.fontSize = '15px';
    q.style.fontWeight = '700';
    q.style.marginBottom = '10px';
    q.textContent = `${item.n}. ${item.text}`;
    wrap.appendChild(q);

    const labelsRow = document.createElement('div');
    labelsRow.style.display = 'flex';
    labelsRow.style.justifyContent = 'space-between';
    labelsRow.style.gap = '12px';
    labelsRow.style.fontSize = '12px';
    labelsRow.style.color = THEME.muted;
    labelsRow.style.marginBottom = '8px';

    const minLab = document.createElement('div');
    minLab.textContent = _opts.minLabel || String(_opts.scaleMin);
    labelsRow.appendChild(minLab);

    const maxLab = document.createElement('div');
    maxLab.textContent = _opts.maxLabel || String(_opts.scaleMax);
    labelsRow.appendChild(maxLab);

    wrap.appendChild(labelsRow);

    const scale = document.createElement('div');
    scale.style.display = 'grid';
    scale.style.gridTemplateColumns = `repeat(${_opts.scaleMax - _opts.scaleMin + 1}, minmax(0, 1fr))`;
    scale.style.gap = '8px';
    wrap.appendChild(scale);

    for (let v = _opts.scaleMin; v <= _opts.scaleMax; v++) {
      const id = `fiveDCR_q${item.n}_${v}`;
      const label = document.createElement('label');
      label.setAttribute('for', id);
      label.style.display = 'flex';
      label.style.flexDirection = 'column';
      label.style.alignItems = 'center';
      label.style.justifyContent = 'center';
      label.style.gap = '6px';
      label.style.border = '1px solid #E9DFBB';
      label.style.borderRadius = '10px';
      label.style.padding = '10px 6px';
      label.style.background = '#FFFFFF';
      label.style.cursor = 'pointer';
      label.style.userSelect = 'none';

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `fiveDCR_q${item.n}`;
      input.id = id;
      input.value = String(v);
      input.style.transform = 'scale(1.1)';
      input.style.cursor = 'pointer';

      if (String(_responses[item.n] ?? '') === String(v)) {
        input.checked = true;
        label.style.borderColor = '#BDAE74';
        label.style.background = '#FFF7D8';
      }

      input.addEventListener('change', () => {
        _responses[item.n] = Number(v);
        refreshItemSelectionStyles(item.n);
      });

      input.addEventListener('focus', () => {
        label.style.boxShadow = THEME.focusShadow;
      });
      input.addEventListener('blur', () => {
        label.style.boxShadow = 'none';
      });

      const t = document.createElement('div');
      t.style.fontSize = '14px';
      t.style.fontWeight = '700';
      t.textContent = String(v);

      label.appendChild(input);
      label.appendChild(t);
      scale.appendChild(label);
    }

    return wrap;
  }

  function refreshItemSelectionStyles(itemN) {
    const inputs = document.querySelectorAll(`input[name="fiveDCR_q${itemN}"]`);
    inputs.forEach(inp => {
      const lab = inp.closest('label');
      if (!lab) return;
      if (inp.checked) {
        lab.style.borderColor = '#BDAE74';
        lab.style.background = '#FFF7D8';
      } else {
        lab.style.borderColor = '#E9DFBB';
        lab.style.background = '#FFFFFF';
      }
    });
  }

  function focusFirstMissing(itemN) {
    const first = document.querySelector(`input[name="fiveDCR_q${itemN}"]`);
    if (first) first.focus();
  }

  // -------------------- Finalize / Save --------------------
  function finalizeSurvey() {
    const summary = buildSummaryObject();
    const pd = getParticipantData();

    pd[_opts.participantDataKey] = summary;

    if (_opts.mergeIntoPostSurveyIfPresent) {
      if (!pd.postSurvey || typeof pd.postSurvey !== 'object') {
        pd.postSurvey = {};
      }
      pd.postSurvey[_opts.participantDataKey] = summary;
    }

    if (!Array.isArray(pd.trials)) pd.trials = [];

    pd.trials.push(buildTrialRow(summary));

    finishFiveDCRSurvey();
  }

  function buildSummaryObject() {
    const out = {
      survey_name: 'five_dcr',
      started_at_ms: Math.round(_surveyStartT || 0),
      total_time_ms: Math.round((_surveyStartT != null) ? (performance.now() - _surveyStartT) : 0),
      page_times_ms_json: JSON.stringify(_pageTimes)
    };

    FIVE_DCR_ITEMS.forEach(item => {
      const raw = Number(_responses[item.n]);
      out[`fiveDCR_q${item.n}`] = Number.isFinite(raw) ? raw : null;
    });

    STRESS_TOLERANCE_ITEMS.forEach(n => {
      const raw = Number(_responses[n]);
      out[`fiveDCR_q${n}_reversed`] = Number.isFinite(raw) ? reverseLikert(raw, _opts.scaleMin, _opts.scaleMax) : null;
    });

    DIMENSIONS.forEach(dim => {
      const vals = dim.items
        .map(n => Number(_responses[n]))
        .filter(v => Number.isFinite(v))
        .map(v => dim.reverse ? reverseLikert(v, _opts.scaleMin, _opts.scaleMax) : v);

      out[`${dim.key}_avg`] = vals.length ? round3(mean(vals)) : null;
    });

    return out;
  }

  function buildTrialRow(summary) {
    const row = {
      trial_type: 'five_dcr_survey',
      survey_name: 'five_dcr',
      rt: summary.total_time_ms ?? null
    };

    Object.keys(summary).forEach(k => {
      row[k] = summary[k];
    });

    return row;
  }

  // -------------------- Data Helpers --------------------
  function getParticipantData() {
    let pd = null;

    try {
      if (typeof participantData !== 'undefined' && participantData && typeof participantData === 'object') {
        pd = participantData;
      }
    } catch (e) {}

    if (!pd && typeof window !== 'undefined' && window.participantData && typeof window.participantData === 'object') {
      pd = window.participantData;
    }

    if (!pd) {
      pd = {};
    }
    if (!Array.isArray(pd.trials)) {
      pd.trials = [];
    }

    if (typeof window !== 'undefined') {
      window.participantData = pd;
    }

    return pd;
  }

  function hasValidResponse(itemN) {
    const v = Number(_responses[itemN]);
    return Number.isFinite(v) && v >= _opts.scaleMin && v <= _opts.scaleMax;
  }

  function reverseLikert(v, minV, maxV) {
    return (minV + maxV) - Number(v);
  }

  function mean(arr) {
    if (!arr.length) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function round3(x) {
    return Math.round(Number(x) * 1000) / 1000;
  }

  // -------------------- UI Helpers --------------------
  function showInlineError(root, text) {
    let box = root.querySelector('#fiveDCRErrorBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'fiveDCRErrorBox';
      box.style.marginTop = '14px';
      box.style.padding = '10px 12px';
      box.style.border = '1px solid #E7B3B3';
      box.style.background = '#FFF1F1';
      box.style.color = '#8A1F1F';
      box.style.borderRadius = '10px';
      root.appendChild(box);
    }
    box.textContent = text;
  }

  function clearInlineError(root) {
    const box = root.querySelector('#fiveDCRErrorBox');
    if (box) box.remove();
  }

  function styleButton(btn, secondary) {
    btn.style.appearance = 'none';
    btn.style.border = secondary ? '1px solid #D8C998' : '1px solid #AF9A53';
    btn.style.background = secondary ? '#FFFFFF' : '#F4E7B2';
    btn.style.color = '#1F2328';
    btn.style.borderRadius = '12px';
    btn.style.padding = '10px 16px';
    btn.style.fontSize = '14px';
    btn.style.fontWeight = '700';
    btn.style.cursor = 'pointer';
    btn.style.boxShadow = secondary ? 'none' : '0 1px 0 rgba(0,0,0,0.05)';
  }

  function capturePageTime() {
    if (_pageStartT == null) return;
    const ms = Math.max(0, Math.round(performance.now() - _pageStartT));
    _pageTimes[_pageIndex] = ms;
    _pageStartT = null;
  }

  function getOrCreateOverlay() {
    let overlay = document.getElementById('fiveDCRSurveyOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'fiveDCRSurveyOverlay';
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.zIndex = '2147483000';
      overlay.style.overflow = 'auto';
      overlay.style.background = THEME.pageBg;
      document.body.appendChild(overlay);
    }
    overlay.style.background = THEME.pageBg;
    overlay.style.display = 'block';
    return overlay;
  }

  function applyOverlayAndLockBackgroundScroll() {
    const html = document.documentElement;
    const body = document.body;
    _prev.htmlOverflow = html.style.overflow;
    _prev.bodyOverflow = body.style.overflow;
    _prev.bodyMinHeight = body.style.minHeight;
    _prev.bodyBg = body.style.background;

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.minHeight = '100vh';
    body.style.background = THEME.pageBg;
  }

  function restoreBackgroundScroll() {
    const html = document.documentElement;
    const body = document.body;
    html.style.overflow = _prev.htmlOverflow ?? '';
    body.style.overflow = _prev.bodyOverflow ?? '';
    body.style.minHeight = _prev.bodyMinHeight ?? '';
    body.style.background = _prev.bodyBg ?? '';
  }
})();