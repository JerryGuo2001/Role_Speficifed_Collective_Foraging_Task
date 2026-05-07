// ========================== bisBasSurvey.js ==========================
// Separate BIS/BAS survey in the same style as cognitionSurvey.js
// - Multi-page overlay survey
// - 20 BIS/BAS items
// - Reverse-scores items 1 and 18
// - Computes subscale sums and means
// - Saves item-level raw/scored responses and scale scores into participantData
// - Optionally merges into participantData.postSurvey

(function () {
  // Public API
  window.startBISBASSurvey = startBISBASSurvey;
  window.finishBISBASSurvey = finishBISBASSurvey;

  // -------------------- Config --------------------
  const DEFAULT_OPTIONS = {
    title: 'Additional Survey',
    subtitle: 'BIS/BAS Scale',
    scaleMin: 1,
    scaleMax: 4,
    minLabel: 'Strongly Agree',
    maxLabel: 'Strongly Disagree',
    itemsPerPage: 8,
    mergeIntoPostSurveyIfPresent: true,
    participantDataKey: 'bisbasSurvey'
  };

  const BIS_BAS_ITEMS = [
    { n: 1,  reverse: true,  text: 'Even if something bad is about to happen to me, I rarely experience fear or nervousness.' },
    { n: 2,  reverse: false, text: 'I go out of my way to get things I want.' },
    { n: 3,  reverse: false, text: 'When I\'m doing well at something, I love to keep at it.' },
    { n: 4,  reverse: false, text: 'I\'m always willing to try something new if I think it will be fun.' },
    { n: 5,  reverse: false, text: 'When I get something I want, I feel excited and energized.' },
    { n: 6,  reverse: false, text: 'Criticism or scolding hurts me quite a bit.' },
    { n: 7,  reverse: false, text: 'When I want something, I usually go all-out to get it.' },
    { n: 8,  reverse: false, text: 'I will often do things for no other reason than that they might be fun.' },
    { n: 9,  reverse: false, text: 'If I see a chance to get something I want, I move on it right away.' },
    { n: 10, reverse: false, text: 'I feel pretty worried or upset when I think or know somebody is angry at me.' },
    { n: 11, reverse: false, text: 'When I see an opportunity for something I like, I get excited right away.' },
    { n: 12, reverse: false, text: 'I often act on the spur of the moment.' },
    { n: 13, reverse: false, text: 'If I think something unpleasant is going to happen, I usually get pretty "worked up."' },
    { n: 14, reverse: false, text: 'When good things happen to me, it affects me strongly.' },
    { n: 15, reverse: false, text: 'I feel worried when I think I have done poorly at something important.' },
    { n: 16, reverse: false, text: 'I crave excitement and new sensations.' },
    { n: 17, reverse: false, text: 'When I go after something, I use a "no holds barred" approach.' },
    { n: 18, reverse: true,  text: 'I have very few fears compared to my friends.' },
    { n: 19, reverse: false, text: 'It would excite me to win a contest.' },
    { n: 20, reverse: false, text: 'I worry about making mistakes.' }
  ];

  const SUBSCALES = {
    bas_drive: [2, 7, 9, 17],
    bas_fun_seeking: [4, 8, 12, 16],
    bas_reward_responsiveness: [3, 5, 11, 14, 19],
    bis: [1, 6, 10, 13, 15, 18, 20]
  };

  const REVERSE_ITEM_NUMBERS = BIS_BAS_ITEMS.filter(x => x.reverse).map(x => x.n);

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
  function startBISBASSurvey(onComplete, options) {
    if (_started) return;

    _started = true;
    _onComplete = typeof onComplete === 'function' ? onComplete : null;
    _opts = { ...DEFAULT_OPTIONS, ...(options || {}) };
    _surveyStartT = performance.now();
    _pageTimes = [];
    _responses = Object.create(null);

    if (!Number.isFinite(Number(_opts.scaleMin))) _opts.scaleMin = 1;
    if (!Number.isFinite(Number(_opts.scaleMax))) _opts.scaleMax = 4;
    if (Number(_opts.scaleMax) <= Number(_opts.scaleMin)) _opts.scaleMax = Number(_opts.scaleMin) + 3;
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
    progressText.id = 'bisbasProgressText';
    progressText.style.fontSize = '13px';
    progressText.style.color = THEME.muted;
    header.appendChild(progressText);

    const sub = document.createElement('div');
    sub.id = 'bisbasSubTitle';
    sub.style.margin = '0 0 10px 0';
    sub.style.color = THEME.muted;
    sub.style.fontSize = '14px';
    sub.textContent = _opts.subtitle || 'BIS/BAS Scale';
    card.appendChild(sub);

    const divider = document.createElement('div');
    divider.style.height = '1px';
    divider.style.background = '#EFE7C9';
    divider.style.margin = '16px 0 18px 0';
    card.appendChild(divider);

    const pageRoot = document.createElement('div');
    pageRoot.id = 'bisbasPageRoot';
    card.appendChild(pageRoot);

    _pageIndex = 0;
    renderPage(card, overlay);
    overlay.scrollTop = 0;
  }

  function finishBISBASSurvey() {
    const overlay = document.getElementById('bisbasSurveyOverlay');
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
    let overlay = document.getElementById('bisbasSurveyOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'bisbasSurveyOverlay';
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
    return 1 + Math.ceil(BIS_BAS_ITEMS.length / _opts.itemsPerPage); // intro + item pages
  }

  function renderPage(card, overlay) {
    const root = document.getElementById('bisbasPageRoot');
    const sub = document.getElementById('bisbasSubTitle');
    const prog = document.getElementById('bisbasProgressText');
    if (!root) return;

    root.innerHTML = '';
    overlay.scrollTop = 0;
    _pageStartT = performance.now();

    const totalPages = getTotalPages();
    prog.textContent = `Page ${_pageIndex + 1} of ${totalPages}`;

    if (_pageIndex === 0) {
      sub.textContent = _opts.subtitle || 'BIS/BAS Scale';
      root.appendChild(renderIntroPage(card, overlay));
      return;
    }

    const itemPageIdx = _pageIndex - 1;
    const start = itemPageIdx * _opts.itemsPerPage;
    const end = Math.min(start + _opts.itemsPerPage, BIS_BAS_ITEMS.length);
    sub.textContent = `Items ${start + 1}-${end} of ${BIS_BAS_ITEMS.length}`;
    root.appendChild(renderItemsPage(start, end, card, overlay));
  }

  function renderIntroPage(card, overlay) {
    const wrap = document.createElement('div');

    wrap.appendChild(makeInstructionBlock(
      'Each item is a statement with which you may either agree or disagree. For each item, indicate how much you agree or disagree with what the item says. Please respond to every item.'
    ));

    const section = makeSectionCard('Instructions');
    section.appendChild(makeParagraph('Choose only one response to each statement. Please be as accurate and honest as you can be.'));
    section.appendChild(makeParagraph(`Response scale: ${_opts.scaleMin} = ${_opts.minLabel}, ${_opts.scaleMax} = ${_opts.maxLabel}.`));
    section.appendChild(makeParagraph('This file automatically computes reverse-scored items, BIS, BAS Drive, BAS Fun Seeking, and BAS Reward Responsiveness scores.'));
    wrap.appendChild(section);

    const btnRow = makeNavRow();
    const nextBtn = makePrimaryButton('Start Survey');
    nextBtn.addEventListener('click', () => {
      _pageTimes.push({
        page_index: _pageIndex + 1,
        rt_ms: performance.now() - (_pageStartT || performance.now())
      });
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
      const item = BIS_BAS_ITEMS[i];
      form.appendChild(
        makeLikertQuestion({
          name: `bisbas_item_${item.n}`,
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
        _pageTimes.push({
          page_index: _pageIndex + 1,
          rt_ms: performance.now() - (_pageStartT || performance.now())
        });
        _pageIndex -= 1;
        renderPage(card, overlay);
      });
      btnRow.appendChild(backBtn);
    }

    const isLast = endIdx >= BIS_BAS_ITEMS.length;
    const nextBtn = makePrimaryButton(isLast ? 'Submit Survey' : 'Next');
    nextBtn.type = 'submit';
    btnRow.appendChild(nextBtn);
    form.appendChild(btnRow);

    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const ok = savePageResponses(form, startIdx, endIdx, true);
      if (!ok) return;

      _pageTimes.push({
        page_index: _pageIndex + 1,
        rt_ms: performance.now() - (_pageStartT || performance.now())
      });

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
      const item = BIS_BAS_ITEMS[i];
      const checked = form.querySelector(`input[name="bisbas_item_${item.n}"]:checked`);
      if (!checked) {
        if (showAlertOnMissing) {
          alert('Please answer every item on this page before continuing.');
        }
        return false;
      }
      _responses[item.n] = Number(checked.value);
    }
    return true;
  }

  function finalizeSurvey() {
    const now = performance.now();
    const id = (typeof participantData !== 'undefined' && participantData?.id) ? participantData.id : 'unknown';
    const startTime = (typeof participantData !== 'undefined' && participantData?.startTime) ? participantData.startTime : now;
    const timeElapsed = now - startTime;

    const scoring = computeScores(_responses, Number(_opts.scaleMin), Number(_opts.scaleMax));

    const summary = {
      id,
      bisbas_scale_min: Number(_opts.scaleMin),
      bisbas_scale_max: Number(_opts.scaleMax),
      bisbas_min_label: String(_opts.minLabel || ''),
      bisbas_max_label: String(_opts.maxLabel || ''),
      bisbas_total_items: BIS_BAS_ITEMS.length,
      bisbas_reverse_items: REVERSE_ITEM_NUMBERS.join('|'),
      bisbas_page_rt_ms_json: JSON.stringify(_pageTimes || []),
      bisbas_survey_rt_total: now - (_surveyStartT || now),
      bisbas_item_order: BIS_BAS_ITEMS.map(x => x.n).join('|'),

      bisbas_raw_total: scoring.rawTotal,
      bisbas_raw_mean: scoring.rawMean,
      bisbas_scored_total: scoring.scoredTotal,
      bisbas_scored_mean: scoring.scoredMean,
      bisbas_possible_min_total: scoring.possibleMinTotal,
      bisbas_possible_max_total: scoring.possibleMaxTotal,

      bis_score_sum: scoring.subscales.bis.sum,
      bis_score_mean: scoring.subscales.bis.mean,

      bas_drive_sum: scoring.subscales.bas_drive.sum,
      bas_drive_mean: scoring.subscales.bas_drive.mean,

      bas_fun_seeking_sum: scoring.subscales.bas_fun_seeking.sum,
      bas_fun_seeking_mean: scoring.subscales.bas_fun_seeking.mean,

      bas_reward_responsiveness_sum: scoring.subscales.bas_reward_responsiveness.sum,
      bas_reward_responsiveness_mean: scoring.subscales.bas_reward_responsiveness.mean,

      bas_total_sum: scoring.basTotalSum,
      bas_total_mean: scoring.basTotalMean,

      time_elapsed: timeElapsed
    };

    for (const item of BIS_BAS_ITEMS) {
      const raw = Number(_responses[item.n]);
      const scored = scoreOne(raw, item.reverse, Number(_opts.scaleMin), Number(_opts.scaleMax));
      summary[`bisbas_item_${item.n}_raw`] = raw;
      summary[`bisbas_item_${item.n}_scored`] = scored;
      summary[`bisbas_item_${item.n}_reverse`] = item.reverse ? 1 : 0;
    }

    if (typeof participantData !== 'undefined') {
      participantData[_opts.participantDataKey] = summary;

      if (_opts.mergeIntoPostSurveyIfPresent && participantData.postSurvey && typeof participantData.postSurvey === 'object') {
        Object.assign(participantData.postSurvey, summary);
      }

      if (!Array.isArray(participantData.trials)) {
        participantData.trials = [];
      }

      participantData.trials.push({
        id,
        trial_index: participantData.trials.length + 1,
        trial_type: 'bis_bas_survey',
        rt: now - (_pageStartT || now),
        ...summary
      });
    }

    finishBISBASSurvey();
  }

  // -------------------- Scoring --------------------
  function scoreOne(raw, reverse, minV, maxV) {
    const x = Number(raw);
    if (!Number.isFinite(x)) return NaN;
    return reverse ? (minV + maxV - x) : x;
  }

  function sumItems(itemNums, responses, minV, maxV) {
    let sum = 0;
    for (const n of itemNums) {
      const item = BIS_BAS_ITEMS.find(x => x.n === n);
      const raw = Number(responses[n]);
      sum += scoreOne(raw, item?.reverse, minV, maxV);
    }
    return sum;
  }

  function computeScores(responses, minV, maxV) {
    let rawTotal = 0;
    let scoredTotal = 0;

    for (const item of BIS_BAS_ITEMS) {
      const raw = Number(responses[item.n]);
      rawTotal += raw;
      scoredTotal += scoreOne(raw, item.reverse, minV, maxV);
    }

    const subscales = {};
    for (const [name, nums] of Object.entries(SUBSCALES)) {
      const sum = sumItems(nums, responses, minV, maxV);
      subscales[name] = {
        sum,
        mean: sum / nums.length,
        n_items: nums.length,
        items: nums.join('|')
      };
    }

    const basTotalSum =
      subscales.bas_drive.sum +
      subscales.bas_fun_seeking.sum +
      subscales.bas_reward_responsiveness.sum;

    const basItemCount =
      SUBSCALES.bas_drive.length +
      SUBSCALES.bas_fun_seeking.length +
      SUBSCALES.bas_reward_responsiveness.length;

    return {
      rawTotal,
      rawMean: rawTotal / BIS_BAS_ITEMS.length,
      scoredTotal,
      scoredMean: scoredTotal / BIS_BAS_ITEMS.length,
      possibleMinTotal: BIS_BAS_ITEMS.length * minV,
      possibleMaxTotal: BIS_BAS_ITEMS.length * maxV,
      subscales,
      basTotalSum,
      basTotalMean: basTotalSum / basItemCount
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