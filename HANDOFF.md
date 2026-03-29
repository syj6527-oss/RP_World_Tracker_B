# 🐶 World Tracker — 개발 현황 핸드오프 문서
## v0.3.0-beta (2026-03-29)

---

## 📦 현재 파일 상태
- **위치:** `/mnt/user-data/outputs/rp-world-tracker-v030-beta/` (11파일 2874줄)
- **파일 목록:** index.js(285), detector.js(378), ui-manager.js(994), map-renderer.js(368), leaflet-renderer.js(269), location-manager.js(134), db.js(112), prompt-injector.js(70), style.css(124), manifest.json(12), README.md(128)

---

## ✅ 구현 완료된 기능

### 핵심 기능
- **자동 장소 감지** — 한국어/영어 AI 응답 + 유저 입력에서 장소 자동 인식
- **USER/AI 감도 분리** — AI 엄격모드(method1 조사패턴 + method4 존재묘사 OFF)
- **최종 목적지 감지** — 같은 confidence면 텍스트 뒤쪽(pos) 우선
- **한/영 이중 등록 방지** — 내장 한영 장소 사전 28그룹 (집↔Home 등)
- **skipKo ~230개** — 의류/신체/추상/가구/음식/자연/일반명사 오탐 방지
- **skipMods 확장** — after/returning/coming/going 등 시간/동작 수식어 25개
- **detectFromDescription** — 캐릭터 설명에서 이동 동사 없이 장소 추출

### 노드 약도
- **약도 자동 생성** — 스프링 시뮬레이션 + level 1~10 → 60~400px 매핑
- **색상 코딩** — 🟣Violet(현재) / 🔵Blue(5회+) / 🟠Orange(2~4회) / 🟡Yellow(새곳)
- **경로선 위 거리 점** — ●●●○○ 레벨 표시 + 자유 텍스트
- **롱프레스 노드 이동** — 500ms 롱프레스 → 이동 모드 → 맵 터치로 배치
- **ViewBox 자동 맞춤** — 모든 노드가 보이도록 자동 조절
- **🐾 마커 + 나침반** NSEW 4방향

### 실제 지도 (Leaflet)
- **OpenStreetMap** CartoDB Voyager 타일
- **커스텀 divIcon 마커** 24x24px 균일 크기 + 색상 코딩
- **주소 검색** (Nominatim) → 좌표 저장 → Leaflet 자동 전환
- **앵커 원형 분포** — 한 장소 검색 시 나머지 30~150m 원형 배치
- **마커 롱프레스 이동** — contextmenu 기반 (PC 우클릭 + 모바일 롱프레스)
  - 마커 롱프레스 → 이동 모드 → 빈 곳 터치 → 이동 + 역지오코딩
  - 300ms 보호 가드 (오터치 방지)
- **지오코딩 캐시** — 같은 검색어 재호출 방지

### AI 프롬프트 주입
- 현재 위치, 상태, 방문 횟수
- **근처 장소 + RP 거리 라벨** (바로 옆/도보권/차량 필요/다른 지역)
- 기억 모드: 💎완벽(영구) / 🌿자연(시간 경과 흐림 — 기본 텍스트 잘라내기만)

### UI/UX
- **커스텀 알림** wtNotify pill (toastr 완전 제거)
- **거리 슬라이더 1~10** + RP 힌트 (바로 옆~다른 지역)
- **별칭 편집** UI (쉼표 구분)
- **장소 이름 변경** — 팝오버 제목이 편집 가능한 input
- **이동 히스토리** 표시 + 삭제 (✕ 버튼)
- **🐾 여기로 이동** 버튼 (수동 위치 변경)
- **⚙️ 데이터 관리** — 채팅별 백업/불러오기/삭제 + 전체 백업/불러오기/삭제
- **패널 pointer-events: none** — 닫혔을 때 터치 투과 (터치 차단 버그 수정)
- **플로팅 승인 UI** — 스캔 결과를 패널 밖 오버레이로 표시 (패널 자동 열림 제거)

### 이벤트 기록 시스템 (v0.3.0 신규)
- **자동:** AI 응답에서 키워드 감지 (싸움/키스/발견/만남/비밀 등) → 플로팅 알림
- **수동:** 팝오버 → 📝 이벤트 기록 섹션 → 직접 입력/삭제
- **플로팅 이벤트 알림** — 수정 후 저장/무시 선택

### 기타
- **CM 프로필 연동** (번역기와 동일 방식: `getContext().extensionSettings?.connectionManager?.profiles`)
- **채팅 전환 시 지도 리셋** — resetMap() 메서드
- **모바일 렌더링** — init() loadChat + togglePanel 350ms 지연 렌더
- **CHAT_CHANGED 200ms 대기** — chatId 갱신 타이밍 보정

---

## 🔴 현재 버그 (미수정)

