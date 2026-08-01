# 확장 개발 GitHub 운영 지침

이 문서는 `D:\확장 개발` 아래의 각 확장 프로그램 폴더를 개별 GitHub 프로젝트로 관리하기 위한 작업 규칙이다. Codex는 이 루트 아래에서 확장 프로그램 개발을 수행할 때 이 지침을 우선 적용한다.

## 쿠키스토리지 관리자 프로젝트 예외

이 저장소에서는 브라우저가 항상 동일한 경로의 최신 개발본을 읽도록 프로젝트 루트를 확장 프로그램 로드 경로로 사용한다.

```text
쿠키스토리지 관리자/
  manifest.json          # 항상 최신 개발 버전
  background.js
  popup.html
  popup.js
  popup.css
  icon.png
  _locales/
  legacy/                # 배포가 끝난 이전 버전의 완전한 스냅샷
    1.0/
    1.1/
  backup/diffs/          # 이전 버전과 최신 버전 사이의 Git 형식 patch
  package/               # 스토어 업로드 ZIP, Git 제외 대상
  package.ps1
```

- Chrome/Edge에는 이 프로젝트 루트를 `압축해제된 확장 프로그램`으로 한 번만 등록한다.
- 소스 변경 후에는 확장 관리 화면에서 새로고침해야 실행 중인 확장에 반영된다. 로컬 압축해제 확장은 스토어 설치 확장처럼 자동 배포·자동 재시작되지 않는다.
- 최신 소스는 버전 번호 폴더를 새로 만들지 않고 루트에서 수정한다.
- 새 버전 작업을 시작하기 직전에 `.\package.ps1 -PrepareVersion <새버전>`을 실행한다. 이 명령은 현재 버전을 `legacy/<현재버전>`에 보존하고 루트 manifest 버전을 올린다.
- 개발과 검증을 마친 뒤 `.\package.ps1`을 실행한다. 이 명령은 `package/`에 현재 버전 ZIP을 만들고 `backup/diffs/`에 가장 최근 legacy 버전 대비 Git 형식 patch를 만든다.
- `legacy/` 스냅샷은 수정하지 않는다. 과거 버전 수정이 필요하면 새 버전으로 승격한다.
- 루트의 `ss.png`, `ss2.png`, `AGENTS.md`, `package.ps1`, `legacy/`, `backup/`, `package/`는 확장 패키지에 포함하지 않는다.
- 아래의 일반적인 “버전 폴더 규칙”보다 이 절의 프로젝트 전용 규칙이 우선한다.

## 현재 환경 확인

- Git은 설치되어 있으나 현재 PowerShell `PATH`에서는 `git` 명령이 바로 인식되지 않는다.
- 사용 가능한 Git 실행 파일:

```powershell
C:\Program Files\Git\cmd\git.exe
```

- 확인된 버전:

```text
git version 2.53.0.windows.2
```

- `winget` 설치 가능:

```powershell
C:\Users\istak\AppData\Local\Microsoft\WindowsApps\winget.exe
```

- `choco` 설치 가능:

```powershell
C:\ProgramData\chocolatey\bin\choco.exe
```

- GitHub CLI `gh`는 설치되어 있다.
- 사용 가능한 GitHub CLI 실행 파일:

```powershell
C:\Program Files\GitHub CLI\gh.exe
```

- 현재 `gh`는 GitHub에 로그인되어 있지 않다. 저장소 자동 생성과 푸시를 하려면 최초 1회 인증이 필요하다.

## Git 자동 설치 가능 여부

현재는 Git 자체가 이미 설치되어 있으므로 재설치가 아니라 `PATH` 등록이 우선이다.

PowerShell에서 `git` 명령이 바로 동작하게 하려면 Windows 환경 변수 `Path`에 아래 경로를 추가한다.

```text
C:\Program Files\Git\cmd
```

Git이 없는 PC라면 아래 중 하나로 설치할 수 있다.

```powershell
winget install --id Git.Git -e
```

또는:

```powershell
choco install git -y
```

GitHub 저장소 생성까지 명령으로 자동화하려면 GitHub CLI도 설치한다. 현재 PC에는 이미 설치되어 있다.

```powershell
winget install --id GitHub.cli -e
```

설치 후 인증:

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" auth login
```

## 프로젝트 단위

`D:\확장 개발` 바로 아래의 각 폴더를 독립 Git 프로젝트로 본다.

예:

```text
D:\확장 개발\TvingAutoSkip
D:\확장 개발\GrokAutoContinue
D:\확장 개발\InstagramVideoController
```

루트인 `D:\확장 개발` 전체를 하나의 Git 저장소로 만들지 않는다. 각 확장 프로그램 폴더가 각각 별도 GitHub 저장소가 되어야 한다.

## 버전 폴더 규칙

확장 프로그램 내부에서 `1.1.3`, `1.1.4`처럼 버전 폴더를 쓰는 경우:

- 이전 버전 폴더는 보존한다.
- 새 기능이나 수정은 새 버전 폴더를 만들어 반영한다.
- Chrome Web Store 또는 Edge Add-ons에 업로드할 때는 해당 버전 폴더만 압축한다.
- 루트에 편의용 `manifest.json`을 만들지 않는다.
- 루트에 편의용 `_locales`를 만들지 않는다.

예:

```text
TvingAutoSkip/
  1.1.3/
    manifest.json
    content.js
  1.1.4/
    manifest.json
    content.js
