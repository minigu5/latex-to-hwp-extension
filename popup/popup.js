'use strict';

/* 팝업: 수동 LaTeX 입력 → window.LatexToHwp.convert → 출력 → 복사.
 * app.js 의 입력→변환→복사 흐름을 축약 이식 (KaTeX 미리보기는 제외). */
(function () {
  var input = document.getElementById('input');
  var output = document.getElementById('output');
  var copyBtn = document.getElementById('copyBtn');
  var hint = document.getElementById('hint');

  var DEFAULT_HINT = hint.textContent;
  var hintTimer = null;

  function flashHint(msg) {
    clearTimeout(hintTimer);
    hint.textContent = msg;
    hint.classList.add('copied');
    hintTimer = setTimeout(function () {
      hint.textContent = DEFAULT_HINT;
      hint.classList.remove('copied');
    }, 1500);
  }

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
      } catch (e) { /* noop */ }
      document.body.removeChild(ta);
    }
  }

  function render() {
    var result = (window.LatexToHwp && window.LatexToHwp.convert)
      ? window.LatexToHwp.convert(input.value) : '';
    output.textContent = result;
  }

  input.addEventListener('input', render);

  copyBtn.addEventListener('click', function () {
    copyText(output.textContent, function () {
      copyBtn.textContent = '복사됨!';
      copyBtn.classList.add('copied');
      flashHint('클립보드에 복사됨 ✓');
      setTimeout(function () {
        copyBtn.textContent = '복사';
        copyBtn.classList.remove('copied');
      }, 1200);
    });
  });

  render();
  input.focus();

  // ── 현재 페이지 상태 + 강제 On ─────────────────────────────────
  // 알려진 AI 사이트는 manifest 의 content_scripts.matches 로 자동 주입된다.
  // 목록에 없는 페이지에서는 activeTab + scripting 으로 같은 파일을 수동 주입한다.
  var pageStatus = document.getElementById('pageStatus');
  var pageStatusText = document.getElementById('pageStatusText');
  var forceOnBtn = document.getElementById('forceOnBtn');

  // chrome 확장 API가 없으면(예: 파일로 직접 열기) 이 영역은 숨긴다.
  if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.scripting) {
    if (pageStatus) pageStatus.hidden = true;
    return;
  }

  // match 패턴 → 정규식 (우리가 쓰는 scheme://host/path, *.host, /* 형태를 커버)
  function matchToRegex(pattern) {
    if (pattern === '<all_urls>') return /^https?:\/\//;
    var m = pattern.match(/^(\*|https?):\/\/([^\/]+)(\/.*)$/);
    if (!m) return null;
    var scheme = m[1] === '*' ? 'https?' : m[1];
    var host = m[2]
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')   // * 제외 정규식 특수문자 이스케이프
      .replace(/^\*\\\./, '([^/]+\\.)?')        // 선행 *. → 선택적 서브도메인
      .replace(/\*/g, '[^/]*');                 // 그 외 * → 호스트 일부
    var path = m[3]
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp('^' + scheme + '://' + host + path);
  }

  var manifest = chrome.runtime.getManifest();
  var matches = (manifest.content_scripts && manifest.content_scripts[0] &&
    manifest.content_scripts[0].matches) || [];
  var INJECT_FILES = (manifest.content_scripts && manifest.content_scripts[0] &&
    manifest.content_scripts[0].js) || ['lib/converter.js', 'content/content.js'];
  var INJECT_CSS = (manifest.content_scripts && manifest.content_scripts[0] &&
    manifest.content_scripts[0].css) || ['content/content.css'];

  function setStatus(text, cls) {
    pageStatusText.textContent = text;
    pageStatus.className = 'page-status' + (cls ? ' ' + cls : '');
  }

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];
    var url = (tab && tab.url) || '';

    // chrome://, edge://, 웹스토어 등은 스크립트 주입 불가
    var injectable = /^https?:\/\//.test(url) &&
      !/^https:\/\/chromewebstore\.google\.com/.test(url) &&
      !/^https:\/\/chrome\.google\.com\/webstore/.test(url);
    var autoSupported = matches.some(function (p) {
      var re = matchToRegex(p);
      return re && re.test(url);
    });

    if (autoSupported) {
      setStatus('✓ 이 페이지는 자동으로 지원됩니다.', 'supported');
      forceOnBtn.hidden = true;
    } else if (injectable) {
      setStatus('자동 지원 목록에 없는 페이지입니다.', '');
      forceOnBtn.hidden = false;
    } else {
      setStatus('이 페이지에서는 사용할 수 없습니다 (브라우저 내부 페이지).', 'disabled');
      forceOnBtn.hidden = true;
    }

    forceOnBtn.addEventListener('click', function () {
      if (!tab || !tab.id) return;
      forceOnBtn.disabled = true;
      forceOnBtn.textContent = '켜는 중…';
      // CSS 먼저, 그다음 converter → content 순서로 주입
      // (content.js 는 중복 주입 가드 __hwpFormulaCopyInjected 로 안전)
      chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: INJECT_CSS })
        .catch(function () { /* 일부 페이지는 CSS만 막힐 수 있음 — 무시하고 진행 */ })
        .then(function () {
          return chrome.scripting.executeScript({ target: { tabId: tab.id }, files: INJECT_FILES });
        })
        .then(function () {
          setStatus('✓ 이 페이지에서 활성화됨! 수식 위에 마우스를 올려보세요.', 'supported');
          forceOnBtn.hidden = true;
        })
        .catch(function (err) {
          setStatus('활성화 실패: ' + ((err && err.message) ? err.message : err), 'disabled');
          forceOnBtn.disabled = false;
          forceOnBtn.textContent = '다시 시도';
        });
    });
  });
})();
