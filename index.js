// 🐶 World Tracker v0.2.1-beta

import { getContext, extension_settings } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { WorldTrackerDB } from './db.js';
import { LocationManager } from './location-manager.js';
import { LocationDetector } from './detector.js';
import { PromptInjector } from './prompt-injector.js';
import { UIManager } from './ui-manager.js';

export const EXTENSION_NAME = 'rp-world-tracker';
export const PROMPT_KEY = 'rp-world-tracker-prompt';
let _autoDetectPauseCount = 0;

export async function runWithoutAutoDetect(task, cooldownMs = 1500) {
    _autoDetectPauseCount++;
    try {
        return await task();
    } finally {
        setTimeout(() => {
            _autoDetectPauseCount = Math.max(0, _autoDetectPauseCount - 1);
        }, cooldownMs);
    }
}

function isAutoDetectPaused() {
    return _autoDetectPauseCount > 0;
}

// ========== 확장 경로 자동 감지 (폴더명 불일치 방지) ==========
export const EXTENSION_PATH = new URL('.', import.meta.url).pathname;

// ========== 🐶/🐺 모드 아이콘 ==========
export function wtMascot() { return extension_settings[EXTENSION_NAME]?.fantasyTheme ? '🐺' : '🐶'; }
export function wtTreat() { return extension_settings[EXTENSION_NAME]?.fantasyTheme ? '🍖' : '🦴'; }

// ========== 커스텀 알림 (번역기 스타일) ==========
let _notiEl = null, _notiTimer = null;
export function wtNotify(msg, type = 'move', duration = 3000) {
    if (!_notiEl) {
        _notiEl = document.createElement('div');
        _notiEl.className = 'wt-notification';
        document.body.appendChild(_notiEl);
    }
    clearTimeout(_notiTimer);
    _notiEl.className = `wt-notification wt-noti-${type}`;
    _notiEl.textContent = msg;
    _notiEl.style.top = '12px';
    _notiTimer = setTimeout(() => { _notiEl.style.top = '-60px'; }, duration);
}
export function toastWarn(msg) { wtNotify(msg, 'warn', 3000); }
export function toastSuccess(msg) { wtNotify(msg, 'move', 2000); }

const defaults = {
    enabled:true, autoDetect:true, showDetectToast:true,
    aiInjection:true, memoryMode:'natural', memorySummaryDays:7, panelOpacity:100,
    debugMode:false, mapMode:'node', fantasyTheme:false,
    eventLang:'auto', // auto=RP언어, ko=한국어, en=English
    worldContinuity:false, // 세계관 이어가기 (캐릭터 기반 저장)
};

let db, lm, det, pi, ui;
let _userContext = ''; // 유저 입력 컨텍스트 (이벤트 추출용)

// ========== 채팅 화면 활성 여부 (캐릭터 설정/선택 화면 방지) ==========
function isChatActive() {
    // offsetParent는 position:fixed에서 null 반환 → getBoundingClientRect 사용
    const sendBtn = document.querySelector('#send_but');
    if (!sendBtn) return false;
    const rect = sendBtn.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

export async function loadLeaflet() {
    if (window.L) return true;
    try {
        if (!document.querySelector('link[href*="leaflet"]')) {
            const link = document.createElement('link'); link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            document.head.appendChild(link);
        }
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            script.onload = () => { console.log(`[${EXTENSION_NAME}] Leaflet loaded!`); resolve(true); };
            script.onerror = () => { console.warn(`[${EXTENSION_NAME}] Leaflet CDN failed`); resolve(false); };
            document.head.appendChild(script);
        });
    } catch(e) { console.warn(`[${EXTENSION_NAME}] Leaflet load error:`, e); return false; }
}

function dbg(msg) {
    const s = extension_settings[EXTENSION_NAME];
    if (s?.debugMode) wtNotify(`🔧 ${msg}`, 'info', 3000);
    console.log(`[${EXTENSION_NAME}] ${msg}`);
}

