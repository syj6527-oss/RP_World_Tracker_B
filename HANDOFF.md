# 🐶 World Tracker — 개발 현황 핸드오프 문서
## v0.3.0-beta hotfix6 (2026-03-30)

---

## 📦 현재 파일 상태
- **위치:** `/mnt/user-data/outputs/rp-world-tracker-v030-beta/` (12파일)
- **변경 파일:** map-renderer.js(489줄), ui-manager.js(1385줄)
- **미변경:** index.js, detector.js, leaflet-renderer.js, location-manager.js, db.js, prompt-injector.js, style.css, manifest.json, README.md

---

## 🔧 hotfix6 수정 사항 (목업v2 기반 전면 리뉴얼)

### 1. 벽지 → 지도 (2000×2000 고정 영역)
- 배경을 앵커 핀 중심 2000×2000px 고정 영역에 생성
- 팬해도 빈 공간 없이 배경이 계속 보임
- seed = chatId 해시 → 채팅별 고유 배경

### 2. 큰 블록 (목업 스케일)
- 격자: 6×8 → **3×4** (블록 면적 4~5배 증가)
- 교란: ±12px → **±22px** (불규칙도 강화)
- 수축: 5px → **8px** (도로 폭 넓게)
- 블록 톤: 따뜻한 6톤 유지
- 건물: 2~4개, 5톤, opacity 0.32~0.45

### 3. 핀 클릭 = 해당 핀 중심 재생성
- `recenterOn(locId)` 메서드 추가
- 앵커를 해당 핀 좌표로 변경 + 배경 캐시 무효화 + ViewBox 이동
- `_yakdoRecenter` → `recenterOn` 호출로 변경
- 현재 위치 핀도 클릭 가능 (무시 제거)

### 4. 15분 반경 완전 숨김
- level > 6 핀: 가장자리 인디케이터 제거 → **완전 안 보임**
- 거리 점선도 level > 6이면 렌더 안 함
- ViewBox를 level ≤ 6 핀만 기준으로 자동 맞춤

### 5. 강 디테일
- cubic bezier (C 커브) → 더 자연스러운 흐름
- 본체 + 하이라이트 + 물결 디테일 (3중 레이어)

### 6. 나침반
- ViewBox 좌하단 고정 (팬해도 항상 같은 위치)
- N극(빨강) + S극(회색) 표시

---

## 🔴 미해결

| # | 이슈 |
|---|------|
| 1 | 삼성 인터넷 가로스크롤 |
| 2 | 재생성/스와이프 중복 방지 |
| 3 | 라이브 테스트 후 디자인 미세조정 |

---

## 🐶 개발 3원칙
1. 자동 우선 — 유저는 구경만
2. AI 프롬프트 주입 최우선
3. 감정 피드백 항상 포함
