# 휩 - LaTeX → 한글(HWP) 수식 복사 — 크롬 확장

[GitHub Repository (Separate)](https://github.com/minigu5/latex-to-hwp-extension)

ChatGPT·Claude 답변의 수식 위에 마우스를 올리면 오른쪽 아래에 **"HWP 복사"** 버튼이 떠서,
클릭 한 번으로 한글(HWP) 수식 편집기 문법으로 변환해 클립보드에 복사한다.
확장 아이콘을 누르면 LaTeX를 직접 입력해 변환하는 팝업도 쓸 수 있다.

## 왜 확장이 더 정확한가

ChatGPT·Claude는 수식을 **KaTeX**로 렌더링하며, 원본 LaTeX를 DOM의
`<annotation encoding="application/x-tex">` 안에 보존한다. 확장은 이 값을 직접 읽으므로
**위/아래 첨자 손실 없이** 원본 LaTeX를 그대로 추출한다. (웹앱에서 렌더된 수식을 복사할 때
첨자가 사라져 휴리스틱으로 복구하던 문제가 확장에서는 발생하지 않는다.)

## 동작 방식 (사이트별)

- **ChatGPT·Claude·Grok 등 (KaTeX + annotation):** 수식에 마우스를 올리면 **"HWP 복사"** 버튼이 떠서 원본 LaTeX를 추출·변환·복사한다.
- **Gemini:** annotation이 없어 호버 버튼이 동작하지 않는다. 대신 수식을 선택해 `⌘/Ctrl+C`로 복사하면 클립보드의 LaTeX를 가로채 한글 수식으로 바꿔 준다. **이 복사 가로채기는 Gemini에서만 활성화**되며(`content.js`의 `HINT_SITE`), 그 외 사이트에서는 사용자의 복사 행위를 건드리지 않고 호버 "HWP 복사" 버튼으로만 변환한다.

## 설치 (개발자 모드)

1. 크롬에서 `chrome://extensions` 접속
2. 우측 상단 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램 로드** → 이 `chrome-extension/` 폴더 선택

## 구조

```
manifest.json          MV3 매니페스트 (ChatGPT·Claude에 content script 주입)
lib/converter.js       ⚠️ src/converter.js 의 사본 (직접 수정 금지)
content/content.js     호버 감지 + LaTeX 추출 + 변환·복사 (플로팅 버튼)
content/content.css    플로팅 버튼 스타일
popup/                 수동 입력 UI (LaTeX → 변환 → 복사)
icons/                 16/48/128 아이콘 (플레이스홀더)
```

## 변환 로직 동기화

`lib/converter.js`는 프로젝트 루트 `src/converter.js`의 **사본**이다. 원본을 고치면 루트에서:

```bash
npm run sync:ext
```

## 지원 사이트

ChatGPT·Claude·Gemini·AI Studio·Perplexity·Copilot·Bing·Poe·DeepSeek·Mistral·Grok(grok.com, x.com)·
HuggingChat·Phind·You.com·ChatGLM·Tongyi·Doubao·Kimi 등 주요 AI 사이트에 **자동 주입**된다
(전체 목록은 `manifest.json`의 `content_scripts.matches`).

### 목록에 없는 페이지 — 강제 On

자동 지원 목록에 없는 페이지에서는 **확장 아이콘 → "이 페이지에서 켜기"** 버튼으로
현재 탭에 수동 주입할 수 있다(`activeTab` + `scripting` 권한, `chrome.scripting.executeScript`).
팝업은 현재 탭 URL을 manifest의 `matches`와 대조해 상태(자동 지원 / 강제 On 가능 / 사용 불가)를 표시한다.

(KaTeX를 쓰는 사이트면 어디서든 동작한다. MathJax 기반 사이트는 원본 TeX 보존이 불확실해
별도 대응이 필요 — 추후 확장.)