### 긴급 — ✅ 수정됨 (v0.3.0-beta hotfix)
1. ~~**노드 맵에 장소 안 뜸**~~ — ✅ _init()에서 기존 SVG 미제거 → 중복 SVG가 overflow:hidden에 밀림. + _autoLayout early return이 첫 렌더링도 스킵. + resetMap()에서 컨테이너 DOM 미클리어.
2. ~~**장소 검색바**~~ — ✅ Nominatim → 등록된 장소 로컬 검색으로 변경. 양 모드(노드/Leaflet) 공통. 선택 시 팝오버 + 맵 포커스.
3. ~~**승인/이벤트 알림**~~ — ✅ z-index 99998→2147483646 (패널 위), bottom 80→100px, opacity/shadow 강화.
- ~~**leaflet curLoc 스코프 오류**~~ — ✅ render() 내 curLoc이 if 블록 안에 선언돼 밖에서 ReferenceError. 함수 스코프로 이동.

### 테스트 미완료
4. 이벤트 기록 자동 감지 — AI 응답 키워드 추출 정확도
5. 데이터 백업/불러오기/삭제 기능
6. 재생성/스와이프 시 장소 중복 방지 (미구현)
7. Leaflet 타일 회색 영역 (invalidateSize 강화했으나 재확인)
8. 모바일 Leaflet 롱프레스 이동 정확도

---

## 🟡 TODO (우선순위 순)

### 즉시 수정
1. 노드 맵 렌더링 안 되는 버그
2. 장소 검색바 → 로컬 검색
3. 플로팅 승인 UI 위치/표시 수정
4. 재생성/스와이프 중복 방지

### Phase 2 — Leaflet 고도화
5. 경로 라인 옵션 (없음/마지막 이동만/전체)
6. GPT 제안: Leaflet 앵커 + 원형 분포 고도화
7. leaflet-renderer.js 리팩토링 (600줄 넘기 전에 분리)

### Phase 3 — 킬러 기능
8. **이벤트 기록 고도화** — 유저가 채팅 문장 드래그 선택 → AI 요약 → 장소에 저장
9. **기억 변형 시스템** — 💎완벽(영구 유저 선택) / 🌿자연(시간 경과 AI 요약)
   - Day 1: "철수랑 결혼 이야기하다 싸웠다"
   - Day 7: "철수랑 대차게 싸웠던 곳"
   - Day 30: "철수랑 안 좋은 기억이 있었던 곳"
10. **이동 히스토리 RP 시간 동기화** — 실제 시간 X → 채팅 내 상태창 날짜+시간
11. 감지 모델 AI 호출 (CM 프로필 연동)
12. 커스텀 placeWords (유저 직접 추가)
13. 건물 내부 하위 장소 (집→거실/침실) — DB VERSION 3 마이그레이션

### Phase 4 — 완성형
14. 다크 테마
15. GitHub 정식 배포 + 스크린샷
16. 유저/캐릭터 위치 분리

### 구현 미정
17. 로어북 연동 (데이터 양 방대 + 오탐 우려 → 채팅 누적 방식 우선)

---

## 🏗️ 핵심 아키텍처 결정

| 결정 | 이유 |
|------|------|
| toastr 제거 → 커스텀 wtNotify | 번역기 스타일 통일 + 의존성 제거 |
| USER/AI 감지 분리 | AI 응답에서 소파/재킷 등 오탐 방지 |
| 거리: 자유 텍스트 + 레벨 슬라이더 병행 | RP 세계관 표현 ("골목 두 개 건너") + 약도 계산용 |
| 노드 이동: 드래그 제거 → 롱프레스 + 탭 | 모바일 터치 충돌 방지 |
| 약도 배치: 스프링 시뮬레이션 | level→px 매핑 + 겹침 방지 |
| Leaflet 롱프레스: contextmenu 이벤트 | 타이머/터치 직접 구현보다 안정적 (GPT 조언) |
| 앵커 원형 분포 | 주소 검색 시 나머지 장소 자동 배치 (GPT 조언) |
| 채팅 기록만 누적 (로어북 X) | 경험 기반 RP 몰입 + 데이터 정확도 |
| pointer-events: none (패널 닫힘 시) | 보이지 않는 터치 영역 차단 방지 |
| 플로팅 오버레이 승인 UI | 패널 자동 열림 방지 + 원터치 승인 |

---

## 🐶 개발 3원칙
1. **자동 우선** — 유저는 구경만, 수동은 보조
2. **AI 프롬프트 주입 최우선** — 확장 켜면 AI 응답 퀄리티 체감 상승
3. **감정 피드백 항상 포함** — 방문 알림, 추억 메모, 통계로 "나중에 보는 맛"

---

## 📋 참고
- 번역기 프로필 읽기: `getContext().extensionSettings?.connectionManager?.profiles`
- SillyTavern 이벤트: MESSAGE_RECEIVED, MESSAGE_RENDERED, GENERATION_ENDED, CHAT_CHANGED, MESSAGE_SENDING(가드 필요)
- 모바일 SVG 렌더링: init() 끝에 loadChat+refresh 필수 + 패널 열림 350ms 후 강제 render
- GPT 조언: leaflet-renderer.js 600줄 넘기 전 리팩토링 권장
