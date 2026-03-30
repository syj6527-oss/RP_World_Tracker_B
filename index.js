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
};

let db, lm, det, pi, ui;

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
        const s = extension_settings[EXTENSION_NAME];
        if (!s?.enabled || !s?.autoDetect || !text?.trim()) return false;
        if (!lm.currentChatId) await lm.loadChat();
        if (!lm.currentChatId) return false;

        const mode = source === 'AI' ? 'ai' : 'user';
        dbg(`🔍 ${source} (${text.length}c) mode=${mode}`);

        // 이미 등록된 장소 감지 (USER/AI 동일)
        const result = det.detect(text);
        if (result) {
            const { location, type, confidence } = result;
            dbg(`✅ "${location.name}" (${type} c=${confidence})`);
            if (lm.currentLocationId !== location.id) {
                await lm.moveTo(location.id);
                if (s.showDetectToast) wtNotify(`${wtMascot()} ${wtTreat()} ${location.name}`, 'move');
                pi.inject(); if (ui.panelVisible) ui.refresh();
            }
            // AI 응답이면 이벤트 자동 추출 (감정/사건 키워드만)
            if (source === 'AI' && text.length > 30) {
                const ev = _extractEventSummary(text, location.name);
                if (ev) {
                    // 자동 저장
                    const loc = lm.locations.find(l => l.id === location.id);
                    if (loc) {
                        if (!loc.events) loc.events = [];
                        loc.events.push({ text: ev.text, type: ev.type, mood: ev.mood, timestamp: Date.now() });
                        if (loc.events.length > 20) loc.events = loc.events.slice(-20); // 최대 20개
                        await lm.updateLocation(location.id, { events: loc.events });
                    }
                    // 알림 (수정 가능)
                    ui.showEventNotify(location.name, { text: ev.text, tag: ev.mood }, location.id);
                }
            }
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
                    await lm.moveTo(loc.id);
                    if (s.showDetectToast) wtNotify(`${wtMascot()} 🆕 ${loc.name}`, 'new', 3500);
                    pi.inject(); if (ui.panelVisible) ui.refresh();
                    ui.showAutoToast(loc);
                }
            }
            return true;
        }
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
    ui.createSettingsPanel(); ui.createSidePanel(); ui.registerWandButton();

    let lastId = null;
    let _handleCount = 0;
    async function handle(idx) {
        try {
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
            if (userMsg?.mes?.trim()) await scanMessage(userMsg.mes, 'USER');
            if (aiMsg.mes?.trim()) await scanMessage(aiMsg.mes, 'AI');
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

// ========== 이벤트 요약 추출 (감정/사건 키워드 + 타입 분류) ==========
function _extractEventSummary(text, locName) {
    const clean = text.replace(/<[^>]*>/g, '').replace(/"[^"]*"/g, '').replace(/「[^」]*」/g, '').trim();
    if (clean.length < 20) return null;

    // 키워드 → 타입 + 무드 매핑
    const patterns = [
        // 💕 감정/관계 (memory)
        { rx: /키스|kiss|포옹|hug|안[았겼]|품[에었]|사랑|love|고백|confess|첫만남|first met/i, type: 'memory', mood: '💕' },
        { rx: /울[었다]|눈물|cry|tears|슬[퍼펐]|sad|위로|comfort|그리[워웠]|miss/i, type: 'memory', mood: '😢' },
        { rx: /웃[었다]|미소|smile|laugh|행복|happy|즐[거겼]|기[뻐쁨]|joy/i, type: 'memory', mood: '😊' },
        // ⚡ 사건 (incident)
        { rx: /싸[우웠움]|fight|충돌|clash|화[가났]|anger|분노|rage|배신|betray/i, type: 'incident', mood: '⚡' },
        { rx: /발견|discover|비밀|secret|숨[겼긴]|hide|도망|escape|추[격적]|chase/i, type: 'incident', mood: '🔍' },
        { rx: /부상|injur|사고|accident|피[가를]|blood|쓰러[졌진]|collapse|치료|heal/i, type: 'incident', mood: '🩹' },
        { rx: /결투|duel|전투|battle|공격|attack|방어|defend|훈련|train/i, type: 'incident', mood: '⚔️' },
        // 📅 약속/미래 (promise)
        { rx: /약속|promise|다음[에번]|next time|만나[자기]|내일|tomorrow|기다[려릴]/i, type: 'promise', mood: '📅' },
        // 🎁 특별 이벤트
        { rx: /선물|gift|편지|letter|파티|party|축하|celebrat|생일|birthday|기념/i, type: 'memory', mood: '🎁' },
        { rx: /전화|call|연락|contact|메시지|message/i, type: 'memory', mood: '📞' },
    ];

    const sentences = clean.split(/[.!?。！？\n]+/).filter(s => s.trim().length > 5);

    for (const s of sentences) {
        const trimmed = s.trim();
        for (const p of patterns) {
            if (p.rx.test(trimmed)) {
                let summary = trimmed;
                if (summary.length > 40) summary = summary.substring(0, 40) + '...';
                return { text: summary, type: p.type, mood: p.mood };
            }
        }
    }

    // 키워드 없으면 null (일상 = 기록 안 함!)
    return null;
}
