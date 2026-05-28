'use strict';

/*
 * background service worker
 *
 * "이 페이지에서 켜기"로 영구 호스트 권한을 부여받은 origin들을 동적 콘텐츠
 * 스크립트로 등록한다 — 새로고침/재방문해도 자동 주입되도록.
 *
 * 권한 다이얼로그 동안 popup이 포커스를 잃어 닫히면 popup의 콜백이 실행되지
 * 않는다. 그래서 권한 부여 직후의 모든 처리(동적 등록 + 즉시 주입)를 여기서
 * chrome.permissions.onAdded 로 받아 처리한다. 사용자는 다이얼로그에서
 * "허용"만 누르면 그 즉시 활성화가 끝난다.
 *
 * 강제 적용 사이트(동적 등록 대상)는 정적 content_scripts 보다 광범위하게
 * 동작한다 — allFrames(iframe 포함), matchOriginAsFallback(about:blank/srcdoc),
 * 그리고 content-forced.js 가 켜는 __hwpForceFullCompat 플래그로 content.js의
 * 셀렉터/추출 경로가 확장된다. 기본 정적 매칭 사이트의 동작은 그대로다.
 */

var SCRIPT_ID = 'hwp-force-on';
var INJECT_JS_FORCED = ['lib/converter.js', 'content/content-forced.js', 'content/content.js'];
var INJECT_CSS = ['content/content.css'];

function getStaticMatches() {
  try {
    var cs = chrome.runtime.getManifest().content_scripts || [];
    return cs[0] && cs[0].matches ? cs[0].matches.slice() : [];
  } catch (e) { return []; }
}

function syncDynamicScripts(cb) {
  var staticMatches = getStaticMatches();
  chrome.permissions.getAll(function (perms) {
    var origins = (perms && perms.origins ? perms.origins : []).filter(function (o) {
      if (!/^https?:\/\//.test(o)) return false;             // <all_urls> 등 제외
      return staticMatches.indexOf(o) === -1;                // 정적 매칭과 중복 제거
    });

    chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] }, function (existing) {
      var hasExisting = existing && existing.length > 0;
      var done = function () { void chrome.runtime.lastError; if (cb) cb(); };

      if (origins.length === 0) {
        if (hasExisting) chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }, done);
        else done();
        return;
      }

      var spec = {
        id: SCRIPT_ID,
        matches: origins,
        js: INJECT_JS_FORCED,
        css: INJECT_CSS,
        runAt: 'document_idle',
        allFrames: true,                  // iframe 안의 수식도 변환 대상
        matchOriginAsFallback: true,      // about:blank/srcdoc iframe까지
        persistAcrossSessions: true
      };

      if (hasExisting) chrome.scripting.updateContentScripts([spec], done);
      else chrome.scripting.registerContentScripts([spec], done);
    });
  });
}

// origin 패턴(예: https://example.com/*)에 매칭되는 현재 탭들에 즉시 주입.
// 새로고침 없이 바로 활성화되게 한다.
function injectIntoMatchingTabs(originPattern) {
  if (!originPattern || !/^https?:\/\//.test(originPattern)) return;
  chrome.tabs.query({ url: originPattern }, function (tabs) {
    if (chrome.runtime.lastError || !tabs) return;
    tabs.forEach(function (tab) {
      if (!tab.id) return;
      chrome.scripting.insertCSS({
        target: { tabId: tab.id, allFrames: true },
        files: INJECT_CSS
      }, function () {
        void chrome.runtime.lastError; // CSS 차단 페이지는 무시
        chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: INJECT_JS_FORCED
        }, function () { void chrome.runtime.lastError; });
      });
    });
  });
}

// service worker가 깨어날 때마다 한 번 동기화 (이벤트가 모두 놓친 경우 대비).
syncDynamicScripts();

chrome.runtime.onInstalled.addListener(function () { syncDynamicScripts(); });
chrome.runtime.onStartup.addListener(function () { syncDynamicScripts(); });

chrome.permissions.onAdded.addListener(function (perms) {
  // 1) 다음 로드부터 자동 주입되도록 동적 등록 동기화
  syncDynamicScripts(function () {
    // 2) 새로 받은 origin들에 매칭되는 현재 활성 탭에는 즉시 주입
    (perms && perms.origins ? perms.origins : []).forEach(function (o) {
      injectIntoMatchingTabs(o);
    });
  });
});
chrome.permissions.onRemoved.addListener(function () { syncDynamicScripts(); });

// popup이 살아있다면 활성화 완료를 알 수 있도록 메시지도 받아 처리.
chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
  if (msg && msg.type === 'sync-scripts') {
    syncDynamicScripts(function () { sendResponse({ ok: true }); });
    return true; // 비동기 응답
  }
  return false;
});
