# 🐶 World Tracker — 개발 현황 핸드오프 문서
## v0.3.0-beta hotfix3 (2026-03-29)

---

## 📦 현재 파일 상태
- **위치:** `/mnt/user-data/outputs/rp-world-tracker-v030-beta/` (11파일)
- **변경 파일:** map-renderer.js(598줄), ui-manager.js(1375줄)
- **미변경:** index.js(307), detector.js(385), leaflet-renderer.js(329), location-manager.js(134), db.js(112), prompt-injector.js(70), style.css(195), manifest.json(12), README.md

---

## 🔧 hotfix3 수정 사항 (금일 전체)

### 🔴 CRITICAL — 약도 핀 안 뜨는 버그
- **원인:** `cx`/`cy`가 `if` 블록 안 `const` → 블록 스코프 → ⑥강 이후 ReferenceError
- **수정:** `let cx, cy;` 함수 스코프 호이스트 + `else` 분기 중심좌표 계산

### 🟡 Voronoi풍 도시 블록 배경 (전면 리뉴얼)
- **기존:** 균일 격자 rect → **변경:** 불규칙 격자 polygon (6×8, 칸 크기 0.6~1.4배)
- **교차점 교란:** ±8px 미세 교란 → 도로는 거의 직선, 블록만 사다리꼴/오각형
- **도로 표현:** 블록 사이 갭이 자연스럽게 도로 역할 (배경색 = 도로색)
- **건물 디테일:** 블록 85%에 회색 사각형 2~5개 (AABB 겹침 방지, 3px 간격, 4타입 크기, 3톤 색상, 여백 12%)
- **메인 도로:** 격자 행/열 따라가는 노란 직선 + 대각선 (seed 기반)
- **강:** seed 기반 on/off, 부드러운 bezier 곡선
- **공원:** 녹색 블록 2~3개 + 연못
- **나침반:** SVG 내부 좌하단
- **Seeded PRNG:** Mulberry32 `_srand()` → 동일 seed = 동일 배경

### 🟡 Geo-aware 약도 배치 (신규)
- **조건:** lat/lng 있는 장소 2개+ → 실제 상대 위치 반영
- **변환:** lat/lng → 미터(111320m/deg) → px (ViewBox 40%)
- **방향:** 북쪽=위, 동쪽=오른쪽
- **fallback:** 좌표 없으면 거리 레벨 원형 배치

### 🟡 핀 클릭 = 카메라 팬 (위치 이동 X)
- 카메라 팬 + `showPop()` 팝오버만

### 🟢 재생성 버그 수정
- `_layoutDone === true` 명시 비교

### 🟢 판타지 거리 중복 수정
- distances 우선 → movements → Set 중복 방지

---

## 🔴 미해결 (다음 세션)

| # | 이슈 |
|---|------|
| 1 | 삼성 인터넷 가로스크롤 |
| 2 | 재생성/스와이프 중복 방지 |
| 3 | 이벤트 기록 자동 감지 정확도 |
| 4 | 데이터 백업/불러오기/삭제 테스트 |

---

## 🟡 TODO (Phase 2~5)

### Phase 2 — 약도 범위 필터링, Leaflet 팝업, 경로 옵션
### Phase 3 — 하위 장소, 기억 변형, 이벤트 고도화, 좌표 캐싱
### Phase 4 — 다크 테마, GitHub 배포
### Phase 5 — AI 지도 생성기, 임시 이벤트 태그, 우연 이벤트

---

## 🐶 개발 3원칙
1. **자동 우선** — 유저는 구경만, 수동은 보조
2. **AI 프롬프트 주입 최우선** — 확장 켜면 AI 응답 퀄리티 체감 상승
3. **감정 피드백 항상 포함** — 방문 알림, 추억 메모, "나중에 보는 맛"