```

업로드 대상은 `TvingAutoSkip` 전체가 아니라 `TvingAutoSkip\1.1.4` 안의 파일들이다.

## Codex 작업 후 자동 Git 절차

Codex는 `D:\확장 개발` 하위 확장 프로젝트에서 파일을 수정한 경우, 사용자가 별도로 막지 않는 한 작업 완료 전에 아래 절차를 수행한다.

1. 수정한 확장 프로그램 폴더를 프로젝트 루트로 판단한다.
2. Git 저장소인지 확인한다.
3. 저장소가 아니면 사용자에게 GitHub 저장소 이름과 공개/비공개 여부가 필요한지 확인한다.
4. 저장소이면 변경 파일을 확인한다.
5. 문법 검사나 가능한 최소 검증을 실행한다.
6. 변경 파일만 스테이징한다.
7. 의미 있는 커밋 메시지로 커밋한다.
8. 원격 저장소가 있으면 푸시한다.
9. 원격 저장소가 없으면 원격 연결이 필요하다고 보고한다.

Git 명령은 현재 환경에서 아래 실행 파일을 우선 사용한다.

```powershell
& "C:\Program Files\Git\cmd\git.exe" status --short
```

GitHub 인증은 Windows 사용자 keyring에 저장되고, Codex가 만든 로컬 저장소는 샌드박스 사용자 소유가 될 수 있다. 이 경우 인증된 사용자 권한으로 `gh`를 실행할 때 Git이 `dubious ownership` 오류를 낼 수 있으므로 프로젝트별로 아래 설정이 필요할 수 있다.

```powershell
& "C:\Program Files\Git\cmd\git.exe" config --global --add safe.directory "D:/확장 개발/<프로젝트폴더>"
```

## 기존 프로젝트를 GitHub에 처음 올리는 절차

프로젝트 폴더 예시:

```powershell
cd "D:\확장 개발\TvingAutoSkip"
```

Git 초기화:

```powershell
& "C:\Program Files\Git\cmd\git.exe" init
& "C:\Program Files\Git\cmd\git.exe" add .
& "C:\Program Files\Git\cmd\git.exe" commit -m "Initial commit"
```

GitHub에서 빈 저장소를 만든 뒤 원격 연결:

```powershell
& "C:\Program Files\Git\cmd\git.exe" branch -M main
& "C:\Program Files\Git\cmd\git.exe" remote add origin https://github.com/<username>/<repo>.git
& "C:\Program Files\Git\cmd\git.exe" push -u origin main
```

GitHub CLI가 설치되어 있고 인증되어 있으면 저장소 생성까지 자동화할 수 있다.

```powershell
gh repo create <repo> --private --source . --remote origin --push
```

공개 저장소가 필요하면 `--private` 대신 `--public`을 사용한다.

## 매 작업 후 커밋/푸시 절차

변경 확인:

```powershell
& "C:\Program Files\Git\cmd\git.exe" status --short
```

스테이징:

```powershell
& "C:\Program Files\Git\cmd\git.exe" add <changed-files>
```

커밋:

```powershell
& "C:\Program Files\Git\cmd\git.exe" commit -m "<summary>"
```

푸시:

```powershell
& "C:\Program Files\Git\cmd\git.exe" push
```

## 커밋 메시지 규칙

커밋 메시지는 짧고 작업 단위를 드러내게 쓴다.

예:

```text
Add TVING overlay sibling hider
Release TvingAutoSkip 1.1.4
Fix popup hotkey reset labels
Remove root extension manifest
```

## 자동 커밋 예외

아래 상황에서는 자동 커밋/푸시를 하지 말고 사용자에게 확인한다.

- GitHub 원격 저장소가 아직 없다.
- GitHub 인증이 필요하다.
- 같은 프로젝트 안에 사용자가 만든 것으로 보이는 미확인 변경이 섞여 있다.
- 테스트나 문법 검사가 실패했다.
- 삭제 파일이 많거나 프로젝트 구조를 크게 바꾸는 작업이다.
- 비밀키, 토큰, 계정 정보, 쿠키, 빌드 산출물 등이 포함될 가능성이 있다.

## 기본 제외 대상

각 프로젝트에 `.gitignore`가 없다면 필요할 때 아래 항목을 기준으로 만든다.

```gitignore
node_modules/
dist/
build/
.env
.env.*
*.zip
*.crx
*.pem
*.key
*.log
.DS_Store
Thumbs.db
```

확장 스토어 업로드용 압축 파일은 GitHub에 올리지 않는 것을 기본으로 한다.

## Codex 응답 규칙

Codex는 작업 완료 보고에 다음 내용을 포함한다.

- 수정한 프로젝트 이름
- 수정한 주요 파일
- 실행한 검증
- 커밋 SHA 또는 커밋하지 못한 이유
- 푸시 성공 여부 또는 푸시하지 못한 이유
