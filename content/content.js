'use strict';

/*
 * LaTeX → 한글(HWP) 수식 복사 — content script
 *
 * 1) 호버 변환 버튼 (ChatGPT·Claude·Grok 등 KaTeX + annotation 사이트)
 *    수식(.katex)에 마우스를 올리면 오른쪽 아래 "HWP 복사" 버튼이 뜨고, 클릭하면
 *    <annotation encoding="application/x-tex">의 원본 LaTeX를 변환·복사한다.
 *
 * 2) 선택 안내 칩 + 복사 가로채기 (Gemini 등 annotation 없는 사이트)
 *    Gemini는 프로그램적 복사에는 유니코드 시각 텍스트만 주고, 사용자의 실제
 *    Cmd+C 에만 원본 LaTeX를 클립보드에 넣는다. 그래서 버튼이 대신 복사할 수 없다.
 *    대신 수식을 선택하면 "⌘C/Ctrl+C로 복사" 안내 칩을 띄워 복사를 유도하고,
 *    사용자가 복사하면 클립보드의 LaTeX를 읽어 한글 수식으로 바꿔 다시 써준다.
 */
(function () {
  if (window.__hwpFormulaCopyInjected) return; // 중복 주입 방지
  window.__hwpFormulaCopyInjected = true;

  var BTN_LABEL = 'HWP 복사';
  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  var COPY_KEY = IS_MAC ? '⌘C' : 'Ctrl+C';
  var HINT_LABEL = COPY_KEY + '로 복사';
  // Cmd+C 복사 가로채기는 Gemini 전용. 그 외 사이트는 사용자의 복사를 건드리지 않고
  // 수식 옆 호버 'HWP 복사' 버튼으로만 변환한다.
  var HINT_SITE = /(^|\.)gemini\.google\.com$/.test(location.hostname);

  var currentKatex = null;
  var hideTimer = null;
  var mode = 'convert';   // 'convert' = .katex annotation 변환 / 'hint' = Cmd+C 안내(Gemini)

  function convert(latex) {
    return (window.LatexToHwp && window.LatexToHwp.convert)
      ? window.LatexToHwp.convert(latex) : '';
  }
  function hasSelection() {
    var s = window.getSelection();
    return s ? s.toString().trim() : '';
  }
  // 선택 텍스트가 수식일 가능성 (일반 문장 선택에는 안내를 띄우지 않기 위한 필터)
  function looksLikeMath(s) {
    return /[\\${}^_]/.test(s) ||
      /[α-ωΑ-Ω∂∇∫∑∏√≤≥≠≈×÷±→←↔⋅·°∈∉⊂⊃∪∩∞]/.test(s);
  }
  function hasAnnotation(katex) {
    return !!(katex && katex.querySelector('annotation[encoding="application/x-tex"]'));
  }

  // ── 클립보드 복사 (app.js copyText 패턴) ───────────────────────
  function copyText(text, onSuccess) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onSuccess, legacy);
    } else {
      legacy();
    }
    function legacy() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        if (document.execCommand('copy') && onSuccess) onSuccess();
      } catch (err) { /* 복사 불가 환경 */ }
      document.body.removeChild(ta);
    }
  }

  // ── 공유 버튼 ──────────────────────────────────────────────────
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hwp-copy-btn';
  btn.textContent = BTN_LABEL;
  document.documentElement.appendChild(btn);

  function positionRect(rect) {
    var bw = btn.offsetWidth || 64;
    var bh = btn.offsetHeight || 24;
    var left = rect.right - bw + 6;     // 수식 오른쪽 아래 모서리에 살짝 걸치도록
    var top = rect.bottom - 4;
    left = Math.max(4, Math.min(left, window.innerWidth - bw - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - bh - 4));
    btn.style.left = left + 'px';
    btn.style.top = top + 'px';
  }

  function showConvert(katex) {
    mode = 'convert';
    currentKatex = katex;
    btn.classList.remove('hint');
    btn.setAttribute('aria-label', '이 수식을 한글(HWP) 수식 문법으로 복사');
    resetLabel();
    btn.style.display = 'inline-flex';
    positionRect(katex.getBoundingClientRect());
  }
  function showHint(rect) {
    mode = 'hint';
    currentKatex = null;
    btn.classList.add('hint');
    btn.setAttribute('aria-label', '수식을 선택한 채 복사하면 자동 변환됩니다');
    resetLabel();
    btn.style.display = 'inline-flex';
    positionRect(rect);
  }
  function hide() { btn.style.display = 'none'; currentKatex = null; }
  function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 220); }
  function cancelHide() { clearTimeout(hideTimer); }

  function extractLatex(katex) {
    var ann = katex.querySelector('annotation[encoding="application/x-tex"]');
    if (ann && ann.textContent) return ann.textContent.trim();
    var mml = katex.querySelector('math');
    if (mml && mml.textContent) return mml.textContent.trim();
    return (katex.textContent || '').trim();
  }

  var labelTimer = null;
  function flash(msg) {
    clearTimeout(labelTimer);
    btn.textContent = msg;
    btn.classList.add('copied');
    labelTimer = setTimeout(resetLabel, 1200);
  }
  function resetLabel() {
    clearTimeout(labelTimer);
    btn.textContent = (mode === 'hint') ? HINT_LABEL : BTN_LABEL;
    btn.classList.remove('copied');
  }

  // ── (1) 호버 변환 버튼 ─────────────────────────────────────────
  document.addEventListener('mouseover', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t === btn) { cancelHide(); return; }
    // 선택 안내가 떠 있는 동안엔 호버가 덮어쓰지 않는다
    if (mode === 'hint' && hasSelection()) return;
    var katex = t.closest('.katex');
    if (katex && hasAnnotation(katex)) { cancelHide(); showConvert(katex); }
  });
  document.addEventListener('mouseout', function (e) {
    var t = e.target;
    if (!t || mode !== 'convert') return;
    if (t === btn || (t.closest && t.closest('.katex'))) scheduleHide();
  });

  // ── (2) 선택 안내 칩 (Gemini 전용) ─────────────────────────────
  document.addEventListener('mouseup', function (e) {
    if (!HINT_SITE) return;   // '⌘C로 복사' 안내 칩은 Gemini에서만 — 그 외 사이트는 호버 버튼만
    if (e.target === btn) return;
    setTimeout(function () {
      var sel = window.getSelection();
      var text = sel ? sel.toString().trim() : '';
      if (!text || !looksLikeMath(text)) {
        if (mode === 'hint') { hide(); mode = 'convert'; }
        return;
      }
      // 선택 위치에 annotation 있는 .katex면 호버 버튼이 처리하므로 안내 생략
      var node = sel.anchorNode;
      var el = node && (node.nodeType === 1 ? node : node.parentElement);
      var k = el && el.closest ? el.closest('.katex') : null;
      if (k && hasAnnotation(k)) return;
      var rect;
      try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch (err) { return; }
      if (!rect || (!rect.width && !rect.height)) return;
      showHint(rect);
      cancelHide();
    }, 10);
  });
  document.addEventListener('selectionchange', function () {
    if (mode === 'hint' && !hasSelection()) { hide(); mode = 'convert'; }
  });

  // fixed 좌표가 어긋나므로 스크롤/리사이즈 시 숨김 (다음 호버/선택에서 재계산)
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);

  // ── 버튼 클릭 ──────────────────────────────────────────────────
  btn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (mode === 'hint') {
      toast('수식을 선택한 채 ' + COPY_KEY + ' 를 누르면 자동 변환됩니다');
      return;
    }
    var latex = currentKatex ? extractLatex(currentKatex) : '';
    if (!latex) { flash('수식 없음'); return; }
    var hwp = convert(latex) || latex;
    if (!hwp) { flash('변환 실패'); return; }
    copyText(hwp, function () { flash('복사됨!'); });
  });
  btn.addEventListener('mousedown', function (e) { e.stopPropagation(); });

  // ── (2) 복사 가로채기 (Gemini 등) ─────────────────────────────
  // 클립보드에 LaTeX 원문(\명령 또는 $ 구분자)이 들어왔을 때만 한글 수식으로 교체.
  // 변환 결과(한글 수식)는 \ 나 $ 가 없어 재변환되지 않는다.
  function isLatexSource(s) {
    return /\\[a-zA-Z]/.test(s) || /\\[\[(]/.test(s) || /\$.*\$/.test(s) || /\$\$/.test(s);
  }
  var lastWritten = '';   // 우리가 방금 쓴 결과는 무시 (자기 반응 방지)
  var copyDebounce = null;
  // Gemini에서만 사용자의 Cmd+C 를 가로채 클립보드를 한글 수식으로 교체한다.
  // 다른 사이트에서는 복사 행위만으로 자동 변환되지 않도록 리스너를 등록하지 않는다.
  if (HINT_SITE) {
    document.addEventListener('copy', function () {
      clearTimeout(copyDebounce);
      copyDebounce = setTimeout(grabClipboardAndConvert, 50);
    }, true);
  }

  function grabClipboardAndConvert() {
    if (!navigator.clipboard || !navigator.clipboard.readText) return;
    navigator.clipboard.readText().then(function (clip) {
      clip = (clip || '').trim();
      if (!clip || clip === lastWritten || !isLatexSource(clip)) return;
      var hwp = convert(clip);
      if (!hwp || hwp === clip) return;
      lastWritten = hwp;
      navigator.clipboard.writeText(hwp).then(function () {
        toast('한글 수식으로 변환됨 ✓ 그대로 붙여넣으세요');
      }, function () { /* 쓰기 실패 무시 */ });
    }, function () { /* 읽기 실패(권한/포커스) 무시 */ });
  }

  // ── 토스트 알림 ────────────────────────────────────────────────
  var toastEl = null, toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'hwp-toast';
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2000);
  }

  // ── 사용법 안내 배너 (Gemini) ──────────────────────────────────
  // 호버 버튼이 안 뜨는 사이트에선 사용법을 모를 수 있어 상단에 안내를 띄운다.
  // X로 닫으면 localStorage에 기억해 다시 띄우지 않는다.
  var BANNER_KEY = 'hwp_hint_banner_dismissed';

  function showBanner() {
    if (!HINT_SITE) return;
    try { if (localStorage.getItem(BANNER_KEY)) return; } catch (e) { /* 접근 불가 무시 */ }
    if (document.querySelector('.hwp-banner')) return;

    var bar = document.createElement('div');
    bar.className = 'hwp-banner';

    var msg = document.createElement('span');
    msg.className = 'hwp-banner-msg';
    msg.textContent = '📐 한글 수식 변환 — 수식을 드래그 선택한 뒤 ' + COPY_KEY +
      ' 로 복사하면 자동으로 변환됩니다. 한글에 그대로 붙여넣으세요.';

    var close = document.createElement('button');
    close.className = 'hwp-banner-close';
    close.type = 'button';
    close.textContent = '✕';
    close.setAttribute('aria-label', '안내 닫기');
    close.addEventListener('click', function () {
      if (bar.parentNode) bar.parentNode.removeChild(bar);
      try { localStorage.setItem(BANNER_KEY, '1'); } catch (e) { /* 무시 */ }
    });

    bar.appendChild(msg);
    bar.appendChild(close);
    document.documentElement.appendChild(bar);
  }
  showBanner();
})();
