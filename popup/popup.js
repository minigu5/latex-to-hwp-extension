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

  // 활성 탭에 content script가 이미 주입돼 있는지 검사.
  // content.js 가드 플래그(__hwpFormulaCopyInjected)를 읽어 본다.
  function probeInjected(tabId) {
    return chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function () { return !!window.__hwpFormulaCopyInjected; }
    }).then(function (results) {
      return !!(results && results[0] && results[0].result);
    });
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
      return;
    }
    if (!injectable) {
      setStatus('이 페이지에서는 사용할 수 없습니다 (브라우저 내부 페이지).', 'disabled');
      forceOnBtn.hidden = true;
      return;
    }

    // injectable 페이지: 이미 강제 On 된 적이 있는지 활성 탭에서 직접 검사.
    // popup은 매번 새로 렌더되므로 페이지의 실제 상태를 봐야 정확하다.
    setStatus('현재 페이지 확인 중…', '');
    forceOnBtn.hidden = true;
    probeInjected(tab.id).then(function (injected) {
      if (injected) {
        setStatus('✓ 이 페이지에서 활성화됨. 수식 위에 마우스를 올려보세요.', 'supported');
        forceOnBtn.hidden = true;
      } else {
        setStatus('자동 지원 목록에 없는 페이지입니다.', '');
        forceOnBtn.hidden = false;
      }
    }, function () {
      // 검사 자체가 막힌 페이지(권한/보호) — 일단 켜기 버튼을 노출해 시도 허용.
      setStatus('자동 지원 목록에 없는 페이지입니다.', '');
      forceOnBtn.hidden = false;
    });

    forceOnBtn.addEventListener('click', function () {
      if (!tab || !tab.id) return;

      // 현재 origin 패턴 산출 — Chrome 권한 다이얼로그에 넘길 match pattern.
      var u;
      try { u = new URL(url); } catch (e) {
        setStatus('활성화 실패: URL을 해석할 수 없습니다.', 'disabled');
        return;
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        setStatus('활성화 실패: 지원하지 않는 프로토콜입니다.', 'disabled');
        return;
      }
      var originPattern = u.protocol + '//' + u.hostname + '/*';

      forceOnBtn.disabled = true;
      forceOnBtn.textContent = '권한 요청 중…';

      // 권한 요청만 한다. 다이얼로그 동안 popup이 포커스를 잃어 닫혀도, background의
      // chrome.permissions.onAdded 가 동적 등록 + 매칭 탭에 즉시 주입까지 처리하므로
      // 사용자는 "허용" 한 번으로 활성화가 끝난다.
      chrome.permissions.request({ origins: [originPattern] }, function (granted) {
        if (chrome.runtime.lastError || !granted) {
          var reason = (chrome.runtime.lastError && chrome.runtime.lastError.message)
            || '권한이 거부되어 활성화할 수 없습니다.';
          setStatus(reason, 'disabled');
          forceOnBtn.disabled = false;
          forceOnBtn.textContent = '다시 시도';
          return;
        }

        // popup이 아직 살아 있는 경우의 UI 마무리. background가 주입을 끝낼 시간을
        // 잠깐 주고 probe로 결과를 확인한다. (popup이 닫혔어도 background는 끝낸다.)
        setStatus('활성화 중…', '');
        forceOnBtn.textContent = '활성화 중…';
        var tries = 0;
        (function poll() {
          probeInjected(tab.id).then(function (ok) {
            if (ok) {
              setStatus('✓ 이 페이지에서 활성화됨. 새로고침해도 유지됩니다.', 'supported');
              forceOnBtn.hidden = true;
              return;
            }
            if (++tries < 8) { setTimeout(poll, 150); return; }
            // background는 곧 끝내지만 popup이 먼저 응답 — 새로고침으로 안내.
            setStatus('✓ 권한 부여 완료. 새로고침하면 활성화됩니다.', 'supported');
            forceOnBtn.hidden = true;
          }, function () {
            setStatus('✓ 권한 부여 완료. 새로고침하면 활성화됩니다.', 'supported');
            forceOnBtn.hidden = true;
          });
        })();
      });
    });
  });
})();
