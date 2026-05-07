// ========================== NeedForCognitionSurvey.js ==========================
// Stand-alone full-screen survey overlay styled to match PostSurvey.js.
//
// Public API:
//   window.startNeedForCognitionSurvey(onComplete?, options?)
//   window.finishNeedForCognitionSurvey()
//
// What it saves:
//   1) participantData.needForCognition  -> flat summary object with all item responses + scores
//   2) participantData.trials            -> one summary row with trial_type = "need_for_cognition_survey"
//
// Notes:
// - Uses the 18-item short Need for Cognition scale.
// - Response scale is configurable. Default is 1-5 with Strongly disagree -> Strongly agree.
// - Reverse-scored items: 3, 4, 5, 7, 8, 9, 12, 16, 17.
// ============================================================================

(function () {
  // -------------------- Public API --------------------
  window.startNeedForCognitionSurvey = startNeedForCognitionSurvey;
  window.finishNeedForCognitionSurvey = finishNeedForCognitionSurvey;

  // -------------------- Config --------------------
  const DEFAULT_OPTIONS = {
    title: 'Additional Survey',
    subtitle: 'Need for Cognition',
    scaleMin: 1,
    scaleMax: 5,
    minLabel: 'Strongly disagree',
    maxLabel: 'Strongly agree',
    itemsPerPage: 9,
    mergeIntoPostSurveyIfPresent: true,
    participantDataKey: 'needForCognition'
  };

  const NFC_ITEMS = [
    { n: 1,  reverse: false, text: 'I would prefer complex to simple problems.' },
    { n: 2,  reverse: false, text: 'I like to have the responsibility of handling a situation that requires a lot of thinking.' },
    { n: 3,  reverse: true,  text: 'Thinking is not my idea of fun.' },
    { n: 4,  reverse: true,  text: 'I would rather do something that requires little thought than something that is sure to challenge my thinking abilities.' },
    { n: 5,  reverse: true,  text: 'I try to anticipate and avoid situations where there is likely chance I will have to think in depth about something.' },
    { n: 6,  reverse: false, text: 'I find satisfaction in deliberating hard and for long hours.' },
    { n: 7,  reverse: true,  text: 'I only think as hard as I have to.' },
    { n: 8,  reverse: true,  text: 'I prefer to think about small, daily projects to long-term ones.' },
    { n: 9,  reverse: true,  text: 'I like tasks that require little thought once I\'ve learned them.' },
    { n: 10, reverse: false, text: 'The idea of relying on thought to make my way to the top appeals to me.' },
    { n: 11, reverse: false, text: 'I really enjoy a task that involves coming up with new solutions to problems.' },
    { n: 12, reverse: true,  text: 'Learning new ways to think doesn\'t excite me very much.' },
    { n: 13, reverse: false, text: 'I prefer my life to be filled with puzzles that I must solve.' },
    { n: 14, reverse: false, text: 'The notion of thinking abstractly is appealing to me.' },
    { n: 15, reverse: false, text: 'I would prefer a task that is intellectual, difficult, and important to one that is somewhat important but does not require much thought.' },
    { n: 16, reverse: true,  text: 'I feel relief rather than satisfaction after completing a task that required a lot of mental effort.' },
    { n: 17, reverse: true,  text: 'It\'s enough for me that something gets the job done; I don\'t care how or why it works.' },
    { n: 18, reverse: false, text: 'I usually end up deliberating about issues even when they do not affect me personally.' }
  ];

  const REVERSE_ITEM_NUMBERS = NFC_ITEMS.filter(x => x.reverse).map(x => x.n);

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
  let _onComplete = null;
  let _surveyStartT = null;
  let _responses = Object.create(null); // itemNumber -> raw response
  let _pageTimes = [];

  // -------------------- Entry --------------------
  function startNeedForCognitionSurvey(onComplete, options) {
    if (_started) return;
    _started = true;

    _onComplete = typeof onComplete === 'function' ? onComplete : null;
    _opts = { ...DEFAULT_OPTIONS, ...(options || {}) };
    _surveyStartT = performance.now();
    _pageTimes = [];

    if (!Number.isFinite(Number(_opts.scaleMin))) _opts.scaleMin = 1;
    if (!Number.isFinite(Number(_opts.scaleMax))) _opts.scaleMax = 5;
    if (Number(_opts.scaleMax) <= Number(_opts.scaleMin)) _opts.scaleMax = Number(_opts.scaleMin) + 4;
    if (!Number.isFinite(Number(_opts.itemsPerPage)) || Number(_opts.itemsPerPage) < 1) _opts.itemsPerPage = 9;
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
    progressText.id = 'nfcProgressText';
    progressText.style.fontSize = '13px';
    progressText.style.color = THEME.muted;
    header.appendChild(progressText);

    const sub = document.createElement('div');
    sub.id = 'nfcSubTitle';
    sub.style.margin = '0 0 10px 0';
    sub.style.color = THEME.muted;
    sub.style.fontSize = '14px';
    sub.textContent = _opts.subtitle || 'Need for Cognition';
    card.appendChild(sub);

    const divider = document.createElement('div');
    divider.style.height = '1px';
    divider.style.background = '#EFE7C9';
    divider.style.margin = '16px 0 18px 0';
    card.appendChild(divider);

    const pageRoot = document.createElement('div');
    pageRoot.id = 'nfcPageRoot';
    card.appendChild(pageRoot);

    _pageIndex = 0;
    renderPage(card, overlay);
    overlay.scrollTop = 0;
  }

  function finishNeedForCognitionSurvey() {
    const overlay = document.getElementById('needForCognitionOverlay');
    if (overlay) overlay.style.display = 'none';
    restoreBackgroundScroll();
    _started = false;

    if (typeof _onComplete === 'function') {
      const fn = _onComplete;
      _onComplete = null;
      fn();
    }
  }

  // -------------------- Overlay --------------------
  function getOrCreateOverlay() {
    let overlay = document.getElementById('needForCognitionOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'needForCognitionOverlay';
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.zIndex = '999999';
      overlay.style.background = THEME.pageBg;
      overlay.style.overflowY = 'auto';
      overlay.style.overflowX = 'hidden';
      overlay.style.webkitOverflowScrolling = 'touch';
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  function applyOverlayAndLockBackgroundScroll() {
    if (_prev.htmlOverflow === null) _prev.htmlOverflow = document.documentElement.style.overflow;
    if (_prev.bodyOverflow === null) _prev.bodyOverflow = document.body.style.overflow;
    if (_prev.bodyMinHeight === null) _prev.bodyMinHeight = document.body.style.minHeight;
    if (_prev.bodyBg === null) _prev.bodyBg = document.body.style.background;

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.background = THEME.pageBg;
    document.body.style.minHeight = '100vh';
  }

  function restoreBackgroundScroll() {
    if (_prev.htmlOverflow !== null) document.documentElement.style.overflow = _prev.htmlOverflow;
    if (_prev.bodyOverflow !== null) document.body.style.overflow = _prev.bodyOverflow;
    if (_prev.bodyMinHeight !== null) document.body.style.minHeight = _prev.bodyMinHeight;
    if (_prev.bodyBg !== null) document.body.style.background = _prev.bodyBg;
  }

  // -------------------- Page rendering --------------------
  function getTotalPages() {
    return 1 + Math.ceil(NFC_ITEMS.length / _opts.itemsPerPage); // intro + items pages
  }

  function renderPage(card, overlay) {
    const root = document.getElementById('nfcPageRoot');
    const sub = document.getElementById('nfcSubTitle');
    const prog = document.getElementById('nfcProgressText');
    if (!root) return;

    root.innerHTML = '';
    overlay.scrollTop = 0;
    _pageStartT = performance.now();

    const totalPages = getTotalPages();
    prog.textContent = `Page ${_pageIndex + 1} of ${totalPages}`;

    if (_pageIndex === 0) {
      sub.textContent = _opts.subtitle || 'Need for Cognition';
      root.appendChild(renderIntroPage(card, overlay));
      return;
    }

    const itemPageIdx = _pageIndex - 1;
    const start = itemPageIdx * _opts.itemsPerPage;
    const end = Math.min(start + _opts.itemsPerPage, NFC_ITEMS.length);
    sub.textContent = `Items ${start + 1}-${end} of ${NFC_ITEMS.length}`;
    root.appendChild(renderItemsPage(start, end, card, overlay));
  }

  function renderIntroPage(card, overlay) {
    const wrap = document.createElement('div');

    wrap.appendChild(makeInstructionBlock(
      'Please indicate how much you agree or disagree with each statement. Answer every item before continuing.'
    ));

    const section = makeSectionCard('Instructions');
    section.appendChild(makeParagraph(`Response scale: ${_opts.scaleMin} = ${_opts.minLabel}, ${_opts.scaleMax} = ${_opts.maxLabel}.`));
    section.appendChild(makeParagraph('This file computes the reverse-scored total and mean automatically.'));
    wrap.appendChild(section);

    const btnRow = makeNavRow();
    const nextBtn = makePrimaryButton('Start Survey');
    nextBtn.addEventListener('click', () => {
      _pageTimes.push({ page_index: _pageIndex + 1, rt_ms: performance.now() - (_pageStartT || performance.now()) });
      _pageIndex = 1;
      renderPage(card, overlay);
    });
    btnRow.appendChild(nextBtn);
    wrap.appendChild(btnRow);

    return wrap;
  }

  function renderItemsPage(startIdx, endIdx, card, overlay) {
    const wrap = document.createElement('div');

    const form = document.createElement('form');
    form.autocomplete = 'off';
    wrap.appendChild(form);

    for (let i = startIdx; i < endIdx; i++) {
      const item = NFC_ITEMS[i];
      form.appendChild(
        makeLikertQuestion({
          name: `nfc_item_${item.n}`,
          label: `${item.n}) ${item.text}`,
          minLabel: _opts.minLabel,
          maxLabel: _opts.maxLabel,
          scaleMin: _opts.scaleMin,
          scaleMax: _opts.scaleMax,
          required: true,
          initial: _responses[item.n]
        })
      );
    }

    const btnRow = makeNavRow();
    if (_pageIndex > 1) {
      const backBtn = makeSecondaryButton('Back');
      backBtn.type = 'button';
      backBtn.addEventListener('click', () => {
        savePageResponses(form, startIdx, endIdx);
        _pageTimes.push({ page_index: _pageIndex + 1, rt_ms: performance.now() - (_pageStartT || performance.now()) });
        _pageIndex -= 1;
        renderPage(card, overlay);
      });
      btnRow.appendChild(backBtn);
    }

    const isLast = endIdx >= NFC_ITEMS.length;
    const nextBtn = makePrimaryButton(isLast ? 'Submit Survey' : 'Next');
    nextBtn.type = 'submit';
    btnRow.appendChild(nextBtn);
    form.appendChild(btnRow);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const ok = savePageResponses(form, startIdx, endIdx, true);
      if (!ok) return;

      _pageTimes.push({ page_index: _pageIndex + 1, rt_ms: performance.now() - (_pageStartT || performance.now()) });

      if (isLast) {
        finalizeSurvey();
      } else {
        _pageIndex += 1;
        renderPage(card, overlay);
      }
    });

    return wrap;
  }

  function savePageResponses(form, startIdx, endIdx, showAlertOnMissing) {
    for (let i = startIdx; i < endIdx; i++) {
      const item = NFC_ITEMS[i];
      const checked = form.querySelector(`input[name="nfc_item_${item.n}"]:checked`);
      if (!checked) {
        if (showAlertOnMissing) alert('Please answer every item on this page before continuing.');
        return false;
      }
      _responses[item.n] = Number(checked.value);
    }
    return true;
  }

  function finalizeSurvey() {
    const now = performance.now();
    const id = participantData?.id || 'unknown';
    const timeElapsed = now - (participantData?.startTime || now);

    const scoring = computeScores(_responses, Number(_opts.scaleMin), Number(_opts.scaleMax));

    const summary = {
      id,
      nfc_scale_min: Number(_opts.scaleMin),
      nfc_scale_max: Number(_opts.scaleMax),
      nfc_min_label: String(_opts.minLabel || ''),
      nfc_max_label: String(_opts.maxLabel || ''),
      nfc_total_items: NFC_ITEMS.length,
      nfc_reverse_items: REVERSE_ITEM_NUMBERS.join('|'),
      nfc_raw_total: scoring.rawTotal,
      nfc_raw_mean: scoring.rawMean,
      nfc_scored_total: scoring.scoredTotal,
      nfc_scored_mean: scoring.scoredMean,
      nfc_possible_min_total: scoring.possibleMinTotal,
      nfc_possible_max_total: scoring.possibleMaxTotal,
      nfc_page_rt_ms_json: JSON.stringify(_pageTimes || []),
      nfc_survey_rt_total: now - (_surveyStartT || now),
      nfc_item_order: NFC_ITEMS.map(x => x.n).join('|'),
      time_elapsed: timeElapsed
    };

    for (const item of NFC_ITEMS) {
      const raw = Number(_responses[item.n]);
      const scored = scoreOne(raw, item.reverse, Number(_opts.scaleMin), Number(_opts.scaleMax));
      summary[`nfc_item_${item.n}_raw`] = raw;
      summary[`nfc_item_${item.n}_scored`] = scored;
      summary[`nfc_item_${item.n}_reverse`] = item.reverse ? 1 : 0;
    }

    participantData[_opts.participantDataKey] = summary;

    if (_opts.mergeIntoPostSurveyIfPresent && participantData.postSurvey && typeof participantData.postSurvey === 'object') {
      Object.assign(participantData.postSurvey, summary);
    }

    (participantData.trials ||= []).push({
      id,
      trial_index: participantData.trials.length + 1,
      trial_type: 'need_for_cognition_survey',
      rt: now - (_pageStartT || now),
      ...summary
    });

    finishNeedForCognitionSurvey();
  }

  function scoreOne(raw, reverse, minV, maxV) {
    const x = Number(raw);
    if (!Number.isFinite(x)) return NaN;
    return reverse ? (minV + maxV - x) : x;
  }

  function computeScores(responses, minV, maxV) {
    let rawTotal = 0;
    let scoredTotal = 0;
    for (const item of NFC_ITEMS) {
      const raw = Number(responses[item.n]);
      rawTotal += raw;
      scoredTotal += scoreOne(raw, item.reverse, minV, maxV);
    }
    return {
      rawTotal,
      rawMean: rawTotal / NFC_ITEMS.length,
      scoredTotal,
      scoredMean: scoredTotal / NFC_ITEMS.length,
      possibleMinTotal: NFC_ITEMS.length * minV,
      possibleMaxTotal: NFC_ITEMS.length * maxV
    };
  }

  // -------------------- UI helpers --------------------
  function makeInstructionBlock(text) {
    const box = document.createElement('div');
    box.style.padding = '12px 14px';
    box.style.borderRadius = '14px';
    box.style.border = '1px solid #EFE7C9';
    box.style.background = '#FFFCF1';
    box.style.color = THEME.text;
    box.style.fontSize = '14px';
    box.style.lineHeight = '1.45';
    box.style.fontWeight = '650';
    box.style.marginBottom = '10px';
    box.textContent = text || '';
    return box;
  }

  function makeParagraph(text) {
    const p = document.createElement('div');
    p.style.fontSize = '14px';
    p.style.color = THEME.text;
    p.style.marginBottom = '8px';
    p.textContent = text || '';
    return p;
  }

  function makeSectionCard(titleText) {
    const section = document.createElement('div');
    section.style.border = '1px solid #EFE7C9';
    section.style.borderRadius = '14px';
    section.style.padding = '14px 14px';
    section.style.margin = '14px 0';
    section.style.background = '#FFFCF1';

    if (titleText) {
      const title = document.createElement('div');
      title.textContent = titleText;
      title.style.fontWeight = '700';
      title.style.marginBottom = '10px';
      title.style.fontSize = '14px';
      section.appendChild(title);
    }
    return section;
  }

  function makeLikertQuestion({ name, label, minLabel, maxLabel, scaleMin, scaleMax, required, initial }) {
    const section = makeSectionCard(label);

    const row = document.createElement('div');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '120px 1fr 120px';
    row.style.alignItems = 'center';
    row.style.gap = '10px';
    section.appendChild(row);

    const left = document.createElement('div');
    left.textContent = minLabel || '';
    left.style.fontSize = '12px';
    left.style.color = THEME.muted;

    const right = document.createElement('div');
    right.textContent = maxLabel || '';
    right.style.fontSize = '12px';
    right.style.color = THEME.muted;
    right.style.textAlign = 'right';

    const radios = document.createElement('div');
    radios.style.display = 'flex';
    radios.style.gap = '10px';
    radios.style.justifyContent = 'center';
    radios.style.flexWrap = 'wrap';

    for (let v = scaleMin; v <= scaleMax; v++) {
      const pill = document.createElement('label');
      pill.style.display = 'flex';
      pill.style.alignItems = 'center';
      pill.style.gap = '8px';
      pill.style.padding = '8px 10px';
      pill.style.border = '1px solid #E7DEBF';
      pill.style.borderRadius = '999px';
      pill.style.background = '#FFFFFF';
      pill.style.cursor = 'pointer';
      pill.style.userSelect = 'none';

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = name;
      input.value = String(v);
      if (required) input.required = true;
      if (String(initial ?? '') === String(v)) input.checked = true;

      input.addEventListener('focus', () => {
        pill.style.outline = 'none';
        pill.style.boxShadow = THEME.focusShadow;
      });
      input.addEventListener('blur', () => {
        pill.style.boxShadow = 'none';
      });

      const t = document.createElement('span');
      t.textContent = String(v);
      t.style.fontSize = '14px';
      t.style.fontWeight = '600';

      pill.appendChild(input);
      pill.appendChild(t);
      radios.appendChild(pill);
    }

    row.appendChild(left);
    row.appendChild(radios);
    row.appendChild(right);

    return section;
  }

  function makeNavRow() {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'flex-end';
    row.style.gap = '10px';
    row.style.marginTop = '18px';
    return row;
  }

  function makePrimaryButton(text) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text || 'Next';
    btn.style.border = 'none';
    btn.style.borderRadius = '12px';
    btn.style.padding = '12px 18px';
    btn.style.fontSize = '16px';
    btn.style.fontWeight = '700';
    btn.style.cursor = 'pointer';
    btn.style.background = '#1F6FEB';
    btn.style.color = '#FFFFFF';
    btn.style.boxShadow = '0 6px 16px rgba(31, 111, 235, 0.25)';
    return btn;
  }

  function makeSecondaryButton(text) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text || 'Back';
    btn.style.border = '1px solid #D8CDA3';
    btn.style.borderRadius = '12px';
    btn.style.padding = '12px 18px';
    btn.style.fontSize = '16px';
    btn.style.fontWeight = '700';
    btn.style.cursor = 'pointer';
    btn.style.background = '#FFFFFF';
    btn.style.color = THEME.text;
    return btn;
  }
})();