# 🐶 World Tracker — 개발 현황 핸드오프 문서
## v0.3.0-beta hotfix5 (2026-03-29)

---

## 📦 현재 파일 상태
- **위치:** `/mnt/user-data/outputs/rp-world-tracker-v030-beta/` (11파일)
- **변경 파일:** map-renderer.js(566줄), ui-manager.js(1389줄)
- **미변경:** index.js(307), detector.js(385), leaflet-renderer.js(329), location-manager.js(134), db.js(112), prompt-injector.js(70), style.css(195), manifest.json(12), README.md

---

## 🔧 hotfix5 수정 사항 (약도 5대 이슈 일괄 수정)

### ① 벽지 → 지도 (배경 월드 고정 + 캐시)
- **이전:** `_drawCity()`가 매 render마다 ViewBox 기준으로 배경 재생성 → 팬하면 배경이 따라옴 ("벽지")
- **수정:** `_buildCityOnce()` — 핀 바운딩박스 + 패딩 350px 기준으로 **월드 고정 좌표**에 배경을 한 번만 생성
- `_cityBgEl` (SVG `<g>`) 캐시 → 이후 render()에서 `cloneNode(true)`로 재사용
- ViewBox만 이동하고 배경은 고정 → **팬해도 배경이 제자리**
- `invalidateCity()` 메서드 → 🔄 재생성 시 캐시 무효화
- seed = `_hashStr(chatId) % 10000` → 채팅별 고유 배경 (장소 수 무관)

### ② 다각형 블록 + 따뜻한 톤 (레퍼런스 디자인)
- **이전:** `rect` 격자 → 옹기종기 사각형
- **수정:** 격자 교차점 ±12px 교란 → **polygon** (사다리꼴/오각형) 블록
- 블록 수축(centroid 방향 5px) → 블록 사이 gap이 자연스러운 도로
- **노란 메인 도로 삭제** → 블록 gap = 도로 (레퍼런스처럼)
- 배경색(도로색): `#F5F1EA` (따뜻한 크림)
- 블록 색상 6톤: `#EDE7DC`, `#E8E0D4`, `#F0E9DF`, `#ECE3D6`, `#EFE6DA`, `#E6DDD0`
- 건물 5톤: `#D5CFC5`, `#CDC7BD`, `#C8C2B8`, `#D0C9BF`, `#DBD5CB`
- 건물 4타입 (넓고낮음/좁고높음/중간/정사각), opacity 0.32~0.45
- 공원: 큰 rx(14~26) + 연못 + 나무 점 (작은 원)
- 격자: 6×8 (이전 5×7)

### ③ 15분 반경 실효화
- **ViewBox 자동 맞춤:** level ≤ 6 핀만 기준으로 바운딩박스 계산
- **🔄 재생성:** 모든 핀(manualXY 포함) x/y를 0으로 리셋 → `needsInit=true` → 새 levelToPx 적용
- ui-manager.js 재생성 핸들러에서 `invalidateCity()` + 전체 핀 리셋

### ④ 수동 핀 위치 보존
- **이전:** `_autoLayout()` 겹침 방지 루프에서 `_manualXY` 무시
- **수정:** 겹침 방지에서 `!locs[i]._manualXY`, `!locs[j]._manualXY` 체크 추가
- 수동 이동한 핀은 자동 배치/겹침 방지에서 제외

### ⑤ 강/블록 겹침 해소
- **강 Y 먼저 계산:** `riverTop`, `riverBot` 변수로 강 영역 확정
- **블록 분할:** 강과 겹치는 블록은 위/아래 두 조각으로 분할 (cutRatio 계산)
- **강 레이어:** 블록 위에 그려지되, 블록이 강을 피하므로 겹침 없음
- **강 하이라이트:** 본체 + 가운데 밝은 선 (2중 stroke)

---

## 🔴 미해결 (다음 세션)

| # | 이슈 |
|---|------|
| 1 | 삼성 인터넷 가로스크롤 |
| 2 | 재생성/스와이프 중복 방지 |
| 3 | 이벤트 기록 자동 감지 정확도 |
| 4 | 데이터 백업/불러오기/삭제 테스트 |
| 5 | 라이브 테스트 후 디자인 미세조정 (블록 크기/강 폭/색상 등) |

---

## 🟡 TODO (Phase 2~5)

### Phase 2 — Leaflet 팝업, 경로 옵션
### Phase 3 — 하위 장소, 기억 변형, 이벤트 고도화, 좌표 캐싱
### Phase 4 — 다크 테마, GitHub 배포
### Phase 5 — AI 지도 생성기, 임시 이벤트 태그, 우연 이벤트

---

## 🐶 개발 3원칙
1. **자동 우선** — 유저는 구경만, 수동은 보조
2. **AI 프롬프트 주입 최우선** — 확장 켜면 AI 응답 퀄리티 체감 상승
3. **감정 피드백 항상 포함** — 방문 알림, 추억 메모, "나중에 보는 맛"