// ========== 메시지 스캔 (USER/AI 감도 분리) ==========
async function scanMessage(text, source = 'USER') {
    try {
        // ★ 리뷰 생성 중이면 감지 차단 (피드백 루프 방지)
        if (ui?._isGeneratingReview) {
            dbg('🔄 리뷰 생성 중 — 감지 건너뜀');
            return false;
        }
        if (isAutoDetectPaused()) {
            dbg('⏸️ auto-detect paused');
            return false;
        }
        const s = extension_settings[EXTENSION_NAME];
        if (!s?.enabled || !s?.autoDetect || !text?.trim()) return false;
        if (!lm.currentChatId) await lm.loadChat();
        if (!lm.currentChatId) return false;

        const mode = source === 'AI' ? 'ai' : 'user';
        const rpDate = _extractRpDate(text);

        // ★ 메타데이터에서 Location 직접 추출 (memo/yaml 블록)
        const locMatch = text.match(/[-*]\s*Location[:\s]+(.+)/i);
        if (locMatch) {
            const metaLoc = locMatch[1].trim().replace(/[`*_]/g, '');
            if (metaLoc.length >= 2 && metaLoc.length <= 30) {
                dbg(`📌 Meta location: "${metaLoc}"`);
                // 기존 장소에 있는지 확인
                const existing = lm.locations.find(l =>
                    l.name.toLowerCase() === metaLoc.toLowerCase() ||
                    (l.aliases || []).some(a => a.toLowerCase() === metaLoc.toLowerCase())
                );
                if (existing) {
                    if (lm.currentLocationId !== existing.id) {
                        await lm.moveTo(existing.id, rpDate);
                        if (s.showDetectToast) wtNotify(`${wtMascot()} ${wtTreat()} ${existing.name}`, 'move');
                        pi.inject(); if (ui.panelVisible) ui.refresh();
                    }
                    await _tryEvent(text, existing.id, source);
                    return true;
                } else {
                    // 새 장소 등록
                    if (!lm.currentChatId) await lm.loadChat();
                    if (lm.currentChatId) {
                        const loc = await lm.addLocation(metaLoc);
                        if (loc) {
                            await lm.moveTo(loc.id, rpDate);
                            if (s.showDetectToast) wtNotify(`${wtMascot()} 🆕 ${loc.name}`, 'new', 3500);
                            pi.inject(); if (ui.panelVisible) ui.refresh();
                            ui.showAutoToast(loc);
                            await _tryEvent(text, loc.id, source);
                        }
                    }
                    return true;
                }
            }
        }

        dbg(`🔍 ${source} (${text.length}c) mode=${mode}${rpDate ? ' rpDate=' + rpDate : ''}`);

        // 이미 등록된 장소 감지 (USER/AI 동일)
        const result = det.detect(text);
        if (result) {
            const { location, type, confidence } = result;
            dbg(`✅ "${location.name}" (${type} c=${confidence})`);
            if (lm.currentLocationId !== location.id) {
                await lm.moveTo(location.id, rpDate);
                if (s.showDetectToast) wtNotify(`${wtMascot()} ${wtTreat()} ${location.name}`, 'move');
                pi.inject(); if (ui.panelVisible) ui.refresh();
            }
            // 이벤트 추출 (AI=전체, USER=강한 키워드만)
            await _tryEvent(text, location.id, source);
            return true;
        }

        // 새 장소 발견 (mode 전달 → AI는 엄격)
        const np = det.detectNewPlace(text, mode);
        if (np) {
            dbg(`🆕 "${np}" (${source})`);
            if (!lm.currentChatId) await lm.loadChat();
            if (lm.currentChatId) {
                const loc = await lm.addLocation(np);
                if (loc) {
                    await lm.moveTo(loc.id, rpDate);
                    if (s.showDetectToast) wtNotify(`${wtMascot()} 🆕 ${loc.name}`, 'new', 3500);
                    pi.inject(); if (ui.panelVisible) ui.refresh();
                    ui.showAutoToast(loc);
                    await _tryEvent(text, loc.id, source);
                }
            }
            return true;
        }

        // 장소 감지 실패해도, 현재 위치가 있으면 이벤트만 추출
        if (lm.currentLocationId) await _tryEvent(text, lm.currentLocationId, source);

        return false;
    } catch(e) { console.error(`[${EXTENSION_NAME}] Scan:`, e); return false; }
}

async function init() {
    if (!extension_settings[EXTENSION_NAME]) extension_settings[EXTENSION_NAME] = { ...defaults };
    for (const [k,v] of Object.entries(defaults)) {
        if (extension_settings[EXTENSION_NAME][k] === undefined) extension_settings[EXTENSION_NAME][k] = v;
    }
    extension_settings[EXTENSION_NAME].debugMode = false;
    saveSettingsDebounced();

    db = new WorldTrackerDB(); await db.open();
    lm = new LocationManager(db);
    det = new LocationDetector(lm);
    pi = new PromptInjector(lm);
    ui = new UIManager(lm, pi);
    ui.createSettingsPanel(); ui.createSidePanel(); ui.registerWandButton(); ui.registerDragSummary();

    let lastId = null;
    let _handleCount = 0;
    async function handle(idx) {
        try {
            if (isAutoDetectPaused()) {
                console.log(`[${EXTENSION_NAME}] ⏸️ handle skipped: auto-detect paused`);
                return;
            }
            _handleCount++;
            console.log(`[${EXTENSION_NAME}] 🔔 handle(${typeof idx === 'number' ? idx : 'event'}) #${_handleCount}`);
            if (!isChatActive()) { console.log(`[${EXTENSION_NAME}] ⏭️ chatActive=false`); return; }
            const ctx = getContext(); if (!ctx?.chat?.length) { console.log(`[${EXTENSION_NAME}] ⏭️ no chat`); return; }

            // 메시지 가져오기 (idx가 숫자면 해당 인덱스, 아니면 마지막 메시지)
            let aiMsg = null, aiIdx = -1;
            if (typeof idx === 'number' && idx >= 0 && idx < ctx.chat.length) {
                aiMsg = ctx.chat[idx]; aiIdx = idx;
            } else {
                // 마지막 AI 메시지 찾기 (뒤에서부터)
                for (let i = ctx.chat.length - 1; i >= Math.max(0, ctx.chat.length - 3); i--) {
                    if (ctx.chat[i] && !ctx.chat[i].is_user) { aiMsg = ctx.chat[i]; aiIdx = i; break; }
                }
            }
            if (!aiMsg || aiMsg.is_user) { console.log(`[${EXTENSION_NAME}] ⏭️ no AI msg`); return; }

            const mid = `${aiIdx}_${(aiMsg.mes||'').length}`;
            if (mid === lastId) return; lastId = mid;

            // 직전 유저 메시지 찾기
            let userMsg = null;
            for (let i = aiIdx - 1; i >= Math.max(0, aiIdx - 3); i--) {
                if (ctx.chat[i]?.is_user) { userMsg = ctx.chat[i]; break; }
            }

            dbg(`📨 AI:${(aiMsg.mes||'').length}c User:${(userMsg?.mes||'').length}c`);
            // USER 먼저 (장소 감지)
            if (userMsg?.mes?.trim()) await scanMessage(userMsg.mes, 'USER');
            // AI (장소+이벤트) — 유저 컨텍스트도 전달
            _userContext = userMsg?.mes?.trim() || '';
            if (aiMsg.mes?.trim()) await scanMessage(aiMsg.mes, 'AI');
            _userContext = '';
        } catch(e) { console.error(`[${EXTENSION_NAME}] Handle:`, e); }
    }

    // ★ 이벤트 등록 (여러 이벤트에 걸어서 확실하게)
    const msgEvents = ['MESSAGE_RECEIVED', 'MESSAGE_RENDERED', 'GENERATION_ENDED', 'GENERATION_STOPPED'];
    for (const evName of msgEvents) {
        if (event_types[evName]) {
            eventSource.on(event_types[evName], handle);
            console.log(`[${EXTENSION_NAME}] ✅ ${evName} 등록`);
        }
    }

    eventSource.on(event_types.CHAT_CHANGED, async () => {
        pi.clear(); lastId = null;
        // 타이밍: SillyTavern이 chatId 갱신할 때까지 대기
        await new Promise(r => setTimeout(r, 300));
        const newId = lm.getChatId();
        dbg(`🔄 CHAT_CHANGED → ${newId}`);
        await lm.loadChat();
        pi.inject();
        ui.resetMap();
        if (ui.panelVisible) ui.refresh();
        // scanContext: 첫 시도 실패 시 1초 후 재시도
        if (!await scanContext()) {
            setTimeout(() => scanContext(), 1000);
        }
        // ★ 위치 기반 자동 확장
        setTimeout(async () => {
            try { await lm.autoCalcDistances(); } catch(_){}
            try { await lm.autoReverseGeocode(); } catch(_){}
            if (ui.panelVisible) ui.refresh();
        }, 3000);
    });

    if (event_types.MESSAGE_SENDING) {
        eventSource.on(event_types.MESSAGE_SENDING, () => {
            if (extension_settings[EXTENSION_NAME]?.enabled && extension_settings[EXTENSION_NAME]?.aiInjection) pi.inject();
        });
    }

    console.log(`[${EXTENSION_NAME}] Ready! 🐶`);

    // 초기 데이터 로드 + 렌더링
    await lm.loadChat();
    ui.refresh();
    // ★ 위치 기반 자동 확장 (비동기, 로딩 안 막음)
    setTimeout(async () => {
        try { await lm.autoCalcDistances(); } catch(_){}
        try { await lm.autoReverseGeocode(); } catch(_){}
        ui.refresh();
    }, 2000);
}

async function scanContext() {
    try {
        const s = extension_settings[EXTENSION_NAME];
        if (!s?.enabled || !s?.autoDetect || !lm.currentChatId) return true; // 설정 비활성 = 정상
        const ctx = getContext();
        if (!ctx?.characterId) return true;

        // Bug I: 채팅 화면 활성 체크
        if (!isChatActive()) return false; // false = 재시도 필요

        // Task 2: 장소가 1개라도 있으면 재스캔 스킵
        if (lm.locations.length > 0) return;

        // 1차: 기존 채팅 히스토리 전체 스캔 (진행 중인 채팅에 확장 설치 시)
        if (ctx.chat?.length > 1) {
            const found = await scanChatHistory(ctx);
            if (found) return;
        }

        // 2차: 캐릭터 설명/시나리오에서 추출
        const char = ctx.characters?.[ctx.characterId];
        if (!char) return;
        const sources = [];
        if (char.description) sources.push(char.description);
        if (char.scenario) sources.push(char.scenario);
        if (char.first_mes) sources.push(char.first_mes);
        if (char.personality) sources.push(char.personality);
        try { const dp = document.querySelector('#depth_prompt_prompt'); if (dp?.value?.trim()) sources.push(dp.value); } catch(_){}
        try { const meta = ctx.chat_metadata; if (meta?.note_prompt) sources.push(meta.note_prompt); if (meta?.depth_prompt?.prompt) sources.push(meta.depth_prompt.prompt); } catch(_){}
        if (!sources.length) return;

        for (const text of sources) {
            const desc = det.detectFromDescription(text);
            if (desc) {
                dbg(`📋 Desc: "${desc}"`);
                const loc = await lm.addLocation(desc);
                if (loc) { await lm.moveTo(loc.id); pi.inject(); if (ui.panelVisible) ui.refresh(); }
                return;
            }
        }
        for (const text of sources) {
            const result = det.detect(text);
            if (result) { dbg(`📋 Context: "${result.location.name}"`); await lm.moveTo(result.location.id); pi.inject(); if (ui.panelVisible) ui.refresh(); return; }
            const np = det.detectNewPlace(text, 'user');
            if (np) { dbg(`📋 Context new: "${np}"`); const loc = await lm.addLocation(np); if (loc) { await lm.moveTo(loc.id); pi.inject(); if (ui.panelVisible) ui.refresh(); } return; }
        }
    } catch(e) { console.error(`[${EXTENSION_NAME}] Context scan:`, e); }
}

// ========== 최근 메시지 스캔 (승인 플로우) ==========
async function scanChatHistory(ctx) {
    if (!ctx?.chat?.length) return false;
    const recent = ctx.chat.slice(-4); // 최근 4개
    dbg(`📜 최근 ${recent.length}개 메시지 스캔`);

    const candidates = [];
    for (const msg of recent) {
        if (!msg?.mes?.trim()) continue;
        const text = msg.mes;

        const result = det.detect(text);
        if (result && !candidates.some(c => c.name === result.location.name)) {
            candidates.push({ name: result.location.name, existing: true, locId: result.location.id, checked: true });
            continue;
        }

        const np = det.detectNewPlace(text, 'ai');
        if (np && !lm.findByName(np) && !candidates.some(c => c.name === np)) {
            candidates.push({ name: np, existing: false, checked: true });
        }
    }

    if (!candidates.length) return false;

    // 승인 UI 표시
    dbg(`📜 ${candidates.length}개 장소 감지 → 승인 대기`);
    ui.showScanApproval(candidates);
    return true;
}

jQuery(async () => { try { await init(); } catch(e) { console.error(`[${EXTENSION_NAME}] Init:`, e); } });

// ========== RP 날짜 추출 (메타데이터에서) ==========
function _extractRpDate(text) {
    // 패턴 1: - Time: 2025/07/12 또는 Date: 2025.07.12
    const m1 = text.match(/[-*]\s*(?:Time|Date|날짜|시간)[:\s]+(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/i);
    if (m1) return `${m1[1]}/${parseInt(m1[2])}/${parseInt(m1[3])}`;
    // 패턴 2: July 12, 2025 또는 12 July 2025
    const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    const m2 = text.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
    if (m2 && months[m2[1].substring(0,3).toLowerCase()]) return `${m2[3]}/${months[m2[1].substring(0,3).toLowerCase()]}/${parseInt(m2[2])}`;
    const m3 = text.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
    if (m3 && months[m3[2].substring(0,3).toLowerCase()]) return `${m3[3]}/${months[m3[2].substring(0,3).toLowerCase()]}/${parseInt(m3[1])}`;
    // 패턴 3: 7월 12일 (년도 없으면 빈값)
    const m4 = text.match(/(\d{1,2})월\s*(\d{1,2})일/);
    if (m4) {
        const yr = text.match(/(\d{4})년/);
        return yr ? `${yr[1]}/${parseInt(m4[1])}/${parseInt(m4[2])}` : `${parseInt(m4[1])}/${parseInt(m4[2])}`;
    }
    return '';
}

// ========== 이벤트 추출 + 저장 헬퍼 ==========
const _strongKw = /키스|kiss|고백|confess|사랑|love|싸[우웠]|fight|죽|kill|배신|betray|도망|escape|약속|promise|결혼|marry|이별|breakup|broke up|훔[쳤치]|stole|steal|snuck|sneak|침입|broke in|farewell|작별|맹세|swear|vow|재회|reunion|잃어버|잃[은었을]|lost|missing/i;
let _lastEventTime = 0;
let _lastEventLocId = null; // 마지막 이벤트 저장 장소

// 전체 패턴 (AI용 — 가벼운 트리거)
const _triggerKw = /키스|kiss|포옹|hug|사랑|love|고백|confess|속삭|whisper|입술|lip|심장|heart|두근|떨[리렸]|tremble|끌어안|embrace|울[었다]|눈물|cry|tear|싸[우웠움]|fight|배신|betray|도망|escape|발견|discover|비밀|secret|부상|injur|약속|promise|내일|tomorrow|선물|gift|devour|cupped|passion|intimate|desire|breathless|gasp|moan|shudder|groan|tongue|stole|steal|stolen|snuck|sneak|훔[쳤치]|침입|threat|경고|죽|kill|death|총|gun|칼|sword|knife|피[가를]|blood|curse|저주|분노|rage|복수|revenge|떠나|이별|작별|farewell|goodbye|depart|leave.*behind|결심|맹세|선언|다짐|decide|swear|vow|declare|귀환|재회|돌아[왔오]|return|reunion|위험|위협|위기|danger|warn|peril|잃어버|잃[은었을]|분실|사라[졌진]|lost|lose|missing|vanish|disappear/i;

async function _tryEvent(text, locId, source) {
    dbg(`📋 _tryEvent (${source}) len=${text.length}`);
    if (text.length < 25) { dbg('⏭️ Text too short'); return; }
    // 같은 장소 5초 내 중복 방지 (다른 장소는 OK!)
    if (Date.now() - _lastEventTime < 5000 && _lastEventLocId === locId) { dbg('⏭️ Event cooldown (same loc)'); return; }
    // USER는 강한 키워드만, AI는 전체 트리거
    if (source === 'USER' && !_strongKw.test(text)) { dbg('⏭️ USER no strong keyword'); return; }
    if (source === 'AI' && !_triggerKw.test(text)) { dbg('⏭️ AI no trigger keyword'); return; }
    dbg(`🎯 Event trigger! (${source}) locId=${locId}`);

    const loc = lm.locations.find(l => l.id === locId);
    if (!loc) return;

    // 중복 방지 (최근 30초 내)
    if (loc.events?.length) {
        const last = loc.events[loc.events.length - 1];
        if (Date.now() - last.timestamp < 30000) return;
    }

    let evText = null, evTitle = null, evMood = '💕';

    // ★ Phase 2: LLM 요약 시도
    try {
        const ctx = getContext();
        const generateQuietPrompt = ctx?.generateQuietPrompt;
        if (generateQuietPrompt) {
            // HTML 제거 + 메타데이터 제거
            const clean = text.replace(/<[^>]*>/g, '').replace(/```[\s\S]*?```/g, '').replace(/<memo>[\s\S]*?<\/memo>/g, '').trim();
            if (clean.length < 30) return;

            // 2000자 제한 (토큰 절약)
            const trimmed = clean.length > 2000 ? clean.substring(0, 2000) : clean;

            // 유저 입력 컨텍스트 추가 (있으면)
            const userCtx = _userContext ? `\n\n[User's action]: ${_userContext.replace(/<[^>]*>/g, '').substring(0, 300)}` : '';

            // 캐릭터 이름 가져오기
            const userName = ctx.name1 || 'User';
            const charName = ctx.name2 || 'Character';

            // 언어 설정
            const eLang = extension_settings[EXTENSION_NAME]?.eventLang || 'auto';
            const langInst = eLang === 'ko' ? 'Write the summary in Korean (한국어).'
                           : eLang === 'en' ? 'Write the summary in English.'
                           : 'Write in the SAME LANGUAGE as the input text.';

            const prompt = `You are a narrative memory keeper for an RP story. Read the scene and write a rich, detailed 2-sentence memory summary.

Character info: The user/protagonist is named "${userName}". The main character is "${charName}".
IMPORTANT: You MUST use "${userName}" by name in the summary. Always write like: "${userName}이/가 [character]와..."

Rules:
- ${langInst}
- ALWAYS include character names as subjects (WHO did what with WHOM).
- Sentence 1: Describe WHERE it happened (place + atmosphere), WHAT ${userName} was doing, and the KEY EVENT that occurred. Be specific with details from the scene (objects, smells, actions). Include a key dialogue quote if impactful.
- Sentence 2: Describe the emotional consequence, tension shift, or what this event foreshadows for the future. Be vivid and narrative.
- Each sentence should be detailed and descriptive (60~120 characters each). Do NOT be too brief.
- Write like a novel's diary entry — immersive, specific, atmospheric.

If no significant event (just walking, sitting, daily routine): {"mood":null,"summary":null}

Respond with ONLY a JSON object, no markdown, no explanation:
{"mood":"💕","title":"ultra-short hook max 15chars that emphasizes THIS PLACE's emotional meaning. Write like: 'OO한 곳' or 'OO이 시작된 곳'. Do NOT copy dialogue literally — capture the emotional significance. Match the scene's tone: playful scenes can have witty/humorous titles, serious scenes should stay sincere.","summary":"detailed 2-sentence summary"}

Mood types: 💕=romantic/emotional 📅=promise/future ⚡=conflict/danger

Examples:
{"mood":"⚡","title":"고구마와 뒷담화의 현장","summary":"군견 Dex의 막사에서 ${userName}가 몰래 군고구마를 나눠먹으며 Ghost에 대한 불만을 털어놓던 중, 이를 엿들은 Ghost에게 현장을 들키고 만다. Ghost의 묵언의 압박과 Dex의 으르렁거림이 섞이며, 이 밀폐된 공간에서 아슬아슬한 대화가 이어질 것을 암시한다."}
{"mood":"💕","title":"금지된 키스가 시작된 곳","summary":"시가 향과 가죽 냄새가 밴 Price의 어두운 방에서 ${userName}과 Soap이 거칠지만 다정한 키스를 나눴다. 대장의 영역을 침범한 이 은밀한 행위가 둘의 관계를 더 위험하고 짜릿하게 만들 것을 예고한다."}
{"mood":"📅","title":"비밀 약속을 나눈 곳","summary":"노을이 물드는 옥상에서 Alejandro가 ${userName}의 손을 잡으며 '내일, 여기서'라고 속삭였다. 이 장소가 둘만의 비밀스러운 거점이 될 것을 서로의 떨리는 손끝으로 예감했다."}

Text:
${trimmed}${userCtx}`;

            const result = await generateQuietPrompt({ prompt });
            if (result) {
                // JSON 파싱
                const jsonMatch = result.match(/\{[\s\S]*?\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (parsed.mood && parsed.summary) {
                        evText = parsed.summary;
                        evTitle = parsed.title || parsed.summary.substring(0, 15) + '...';
                        evMood = parsed.mood;
                        dbg(`🤖 LLM Event: "${evTitle}" | "${evText}" (${evMood})`);
                    }
                }
            }
        }
    } catch (e) {
        dbg(`⚠️ LLM event extraction failed, falling back to regex: ${e.message}`);
    }

    // ★ 폴백: LLM 실패 시 regex 추출
    if (!evText) {
        const ev = _extractEventSummary(text, '');
        if (!ev) return;
        evText = ev.text;
        evTitle = ev.text.length > 15 ? ev.text.substring(0, 15) + '...' : ev.text;
        evMood = ev.mood;
        dbg(`📝 Regex Event: "${evTitle}" | "${evText}" (${evMood})`);
    }

    // ★ RP 날짜 추출 (메타데이터에서)
    const rpDate = _extractRpDate(text);

    if (!loc.events) loc.events = [];
    loc.events.push({ text: evText, title: evTitle, mood: evMood, timestamp: Date.now(), rpDate, source });
    if (loc.events.length > 20) loc.events = loc.events.slice(-20);
    await lm.updateLocation(locId, { events: loc.events });
    _lastEventTime = Date.now();
    _lastEventLocId = locId;
    // 알림 (오버레이 → 읽기 전용)
    try {
        ui.showEventNotify(loc.name, { text: evText, tag: evMood }, locId);
    } catch(e) {
        dbg(`⚠️ Notify failed: ${e.message}`);
    }
    // ★ 팝오버 열려있으면 이벤트 목록 자동 갱신
    try {
        const openId = $('#wt-popover').attr('data-id');
        if (openId === locId && $('#wt-popover').is(':visible')) {
            ui._updEventsList(locId);
        }
    } catch(e) {}
    dbg(`${evMood} Event: "${evText}" @ ${loc.name} (${source})`);
}

// ========== 이벤트 요약 추출 (감정/사건 키워드 + 타입 분류) ==========
function _extractEventSummary(text, locName) {
    // HTML만 제거 (대사는 유지! RP 감정은 대사 안에 있음)
    const clean = text.replace(/<[^>]*>/g, '').trim();
    if (clean.length < 20) return null;

    // 메타데이터/시스템 텍스트 필터 (이벤트 아님)
    const metaFilter = /^[-*]\s*(Time|Date|Location|Characters|Outfit|Items|Scene|Status|DATE CHANGE|날짜|시간|장소|의상|아이템)[\s:]/i;

    const patterns = [
        // 💕 감정/관계/로맨스 (memory)
        { rx: /키스|kiss|포옹|hug|안[았겼]|품[에었]|사랑|love|고백|confess|첫만남|first met/i, type: 'memory', mood: '💕' },
        { rx: /속삭|whisper|윙크|wink|숨결|breath|두근|심장.*뛰|heart.*beat|heart.*pound|떨[리렸]|tremble|shiver/i, type: 'memory', mood: '💕' },
        { rx: /볼.*빨개|얼굴.*달아|blush|손[을를].*잡|hold.*hand|눈[을를].*맞|eye.*meet|이마.*닿|forehead/i, type: 'memory', mood: '💕' },
        { rx: /끌어안|embrace|기대[어었]|lean|쓰다듬|caress|어루만|stroke|입술|lip|볼[에].*입|cheek/i, type: 'memory', mood: '💕' },
        { rx: /손가락.*깍지|finger.*interlock|머리.*쓸어|귓[가속]|ear|향기|scent|체온|온기|warmth/i, type: 'memory', mood: '💕' },
        // 💕 영어 로맨스 확장 (AI가 자주 쓰는 묘사)
        { rx: /mouth.*devour|devour.*mouth|cupped.*face|traced.*jaw|passion|intimate|desire|sensual|breathless|panting/i, type: 'memory', mood: '💕' },
        { rx: /pressed.*against|pulled.*close|leaned.*in|neck.*kiss|collarbone|nuzzle|nibble|tongue|lick/i, type: 'memory', mood: '💕' },
        { rx: /moaned|gasped|arched|shudder|pulse.*rac|heart.*rac|chest.*tight|stomach.*flutter/i, type: 'memory', mood: '💕' },
        { rx: /intertwine|entangle|straddle|pin.*down|beneath|above.*hover|grind|groan/i, type: 'memory', mood: '💕' },
        // 😢 슬픔
        { rx: /울[었다]|눈물|cry|tears|슬[퍼펐]|sad|위로|comfort|그리[워웠]|miss/i, type: 'memory', mood: '😢' },
        // 😊 기쁨 (강한 것만)
        { rx: /행복|happy|환희|기[뻐쁨]|joy|축하|celebrat/i, type: 'memory', mood: '😊' },
        // ⚡ 사건 (incident)
        { rx: /싸[우웠움]|fight|충돌|clash|화[가났]|anger|분노|rage|배신|betray/i, type: 'incident', mood: '⚡' },
        { rx: /발견|discover|비밀|secret|숨[겼긴]|hide|도망|escape|추[격적]|chase/i, type: 'incident', mood: '🔍' },
        { rx: /부상|injur|사고|accident|피[가를]|blood|쓰러[졌진]|collapse|치료|heal/i, type: 'incident', mood: '🩹' },
        { rx: /결투|duel|전투|battle|공격|attack|방어|defend|훈련|train/i, type: 'incident', mood: '⚔️' },
        { rx: /비명|scream|절규|shriek|공포|terror|두려[움운]|fear|confrontation/i, type: 'incident', mood: '⚡' },
        // 📅 약속/미래 (promise)
        { rx: /약속|promise|다음[에번]|next time|만나[자기]|내일|tomorrow|기다[려릴]|같이.*가|데이트|date/i, type: 'promise', mood: '📅' },
        // 🎁 특별 이벤트
        { rx: /선물|gift|편지|letter|파티|party|축하|celebrat|생일|birthday|기념/i, type: 'memory', mood: '🎁' },
        { rx: /전화|call|연락|contact|메시지|message/i, type: 'memory', mood: '📞' },
    ];

    const sentences = clean.split(/[.!?。！？\n]+/).filter(s => s.trim().length > 8);

    for (const s of sentences) {
        const trimmed = s.trim();
        // 메타데이터 문장 스킵
        if (metaFilter.test(trimmed)) continue;
        for (const p of patterns) {
            if (p.rx.test(trimmed)) {
                let summary = trimmed;
                if (summary.length > 60) summary = summary.substring(0, 60) + '...';
                return { text: summary, type: p.type, mood: p.mood };
            }
        }
    }

    // 키워드 없으면 null (일상 = 기록 안 함!)
    return null;
}
