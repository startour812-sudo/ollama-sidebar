# Ollama Sidebar

VS Code 오른쪽 사이드바에서 **로컬 Ollama 모델과 대화하고 프로젝트 파일을 읽거나 수정하는 확장**입니다. Codex app-server를 실행 엔진으로 사용하며, 모델 추론은 로컬 Ollama 서버에서 수행합니다.

## 기능과 지원 환경

- 응답 스트리밍, 파일·선택 코드 첨부, 명령 실행 결과 및 파일 변경 표시
- 명령·파일 변경 승인과 거절, 작업 중단, 대화 저장·복원
- 설치된 Ollama 모델 선택: 도구 호출(`tools`) 지원 모델만 사용 가능
- **Windows x64**, VS Code **1.106.0 이상**, 신뢰하는 로컬 작업 폴더 지원
- WSL·SSH·가상 작업 영역, 이미지 입력, 웹 검색, 플러그인, 다중 에이전트는 지원하지 않습니다.

## 설치

1. [Node.js](https://nodejs.org/) 22 이상, [VS Code](https://code.visualstudio.com/), [Ollama](https://ollama.com/)를 설치합니다. `node`, `npm`, `ollama`가 터미널에서 실행되어야 합니다.
2. 이 저장소를 복제하고 루트에서 PowerShell을 엽니다.

```powershell
git clone https://github.com/startour812-sudo/ollama-sidebar.git
cd ollama-sidebar
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-runtime.ps1
ollama pull gemma4:e4b
npm run package
```

설치 스크립트는 공식 npm 배포의 **Codex 0.150.1**과 실행 보조 파일을 `%LOCALAPPDATA%\SelfAgent\.runtime\vendor`에 설치합니다. 같은 버전은 재사용하며, 다른 버전 또는 불완전한 설치가 있으면 덮어쓰지 않고 중단합니다. 네트워크 연결이 필요합니다. 모델은 별도 다운로드이며 VSIX에 포함되지 않습니다.

3. VS Code 확장 메뉴의 **… → VSIX에서 설치**로 `artifacts/ollama-sidebar-0.1.5.vsix`를 선택합니다. 또는 다음을 실행합니다.

```powershell
code --install-extension .\artifacts\ollama-sidebar-0.1.5.vsix
```

## 사용법

프로젝트 폴더를 열고 명령 팔레트에서 **Ollama Sidebar: 채팅 열기**를 실행합니다. 여러 작업 폴더를 연 경우 사용할 폴더를 선택합니다.

- **모델명 버튼**: 설치된 모델을 선택합니다. 변경하면 현재 대화를 저장하고 새 대화를 시작합니다.
- **파일 첨부 / 선택 코드**: 현재 파일 또는 선택 범위를 첨부합니다. 합계 32KiB까지 가능합니다.
- **Enter**는 전송, **Shift+Enter**는 줄바꿈입니다. 한글 조합 중 Enter는 전송하지 않습니다.
- 실행 요청 내용을 확인하고 승인 또는 거절합니다. **중단**은 진행 중 작업을 멈추며, 완료된 파일 변경을 되돌리지 않습니다.
- **대화 목록 / ＋**로 이전 대화를 복원하거나 새 대화를 시작합니다.
- **로그** 버튼 또는 출력 패널의 **Ollama Sidebar**에서 실행 로그를 확인합니다.

## 설정과 저장

VS Code 설정에서 `Self Agent` 또는 `selfAgent`를 검색합니다. 기존 설정 호환성을 위해 설정 키는 유지합니다.

| 설정 | 기본값 / 용도 |
| --- | --- |
| `selfAgent.ollamaExecutable` | `ollama`: 실행 파일 경로 |
| `selfAgent.ollamaUrl` | `http://127.0.0.1:11435`: 로컬 HTTP 주소만 허용 |
| `selfAgent.autoStartOllama` | `true`: 서버가 없으면 자동 시작 |
| `selfAgent.model` | `gemma4:e4b` |
| `selfAgent.modelCatalog` | 비워두면 확장에 포함된 모델 정보 사용; 사용자 지정 JSON의 절대 경로 지정 가능 |
| `selfAgent.contextLength` | `16384`: 모델 컨텍스트 길이 |

대화·첨부 코드·로그·실행 설정은 확장 전용 VS Code `globalStorage`에 작업 영역별로 저장합니다. 기존 `~/.codex` 설정은 사용하지 않습니다. 이름이 바뀐 이전 Self Agent 확장의 저장 기록은 자동 이전하지 않습니다.

기본 서버는 기존 Ollama의 11434 포트와 별도로 11435 포트를 사용합니다. 자동 시작 서버는 재사용하며 모델은 유휴 상태 5분 후 메모리에서 내려갑니다. 승인 정책은 `on-request`, 파일 접근은 `workspace-write`, Windows 샌드박스는 `unelevated`입니다.

## 개발과 검증

```powershell
npm ci
npm run check
npm test
npm run build
npm run test:integration
npm run test:live
npm run package
```

`check`는 타입 검사, `test`는 Node 단위 테스트, `build`는 esbuild 번들 생성입니다. `test:integration`은 별도 VS Code 환경에서 UI·대화·승인·중단 동작을 검사하며 처음 실행할 때 VS Code를 다운로드합니다. `SELF_AGENT_TEST_CODE`에 VS Code 실행 파일 경로를 지정하면 다운로드 없이 사용할 수 있습니다. `test:live`는 설치된 런타임과 실제 기본 모델로 전용 테스트 폴더의 파일 복사·읽기 및 대화 재연결을 검사합니다. 실행에 수 분이 걸릴 수 있습니다.

이 폴더를 VS Code로 열고 **F5**를 누르면 확장 개발 호스트를 실행합니다. 소스는 `src/`, 테스트는 `test/`, UI 자산은 `media/`, 기본 모델 정보는 `resources/`에 있습니다. `src/protocol/`은 Codex에서 생성된 타입이며 직접 수정하지 않습니다. 바이너리 버전 변경 시 타입 재생성과 통합 검증이 필요합니다.

## 문제 해결

- **런타임 없음 / 버전 오류**: 설치 스크립트를 실행합니다. 지원 버전은 0.150.1이며 다른 버전은 자동 교체하지 않습니다.
- **모델 없음 / 도구 호출 미지원**: `ollama list`로 확인하고 필요한 모델을 받습니다. `tools` 지원 모델을 선택합니다.
- **서버 시작 실패**: `ollama` 실행 경로, 설정된 포트와 출력 로그를 확인합니다. 기존 서버를 사용할 때 컨텍스트 설정도 맞춥니다.
- **첫 응답 지연**: CPU 추론에서는 모델 로딩과 입력 처리에 수 분이 걸릴 수 있습니다. 짧은 입력과 필요한 파일만 첨부하세요.
- **명령이 안 보임**: **Developer: Reload Window**를 실행합니다.
- **중첩 샌드박스 오류**: 개발 테스트는 일반 사용자 터미널에서 실행합니다.

## 라이선스

확장 코드는 [MIT](LICENSE)입니다. 생성된 Codex API 타입과 의존성의 출처는 [외부 라이선스 안내](THIRD_PARTY_NOTICES.md)에 정리했습니다. 외부 Codex·Ollama·모델은 각 배포의 라이선스와 사용 조건을 따릅니다. 이 저장소에는 해당 바이너리나 모델 가중치를 포함하지 않습니다.
