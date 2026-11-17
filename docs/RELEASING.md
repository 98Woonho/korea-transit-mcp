# 릴리스 방법

태그를 push하면 [release.yml](../.github/workflows/release.yml)이 다음을 자동으로 진행합니다.

1. 태그와 `package.json` 버전 일치 확인
2. 타입 검사 · 테스트 · 빌드
3. npm 배포 (Trusted Publishing, 토큰 없음, provenance 자동 첨부)
4. MCP 공식 레지스트리 갱신 (GitHub OIDC 로그인)

## 새 버전 내기

```powershell
# 1. 버전 올리기: package.json, package-lock.json, server.json을 함께 고치고 커밋과 태그(v0.3.0)를 만듭니다.
#    patch(0.2.0→0.2.1) / minor(→0.3.0) / major(→1.0.0) 중 선택
npm version minor -m "릴리스 v%s"

# 2. 커밋과 태그를 함께 push하면 자동 배포가 시작됩니다.
git push --follow-tags
```

진행 상황은 GitHub 저장소의 **Actions → Release**에서 확인합니다.

## 실패했을 때
- **"npm 조회에 나타나지 않았습니다"**: 대개 npm 반영 지연입니다. 잠시 뒤 Actions에서 **Re-run**하세요. npmjs.com → Staged Packages에 올라가 있다면 승인한 뒤 Re-run하고, Trusted Publisher의 Allowed actions에 `npm publish`가 있는지 확인합니다. 이 설정은 수정이 안 되므로 삭제하고 다시 만들어야 합니다.
- **MCP 레지스트리 단계만 실패**: 그냥 **Re-run**하면 됩니다. 이미 npm에 있는 버전은 배포를 건너뜁니다.

## 버전 규칙
- 서버 코드의 버전(`SERVER_INFO`)은 `package.json`에서 읽으므로 따로 고치지 않습니다.
- `server.json`은 `npm version` 실행 시 [scripts/sync-version.mjs](../scripts/sync-version.mjs)가 맞춰 줍니다.
- 세 곳이 어긋나면 [test/release.test.ts](../test/release.test.ts)가 실패해서 배포 전에 걸러집니다.

## 최초 1회 설정 (완료 후 체크)
- [ ] npmjs.com → 패키지 **Settings → Trusted publishing → GitHub Actions**
  - Organization or user: `98Woonho`
  - Repository: `korea-transit-mcp`
  - Workflow filename: `release.yml`
  - Environment: 비워 둠
  - Allowed actions: **`npm publish` 허용** (stage만 허용하면 웹 승인이 필요해 자동 배포가 멈춥니다)
- [ ] 첫 자동 배포 성공 후 **Settings → Publishing access → "Require two-factor authentication and disallow tokens"** (토큰 배포 차단, Trusted Publishing은 계속 동작)
