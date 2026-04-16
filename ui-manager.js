// 🐶 World Tracker — ui-manager.js (Inline Toast + Popover)
// ★ BUILD: 2026-04-02 hotfix16 (session5 FINAL — mood cards + accordion timeline)
console.log('[wt] ui-manager hotfix16 loaded');

import { getContext, extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { EXTENSION_NAME, wtNotify, toastWarn, toastSuccess, loadLeaflet, wtMascot, wtTreat, runWithoutAutoDetect } from './index.js';
import { callLLM, parseLLMJson, getRecentChatContext } from './llm-helper.js';
import { MapRenderer } from './map-renderer.js';
import { LeafletRenderer } from './leaflet-renderer.js';

const dbg = (...a) => console.log(`[${EXTENSION_NAME}]`, ...a);

const catGroups = [
    ['hall','room','chamber','lounge'],['dining','mess','cafeteria','restaurant','kitchen','cafe','canteen'],
    ['office','study','workshop','lab'],['bedroom','quarters','dorm','bunk','dormitory'],
    ['gym','arena','court','field','ground','training','range'],['armory','arsenal','weapons'],
    ['garden','park','yard','plaza','square'],['shop','store','market','mall','mart','grocery','supermarket','convenience'],
    ['library','archive','bookstore'],['bar','pub','tavern','inn'],
    ['식당','카페','음식점','레스토랑','매점','구내식당'],['숙소','기숙사','침실','방','객실'],
    ['사무실','연구실','작업실'],['도서관','서점','서재'],['공원','정원','광장'],['체육관','운동장','훈련장','사격장'],
];

export class UIManager {
    constructor(lm, pi) {
        this.lm=lm;
        this.pi=pi;
        this.mapRenderer=null;
        this.leafletRenderer=null;
        this.panelVisible=false;
        this._reviewCache = new Map();
        this._reviewPending = new Set();
        // r23: 디버그 시스템 (설정 or localStorage로 토글) — 양쪽 다 체크
        const _dbgFromLs = localStorage.getItem('wtDebug') === '1';
        const _dbgFromSettings = extension_settings?.[EXTENSION_NAME]?.debugMode === true;
        this._debugEnabled = _dbgFromLs || _dbgFromSettings;
        window._wtTapFireLock = false;
        window._wtDlog = (msg, color) => this._dlog?.(msg, color);
        this._installDebugSystem();
    }

    // r23: 디버그 시스템 — 항상 리스너는 설치하되 _debugEnabled true일 때만 동작
    _installDebugSystem() {
        if (window._wtDebugSysInstalled) return;
        window._wtDebugSysInstalled = true;
        const self = this;

        // 1) 전역 에러 캐치 — 디버그 ON일 때 패널에 찍힘
        window.addEventListener('error', (e) => {
            if (!self._debugEnabled) return;
            const src = (e.filename||'').split('/').pop().substring(0,20);
            self._dlog(`ERR: ${e.message?.substring(0,60)} @${src}:${e.lineno}`, '#f55');
        });
        window.addEventListener('unhandledrejection', (e) => {
            if (!self._debugEnabled) return;
            const msg = e.reason?.message || String(e.reason).substring(0,60);
            self._dlog(`REJECT: ${msg.substring(0,80)}`, '#f55');
        });

        // 2) 터치 이벤트 추적
        const describeEl = (el) => {
            if (!el || !el.tagName) return 'NULL';
            const id = el.id ? `#${el.id}` : '';
            const cls = (typeof el.className === 'string') ? `.${el.className.split(' ').slice(0,2).join('.')}` : '';
            return `${el.tagName}${id}${cls}`.substring(0, 45);
        };
        self._describeEl = describeEl;

        const isWtTarget = (t) => {
            if (!t || !t.closest) return null;
            if (t.closest('#wt-tap-debug')) return null; // 디버그 패널 자체는 무시
            if (t.closest('.wt-bs-comm-more')) return 'COMM_MORE';
            if (t.closest('#wt-bs-nodemap-expand')) return 'NMAP_EXP';
            if (t.closest('.wt-bs-comm-gen')) return 'COMM_GEN';
            if (t.closest('.wt-bs-ev-del')) return 'EV_DEL';
            if (t.closest('.wt-bs-sub-del')) return 'SUB_DEL';
            if (t.closest('.wt-bs-mood-reset')) return 'MOOD_RST';
            if (t.closest('.wt-plan-del')) return 'PLAN_DEL';
            return null;
        };

        ['touchstart', 'touchend', 'click'].forEach(ev => {
            document.addEventListener(ev, (e) => {
                if (!self._debugEnabled) return;
                const kind = isWtTarget(e.target);
                if (kind) {
                    self._dlog(`${ev} → ${kind}`, '#0ff');
                } else if (window._wtLogAll && !e.target.closest?.('#wt-tap-debug')) {
                    const t = e.touches?.[0] || e.changedTouches?.[0];
                    if (ev === 'touchstart' && t) {
                        const topEl = document.elementFromPoint(t.clientX, t.clientY);
                        self._dlog(`TS @(${t.clientX.toFixed(0)},${t.clientY.toFixed(0)}) ${describeEl(topEl)}`, '#888');
                    }
                }
            }, true);
        });

        // 3) 활성 상태면 패널 생성
        if (self._debugEnabled) {
            const setup = () => {
                if (!document.body) { setTimeout(setup, 100); return; }
                self._createDebugPanel();
            };
            setup();
        }
    }

    _toggleDebug(on) {
        this._debugEnabled = on;
        localStorage.setItem('wtDebug', on ? '1' : '0');
        // extension_settings도 동기화
        try {
            if (extension_settings?.[EXTENSION_NAME]) {
                extension_settings[EXTENSION_NAME].debugMode = on;
                saveSettingsDebounced();
            }
        } catch(e) {}
        if (on) {
            this._createDebugPanel();
            toastSuccess('🔍 디버그 패널 ON');
        } else {
            document.getElementById('wt-tap-debug')?.remove();
            toastSuccess('🔍 디버그 패널 OFF');
        }
    }

    _dlog(msg, color) {
        if (!this._debugEnabled) return;
        const log = document.getElementById('wt-dbg-log');
        if (!log) return;
        const d = document.createElement('div');
        d.style.cssText = `color:${color||'#0f0'};margin-bottom:1px;word-break:break-all`;
        const ts = new Date();
        const tm = `${String(ts.getSeconds()).padStart(2,'0')}.${String(ts.getMilliseconds()).padStart(3,'0')}`;
        d.textContent = `${tm} ${msg}`;
        log.insertBefore(d, log.firstChild);
        while (log.children.length > 60) log.removeChild(log.lastChild);
    }

    _createDebugPanel() {
        if (document.getElementById('wt-tap-debug')) return;
        const self = this;
        const panel = document.createElement('div');
        panel.id = 'wt-tap-debug';
        panel.style.cssText = 'position:fixed;top:8px;right:8px;width:250px;max-height:40vh;background:rgba(0,0,0,0.88);color:#0f0;font-family:monospace;font-size:10px;padding:4px 6px;border-radius:6px;z-index:2147483647;overflow-y:auto;line-height:1.35;box-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:auto';
        panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;border-bottom:1px solid #333;padding-bottom:2px"><span style="color:#ff0;font-weight:700">🔍 WT DEBUG</span><span style="display:flex;gap:3px"><span id="wt-dbg-diag" style="cursor:pointer;color:#fa0;padding:0 3px;font-weight:700">DIAG</span><span id="wt-dbg-all" style="cursor:pointer;color:#888;padding:0 3px;font-weight:700">ALL</span><span id="wt-dbg-clr" style="cursor:pointer;color:#0af;padding:0 3px">CLR</span><span id="wt-dbg-x" style="cursor:pointer;color:#f55;padding:0 3px">✕</span></span></div><div id="wt-dbg-log"></div>';
        document.body.appendChild(panel);
        self._dlog(`debug ready (v${this._version || 'r23'})`, '#ff0');

        document.getElementById('wt-dbg-clr').addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('wt-dbg-log').innerHTML = ''; }, true);
        document.getElementById('wt-dbg-x').addEventListener('click', (e) => { e.stopPropagation(); panel.remove(); }, true);

        window._wtLogAll = false;
        const toggleAll = () => {
            window._wtLogAll = !window._wtLogAll;
            const btn = document.getElementById('wt-dbg-all');
            if (btn) btn.style.color = window._wtLogAll ? '#0f0' : '#888';
            self._dlog(`ALL ${window._wtLogAll ? 'ON' : 'OFF'}`, '#ff0');
        };
        document.getElementById('wt-dbg-all').addEventListener('click', (e) => { e.stopPropagation(); toggleAll(); }, true);
        document.getElementById('wt-dbg-all').addEventListener('touchend', (e) => { e.stopPropagation(); toggleAll(); }, true);

        // DIAG — 바텀시트 핵심 버튼들 진단
        const runDiag = () => {
            self._dlog('=== DIAG ===', '#ff0');
            const targets = [
                { sel: '.wt-bs-comm-more', label: 'COMM_MORE' },
                { sel: '#wt-bs-nodemap-expand', label: 'NMAP_EXP' },
                { sel: '.wt-bs-ev-del', label: 'EV_DEL (first)' },
                { sel: '.wt-bs-sub-del', label: 'SUB_DEL (first)' },
                { sel: '.wt-bs-mood-reset', label: 'MOOD_RST' },
            ];
            for (const { sel, label } of targets) {
                const el = document.querySelector(sel);
                if (!el) { self._dlog(`${label}: NOT IN DOM`, '#888'); continue; }
                const r = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                self._dlog(`${label}: ${r.width.toFixed(0)}x${r.height.toFixed(0)} pe=${cs.pointerEvents}`, '#0f0');
                if (r.width === 0 || r.height === 0) { self._dlog(` ! zero-size`, '#f55'); continue; }
                const cx = r.left + r.width/2, cy = r.top + r.height/2;
                const vw = window.innerWidth, vh = window.innerHeight;
                if (cx < 0 || cx > vw || cy < 0 || cy > vh) { self._dlog(` ! offscreen`, '#f55'); continue; }
                const topEl = document.elementFromPoint(cx, cy);
                const isSame = topEl === el || (topEl && el.contains(topEl));
                self._dlog(` top: ${self._describeEl(topEl)}`, isSame ? '#0f0' : '#f55');
                if (!isSame && topEl) {
                    const tcs = getComputedStyle(topEl);
                    self._dlog(` !! COVERED z=${tcs.zIndex}`, '#f80');
                }
            }
            // html/body transform 체크 — fixed containing block 이슈 발생 여부
            const hcs = getComputedStyle(document.documentElement);
            self._dlog(`html.tf=${hcs.transform.substring(0,25)}`, '#0af');
            self._dlog('=== END ===', '#ff0');
        };
        document.getElementById('wt-dbg-diag').addEventListener('click', (e) => { e.stopPropagation(); runDiag(); }, true);
        document.getElementById('wt-dbg-diag').addEventListener('touchend', (e) => { e.stopPropagation(); runDiag(); }, true);
    }


    // ========== 설정 패널 (SillyTavern 확장 설정) ==========
    createSettingsPanel() {
        const html = `<div id="wt-settings" class="wt-settings"><div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🐶 World Tracker <span class="wt-version" style="cursor:default;user-select:none">v0.6.1-beta-r2</span></b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div><div class="inline-drawer-content">
                <div class="wt-s-row"><label><input type="checkbox" id="wt-s-enabled"/> 활성화</label></div>
                <div class="wt-divider"></div>
                <div class="wt-s-row"><label><input type="checkbox" id="wt-s-detect"/> 🔍 자동 감지</label></div>
                <div class="wt-s-row"><label><input type="checkbox" id="wt-s-toast"/> 📍 이동 알림</label></div>
                <div class="wt-divider"></div>
                <div class="wt-s-row"><label><input type="checkbox" id="wt-s-inject"/> 🤖 AI 프롬프트 주입</label></div>
                <div class="wt-s-row"><label><input type="checkbox" id="wt-s-moveevent"/> 🐾 발자취 기록</label></div>
                <div class="wt-s-row"><label><span id="wt-secret" style="cursor:default">💭</span> 기억</label>
                    <select id="wt-s-mem" class="text_pole wt-select"><option value="natural">🌿 자연</option><option value="perfect">💎 완벽</option></select>
                </div>
                <div class="wt-divider"></div>
                <div class="wt-s-row"><label>🧠 감지 모델</label></div>
                <div class="wt-s-row" style="display:flex;gap:4px;align-items:center">
                    <select id="wt-s-profile" class="text_pole wt-select" style="flex:1;font-size:11px"><option value="">없음 (regex만)</option></select>
                    <button id="wt-s-profile-save" class="menu_button" style="font-size:11px;padding:6px 10px;white-space:nowrap">💾 저장</button>
                </div>
                <span id="wt-s-profile-status" style="font-size:10px;color:#9A8A7A;display:block;margin-top:2px"></span>
                <div class="wt-divider"></div>
                <div class="wt-s-row" style="display:flex;align-items:center;gap:6px">
                    <label style="white-space:nowrap">🌐 AI 언어</label>
                    <select id="wt-s-eventlang" class="text_pole wt-select" style="flex:1;font-size:11px"><option value="auto">🔄 자동 (RP 언어)</option><option value="ko">🇰🇷 한국어</option><option value="en">🇺🇸 English</option></select>
                </div>
                <div class="wt-divider"></div>
                <div class="wt-s-row"><label>🔑 LLM API 키 (리뷰/이벤트 생성용)</label></div>
                <div class="wt-s-row" style="display:flex;gap:4px;align-items:center">
                    <select id="wt-s-llm-provider" class="text_pole wt-select" style="width:90px;font-size:11px"><option value="google">Gemini</option><option value="openai">OpenAI</option><option value="openrouter">OpenRouter</option></select>
                    <input type="password" id="wt-s-llm-key" class="text_pole" placeholder="API 키 입력..." style="flex:1;font-size:11px;padding:6px 8px"/>
                </div>
                <div class="wt-s-row" style="display:flex;gap:4px;align-items:center">
                    <select id="wt-s-llm-model" class="text_pole wt-select" style="flex:1;font-size:11px"></select>
                    <button id="wt-s-llm-test" class="menu_button" style="font-size:11px;padding:6px 10px;white-space:nowrap">🧪 테스트</button>
                </div>
                <span id="wt-s-llm-status" style="font-size:10px;color:#9A8A7A;display:block;margin-top:2px">미설정 → 기본(generateQuietPrompt) 사용</span>
                <div class="wt-divider"></div>
                <div class="wt-s-row"><label><input type="checkbox" id="wt-s-worldcont"/> 🌍 세계관 이어가기</label></div>
                <span id="wt-s-worldcont-status" style="font-size:10px;color:#9A8A7A;display:block;margin-top:1px;margin-bottom:4px">새 채팅에서도 같은 캐릭터의 세계관 유지</span>
                <div class="wt-divider"></div>
                <div class="wt-s-row"><label>📦 전체 데이터 관리</label></div>
                <div class="wt-s-row" style="display:flex;gap:4px">
                    <button id="wt-s-export-all" class="menu_button" style="flex:1;font-size:11px;padding:6px">💾 전체 백업</button>
                    <button id="wt-s-import-all" class="menu_button" style="flex:1;font-size:11px;padding:6px">📂 불러오기</button>
                    <button id="wt-s-delete-all" class="menu_button" style="flex:1;font-size:11px;padding:6px;color:#e74c3c">🗑️ 전체 삭제</button>
                </div>
                <input type="file" id="wt-s-import-file" accept=".json" style="display:none"/>
            </div></div></div>`;
        const containers = ['#extensions_settings2','#extensions_settings','.extensions_block'];
        let target = null;
        for (const sel of containers) { target = $(sel); if (target.length) break; }
        if (!target?.length) { setTimeout(() => this.createSettingsPanel(), 3000); return; }
        target.append(html);
        this._bindSettings();
    }

    _bindSettings() {
        const s = extension_settings[EXTENSION_NAME];
        const bind = (sel, key, def) => $(sel).prop('checked', s?.[key] ?? def).on('change', function(){ s[key]=$(this).is(':checked'); saveSettingsDebounced(); });
        bind('#wt-s-enabled','enabled',true); bind('#wt-s-detect','autoDetect',true); bind('#wt-s-toast','showDetectToast',true); bind('#wt-s-inject','aiInjection',true); bind('#wt-s-moveevent','moveEvent',true);
        // r23: 디버그 체크박스 — localStorage + extension_settings 이중 저장
        const self = this;
        $('#wt-s-debug').prop('checked', this._debugEnabled).on('change', function() {
            const on = $(this).is(':checked');
            s.debugMode = on;
            saveSettingsDebounced();
            self._toggleDebug(on);
        });
        $('#wt-s-inject').on('change', () => { s.aiInjection ? this.pi?.inject() : this.pi?.clear(); });
        $('#wt-s-mem').val(s?.memoryMode||'natural').on('change', () => { s.memoryMode=$('#wt-s-mem').val(); saveSettingsDebounced(); this.pi?.inject(); });
        $('#wt-s-eventlang').val(s?.eventLang||'auto').on('change', () => { s.eventLang=$('#wt-s-eventlang').val(); saveSettingsDebounced(); });
        // 🧠 감지 모델 프로필 로드
        this._loadProfiles();
        $('#wt-s-profile').on('change', () => { $('#wt-s-profile-status').text('⚠️ 미저장').css('color','#F5A8A8'); });
        $('#wt-s-profile-save').on('click', () => {
            s.selectedProfile = $('#wt-s-profile').val();
            saveSettingsDebounced();
            const name = $('#wt-s-profile option:selected').text() || '없음';
            $('#wt-s-profile-status').text(`✅ "${name}" 저장됨`).css('color','#5E84E2');
            toastSuccess(`🧠 감지 모델: ${name}`);
            setTimeout(() => $('#wt-s-profile-status').text(''), 3000);
        });
        // 🔑 LLM API 키 설정
        const llmModels = {
            google: [
                { value: 'gemini-2.5-flash', label: '⚡ Gemini 2.5 Flash (추천)' },
                { value: 'gemini-2.0-flash', label: '⚡ Gemini 2.0 Flash' },
                { value: 'gemini-2.5-pro', label: '🧠 Gemini 2.5 Pro (고품질)' },
                { value: 'gemini-2.0-flash-lite', label: '💨 Gemini 2.0 Flash Lite (최저비용)' },
            ],
            openai: [
                { value: 'gpt-4o-mini', label: '⚡ GPT-4o Mini (추천)' },
                { value: 'gpt-4o', label: '🧠 GPT-4o (고품질)' },
                { value: 'gpt-4.1-mini', label: '⚡ GPT-4.1 Mini' },
                { value: 'gpt-4.1', label: '🧠 GPT-4.1' },
            ],
            openrouter: [
                { value: 'google/gemini-2.5-flash', label: '⚡ Gemini 2.5 Flash' },
                { value: 'google/gemini-2.5-pro', label: '🧠 Gemini 2.5 Pro' },
                { value: 'openai/gpt-4o-mini', label: '⚡ GPT-4o Mini' },
                { value: 'anthropic/claude-sonnet-4', label: '🧠 Claude Sonnet 4' },
            ],
        };
        const _populateModels = (provider) => {
            const sel = $('#wt-s-llm-model').empty();
            const models = llmModels[provider] || [];
            models.forEach(m => sel.append(`<option value="${m.value}">${m.label}</option>`));
            // 저장된 모델 복원
            if (s?.llmModel) sel.val(s.llmModel);
        };
        $('#wt-s-llm-provider').val(s?.llmProvider || 'google');
        _populateModels(s?.llmProvider || 'google');
        $('#wt-s-llm-key').val(s?.llmApiKey || '');
        if (s?.llmApiKey) $('#wt-s-llm-status').text('✅ API 키 설정됨').css('color', '#2B8A6E');
        $('#wt-s-llm-provider').on('change', () => {
            s.llmProvider = $('#wt-s-llm-provider').val();
            _populateModels(s.llmProvider);
            s.llmModel = $('#wt-s-llm-model').val();
            saveSettingsDebounced();
        });
        $('#wt-s-llm-key').on('change', () => { s.llmApiKey = $('#wt-s-llm-key').val().trim(); saveSettingsDebounced(); $('#wt-s-llm-status').text(s.llmApiKey ? '✅ 저장됨' : '미설정').css('color', s.llmApiKey ? '#2B8A6E' : '#9A8A7A'); });
        $('#wt-s-llm-model').on('change', () => { s.llmModel = $('#wt-s-llm-model').val(); saveSettingsDebounced(); });
        $('#wt-s-llm-test').on('click', async () => {
            $('#wt-s-llm-status').text('🔄 테스트 중...').css('color', '#5E84E2');
            try {
                const { callLLM } = await import('./llm-helper.js');
                // 15초 타임아웃
                const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('15초 타임아웃 — API 키/모델 확인')), 15000));
                const result = await Promise.race([callLLM('Respond with ONLY this JSON: {"test":"ok"}'), timeout]);
                if (result && result.includes('ok')) {
                    $('#wt-s-llm-status').text('✅ 연결 성공!').css('color', '#2B8A6E');
                    toastSuccess('🔑 LLM 연결 성공!');
                } else if (result) {
                    $('#wt-s-llm-status').text('⚠️ 응답은 왔지만 JSON 아님: ' + result.substring(0, 80)).css('color', '#E07C3A');
                } else {
                    $('#wt-s-llm-status').text('⚠️ 빈 응답 — 모델 변경 권장').css('color', '#F5A8A8');
                }
            } catch(e) {
                $('#wt-s-llm-status').text('❌ ' + e.message).css('color', '#F5A8A8');
            }
        });
        // 🌍 세계관 이어가기
        $('#wt-s-worldcont').prop('checked', s?.worldContinuity ?? false).on('change', async () => {
            const enabled = $('#wt-s-worldcont').is(':checked');
            if (enabled) {
                const charKey = this.lm.getCharacterId();
                if (!charKey) {
                    toastWarn('캐릭터를 먼저 선택해주세요');
                    $('#wt-s-worldcont').prop('checked', false);
                    return;
                }
                const existing = await this.lm.db.getLocationsByChatId(charKey);
                let msg = '현재 채팅의 세계관을 이 캐릭터에 연결할까요?\n새 채팅을 만들어도 세계관이 유지됩니다.';
                if (existing?.length) {
                    msg = `이 캐릭터에 이미 세계관 데이터가 있어요 (${existing.length}곳).\n연결하면 기존 데이터를 이어서 사용합니다.`;
                }
                if (!confirm(msg)) {
                    $('#wt-s-worldcont').prop('checked', false);
                    return;
                }
                s.worldContinuity = true;
                saveSettingsDebounced();
                await this.lm.migrateToCharacter();
                await this.lm.loadChat();
                this.pi?.inject();
                if (this.panelVisible) this.refresh();
                $('#wt-s-worldcont-status').text('✅ 캐릭터 세계관 연결됨').css('color', '#2B8A6E');
                toastSuccess('🌍 세계관 이어가기 ON!');
            } else {
                s.worldContinuity = false;
                saveSettingsDebounced();
                await this.lm.loadChat();
                this.pi?.inject();
                if (this.panelVisible) this.refresh();
                $('#wt-s-worldcont-status').text('새 채팅에서도 같은 캐릭터의 세계관 유지').css('color', '#9A8A7A');
                toastSuccess('🌍 세계관 이어가기 OFF');
            }
        });
        // 전체 데이터 관리 (설정 패널)
        $('#wt-s-export-all').on('click', () => this._exportAllData());
        $('#wt-s-import-all').on('click', () => $('#wt-s-import-file').click());
        $('#wt-s-import-file').on('change', (e) => this._importAllData(e));
        $('#wt-s-delete-all').on('click', () => this._deleteAllData());
        // 🔧 비밀 디버그 토글: 💭 또는 버전 번호 5번 탭 (2초 내)
        // r23: click → pointerdown으로 변경 (모바일 호환성 ↑, click보다 빨리 + 확실)
        const makeRapidTap = (triggerFn) => {
            let _t = 0, _tm = null;
            return (e) => {
                e.stopPropagation();
                e.preventDefault();
                _t++;
                clearTimeout(_tm);
                if (_t >= 5) {
                    _t = 0;
                    triggerFn();
                }
                _tm = setTimeout(() => { _t = 0; }, 2000);
            };
        };
        const toggleHandler = makeRapidTap(() => {
            const nv = !this._debugEnabled;
            s.debugMode = nv;
            saveSettingsDebounced();
            this._toggleDebug(nv);
            $('#wt-s-debug').prop('checked', nv);
        });
        $(document).on('pointerdown', '#wt-secret, .wt-version', toggleHandler);
    }

    _loadProfiles() {
        const sel = $('#wt-s-profile');
        const s = extension_settings[EXTENSION_NAME];
        sel.find('option:not(:first)').remove();

        try {
            // SillyTavern Connection Manager 프로필 (번역기와 동일 방식)
            const ctx = getContext();
            const profiles = ctx?.extensionSettings?.connectionManager?.profiles || [];
            for (const p of profiles) {
                if (p.id && p.name) sel.append(`<option value="${p.id}">${p.name}</option>`);
            }

            // 프로필 없으면 3초 후 재시도 (비동기 로드 대기)
            if (!profiles.length && !this._profileRetried) {
                this._profileRetried = true;
                setTimeout(() => { this._profileRetried = false; this._loadProfiles(); }, 3000);
            }
        } catch(e) { console.warn(`[${EXTENSION_NAME}] Profile load:`, e); }

        if (s?.selectedProfile) sel.val(s.selectedProfile);
    }

    registerWandButton() {
        try { const b=document.createElement('div'); b.id='wt-wand-btn'; b.className='list-group-item flex-container flexGap5';
            b.innerHTML='<span>🐶</span> World Tracker'; b.addEventListener('click',()=>this.togglePanel());
            const m=document.getElementById('extensionsMenu'); if(m)m.appendChild(b); } catch(e){}
    }

    // ========== 사이드 패널 HTML ==========
    createSidePanel() {
        const html = `
        <div id="wt-panel" class="wt-panel">
            <div class="wt-panel-header">
                <div class="wt-panel-title"><span>🐶</span> World Tracker</div>
                <div style="display:flex;gap:4px;align-items:center">
                    <button id="wt-fantasy-btn" class="wt-btn-icon" style="font-size:16px" title="판타지 모드">🏰</button>
                    <button id="wt-data-btn" class="wt-btn-icon" style="font-size:16px">⚙️</button>
                    <button id="wt-close-btn" class="wt-btn-icon">✕</button>
                </div>
            </div>
            <!-- 데이터 관리 드롭다운 -->
            <div id="wt-data-menu" style="display:none;padding:10px;background:var(--wt-surface);border-bottom:1px solid var(--wt-border);font-size:13px">
                <div style="font-weight:700;color:var(--wt-brown);margin-bottom:8px">📦 이 채팅 데이터</div>
                <div style="display:flex;gap:6px;margin-bottom:10px">
                    <button id="wt-data-export" class="wt-btn-primary" style="flex:1;padding:6px;font-size:12px">💾 백업</button>
                    <button id="wt-data-import" class="wt-btn-ghost" style="flex:1;padding:6px;font-size:12px">📂 불러오기</button>
                    <button id="wt-data-delete" class="wt-btn-danger" style="flex:1;padding:6px;font-size:12px">🗑️ 삭제</button>
                </div>
                <input type="file" id="wt-data-file" accept=".json" style="display:none"/>
            </div>
            <div class="wt-panel-body" id="wt-panel-body">

                <div class="wt-map-toggle" id="wt-map-toggle" style="display:none">🗺️ 지도 ▾</div>
                <div id="wt-map-section" style="display:none">
                    <div class="wt-map-mode-bar" style="display:none">
                        <button id="wt-mode-leaflet" class="wt-mode-btn wt-mode-active">🐾 Paw Maps</button>
                        <button id="wt-mode-node" class="wt-mode-btn">🗺️ 약도</button>
                        <button id="wt-mode-fantasy" class="wt-mode-btn" style="display:none">🏰 지도</button>
                    </div>
                    <div id="wt-search-bar" class="wt-search-bar" style="position:relative">
                        <button class="wt-back-btn" style="display:none" onclick="window.__wtCloseMap&&window.__wtCloseMap()" title="닫기">✕</button>
                        <div id="wt-search-tabs" style="display:none;gap:2px;margin-bottom:3px">
                            <button id="wt-search-tab-loc" class="wt-mode-btn wt-mode-active" style="flex:1;padding:4px;font-size:11px">🔍 장소</button>
                            <button id="wt-search-tab-addr" class="wt-mode-btn" style="flex:1;padding:4px;font-size:11px">📍 주소</button>
                        </div>
                        <input type="search" id="wt-search-input" class="wt-input" placeholder="🔍 주소 검색..." autocomplete="off" inputmode="search"/>
                        <button id="wt-btn-refresh" style="border:none;background:none;font-size:16px;cursor:pointer;opacity:.5;padding:2px 4px" title="약도 재배치">🔄</button>
                        <div id="wt-search-results" class="wt-search-results" style="display:none"></div>
                    </div>
                    <div id="wt-map-wrap" class="wt-map-wrap">
                        <div id="wt-map-container" class="wt-map-container"></div>
                    </div>
                    <div id="wt-leaflet-wrap" class="wt-map-wrap" style="display:none">
                        <div id="wt-leaflet-container" class="wt-map-container wt-leaflet-map"></div>
                        <!-- 구글맵 스타일 바텀시트 -->
                        <div id="wt-bottomsheet" class="wt-bs" style="display:none"></div>
                    </div>
                </div>

                <!-- 팝오버 (인라인!) -->
                <div id="wt-popover" class="wt-popover-inline" style="display:none">
                    <div class="wt-pop-header" style="display:flex;align-items:center;gap:8px;position:sticky;top:0;z-index:1;background:var(--wt-cream,#FEFEF2);padding:8px 4px 4px">
                        <input type="text" id="wt-pop-title" style="font-size:16px;font-weight:800;color:var(--wt-brown);background:transparent;border:none;border-bottom:1.5px dashed transparent;outline:none;flex:1;min-width:0;padding:2px 0;font-family:inherit" onfocus="this.style.borderBottomColor='var(--wt-yellow-d)'" onblur="this.style.borderBottomColor='transparent'"/>
                        <button id="wt-pop-close" style="width:32px;height:32px;min-width:32px;border:none;background:rgba(0,0,0,0.05);cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:8px;flex-shrink:0" title="닫기">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2.5 2.5L13.5 13.5M13.5 2.5L2.5 13.5" stroke="#9A8A7A" stroke-width="2.8" stroke-linecap="round"/></svg>
                        </button>
                    </div>
                    <div class="wt-pop-body" style="padding:10px 14px;display:flex;flex-direction:column;gap:8px;max-height:70vh;overflow-y:auto">
                        <div class="wt-pop-stats">
                            <div><span class="wt-stat-l">방문</span><span id="wt-pop-visits">0</span>회</div>
                            <div><span class="wt-stat-l">첫</span><span id="wt-pop-first">—</span></div>
                            <div><span class="wt-stat-l">최근</span><span id="wt-pop-last">—</span></div>
                        </div>
                        <div id="wt-pop-dist-section" style="display:none">
                            <div style="font-size:12px;color:#9A8A7A;margin-bottom:4px">📏 주요 장소와의 거리</div>
                            <div id="wt-pop-dist-list" style="display:flex;flex-direction:column;gap:4px"></div>
                            <div style="display:flex;gap:4px;margin-top:4px;align-items:center">
                                <select id="wt-pop-dist-target" class="wt-input wt-select-full" style="flex:1;font-size:12px;padding:6px 8px"></select>
                                <input type="text" id="wt-pop-dist-value" class="wt-input" placeholder="도보 10분" style="width:80px;font-size:12px;padding:6px 8px"/>
                                <button id="wt-pop-dist-add" class="wt-btn-accent wt-btn-s">+</button>
                            </div>
                            <div style="display:flex;align-items:center;gap:6px;margin-top:4px;font-size:11px;color:#9A8A7A">
                                <span>가까움</span>
                                <input type="range" id="wt-pop-dist-level" min="1" max="10" value="5" style="flex:1;height:4px"/>
                                <span>멀음</span>
                                <span id="wt-pop-dist-lvl-val" style="font-weight:600;color:var(--wt-brown);min-width:16px">5</span>
                            </div>
                            <div id="wt-pop-dist-hint" style="font-size:10px;color:#9A8A7A;text-align:center;margin-top:2px">도보권</div>
                        </div>
                        <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
                            <span style="font-size:12px;color:#9A8A7A">🏰 아이콘</span>
                            <select id="wt-pop-icon-type" class="wt-input wt-select-full" style="flex:1;font-size:12px;padding:5px 8px">
                                <option value="">자동 감지</option>
                                <option value="castle">🏰 성/궁전</option>
                                <option value="mountain">⛰️ 산</option>
                                <option value="forest">🌲 숲</option>
                                <option value="temple">⛪ 신전/교회</option>
                                <option value="village">🏘️ 마을</option>
                                <option value="house">🏠 집</option>
                                <option value="shop">🏪 상점/대장간</option>
                                <option value="tavern">🍺 술집/여관</option>
                                <option value="cave">🕳️ 동굴/던전</option>
                                <option value="port">⚓ 항구</option>
                                <option value="water">💧 강/호수</option>
                                <option value="library">📚 도서관</option>
                                <option value="arena">⚔️ 투기장</option>
                                <option value="flag">🪧 이정표</option>
                            </select>
                        </div>
                        <textarea id="wt-pop-memo" class="wt-input wt-textarea" placeholder="예: 행복한 우리집, 비밀 아지트..." rows="2"></textarea>
                        <div id="wt-pop-ainotes-section" style="margin-top:2px">
                            <div style="font-size:12px;color:#9A8A7A;margin-bottom:3px">🤖 특이사항 <span style="font-size:10px;color:#B0A898">(AI에게만 전달)</span></div>
                            <textarea id="wt-pop-ainotes" class="wt-input wt-textarea" placeholder="예: 0900 붐빔, 바리스타 민수, 2층 창가석 단골..." rows="3" style="font-size:11px;line-height:1.5"></textarea>
                        </div>
                        <div id="wt-pop-npcs-section" style="margin-top:4px">
                            <div style="font-size:12px;color:#9A8A7A;margin-bottom:3px">👥 터줏대감 <span style="font-size:10px;color:#B0A898">(자동 감지)</span></div>
                            <div id="wt-pop-npcs-list" style="display:flex;flex-direction:column;gap:2px;max-height:120px;overflow-y:auto"></div>
                        </div>
                        <div id="wt-pop-events-section" style="margin-top:4px">
                            <div style="font-size:12px;color:#9A8A7A;margin-bottom:4px">📝 이벤트 기록</div>
                            <div id="wt-pop-events-list" style="display:flex;flex-direction:column;gap:3px;max-height:300px;overflow-y:auto"></div>
                            <div style="display:flex;gap:4px;margin-top:4px">
                                <input type="text" id="wt-pop-event-input" class="wt-input" placeholder="이벤트 추가..." style="flex:1;font-size:12px;padding:5px 8px"/>
                                <button id="wt-pop-event-add" class="wt-btn-accent wt-btn-s">+</button>
                            </div>
                        </div>
                        <div style="font-size:12px;color:#9A8A7A;margin-top:2px">🏷️ 별칭 (쉼표 구분)</div>
                        <input type="text" id="wt-pop-aliases" class="wt-input" placeholder="예: 사격장, Shooting range" style="font-size:12px"/>
                        <div id="wt-pop-sub-section" style="margin-top:6px;display:none">
                            <div style="font-size:12px;font-weight:700;color:#5A4030;margin-bottom:4px">🏠 내부 장소</div>
                            <div id="wt-pop-sub-list"></div>
                            <div style="display:flex;gap:4px;margin-top:4px">
                                <input type="text" id="wt-pop-sub-input" class="wt-input" placeholder="장소 이름 (EX. 거실)" style="flex:1;font-size:11px;padding:5px 8px"/>
                                <button id="wt-pop-sub-add" class="wt-btn-accent wt-btn-s" style="font-size:14px;padding:4px 8px">+</button>
                            </div>
                        </div>
                        <div class="wt-pop-actions"><button id="wt-pop-save" class="wt-btn-primary">💾 저장</button><button id="wt-pop-del" class="wt-btn-danger">🗑️</button></div>
                        <button id="wt-pop-move" class="wt-btn-ghost wt-btn-sm">📍 위치 수정</button>
                        <button id="wt-pop-moveto" class="wt-btn-accent wt-btn-sm" style="opacity:1;font-size:12px">🐾 여기로 이동</button>
                        <div id="wt-pop-geo-section" style="margin-top:6px;text-align:left">
                            <div id="wt-pop-geo-notice" style="display:none;padding:8px 10px;background:rgba(94,132,226,0.1);border:1px solid #5E84E2;border-radius:6px;margin-bottom:6px;font-size:11px;color:#5E84E2;text-align:center">📍 이 장소에 좌표가 없어요 — 아래에서 주소를 검색해보세요!</div>
                            <div id="wt-pop-cur-addr" style="display:none;padding:6px 10px;background:rgba(94,132,226,0.06);border-radius:6px;margin-bottom:6px;font-size:11px;color:#5E84E2;text-align:left">📍 <span id="wt-pop-addr-text"></span></div>
                            <div style="font-size:12px;color:#9A8A7A;margin-bottom:4px;text-align:left">📍 실제 주소 설정</div>
                            <div style="display:flex;gap:4px">
                                <input type="text" id="wt-pop-geo-input" class="wt-input" placeholder="주소 또는 랜드마크..." style="flex:1;font-size:12px;padding:6px 8px"/>
                                <button id="wt-pop-geo-btn" class="wt-btn-accent wt-btn-s">🔍</button>
                            </div>
                            <div id="wt-pop-geo-results" style="display:none;margin-top:4px;max-height:100px;overflow-y:auto;font-size:11px"></div>
                        </div>
                    </div>
                </div>

                <div class="wt-scene-loc">
                    <span class="wt-scene-icon">🦴</span>
                    <div class="wt-scene-info"><span class="wt-scene-label">현재 씬</span><span id="wt-scene-name" class="wt-scene-name">—</span></div>
                </div>

                <div class="wt-add-toggle" id="wt-add-toggle">✚ 장소 추가 <span id="wt-add-arrow">▾</span></div>
                <div class="wt-add-form" id="wt-add-form" style="display:none">
                    <input type="text" id="wt-input-name" class="wt-input" placeholder="장소 이름"/>
                    <input type="text" id="wt-input-aliases" class="wt-input" placeholder="별칭 (쉼표)"/>
                    <button id="wt-btn-add" class="wt-btn-primary">✚ 추가</button>
                </div>

                <div class="wt-section-toggle" id="wt-loc-toggle">📍 장소 목록 <span id="wt-loc-count" class="wt-badge">0</span> <span id="wt-loc-arrow">▾</span></div>
                <div id="wt-loc-wrap" style="display:none"><div id="wt-loc-list" class="wt-loc-list"></div></div>
                <div class="wt-section-toggle" id="wt-move-toggle">🚶 이동 히스토리 <span id="wt-move-arrow">▾</span></div>
                <div id="wt-move-wrap" style="display:none"><div id="wt-move-list" class="wt-move-list"></div></div>
            </div>
            <!-- 🐾 Paw Map 하단 탭 (Leaflet 모드에서만 보임) -->
            <div id="wt-paw-nav" style="display:none;border-top:1px solid #E0E0E0;background:#fff;flex-shrink:0;z-index:40">
                <div style="display:flex">
                    <div class="wt-paw-tab wt-paw-tab-on" data-tab="explore" onclick="window.__wtNavTab&&window.__wtNavTab('explore',this)" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:10px 4px 12px;min-height:68px;cursor:pointer;background:#fff">
                        <span style="font-size:20px">🐾</span><span style="font-size:12px;font-weight:700;color:#1A73E8">탐색</span>
                    </div>
                    <div class="wt-paw-tab" data-tab="mypage" onclick="window.__wtNavTab&&window.__wtNavTab('mypage',this)" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:10px 4px 12px;min-height:68px;cursor:pointer;background:#fff">
                        <span style="font-size:20px">🔖</span><span style="font-size:12px;font-weight:500;color:#5F6368">내 페이지</span>
                    </div>
                    <div class="wt-paw-tab" data-tab="timeline" onclick="window.__wtNavTab&&window.__wtNavTab('timeline',this)" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:10px 4px 12px;min-height:68px;cursor:pointer;background:#fff">
                        <span style="font-size:20px">🕐</span><span style="font-size:12px;font-weight:500;color:#5F6368">타임라인</span>
                    </div>
                </div>
            </div>
        </div>`;
        $('body').append(html);
        this._bind();
    }

    // ========== 이벤트 바인딩 ==========
    _bind() {
        $('#wt-close-btn').on('click', () => this.togglePanel(false));

        // 🏰 판타지 모드 토글
        $('#wt-fantasy-btn').on('click', () => this._toggleFantasyTheme());

        // 데이터 관리 메뉴
        $('#wt-data-btn').on('click', () => $('#wt-data-menu').toggle());
        $('#wt-data-export').on('click', () => this._exportChatData());
        $('#wt-data-import').on('click', () => $('#wt-data-file').click());
        $('#wt-data-file').on('change', (e) => this._importChatData(e));
        $('#wt-data-delete').on('click', () => this._deleteChatData());
        $('#wt-map-toggle').on('click', () => { $('#wt-map-section').slideToggle(200); const t=$('#wt-map-toggle').text(); $('#wt-map-toggle').text(t.includes('▾')?'🗺️ 지도 ▴':'🗺️ 지도 ▾'); });
        $('#wt-add-toggle').on('click', () => { $('#wt-add-form').slideToggle(200); const a=$('#wt-add-arrow'); a.text(a.text()==='▾'?'▴':'▾'); });
        $('#wt-btn-add').on('click', () => this._addLoc());
        $('#wt-input-name').on('keydown', e => { if(e.key==='Enter') this._addLoc(); });
        $('#wt-pop-close').on('click', () => this.hidePop());
        $('#wt-loc-toggle').on('click', () => { $('#wt-loc-wrap').slideToggle(200); const a=$('#wt-loc-arrow'); a.text(a.text()==='▾'?'▴':'▾'); });
        $('#wt-move-toggle').on('click', () => { $('#wt-move-wrap').slideToggle(200); const a=$('#wt-move-arrow'); a.text(a.text()==='▾'?'▴':'▾'); });
        $('#wt-pop-save').on('click', () => this._popSave());
        $('#wt-pop-del').on('click', () => this._popDel());
        // ★ 내부 장소 추가
        $('#wt-pop-sub-add').on('click', async () => {
            const locId = $('#wt-popover').attr('data-id');
            const name = $('#wt-pop-sub-input').val().trim();
            if (!name || !locId) return;
            await this.lm.findOrCreateSub(locId, name);
            $('#wt-pop-sub-input').val('');
            this._renderPopSubList(locId);
            toastSuccess(`🏠 "${name}" 추가!`);
        });
        $('#wt-pop-sub-input').on('keydown', (e) => { if (e.key === 'Enter') $('#wt-pop-sub-add').click(); });
        $('#wt-pop-move').on('click', () => this._popMove());
        $('#wt-pop-moveto').on('click', async () => {
            const locId = $('#wt-popover').attr('data-id');
            if (!locId) return;
            await this.lm.moveTo(locId);
            // 약도 재생성 (새 장소 중심)
            if (this.mapRenderer) {
                this.mapRenderer._layoutDirty = true;
                this.mapRenderer._layoutDone = false;
            }
            this.pi?.inject();
            this.refresh();
            this.hidePop();
            toastSuccess('🐾 이동 완료!');
        });
        $('#wt-pop-geo-btn').on('click', () => this._geoSearch());
        $('#wt-pop-geo-input').on('keydown', (e) => { if (e.key === 'Enter') this._geoSearch(); });
        $('#wt-pop-event-add').on('click', () => this._addEvent());
        $('#wt-pop-event-input').on('keydown', (e) => { if (e.key === 'Enter') this._addEvent(); });
        $('#wt-pop-review-gen').on('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const locId = $('#wt-popover').attr('data-id');
            if (locId) this._generateReviews(locId, 'popover');
        });
        $('#wt-pop-dist-add').on('click', () => this._addDist());
        $(document).on('input', '#wt-pop-dist-level', function() {
            const v = parseInt($(this).val());
            $('#wt-pop-dist-lvl-val').text(v);
            const hints = {1:'바로 옆',2:'매우 가까움',3:'가까움',4:'도보 5분',5:'도보권',6:'도보 15분+',7:'대중교통',8:'차량 필요',9:'먼 거리',10:'다른 지역'};
            $('#wt-pop-dist-hint').text(hints[v] || '');
        });
        // 맵 모드 토글
        $('#wt-mode-node').on('click', () => this._setMapMode('node'));
        $('#wt-mode-leaflet').on('click', () => this._setMapMode('leaflet'));
        $('#wt-mode-fantasy').on('click', () => this._setMapMode('fantasy'));
        // 검색 탭 전환 (Bug K: 장소/주소 분리)
        this._searchMode = 'loc';
        // 🔄 약도 재배치 (전체 핀 리셋 + 배경 캐시 무효화)
        $('#wt-btn-refresh').on('click', () => {
            if (this.mapRenderer) {
                // 모든 핀 위치 리셋 + localStorage 초기화
                for (const loc of this.lm.locations) {
                    loc._manualXY = false;
                    loc.x = 0; loc.y = 0;
                    this.lm.updateLocation(loc.id, { _manualXY: false, x: 0, y: 0 });
                    this.mapRenderer._clearPinPos(loc.id);
                }
                this.mapRenderer._layoutDirty = true;
                this.mapRenderer._layoutDone = false;
                this.mapRenderer._skipLayout = false;
                this.mapRenderer._vbManual = false;
                if (this.mapRenderer.invalidateCity) this.mapRenderer.invalidateCity();
                this.mapRenderer.render();
                toastSuccess('🗺️ 약도 재생성!');
            }
        }); // 기본: 장소 검색
        $('#wt-search-tab-loc').on('click', () => {
            this._searchMode = 'loc';
            $('#wt-search-tab-loc').addClass('wt-mode-active'); $('#wt-search-tab-addr').removeClass('wt-mode-active');
            $('#wt-search-input').attr('placeholder', '🔍 장소 검색...').val('');
            $('#wt-search-results').hide();
        });
        $('#wt-search-tab-addr').on('click', () => {
            this._searchMode = 'addr';
            $('#wt-search-tab-addr').addClass('wt-mode-active'); $('#wt-search-tab-loc').removeClass('wt-mode-active');
            $('#wt-search-input').attr('placeholder', '📍 실제 주소 검색 (Nominatim)...').val('');
            $('#wt-search-results').hide();
        });
        // 검색
        let _searchTimer = null;
        $('#wt-search-input').on('input', () => {
            clearTimeout(_searchTimer);
            _searchTimer = setTimeout(() => this._doSearch(), 500);
        });
        $('#wt-search-input').on('keydown', e => { if(e.key==='Enter') { clearTimeout(_searchTimer); this._doSearch(); } });
        // 모바일: 키보드 열릴 때 검색창 보이게
        $('#wt-search-input').on('focus', () => {
            setTimeout(() => { document.getElementById('wt-search-input')?.scrollIntoView({behavior:'smooth',block:'center'}); }, 300);
        });
        // ========== Feature 2: 문장 드래그 → 이벤트 저장 ==========
        this._setupTextSelection();
        // ========== 구글맵 바텀시트 바인딩 ==========
        this._bindBottomSheet();
    }

    // ========== 문장 드래그 → 이벤트 저장 ==========
    _setupTextSelection() {
        let _selBtn = null;
        const self = this;
        const removeBtn = () => { if (_selBtn) { _selBtn.remove(); _selBtn = null; } };

        $(document).on('mouseup touchend', '#chat .mes_text', function() {
            setTimeout(() => {
                const sel = window.getSelection();
                const text = sel?.toString()?.trim();
                removeBtn();
                if (!text || text.length < 5 || text.length > 300) return;
                if (!self.lm.currentLocationId && !self.lm.locations.length) return;
                const s = extension_settings[EXTENSION_NAME];
                if (!s?.enabled) return;

                const range = sel.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                const top = Math.max(10, rect.top - 40);
                const left = Math.min(window.innerWidth - 180, Math.max(10, rect.left));

                _selBtn = $(`<div id="wt-sel-event-btn" style="position:fixed;top:${top}px;left:${left}px;z-index:2147483646;display:flex;gap:4px;background:rgba(245,244,237,0.98);border:1.5px solid #5E84E2;border-radius:10px;padding:5px 10px;box-shadow:0 4px 16px rgba(0,0,0,0.15);backdrop-filter:blur(8px);font-family:-apple-system,'Noto Sans KR',sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent">
                    <span style="font-size:13px">📝</span>
                    <span style="font-size:12px;color:#775537;font-weight:600">이벤트 저장</span>
                </div>`);

                _selBtn.on('click', () => {
                    self._saveSelectionAsEvent(text);
                    removeBtn();
                    try { sel.removeAllRanges(); } catch(_){}
                });
                $('body').append(_selBtn);
                setTimeout(removeBtn, 5000);
            }, 80);
        });

        $(document).on('mousedown touchstart', (e) => {
            if (_selBtn && !$(e.target).closest('#wt-sel-event-btn').length) removeBtn();
        });
    }

    _saveSelectionAsEvent(text) {
        const curLoc = this.lm.locations.find(l => l.id === this.lm.currentLocationId);
        if (!curLoc && !this.lm.locations.length) { toastWarn('장소를 먼저 등록해주세요'); return; }

        if (this.lm.locations.length > 1) {
            this._showEventLocationPicker(text);
        } else {
            this._doSaveEvent(curLoc || this.lm.locations[0], text);
        }
    }

    _showEventLocationPicker(text) {
        $('#wt-evpick-overlay').remove();
        const locs = this.lm.locations;
        const curId = this.lm.currentLocationId;
        let items = locs.map(l => {
            const cur = l.id === curId;
            return `<button class="wt-evpick-btn" data-lid="${l.id}" style="padding:5px 10px;background:${cur?'#F7EC8D':'#fff'};border:1.5px solid ${cur?'#F6A93A':'#E8E4D8'};border-radius:6px;font-size:12px;color:#775537;cursor:pointer;font-family:inherit;font-weight:${cur?'700':'400'}">${l.name}${cur?' 🐾':''}</button>`;
        }).join('');

        const summary = text.length > 50 ? text.substring(0, 50) + '...' : text;
        const overlay = $(`<div id="wt-evpick-overlay" style="position:fixed;bottom:100px;left:50%;transform:translateX(-50%);width:300px;max-width:90vw;background:rgba(245,244,237,0.98);border:2px solid #5E84E2;border-radius:14px;padding:10px 14px;z-index:2147483646;box-shadow:0 6px 24px rgba(0,0,0,0.2);backdrop-filter:blur(8px);font-family:-apple-system,'Noto Sans KR',sans-serif">
            <div style="font-size:12px;font-weight:700;color:#775537;margin-bottom:4px">📝 이벤트 저장할 장소</div>
            <div style="font-size:11px;color:#9A8A7A;margin-bottom:6px;word-break:break-all">"${summary}"</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px">${items}</div>
            <button id="wt-evpick-cancel" style="width:100%;margin-top:6px;padding:5px;background:transparent;border:1px solid #E8E4D8;border-radius:6px;font-size:11px;color:#9A8A7A;cursor:pointer;font-family:inherit">취소</button>
        </div>`);
        $('body').append(overlay);
        const self = this;
        overlay.find('.wt-evpick-btn').on('click', function() {
            const loc = self.lm.locations.find(l => l.id === $(this).attr('data-lid'));
            if (loc) self._doSaveEvent(loc, text);
            overlay.remove();
        });
        overlay.find('#wt-evpick-cancel').on('click', () => overlay.remove());
        setTimeout(() => overlay.remove(), 10000);
    }

    _doSaveEvent(loc, text) {
        const events = loc.events || [];
        const date = new Date().toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
        let summary = text.trim();
        if (summary.length > 80) summary = summary.substring(0, 80) + '...';
        events.push({ text: summary, date, timestamp: Date.now(), source: 'selection' });
        this.lm.updateLocation(loc.id, { events });
        toastSuccess(`📝 "${loc.name}"에 이벤트 저장!`);
    }

    // ========== 패널 열기/닫기 ==========
    togglePanel(show) {
        this.panelVisible = show ?? !this.panelVisible;
        if (this.panelVisible) {
            $('#wt-panel').addClass('wt-panel-open').css('opacity',(extension_settings[EXTENSION_NAME]?.panelOpacity??100)/100);
            // 판타지 테마 상태 복원
            const s = extension_settings[EXTENSION_NAME];
            if (s?.fantasyTheme) {
                $('#wt-panel').addClass('wt-panel-fantasy');
                $('#wt-fantasy-btn').css({ background: '#DAA520', borderRadius: '6px' });
                $('.wt-panel-title span:first').text('🐺');
                $('.wt-scene-icon').text('🍖');
                // Task 3: 모드 바 복원
                $('#wt-mode-node, #wt-mode-leaflet').hide();
                $('#wt-mode-fantasy').show().text('🏰 지도').addClass('wt-mode-active');
            } else {
                $('.wt-panel-title span:first').text('🐶');
                $('.wt-scene-icon').text('🦴');
                $('#wt-mode-node, #wt-mode-leaflet').show();
                $('#wt-mode-fantasy').hide();
            }
            this.refresh();
            // ★ v0.6.0: 패널 열면 자동으로 Paw Maps 풀스크린
            $('#wt-map-section').show();
            setTimeout(() => {
                if (!this._isLeafletFull) this._setMapMode('leaflet');
            }, 400);
            setTimeout(() => {
                if (this.leafletRenderer?.map) this.leafletRenderer.invalidateSize();
            }, 600);
        }
        else { $('#wt-panel').removeClass('wt-panel-open'); this.hidePop(); }
    }

    // ========== 🏰 판타지 모드 토글 ==========
    _toggleFantasyTheme() {
        const s = extension_settings[EXTENSION_NAME];
        const isFantasy = s.fantasyTheme = !s.fantasyTheme;
        saveSettingsDebounced();

        // 마스코트 아이콘 전환
        const mascot = isFantasy ? '🐺' : '🐶';
        const treat = isFantasy ? '🍖' : '🦴';
        $('.wt-panel-title span:first').text(mascot);
        $('.wt-scene-icon').text(treat);

        // Task 3: 모드 바 동적 전환
        if (isFantasy) {
            $('#wt-mode-node, #wt-mode-leaflet').hide();
            $('#wt-mode-fantasy').show().text('🏰 지도');
        } else {
            $('#wt-mode-node, #wt-mode-leaflet').show();
            $('#wt-mode-fantasy').hide();
        }

        if (isFantasy) {
            $('#wt-panel').addClass('wt-panel-fantasy');
            $('#wt-fantasy-btn').css({ background: '#DAA520', borderRadius: '6px' });
            if (s.mapMode !== 'fantasy') s._prevMapMode = s.mapMode || 'leaflet';
            this._setMapMode('fantasy');
            wtNotify(`🐺 ${treat} 판타지 모드!`, 'move', 2000);
        } else {
            $('#wt-panel').removeClass('wt-panel-fantasy');
            $('#wt-fantasy-btn').css({ background: 'none', borderRadius: '' });
            this._setMapMode(s._prevMapMode || 'node');
            wtNotify(`🐶 ${treat} 일반 모드`, 'info', 1500);
        }

        // Bug J: 이미 열린 팝오버의 아이콘 선택 show/hide
        if (isFantasy) {
            $('#wt-pop-icon-type').closest('div').show();
        } else {
            $('#wt-pop-icon-type').closest('div').hide();
        }
    }

    // 채팅 전환 시 지도 완전 리셋
    resetMap() {
        const nodeContainer = document.querySelector('#wt-map-container');
        if (nodeContainer) nodeContainer.innerHTML = '';
        this.mapRenderer = null;
        if (this.leafletRenderer) { this.leafletRenderer.destroy(); this.leafletRenderer = null; }
        const leafletContainer = document.querySelector('#wt-leaflet-container');
        if (leafletContainer) leafletContainer.innerHTML = '';
        $('#wt-scan-overlay').remove();
        // ★ Paw Map 완전 정리
        this._hideBottomSheet();
        $('#wt-paw-mypage').remove();
        $('#wt-pawmap-tag').remove();
        this._isLeafletFull = false;
        this._isGeneratingReview = false;
        $('#wt-panel-body').removeClass('wt-leaflet-full');
        $('#wt-paw-nav').hide();
        // ★ 숨겨진 요소 전부 복원
        $('#wt-loc-toggle,#wt-move-toggle,#wt-add-toggle,.wt-scene-loc,#wt-map-toggle,#wt-btn-refresh').show();
        // leaflet wrap 스타일 복원
        const lWrap = document.querySelector('#wt-leaflet-wrap');
        if (lWrap) { lWrap.style.flex = ''; lWrap.style.display = 'none'; lWrap.style.flexDirection = ''; }
    }

    async refresh() {
        await this.lm.loadChat();
        const s = extension_settings[EXTENSION_NAME];
        const mode = s?.mapMode || 'leaflet';

        // 노드 그래프 (node + fantasy 공유)
        if (mode === 'node' || mode === 'fantasy') {
            const container = document.querySelector('#wt-map-container');
            if (this.mapRenderer && (!this.mapRenderer.svg || !this.mapRenderer.svg.parentNode)) {
                this.mapRenderer = null;
            }
            if (!this.mapRenderer && container) {
                this.mapRenderer = new MapRenderer(container, this.lm);
                this.mapRenderer.onLocationClick = id => this._yakdoRecenter(id);
                this.mapRenderer.onPopupCardClick = id => { this.showPop(id); };
                this.mapRenderer.onMoveRequest = (id, name) => {
                    wtNotify(`📍 "${name}" 이동 모드 — 맵을 터치하세요`, 'info', 3000);
                };
            }
            if (this.mapRenderer) {
                this.mapRenderer.fantasyMode = (mode === 'fantasy');
                this.mapRenderer.render();
            }
        }

        // Leaflet
        if (mode === 'leaflet' && this.leafletRenderer?.map) {
            this.leafletRenderer.render();
            this.leafletRenderer.invalidateSize();
        }

        const cur = this.lm.locations.find(l => l.id === this.lm.currentLocationId);
        const subLoc = this.lm.currentSubLocationId ? this.lm.locations.find(l => l.id === this.lm.currentSubLocationId) : null;
        $('#wt-scene-name').text(cur ? (cur.name + (subLoc ? ' > ' + subLoc.name : '')) : '—').css('color', cur?.color || '');
        // ★ Leaflet 풀스크린이면 장소목록/이동히스토리 숨김 유지
        if (this._isLeafletFull) {
            $('#wt-loc-toggle,#wt-loc-wrap,#wt-move-toggle,#wt-move-wrap,#wt-add-toggle,#wt-add-form,.wt-scene-loc,#wt-popover').hide();
            $('.wt-panel-header,.wt-map-mode-bar').hide(); // ★ refresh마다 강제 숨김
            $('#wt-paw-nav').show();
        } else {
            this._updLocList(); this._updMoveList();
            $('#wt-paw-nav').hide();
        }
    }

    // ========== 맵 모드 전환 ==========
    async _setMapMode(mode) {
        const s = extension_settings[EXTENSION_NAME];
        s.mapMode = mode; saveSettingsDebounced();

        // UI 버튼 활성화
        $('.wt-mode-btn').removeClass('wt-mode-active');
        $(`#wt-mode-${mode}`).addClass('wt-mode-active');

        // ★ Leaflet 풀스크린 해제 (다른 모드로 전환 시)
        if (mode !== 'leaflet') {
            this._isLeafletFull = false;
            $('#wt-panel-body').removeClass('wt-leaflet-full');
            $('#wt-loc-toggle,#wt-move-toggle,#wt-add-toggle,.wt-scene-loc').show();
            $('#wt-map-toggle').show();
            $('#wt-btn-refresh').show();
            $('.wt-panel-header').show(); // ★ 헤더 복원
            $('.wt-map-mode-bar').show(); // ★ 모드바 복원
            $('#wt-paw-nav').hide();
            // ★ 바텀시트 + 내페이지 완전 정리
            this._hideBottomSheet();
            $('#wt-paw-mypage').remove();
            // leaflet wrap 스타일 복원
            const lWrap = document.querySelector('#wt-leaflet-wrap');
            if (lWrap) { lWrap.style.flex = ''; lWrap.style.display = 'none'; lWrap.style.flexDirection = ''; }
            const lCont = document.querySelector('#wt-leaflet-container');
            if (lCont) { lCont.style.flex = ''; lCont.style.height = '320px'; lCont.style.minHeight = '320px'; }
        }

        if (mode === 'node') {
            $('#wt-leaflet-wrap').hide();
            $('#wt-map-wrap').show();
            // Bug B: 판타지 플래그 먼저 해제 (render 전에!)
            if (this.mapRenderer) this.mapRenderer.fantasyMode = false;
            if (!this.mapRenderer) {
                const container = document.querySelector('#wt-map-container');
                if (container) {
                    this.mapRenderer = new MapRenderer(container, this.lm);
                    this.mapRenderer.onLocationClick = id => this._yakdoRecenter(id);
                this.mapRenderer.onPopupCardClick = id => { this.showPop(id); };
                    this.mapRenderer.onMoveRequest = (id, name) => {
                        wtNotify(`📍 "${name}" 이동 모드 — 맵을 터치하세요`, 'info', 3000);
                    };
                }
            }
            this.mapRenderer.render();
        } else if (mode === 'leaflet') {
            $('#wt-map-wrap').hide();
            $('#wt-leaflet-wrap').show();
            // ★ 구글맵 스타일: 풀스크린
            this._isLeafletFull = true;
            $('#wt-panel-body').addClass('wt-leaflet-full');
            $('#wt-loc-toggle,#wt-loc-wrap,#wt-move-toggle,#wt-move-wrap,#wt-add-toggle,#wt-add-form,.wt-scene-loc,#wt-popover').hide();
            $('.wt-map-mode-bar').hide(); // ★ 약도/Paw Map 탭 숨김
            $('.wt-panel-header').hide(); // ★ 헤더 숨김
            $('#wt-map-section').show();
            $('#wt-map-toggle').hide(); // 접기 버튼 숨김
            $('#wt-btn-refresh').hide(); // 약도 재생성 숨김
            $('#wt-paw-nav').show(); // 하단 탭 표시
            // 지도 컨테이너 풀사이즈
            const lWrap = document.querySelector('#wt-leaflet-wrap');
            const lContainer = document.querySelector('#wt-leaflet-container');
            if (lWrap) { lWrap.style.flex = '1'; lWrap.style.display = 'flex'; lWrap.style.flexDirection = 'column'; }
            if (lContainer) { lContainer.style.flex = '1'; lContainer.style.height = 'auto'; lContainer.style.minHeight = '0'; }
            // 3. Paw Map 태그 (좌하단)
            if (!$('#wt-pawmap-tag').length) {
                $('#wt-leaflet-wrap').append('<div id="wt-pawmap-tag" style="position:absolute;bottom:8px;left:8px;z-index:20;font-size:11px;font-weight:600;color:rgba(0,0,0,.35);font-family:Outfit,sans-serif;pointer-events:none">🐾 Paw Maps</div>');
            }
            if (!this.leafletRenderer) {
                const ok = await loadLeaflet();
                if (!ok) { toastWarn('Leaflet CDN 로드 실패!'); this._setMapMode('node'); return; }
                // #46: 컨테이너가 레이아웃 완료될 때까지 대기
                const container = document.querySelector('#wt-leaflet-container');
                if (container) {
                    container.style.width = '100%';
                    container.style.height = '100%';
                    container.style.minHeight = '320px';
                }
                // rAF 2번 → 브라우저 레이아웃 확정 후 init
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                this.leafletRenderer = new LeafletRenderer(document.querySelector('#wt-leaflet-container'), this.lm);
                await this.leafletRenderer.init();
                // ★ 핀 클릭 → 바텀시트 (구글맵 스타일)
                this.leafletRenderer.onLocationClick = id => this._showBottomSheet(id);
                // #1: 마커 롱프레스 → 이동 모드 → 빈 곳 터치 → 이동
                this.leafletRenderer.onMoveStart = (locId, name) => {
                    wtNotify(`📍 "${name}" 이동 모드 — 원하는 곳을 터치하세요`, 'info', 3000);
                };
                this.leafletRenderer.onMoveComplete = async (latlng, locId) => {
                    const loc = this.lm.locations.find(l => l.id === locId);
                    if (!loc) return;

                    await this.lm.updateLocation(locId, { lat: latlng.lat, lng: latlng.lng });
                    const marker = this.leafletRenderer.markers[locId];
                    if (marker) marker.setLatLng(latlng);

                    // 역지오코딩
                    try {
                        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}&accept-language=ko`, { headers: { 'User-Agent': 'RP-World-Tracker/0.2' } });
                        if (res.ok) {
                            const d = await res.json();
                            const addr = d.display_name?.split(',').slice(0, 3).join(', ') || '';
                            if (addr) await this.lm.updateLocation(locId, { address: addr, _tempAddress: false });
                            toastSuccess(`📍 "${loc.name}" → ${addr}`);
                        } else { toastSuccess(`📍 "${loc.name}" 이동!`); }
                    } catch(_) { toastSuccess(`📍 "${loc.name}" 이동!`); }
                };
                // ★ 빈 곳 롱프레스 → 새 장소 등록
                this.leafletRenderer.onLongPress = async (lat, lng) => {
                    const name = prompt('📍 새 장소 이름:');
                    if (!name?.trim()) return;
                    const loc = await this.lm.addLocation(name.trim());
                    if (loc) {
                        await this.lm.updateLocation(loc.id, { lat, lng });
                        // 역지오코딩
                        try {
                            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ko`, { headers: { 'User-Agent': 'RP-World-Tracker/0.3' } });
                            if (res.ok) {
                                const d = await res.json();
                                const addr = d.display_name?.split(',').slice(0, 3).join(', ') || '';
                                if (addr) await this.lm.updateLocation(loc.id, { address: addr });
                            }
                        } catch(_) {}
                        this.leafletRenderer.render();
                        try { await this.lm.autoCalcDistances(); } catch(_){}
                        toastSuccess(`📍 "${name.trim()}" 등록!`);
                        console.log(`[${EXTENSION_NAME}] 🔧 longPress addLoc: "${name.trim()}" (${lat.toFixed(4)},${lng.toFixed(4)})`);
                    }
                };
            }
            this.leafletRenderer.render();
            // #46: 모바일 invalidateSize — 여러 타이밍에 반복
            [100, 300, 600, 1000].forEach(ms => {
                setTimeout(() => this.leafletRenderer?.invalidateSize(), ms);
            });
        } else if (mode === 'fantasy') {
            // 🏰 판타지 모드: 노드 맵 + 판타지 테마
            $('#wt-leaflet-wrap').hide();
            $('#wt-map-wrap').show();
            const container = document.querySelector('#wt-map-container');
            if (container) {
                container.classList.add('wt-fantasy-theme');
                // 배경은 CSS .wt-fantasy-theme에서 처리 (베이지+그레인)
            }
            if (!this.mapRenderer) {
                if (container) {
                    this.mapRenderer = new MapRenderer(container, this.lm);
                    this.mapRenderer.onLocationClick = id => this._yakdoRecenter(id);
                this.mapRenderer.onPopupCardClick = id => { this.showPop(id); };
                    this.mapRenderer.onMoveRequest = (id, name) => {
                        wtNotify(`📍 "${name}" 이동 모드 — 맵을 터치하세요`, 'info', 3000);
                    };
                }
            }
            if (this.mapRenderer) {
                this.mapRenderer.fantasyMode = true;
                this.mapRenderer._layoutDirty = true;
                this.mapRenderer.render();
            }
        }

        // 판타지 테마 토글: node 또는 leaflet 모드면 제거
        if (mode !== 'fantasy') {
            document.querySelector('#wt-map-container')?.classList.remove('wt-fantasy-theme');
            if (this.mapRenderer) this.mapRenderer.fantasyMode = false;
        }

        // Fix 4: 검색 탭 바 → 실제지도에서만 표시 (노드/판타지: 숨김)
        if (mode === 'leaflet') {
            $('#wt-search-tabs').css('display', 'flex');
        } else {
            $('#wt-search-tabs').hide();
            // 주소 모드였다면 장소 모드로 전환
            if (this._searchMode === 'addr') {
                this._searchMode = 'loc';
                $('#wt-search-tab-loc').addClass('wt-mode-active');
                $('#wt-search-tab-addr').removeClass('wt-mode-active');
                $('#wt-search-input').attr('placeholder', '🔍 등록된 장소 검색...').val('');
                $('#wt-search-results').hide();
            }
        }
    }

    // ========== 약도: 장소 클릭 → 해당 핀 중심으로 배경 재생성 ==========
    async _yakdoRecenter(locId) {
        const loc = this.lm.locations.find(l => l.id === locId);
        if (!loc) return;
        if (this._reviewPending.has(locId)) return;
        if (this.mapRenderer?.recenterOn) {
            this.mapRenderer.recenterOn(locId);
        }
    }

    // ========== 장소 목록 / 이동 히스토리 ==========
    _updLocList() {
        const topLocs = this.lm.locations.filter(l => !l.parentId); // ★ 서브 장소 제외
        const list=$('#wt-loc-list').empty(); $('#wt-loc-count').text(topLocs.length);
        if (!topLocs.length) { list.html('<div class="wt-empty">RP를 시작하면 장소가 자동 추가돼요!</div>'); return; }
        for (const loc of [...topLocs].sort((a,b)=>(b.visitCount||0)-(a.visitCount||0))) {
            const cur = loc.id === this.lm.currentLocationId;
            const subCount = this.lm.getSubLocations(loc.id).length;
            const item = $(`<div class="wt-loc-item ${cur?'wt-loc-active':''}" data-id="${loc.id}">
                <div class="wt-loc-dot" style="background:${loc.color}"></div>
                <div class="wt-loc-info"><div class="wt-loc-name">${loc.name}${cur?' 🐾':''}${subCount?` <span style="font-size:9px;color:#9AA0A6">(+${subCount})</span>`:''}</div></div>
                <div class="wt-loc-visits">${loc.visitCount||0}회</div></div>`);
            item.on('click', () => this.showPop(loc.id));
            list.append(item);
        }
    }

    _updMoveList() {
        const list=$('#wt-move-list').empty();
        if (!this.lm.movements.length) { list.html('<div class="wt-empty">아직 이동 기록이 없어요</div>'); return; }
        const self = this;
        for (const m of [...this.lm.movements].sort((a,b)=>a.timestamp-b.timestamp).slice(-20)) {
            const f=this.lm.locations.find(l=>l.id===m.fromId), t=this.lm.locations.find(l=>l.id===m.toId);
            if (!f||!t) continue;
            const time=new Date(m.timestamp).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
            const item = $(`<div class="wt-mv-item" style="position:relative">
                <span class="wt-mv-time">${time}</span>
                <span class="wt-mv-from">${f.name}</span>
                <span class="wt-mv-arrow">→</span>
                <span class="wt-mv-to">${t.name}</span>
                ${m.id ? `<button class="wt-btn-icon" style="font-size:10px;padding:2px 4px;color:var(--wt-pink);opacity:0.5" data-mid="${m.id}">✕</button>` : ''}
            </div>`);
            if (m.id) {
                item.find('button').on('click', async function(e) {
                    e.stopPropagation();
                    const mid = parseInt($(this).attr('data-mid'));
                    await self.lm.removeMovement(mid);
                    self._updMoveList();
                    self.pi?.inject();
                    toastSuccess('🗑️ 이동 기록 삭제!');
                });
            }
            list.append(item);
        }
    }

    async _addLoc() {
        const name=$('#wt-input-name').val().trim(); if(!name) return;
        if (!this.lm.currentChatId) await this.lm.loadChat();
        if (!this.lm.currentChatId) { toastWarn('채팅방 선택'); return; }
        if (this.lm.findByName(name)) { toastWarn(`"${name}" 존재`); return; }
        const aliases=$('#wt-input-aliases').val().split(',').map(a=>a.trim()).filter(Boolean);
        const loc = await this.lm.addLocation(name, '', aliases);
        if (loc) { toastSuccess(`"${name}" 추가!`); $('#wt-input-name,#wt-input-aliases').val(''); $('#wt-add-form').slideUp(200); $('#wt-add-arrow').text('▾'); this.refresh(); }
    }

    // ---- Popover (인라인) ----
    // ========== 팝오버 (장소 상세) ==========
    showPop(id) {
        const l = this.lm.locations.find(x=>x.id===id); if(!l) return;
        // ★ 서브 장소면 부모 팝오버 열고 서브 수정창 오버레이
        if (l.parentId) {
            const parentExists = this.lm.locations.find(x => x.id === l.parentId);
            if (parentExists) {
                this.showPop(l.parentId); // 부모 먼저 열기
                setTimeout(() => this._showSubPop(l.parentId, id), 50);
                return;
            }
        }
        // ★ 이전 서브 오버레이 정리 + 원래 body 표시
        $('#wt-popover .wt-subpop-overlay').remove();
        $('#wt-popover .wt-pop-body').show();
        
        $('#wt-popover').attr('data-id', id);
        $('#wt-pop-title').val(l.name); $('#wt-pop-visits').text(l.visitCount||0);
        $('#wt-pop-first').text(l.rpFirstVisited || (l.firstVisited?this._fmt(l.firstVisited):'—'));
        $('#wt-pop-last').text(l.rpLastVisited || (l.lastVisited?this._fmt(l.lastVisited):'—'));
        $('#wt-pop-memo').val(l.memo||'');
        $('#wt-pop-ainotes').val(l.aiNotes||'');
        // ★ 터줏대감 목록 렌더
        const npcList = $('#wt-pop-npcs-list');
        npcList.empty();
        if (l.npcs?.length) {
            l.npcs.forEach(n => {
                const icon = n.type === 'animal' ? '🐾' : '🧑';
                npcList.append(`<div style="display:flex;align-items:center;gap:4px;padding:3px 6px;background:#FAFAF5;border-radius:6px;font-size:11px;color:#3C4043">
                    <span>${icon}</span><span style="font-weight:500">${n.name}</span>${n.role ? `<span style="font-size:9px;color:#9AA0A6">(${n.role})</span>` : ''}
                    <span style="font-size:9px;color:#B0A898;margin-left:auto">×${n.count||1}</span>
                    <span class="wt-npc-del" data-name="${n.name}" style="color:#F5A8A8;cursor:pointer;font-size:9px;margin-left:4px">✕</span>
                </div>`);
            });
            npcList.find('.wt-npc-del').on('click', async function(e) {
                e.stopPropagation();
                const name = $(this).data('name');
                const locId = $('#wt-popover').attr('data-id');
                await self.lm.removeNpcFromLocation(locId, name);
                $(this).closest('div').fadeOut(200, function() { $(this).remove(); });
            });
        } else {
            npcList.html('<div style="font-size:10px;color:#B0A898;padding:4px">아직 감지된 인물이 없어요</div>');
        }
        $('#wt-pop-aliases').val((l.aliases||[]).join(', '));
        // Task 5: 아이콘 타입 선택 복원
        $('#wt-pop-icon-type').val(l.locationType || '');
        // Bug D: 아이콘 선택은 판타지 모드에서만 표시
        const s2 = extension_settings[EXTENSION_NAME];
        if (s2?.fantasyTheme) { $('#wt-pop-icon-type').closest('div').show(); } else { $('#wt-pop-icon-type').closest('div').hide(); }
        // Task 6: 좌표 없으면 안내 표시
        if (!l.lat && !l.lng) { $('#wt-pop-geo-notice').show(); } else { $('#wt-pop-geo-notice').hide(); }
        // 현재 주소 표시
        if (l.address) { $('#wt-pop-cur-addr').show(); $('#wt-pop-addr-text').text(l.address); } else { $('#wt-pop-cur-addr').hide(); }
        // ★ 내부 장소 섹션 (서브가 아닌 상위 장소만)
        console.log(`[${EXTENSION_NAME}] 🔧 showPop sub-section: parentId=${l.parentId}, el=${$('#wt-pop-sub-section').length}`);
        if (!l.parentId) {
            $('#wt-pop-sub-section').css('display', 'block'); // .show() 대신 강제
            this._renderPopSubList(id);
            console.log(`[${EXTENSION_NAME}] 🔧 sub-section SHOWN for "${l.name}"`);
        } else {
            $('#wt-pop-sub-section').hide();
        }
        this._updDistSection(id);
        this._updEventsList(id);
        this._renderCachedReviews(id, '#wt-pop-review-list');
        // 지도 섹션 상태 저장 후 숨김
        this._mapWasVisible = $('#wt-map-section').is(':visible');
        if (this._mapWasVisible) {
            $('#wt-map-section').hide();
            $('#wt-map-toggle').text('🗺️ 지도 ▾');
        }
        $('#wt-popover').show();
        const pop = document.getElementById('wt-popover');
        const body = document.getElementById('wt-panel-body');
        if (pop && body) body.scrollTop = pop.offsetTop - 5;
    }
    hidePop() {
        $('#wt-popover').hide();
        // 약도가 열려있었으면 복원
        if (this._mapWasVisible) {
            $('#wt-map-section').show();
            $('#wt-map-toggle').text('🗺️ 지도 ▴');
            // 렌더링 갱신 (패널 크기 변경 후)
            setTimeout(() => {
                if (this.mapRenderer) this.mapRenderer.render();
                if (this.leafletRenderer?.map) this.leafletRenderer.invalidateSize();
            }, 100);
        }
    }

    // ★ 팝오버 내부 장소 리스트 렌더
    _renderPopSubList(parentId) {
        const subs = this.lm.getSubLocations(parentId);
        const list = $('#wt-pop-sub-list');
        if (!subs.length) {
            list.html('<div style="font-size:11px;color:#9AA0A6;padding:4px 0">RP 중 자동 등록되거나 위에서 추가하세요</div>');
            return;
        }
        const subEmojis = { '거실':'🛋', '부엌':'🍳', '주방':'🍳', '방':'🛏', '침실':'🛏', '화장실':'🚿', '욕실':'🚿', '서재':'📚', '마당':'🌳', 'kitchen':'🍳', 'bedroom':'🛏', 'bathroom':'🚿', 'living room':'🛋', 'room':'🛏' };
        const html = subs.map(s => {
            const emoji = subEmojis[s.name.toLowerCase()] || '🚪';
            const evCount = (s.events || []).length;
            const isCur = s.id === this.lm.currentSubLocationId;
            return `<div class="wt-pop-sub-item" data-subid="${s.id}" style="display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:6px;margin-bottom:2px;background:${isCur ? '#F0FFF4' : '#FAFAF5'};font-size:11px;cursor:pointer;-webkit-tap-highlight-color:transparent">
                <span>${emoji}</span>
                <span style="flex:1;font-weight:${isCur ? '700' : '400'};color:#3C3028">${s.name}${isCur ? ' 🐾' : ''}</span>
                <span style="color:#9AA0A6;font-size:10px">${s.visitCount || 0}회${evCount ? ' · ' + evCount + '건' : ''}</span>
                <span style="color:#9AA0A6;font-size:11px">></span>
            </div>`;
        }).join('');
        list.html(html);
        const self = this;
        // 서브 장소 클릭 → 서브 수정창
        list.find('.wt-pop-sub-item').on('click', function() {
            const subId = $(this).attr('data-subid');
            console.log(`[${EXTENSION_NAME}] 🔧 sub-item clicked: ${subId}`);
            self._showSubPop(parentId, subId);
        });
        console.log(`[${EXTENSION_NAME}] 🔧 renderPopSubList: ${subs.length} items, handlers bound`);
    }

    // ★ 서브 장소 수정창 (팝오버 위에 오버레이)
    _showSubPop(parentId, subId) {
        const parent = this.lm.locations.find(l => l.id === parentId);
        const sub = this.lm.locations.find(l => l.id === subId);
        if (!parent || !sub) return;

        const subEmojis = { '거실':'🛋', '부엌':'🍳', '주방':'🍳', '방':'🛏', '침실':'🛏', '화장실':'🚿', '욕실':'🚿', '서재':'📚', '마당':'🌳', 'kitchen':'🍳', 'bedroom':'🛏', 'bathroom':'🚿', 'living room':'🛋', 'room':'🛏' };
        const emoji = subEmojis[sub.name.toLowerCase()] || '🚪';
        const isCur = sub.id === this.lm.currentSubLocationId;
        const events = sub.events || [];

        const eventsHtml = events.length ? events.map((ev, i) => {
            const date = ev.isPlan ? (ev.planDate ? `📌 ${ev.planDate}` : '📌 예정') : (ev.timestamp ? this._fmt(ev.timestamp) : '—');
            const title = ev.title || ev.text?.substring(0, 20) + '...' || '—';
            const fullText = ev.text || '';
            const hasDetail = fullText.length > 0 && fullText !== title;
            return `<div class="wt-subpop-ev-card" style="padding:6px 8px;border-bottom:1px solid #F1F3F4">
                <div style="display:flex;align-items:center;gap:5px">
                    <span style="font-size:12px">${ev.mood || '📝'}</span>
                    <span style="flex:1;font-weight:600;font-size:11px;color:#5A4030">${title}</span>
                </div>
                <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
                    <span style="font-size:10px;color:#9AA0A6">${date}</span>
                    <span class="wt-subpop-ev-del" data-idx="${i}" style="cursor:pointer;color:#F5A8A8;font-size:11px;margin-left:auto">✕</span>
                    ${hasDetail ? '<span class="wt-subpop-ev-toggle" style="cursor:pointer;font-size:10px;color:#B0A898">▼</span>' : ''}
                </div>
                ${hasDetail ? `<div class="wt-subpop-ev-detail" style="display:none;margin-top:4px;padding:6px 8px;background:#FAFAF5;border-radius:6px;font-size:11px;color:#5A4030;line-height:1.6">${fullText}</div>` : ''}
            </div>`;
        }).join('') : '<div style="padding:10px;text-align:center;color:#9AA0A6;font-size:11px">아직 이벤트가 없어요</div>';

        // ★ 기존 팝오버 숨기고 오버레이 추가 (DOM 교체 안 함!)
        const pop = $('#wt-popover');
        pop.find('.wt-pop-body').hide();
        pop.find('.wt-subpop-overlay').remove();

        const overlay = $(`<div class="wt-subpop-overlay" style="padding:10px 14px;display:flex;flex-direction:column;gap:8px;max-height:70vh;overflow-y:auto">
            <div style="display:flex;align-items:center;gap:8px">
                <span id="wt-subpop-back" style="font-size:16px;color:#9A8A7A;cursor:pointer">←</span>
                <span style="font-size:11px;color:#9AA0A6">${parent.name}</span>
                <span id="wt-subpop-close" style="margin-left:auto;font-size:14px;color:#9A8A7A;cursor:pointer">✕</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:22px">${emoji}</span>
                <div style="flex:1">
                    <input type="text" id="wt-subpop-name" class="wt-input" value="${sub.name}" style="font-size:15px;font-weight:800;color:#3C3028;border:1.5px solid transparent;padding:2px 6px;border-radius:6px;background:transparent;width:100%;box-sizing:border-box" onfocus="this.style.borderColor='#8B6BB4';this.style.background='#FAFAF5'" onblur="this.style.borderColor='transparent';this.style.background='transparent'"/>
                    <div style="font-size:11px;color:#70757A">방문 ${sub.visitCount || 0}회${isCur ? ' · 현재 🐾' : ''}</div>
                </div>
            </div>
            <div style="font-size:12px;color:#9A8A7A">🏷️ 별칭 (쉼표 구분)</div>
            <input type="text" id="wt-subpop-aliases" class="wt-input" placeholder="예: 리빙룸, Living Room" style="font-size:12px" value="${(sub.aliases||[]).join(', ')}"/>
            <div style="font-size:12px;color:#9A8A7A">💭 메모</div>
            <textarea id="wt-subpop-memo" class="wt-input" placeholder="예: 소파가 편해서 맨날 잠" style="height:45px;resize:none;font-size:12px">${sub.memo || ''}</textarea>
            <div style="font-size:12px;color:#9A8A7A">🤖 특이사항 (AI에게만 전달)</div>
            <textarea id="wt-subpop-ainotes" class="wt-input" placeholder="예: 큰 TV가 있음, 창문이 남향" style="height:35px;resize:none;font-size:12px">${sub.aiNotes || ''}</textarea>
            <div style="font-size:12px;color:#9A8A7A">📝 이벤트 기록</div>
            <div id="wt-subpop-events" style="border:1px solid #E8E4D8;border-radius:8px;overflow-y:auto;max-height:200px;-webkit-overflow-scrolling:touch;background:#fff">${eventsHtml}</div>
            <div style="display:flex;gap:4px">
                <input type="text" id="wt-subpop-ev-input" class="wt-input" placeholder="이벤트 추가..." style="flex:1;font-size:11px;padding:5px 8px"/>
                <button id="wt-subpop-ev-add" class="wt-btn-accent wt-btn-s">+</button>
            </div>
            <div style="display:flex;gap:6px;margin-top:4px">
                <button id="wt-subpop-save" class="wt-btn-primary" style="flex:1">💾 저장</button>
                <button id="wt-subpop-del" class="wt-btn-danger" style="width:40px">🗑️</button>
            </div>
        </div>`);

        pop.append(overlay);
        const self = this;

        // ← 뒤로가기 (오버레이 제거 + 원래 팝오버 표시)
        overlay.find('#wt-subpop-back').on('click', () => {
            overlay.remove();
            pop.find('.wt-pop-body').show();
            // 내부 장소 리스트 리렌더 (삭제/추가 반영)
            self._renderPopSubList(parentId);
        });
        overlay.find('#wt-subpop-close').on('click', () => { overlay.remove(); self.hidePop(); });
        // 💾 저장
        overlay.find('#wt-subpop-save').on('click', async () => {
            const newName = overlay.find('#wt-subpop-name').val().trim();
            const aliases = overlay.find('#wt-subpop-aliases').val().split(',').map(a=>a.trim()).filter(Boolean);
            const updates = {
                memo: overlay.find('#wt-subpop-memo').val().trim(),
                aiNotes: overlay.find('#wt-subpop-ainotes').val().trim(),
                aliases,
            };
            if (newName && newName !== sub.name) updates.name = newName;
            await self.lm.updateLocation(subId, updates);
            toastSuccess('💾 저장!');
            self.pi?.inject();
        });
        // 🗑 삭제
        overlay.find('#wt-subpop-del').on('click', async () => {
            if (!confirm(`"${sub.name}" 삭제?`)) return;
            await self.lm.deleteLocation(subId);
            if (self.lm.currentSubLocationId === subId) self.lm.currentSubLocationId = null;
            overlay.remove();
            pop.find('.wt-pop-body').show();
            self._renderPopSubList(parentId);
            toastSuccess('🗑️ 삭제됨');
        });
        // + 이벤트 추가
        overlay.find('#wt-subpop-ev-add').on('click', () => {
            const text = overlay.find('#wt-subpop-ev-input').val().trim();
            if (!text) return;
            if (!sub.events) sub.events = [];
            sub.events.push({ text, title: text.substring(0, 20), mood: '📝', timestamp: Date.now(), source: 'manual' });
            self.lm.updateLocation(subId, { events: sub.events });
            toastSuccess('📝 이벤트 추가!');
            // 리렌더
            overlay.remove();
            pop.find('.wt-pop-body').hide();
            self._showSubPop(parentId, subId);
        });
        overlay.find('#wt-subpop-ev-input').on('keydown', (e) => { if (e.key === 'Enter') overlay.find('#wt-subpop-ev-add').click(); });
        // ✕ 이벤트 삭제
        overlay.find('.wt-subpop-ev-del').on('click', function(e) {
            e.stopPropagation();
            const idx = parseInt($(this).attr('data-idx'));
            if (!confirm('이벤트 삭제?')) return;
            sub.events.splice(idx, 1);
            self.lm.updateLocation(subId, { events: sub.events });
            overlay.remove();
            pop.find('.wt-pop-body').hide();
            self._showSubPop(parentId, subId);
            toastSuccess('🗑️ 삭제!');
        });
        // ▼ 이벤트 아코디언 토글
        overlay.find('.wt-subpop-ev-card').on('click', function(e) {
            if ($(e.target).closest('.wt-subpop-ev-del').length) return;
            const det = $(this).find('.wt-subpop-ev-detail');
            const arrow = $(this).find('.wt-subpop-ev-toggle');
            if (det.length) {
                det.slideToggle(200);
                arrow.text(det.is(':visible') ? '▲' : '▼');
            }
        });
        console.log(`[${EXTENSION_NAME}] 🔧 showSubPop: "${parent.name} > ${sub.name}"`);
    }

    // ========== 분위기 카드 (이모지 기반 자동 생성) ==========
    _moodCardPool = {
        mart: { main: '🏪', pool: ['🛒','🍜','🍺','🍪','🍫','🧃','💰','🥤','🍱','🧻','🐱','🐾'], colors: ['#E8F5E9','#FFF8E1'] },
        cafe: { main: '☕', pool: ['🐱','🧁','🍰','🫧','✨','🍪','🎵','📖','🪴','💕','🌆'], colors: ['#FCE4EC','#FFF3E0'] },
        home: { main: '🏠', pool: ['🐶','🛋️','📺','🍿','😴','💤','🧸','🕯️','🌙','💕'], colors: ['#E8EAF6','#E3F2FD'] },
        school: { main: '🎓', pool: ['📚','✏️','🎒','📝','🔬','💻','⏰','🏫','📐','🎯'], colors: ['#F3E5F5','#E8EAF6'] },
        park: { main: '🌳', pool: ['🐕','🦆','🌸','🍃','☀️','🧺','🎈','🦋','⛲','🌻'], colors: ['#E8F5E9','#F1F8E9'] },
        gym: { main: '💪', pool: ['🏋️','🥊','💦','🎯','🔥','🥤','🧊','⚡','🏃','🎽'], colors: ['#E3F2FD','#E1F5FE'] },
        bar: { main: '🍺', pool: ['🥃','🍷','🎵','🎤','🌙','🥜','🍻','💫','🎶','🎲'], colors: ['#FFF3E0','#FBE9E7'] },
        restaurant: { main: '🍽️', pool: ['🥘','🍕','🍝','🥗','🍖','🧑‍🍳','🥂','🌶️','🫕','🍜'], colors: ['#FFF8E1','#FBE9E7'] },
        hospital: { main: '🏥', pool: ['💊','🩺','🩹','💉','🌡️','❤️‍🩹','🚑','🧴','🩻','🫀'], colors: ['#E8F5E9','#E1F5FE'] },
        library: { main: '📚', pool: ['📖','🔍','📝','🤓','☕','🪴','💡','🔖','📑','🧐'], colors: ['#EDE7F6','#E8EAF6'] },
        station: { main: '🚉', pool: ['🚃','🎫','⏰','👥','📱','🧳','🚶','🗺️','☕','🎧'], colors: ['#ECEFF1','#E3F2FD'] },
        alley: { main: '🌧️', pool: ['🏚️','🔦','🐈‍⬛','📱','👀','💨','🌫️','🚶','🔒','⚡'], colors: ['#78909C','#546E7A'] },
        default: { main: '📍', pool: ['🗺️','👣','🐾','✨','🌟','📌','🎯','🏷️','🔖','💫'], colors: ['#F5F5F5','#EEEEEE'] },
    };

    _getMoodCard(loc) {
        const name = (loc.name || '').toLowerCase();
        const memo = (loc.memo || '').toLowerCase();
        const events = loc.events || [];
        const style = this.leafletRenderer?._locStyle?.(loc.name) || { emoji: '📍' };

        // 장소 타입 매칭
        let type = 'default';
        if (/마트|mart|편의|convenience|가게|shop|store|grocery|supermarket/i.test(name)) type = 'mart';
        else if (/카페|cafe|coffee|커피/i.test(name)) type = 'cafe';
        else if (/집|home|house|숙소|기숙/i.test(name)) type = 'home';
        else if (/학교|school|학원/i.test(name)) type = 'school';
        else if (/공원|park|정원|garden/i.test(name)) type = 'park';
        else if (/체육|gym|운동|fitness/i.test(name)) type = 'gym';
        else if (/술집|bar|pub|tavern|주점/i.test(name)) type = 'bar';
        else if (/식당|restaurant|음식|레스토랑/i.test(name)) type = 'restaurant';
        else if (/병원|hospital|의원/i.test(name)) type = 'hospital';
        else if (/도서|library|서점/i.test(name)) type = 'library';
        else if (/역|station|지하철/i.test(name)) type = 'station';
        else if (/골목|alley|뒷길/i.test(name)) type = 'alley';

        const pool = this._moodCardPool[type] || this._moodCardPool.default;
        const mainEmoji = style.emoji !== '📍' ? style.emoji : pool.main;

        // 시드 기반 랜덤 (장소별 고정)
        const seed = (loc.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
        const rng = (i) => ((seed * 9301 + 49297 + i * 31) % 233280) / 233280;

        // 이모지 셔플 후 3~5개 선택
        const shuffled = [...pool.pool].sort((a, b) => rng(a.codePointAt(0)) - rng(b.codePointAt(0)));
        const subs = shuffled.slice(0, 4);

        // 이벤트 무드에서 추가 이모지
        const lastEvent = events[events.length - 1];
        let eventEmoji = null;
        if (lastEvent?.mood === '💕') eventEmoji = '💕';
        else if (lastEvent?.mood === '⚡') eventEmoji = '⚡';
        else if (lastEvent?.mood === '📅') eventEmoji = '📅';

        // 시간대
        const hour = new Date().getHours();
        let timeLabel, timeIcon;
        if (hour >= 5 && hour < 12) { timeLabel = '아침'; timeIcon = '☀️'; }
        else if (hour >= 12 && hour < 17) { timeLabel = '오후'; timeIcon = '🌤️'; }
        else if (hour >= 17 && hour < 20) { timeLabel = '저녁'; timeIcon = '🌆'; }
        else { timeLabel = '밤'; timeIcon = '🌙'; }

        // 밤 장소는 어두운 배경
        const isDark = hour >= 20 || hour < 5 || type === 'alley';
        const colors = isDark
            ? ['#1a1a2e', '#16213e', '#0f3460']
            : pool.colors;
        const tagBg = isDark ? 'rgba(255,255,255,.15)' : 'rgba(255,255,255,.85)';
        const tagColor = isDark ? '#e0e0e0' : '#5D4037';

        return { mainEmoji, subs, eventEmoji, colors, isDark, timeLabel, timeIcon, tagBg, tagColor, small1: subs[0], small1deco: subs[1], small2: subs[2] || eventEmoji || '✨', small2deco: subs[3] || '🐾' };
    }

    // ========== 분위기 카드 이모지 시스템 ==========
    _getMoodCard(loc) {
        const name = (loc.name || '').toLowerCase();
        const memo = (loc.memo || '').toLowerCase();
        const events = loc.events || [];
        const lastEvent = events[events.length - 1];
        const hour = new Date().getHours();

        // 시간대 + 날씨
        let timeLabel, colors;
        if (hour >= 5 && hour < 12) { timeLabel = '아침 · 맑음'; colors = ['#E3F2FD','#E1F5FE','#B3E5FC']; }
        else if (hour >= 12 && hour < 17) { timeLabel = '오후 · 맑음'; colors = ['#E8F5E9','#FFF8E1','#FFECB3']; }
        else if (hour >= 17 && hour < 20) { timeLabel = '저녁 · 노을'; colors = ['#FCE4EC','#FFF3E0','#FFE0B2']; }
        else { timeLabel = '밤 · 맑음'; colors = ['#1a1a2e','#16213e','#0f3460']; }
        const isDark = hour >= 20 || hour < 5;
        const tagStyle = isDark ? 'background:rgba(255,255,255,.15);color:#e0e0e0' : 'background:rgba(255,255,255,.85);color:#5D4037';

        // 장소 타입별 이모지 풀
        const pools = {
            mart: { main: '🏪', subs: ['🛒','🍜','🍺','💰','🧃','🍫','🧻'], s1: ['🍪','🍫','🥤'], s2: ['🐱','🐾','🧊'] },
            cafe: { main: '☕', subs: ['🐱','🧁','🍰','🫧','✨','🍪'], s1: ['🌆','✨','🫧'], s2: ['💕','🍰','🧁'] },
            home: { main: '🏠', subs: ['🐶','🛋️','📺','🍿','😴','💤','🧸'], s1: ['🍿','📺','🧸'], s2: ['😴','💤','🐶'] },
            school: { main: '🎓', subs: ['📚','✏️','🎒','📝','🏫'], s1: ['📚','✏️','📝'], s2: ['🎒','🏫','📖'] },
            gym: { main: '💪', subs: ['🏋️','🥊','💦','🎯','🔥'], s1: ['🥤','🧊','💦'], s2: ['🔥','⚡','🎯'] },
            park: { main: '🌳', subs: ['🌸','🐦','🦋','🍃','🌷','🐿️'], s1: ['🌸','🦋','🌷'], s2: ['🐦','🐿️','🍃'] },
            bar: { main: '🍺', subs: ['🥂','🎵','🎶','🌙','🍸','🎤'], s1: ['🥂','🍸','🎵'], s2: ['🎶','🎤','🌙'] },
            restaurant: { main: '🍽️', subs: ['🍝','🥘','🍖','🥗','🧑‍🍳'], s1: ['🍝','🥘','🍖'], s2: ['🥗','🍷','🧑‍🍳'] },
            hospital: { main: '🏥', subs: ['💊','🩺','🩹','💉','🧴'], s1: ['💊','🩺','🩹'], s2: ['💉','🧴','🤒'] },
            library: { main: '📚', subs: ['📖','📝','🔖','💡','🤓'], s1: ['📖','🔖','📝'], s2: ['💡','🤓','☕'] },
            station: { main: '🚉', subs: ['🚆','🎫','🕐','👥','🛤️'], s1: ['🚆','🎫','🕐'], s2: ['👥','🛤️','📱'] },
            street: { main: '🏚️', subs: ['🔦','🐈‍⬛','📱','👀','🌧️'], s1: ['⚡','🔦','👀'], s2: ['🐈‍⬛','📱','🌧️'] },
        };

        // 장소 이름으로 타입 매칭
        let type = 'default';
        if (/마트|mart|편의|convenience|가게|shop|store|grocery/i.test(name)) type = 'mart';
        else if (/카페|cafe|coffee|커피/i.test(name)) type = 'cafe';
        else if (/집|home|house|숙소|기숙/i.test(name)) type = 'home';
        else if (/학교|school|학원|academy/i.test(name)) type = 'school';
        else if (/체육|gym|운동|fitness|arena|훈련/i.test(name)) type = 'gym';
        else if (/공원|park|정원|garden/i.test(name)) type = 'park';
        else if (/술집|bar|pub|tavern|주점/i.test(name)) type = 'bar';
        else if (/식당|restaurant|음식|레스토랑/i.test(name)) type = 'restaurant';
        else if (/병원|hospital|의원|clinic/i.test(name)) type = 'hospital';
        else if (/도서|library|서점|서재/i.test(name)) type = 'library';
        else if (/역|station|지하철|버스/i.test(name)) type = 'station';
        else if (/골목|거리|길|street|alley/i.test(name)) type = 'street';

        const pool = pools[type] || { main: '📍', subs: ['🗺️','🐾','✨','📌','🏷️'], s1: ['🗺️','✨','📌'], s2: ['🐾','🏷️','🔖'] };

        // 랜덤하게 서브 이모지 선택 (seed: loc.id 해시)
        const hash = (loc.id || '').split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
        const pick = (arr, n) => { const r = [...arr]; const res = []; for (let i = 0; i < n && r.length; i++) { const idx = Math.abs((hash + i * 7) % r.length); res.push(r.splice(idx, 1)[0]); } return res; };

        const mainSubs = pick(pool.subs, 4);
        const s1Emoji = pick(pool.s1, 2);
        const s2Emoji = pick(pool.s2, 2);

        // 이벤트 기반 오버라이드
        if (lastEvent?.mood === '💕') { mainSubs.push('💕'); s2Emoji[0] = '💕'; }
        if (lastEvent?.mood === '⚡') { mainSubs.push('⚡'); s1Emoji[0] = '⚡'; }

        return { main: pool.main, subs: mainSubs, s1: s1Emoji, s2: s2Emoji, colors, timeLabel, tagStyle, isDark };
    }

    _buildMoodCardHtml(loc, style) {
        const mc = this._getMoodCard(loc);
        const grad = mc.isDark
            ? `linear-gradient(160deg,${mc.colors[0]},${mc.colors[1]},${mc.colors[2]})`
            : `linear-gradient(135deg,${mc.colors[0]},${mc.colors[1]})`;
        const opMain = mc.isDark ? '0.9' : '0.9';
        const opSub = mc.isDark ? '0.4' : '0.45';
        const opDeco = mc.isDark ? '0.3' : '0.35';
        // 서브 이모지 위치 (최대 4개, 절대 위치)
        const positions = [
            'top:12px;left:14px', 'bottom:10px;right:16px',
            'top:40px;right:12px', 'bottom:34px;left:18px'
        ];
        const subsHtml = mc.subs.slice(0, 4).map((e, i) =>
            `<span style="position:absolute;${positions[i]};font-size:${16 - i}px;opacity:${opSub - i * 0.05};pointer-events:none">${e}</span>`
        ).join('');

        const s1Bg = mc.isDark ? mc.colors[1] : '#FFF3E0';
        const s2Bg = mc.isDark ? mc.colors[2] : '#E8F5E9';

        return `<div style="display:grid;grid-template-columns:2fr 1fr;grid-template-rows:80px 80px;gap:3px;border-radius:10px;overflow:hidden;margin-bottom:8px">
            <div style="grid-row:1/3;background:${grad};display:flex;align-items:center;justify-content:center;position:relative">
                <span style="font-size:44px;opacity:${opMain}">${mc.main}</span>
                ${subsHtml}
                <span style="position:absolute;top:8px;left:10px;font-size:10px;padding:3px 8px;border-radius:14px;${mc.tagStyle};pointer-events:none">${mc.timeLabel}</span>
            </div>
            <div style="background:${s1Bg};display:flex;align-items:center;justify-content:center;position:relative">
                <span style="font-size:24px;opacity:.7">${mc.s1[0] || '✨'}</span>
                ${mc.s1[1] ? `<span style="position:absolute;bottom:5px;right:7px;font-size:12px;opacity:${opDeco}">${mc.s1[1]}</span>` : ''}
            </div>
            <div style="background:${s2Bg};display:flex;align-items:center;justify-content:center;position:relative">
                <span style="font-size:22px;opacity:.65">${mc.s2[0] || '🐾'}</span>
                ${mc.s2[1] ? `<span style="position:absolute;top:5px;left:7px;font-size:11px;opacity:${opDeco}">${mc.s2[1]}</span>` : ''}
            </div>
        </div>`;
    }

    // ★ 예정 일정 섹션 HTML (개요/이벤트 탭 공용)
    _buildPlanSectionHtml(loc) {
        const plans = (loc.events || []).filter(e => e.isPlan);
        return `<div style="margin-top:12px;padding-top:10px;border-top:1.5px dashed #E0DDD5">
            <div style="display:flex;align-items:center;gap:5px;margin-bottom:8px">
                <span style="font-size:12px">🗓️</span>
                <span style="font-size:11px;font-weight:700;color:#B0A898">예정된 일정</span>
                <span style="font-size:9px;color:#C0B8A8;background:#F0EDE5;padding:1px 6px;border-radius:8px">${plans.length}건</span>
            </div>
            ${plans.length ? plans.map((p, i) => `<div class="wt-plan-card" data-plan-idx="${i}" style="border-radius:7px;padding:8px 10px;margin-bottom:4px;background:#FAFAFA;border:1.5px dashed #D5D0C8;opacity:0.6;cursor:pointer;-webkit-tap-highlight-color:transparent">
                <div style="display:flex;align-items:center;gap:5px">
                    <span style="font-size:12px">🗓️</span>
                    <span style="flex:1;font-weight:600;font-size:10.5px;color:#888">${p.text || p.title || ''}</span>
                    <span class="wt-plan-del" data-plan-idx="${i}" style="cursor:pointer;color:#E53935;background:#FFEBEE;font-size:14px;font-weight:700;padding:4px 8px;border-radius:10px;margin-left:4px;touch-action:manipulation;min-width:28px;text-align:center" title="삭제">✕</span>
                </div>
                ${p.planWhen ? `<div style="font-size:9px;color:#B0A898;margin-top:2px;padding-left:17px">📌 ${p.planDate ? p.planDate + ' (' + p.planWhen + ')' : p.planWhen}</div>` : ''}
            </div>`).join('')
            : '<div style="text-align:center;padding:10px;font-size:11px;color:#C0B8A8;font-style:italic">아직 예정된 일정이 없어요</div>'}
        </div>`;
    }

    // ★ 사진 갤러리 / 분위기 카드 (사진 있으면 사진, 없으면 이모지)
    _buildGalleryHtml(loc, style) {
        const photos = loc.photos || [];
        const locId = loc.id;

        if (photos.length > 0) {
            // 사진 그리드
            const main = photos[0];
            const side = photos.slice(1, 3);
            return `<div style="position:relative;margin-bottom:10px">
                <div style="display:flex;gap:4px;height:140px;border-radius:12px;overflow:hidden">
                    <div style="flex:2;background:url('${main}') center/cover;border-radius:12px 0 0 12px;cursor:pointer" class="wt-photo-view" data-idx="0"></div>
                    ${side.length ? `<div style="flex:1;display:flex;flex-direction:column;gap:4px">
                        ${side.map((p, i) => `<div style="flex:1;background:url('${p}') center/cover;${i === 0 && side.length === 1 ? 'border-radius:0 12px 12px 0' : i === 0 ? 'border-radius:0 12px 0 0' : 'border-radius:0 0 12px 0'};cursor:pointer;position:relative" class="wt-photo-view" data-idx="${i+1}">
                            ${i === side.length - 1 && photos.length > 3 ? `<div style="position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;border-radius:inherit">+${photos.length - 3}</div>` : ''}
                        </div>`).join('')}
                    </div>` : ''}
                </div>
                <div style="display:flex;gap:6px;margin-top:6px">
                    <button class="wt-photo-add" data-locid="${locId}" style="flex:1;padding:6px;background:#F5F4ED;border:1.5px dashed #D8D4C8;border-radius:8px;font-size:11px;color:#9A8A7A;cursor:pointer;font-family:inherit">📷 사진 추가 (${photos.length}/5)</button>
                    ${photos.length > 0 ? `<button class="wt-photo-del-last" data-locid="${locId}" style="padding:6px 10px;background:#FFF5F5;border:1px solid #F0C0C0;border-radius:8px;font-size:11px;color:#C07070;cursor:pointer;font-family:inherit">🗑</button>` : ''}
                </div>
            </div>`;
        }

        // 사진 없으면 기존 분위기 카드 + 사진 추가 버튼
        return this._buildMoodCardHtml(loc, style) +
            `<div style="margin-top:6px;margin-bottom:8px"><button class="wt-photo-add" data-locid="${locId}" style="width:100%;padding:6px;background:#F5F4ED;border:1.5px dashed #D8D4C8;border-radius:8px;font-size:11px;color:#9A8A7A;cursor:pointer;font-family:inherit">📷 사진 추가</button></div>`;
    }

    // ★ 풀스크린 사진 뷰어 (좌우 넘기기 + 개별 삭제)
    _showPhotoViewer(locId, startIdx = 0) {
        const loc = this.lm.locations.find(l => l.id === locId);
        if (!loc?.photos?.length) return;
        const self = this;
        let idx = startIdx;

        const render = () => {
            const total = loc.photos.length;
            if (total === 0) { document.getElementById('wt-photo-viewer')?.remove(); return; }
            if (idx >= total) idx = total - 1;
            if (idx < 0) idx = 0;

            // ★ 기존 뷰어 제거
            document.getElementById('wt-photo-viewer')?.remove();

            // ★ 독립 DOM 요소로 생성 (ST 컨테이너 밖!)
            const overlay = document.createElement('div');
            overlay.id = 'wt-photo-viewer';
            overlay.style.cssText = 'position:fixed!important;top:0!important;left:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;background:rgba(0,0,0,.95);display:flex;flex-direction:column;align-items:center;justify-content:center;touch-action:none';

            overlay.innerHTML = `
                <div style="position:absolute;top:16px;right:16px;display:flex;gap:8px;z-index:2">
                    <button id="wt-pv-del" style="padding:8px 14px;background:rgba(255,60,60,.85);border:none;border-radius:10px;color:#fff;font-size:13px;font-weight:600;cursor:pointer">🗑 삭제</button>
                    <button id="wt-pv-close" style="padding:8px 14px;background:rgba(255,255,255,.2);border:none;border-radius:10px;color:#fff;font-size:18px;cursor:pointer;font-weight:700">✕</button>
                </div>
                ${idx > 0 ? '<button id="wt-pv-prev" style="position:absolute;top:50%;left:10px;transform:translateY(-50%);background:rgba(255,255,255,.15);border:none;border-radius:50%;width:40px;height:40px;font-size:20px;color:#fff;cursor:pointer;z-index:2">◀</button>' : ''}
                ${idx < total - 1 ? '<button id="wt-pv-next" style="position:absolute;top:50%;right:10px;transform:translateY(-50%);background:rgba(255,255,255,.15);border:none;border-radius:50%;width:40px;height:40px;font-size:20px;color:#fff;cursor:pointer;z-index:2">▶</button>' : ''}
                <img src="${loc.photos[idx]}" style="max-width:90vw;max-height:70vh;object-fit:contain;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,.5)">
                <div style="margin-top:14px;color:#fff;font-size:14px;font-weight:600;letter-spacing:1px">${idx + 1} / ${total}</div>
            `;

            document.documentElement.appendChild(overlay); // ★ <html> 직접 자식으로!

            document.getElementById('wt-pv-close')?.addEventListener('click', () => overlay.remove());
            document.getElementById('wt-pv-prev')?.addEventListener('click', (e) => { e.stopPropagation(); idx--; render(); });
            document.getElementById('wt-pv-next')?.addEventListener('click', (e) => { e.stopPropagation(); idx++; render(); });
            document.getElementById('wt-pv-del')?.addEventListener('click', async (e) => {
                e.stopPropagation();
                loc.photos.splice(idx, 1);
                await self.lm.updateLocation(locId, { photos: loc.photos });
                if (loc.photos.length === 0) { overlay.remove(); }
                else { render(); }
                const savedStage = self._bsStage;
                self._showBottomSheet(locId);
                setTimeout(() => self._applyBsStage(savedStage), 50);
                toastSuccess('🗑 사진 삭제');
            });
            overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        };
        render();
    }

    // ★ 사진 압축 + base64 변환
    _compressPhoto(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const MAX = 800;
                    let w = img.width, h = img.height;
                    if (w > MAX || h > MAX) {
                        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
                        else { w = Math.round(w * MAX / h); h = MAX; }
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    resolve(canvas.toDataURL('image/jpeg', 0.7));
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // ========== 구글맵 스타일 바텀시트 ==========
    _showBottomSheet(locId) {
        const loc = this.lm.locations.find(l => l.id === locId);
        if (!loc) return;
        const bs = $('#wt-bottomsheet');
        bs.attr('data-id', locId);

        const style = this.leafletRenderer?._locStyle?.(loc.name) || { emoji: '📍' };
        const v = loc.visitCount || 0;
        const cur = loc.id === this.lm.currentLocationId;
        const visitLabel = v === 0 ? '새 장소' : `방문 ${v}회`;
        const allEvents = (loc.events || []).filter(e => e.source !== 'move');
        const events = allEvents.filter(e => !e.isPlan);
        const plans = allEvents.filter(e => e.isPlan);

        // 주변 장소
        let nearbyHtml = '';
        const nearList = [];
        for (const d of (this.lm.distances || [])) {
            const otherId = d.fromId === locId ? d.toId : d.toId === locId ? d.fromId : null;
            if (!otherId) continue;
            const other = this.lm.locations.find(l => l.id === otherId);
            if (other) nearList.push({ name: other.name, text: d.distanceText || '—', level: d.level || 5, color: other.color || '#9AA0A6' });
        }
        // ★ 도보 15분 이내만 (level 1~6)
        const walkNear = nearList.filter(n => n.level <= 6);
        if (walkNear.length) {
            nearbyHtml = `<div style="margin-top:8px"><div style="font-size:11px;font-weight:600;color:#5A4030;margin-bottom:4px">📌 주변 장소</div>` +
                walkNear.sort((a,b) => a.level - b.level).slice(0, 4).map(n =>
                    `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:11px;color:#3C4043"><div style="width:8px;height:8px;border-radius:50%;background:${n.color};flex-shrink:0"></div>${n.name}<span style="font-size:9px;color:#9AA0A6;margin-left:auto">${n.text}</span></div>`
                ).join('') + '</div>';
        }

        // 이벤트 HTML
        let eventsHtml = '';
        if (events.length) {
            const recentEvents = events.slice(-5).reverse();
            eventsHtml = recentEvents.map((ev, displayIdx) => {
                const dateStr = ev.rpDate || (ev.timestamp ? new Date(ev.timestamp).toLocaleDateString('ko-KR', { month:'numeric', day:'numeric' }) : '');
                const hasDetail = ev.text && ev.text !== ev.title && ev.text.length > 15;
                const moodColors = { '💕': { bg:'#FFF0F3', border:'#F5C0CE', text:'#8B2252' }, '⚡': { bg:'#FFF3E0', border:'#F5C28A', text:'#8B4513' }, '📅': { bg:'#E8F5E9', border:'#A5D6A7', text:'#2E5E3E' } };
                const mc = moodColors[ev.mood] || { bg:'#F5F5F5', border:'#E0E0E0', text:'#4A4A4A' };
                // r22: 이벤트 식별용 ts (timestamp) — 삭제 시 이걸로 find
                const evTs = ev.timestamp || 0;
                return `<div class="wt-bs-ev-card" data-ev-ts="${evTs}" style="background:${mc.bg};border-radius:7px;padding:7px 9px;border:1px solid ${mc.border};margin-bottom:4px;cursor:${hasDetail ? 'pointer' : 'default'}">
                    <div style="display:flex;align-items:center;gap:5px"><span style="font-size:12px">${ev.mood||'📝'}</span><span style="flex:1;font-weight:600;font-size:10.5px;color:${mc.text}">${ev.title||ev.text||''}</span><span style="font-size:8px;color:#B0A898">${dateStr}</span>${hasDetail ? '<span class="wt-bs-ev-arrow" style="font-size:8px;color:#B0A898">▼</span>' : ''}<span class="wt-bs-ev-del" data-ev-ts="${evTs}" style="cursor:pointer;color:#B8A89A;background:transparent;font-size:13px;font-weight:500;padding:3px 7px;border-radius:8px;margin-left:4px;touch-action:manipulation;min-width:24px;text-align:center;border:1px solid transparent;transition:all .15s" title="삭제">✕</span></div>
                    ${hasDetail ? `<div class="wt-bs-ev-detail" style="display:none;margin-top:5px;padding-top:5px;border-top:1px dashed ${mc.border};font-size:9.5px;line-height:1.6;color:#7A7060">${ev.text}</div>` : ''}
                </div>`;
            }).join('');
        } else {
            eventsHtml = '<div style="font-size:11px;color:#9AA0A6;padding:12px;text-align:center;font-style:italic">아직 기억이 없어요</div>';
        }

        // 특이사항
        let specialHtml = '';
        if (loc.aiNotes) {
            specialHtml = `<div style="margin-top:6px;padding:7px 9px;background:rgba(94,132,226,.06);border-radius:7px;border:1px solid rgba(94,132,226,.1)">
                <div style="font-size:9px;color:#5E84E2;font-weight:600;margin-bottom:2px">🤖 특이사항 <span style="font-size:7px;background:#5E84E2;color:#fff;padding:1px 4px;border-radius:3px">AI 참고</span></div>
                <div style="font-size:10px;color:#5E84E2;line-height:1.5">${loc.aiNotes}</div>
            </div>`;
        }

        const html = `
            <div class="wt-bs-handle" style="display:flex;justify-content:center;padding:14px 0 8px;cursor:pointer;min-height:44px"><div style="width:36px;height:4px;background:#D4D0C8;border-radius:2px"></div></div>
            <div style="display:flex;align-items:flex-start;gap:10px;padding:2px 14px 8px">
                <span style="font-size:24px;flex-shrink:0;margin-top:2px">${style.emoji}</span>
                <div style="flex:1;min-width:0">
                    <div style="font-size:17px;font-weight:800;color:#202124;line-height:1.25">${loc.name}</div>
                    <div style="font-size:11px;color:#70757A;margin-top:2px">${visitLabel}${cur ? ' · 현재 위치 🐾' : ''}${walkNear.length ? ' · Near ' + walkNear[0].name : ''}</div>
                </div>
                <button id="wt-bs-x" style="width:28px;height:28px;border:none;background:rgba(0,0,0,.04);border-radius:50%;font-size:12px;color:#70757A;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>
            </div>
            ${loc.memo ? `<div style="padding:0 14px 6px"><div style="font-size:11px;color:#5A4030;font-style:italic;border-left:3px solid #D4D0C8;padding-left:8px">"${loc.memo}"</div></div>` : ''}
            ${loc._tempAddress ? `<div style="padding:0 14px 6px"><div style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:#FFF3E0;border:1px solid #FFB74D;border-radius:14px;font-size:10px;color:#E65100;font-weight:500">📍 임시 주소 · 실제 지도에서 확정해주세요</div></div>` : ''}
            <div style="display:flex;gap:5px;padding:2px 14px 8px;overflow-x:auto">
                <button class="wt-bs-pill-btn" data-action="move" style="display:flex;align-items:center;gap:3px;padding:6px 12px;border-radius:18px;border:1.5px solid #2B8A6E;background:#2B8A6E;font-size:10.5px;font-weight:600;color:#fff;white-space:nowrap;cursor:pointer;font-family:inherit${cur ? ';opacity:.4' : ''}">🐾 이동</button>
                <button class="wt-bs-pill-btn" data-action="edit" style="display:flex;align-items:center;gap:3px;padding:6px 12px;border-radius:18px;border:1.5px solid #5E84E2;background:#EAF0FF;font-size:10.5px;font-weight:600;color:#3A5FBA;white-space:nowrap;cursor:pointer;font-family:inherit">✏️ 수정</button>
                <button class="wt-bs-pill-btn" data-action="save" style="display:flex;align-items:center;gap:3px;padding:6px 12px;border-radius:18px;border:1.5px solid #8B6BB4;background:#F3EEFA;font-size:10.5px;font-weight:600;color:#6B4F91;white-space:nowrap;cursor:pointer;font-family:inherit">🔖 ${((loc.tags||[]).length ? (loc.tags||[]).map(t=>({favorites:'💜',starred:'⭐',wantToGo:'🚩',travel:'🧳'})[t]||'').join('') : '저장')}</button>
                <button class="wt-bs-pill-btn" data-action="dist" style="display:flex;align-items:center;gap:3px;padding:6px 12px;border-radius:18px;border:1.5px solid #E07C3A;background:#FFF3E8;font-size:10.5px;font-weight:600;color:#B85A1A;white-space:nowrap;cursor:pointer;font-family:inherit">📏 거리</button>
            </div>
            <div id="wt-bs-tabs" style="display:flex;border-bottom:2px solid #F0EDE5">
                <div class="wt-bs-tab" data-tab="overview" style="flex:1;text-align:center;padding:8px;font-size:11px;font-weight:600;color:#2B8A6E;cursor:pointer;border-bottom:2.5px solid #2B8A6E;margin-bottom:-2px">개요</div>
                <div class="wt-bs-tab" data-tab="events" style="flex:1;text-align:center;padding:8px;font-size:11px;font-weight:600;color:#B0A898;cursor:pointer;border-bottom:2.5px solid transparent;margin-bottom:-2px">이벤트</div>
                <div class="wt-bs-tab" data-tab="review" style="flex:1;text-align:center;padding:8px;font-size:11px;font-weight:600;color:#B0A898;cursor:pointer;border-bottom:2.5px solid transparent;margin-bottom:-2px">리뷰</div>
                <div class="wt-bs-tab" data-tab="rooms" style="flex:1;text-align:center;padding:8px;font-size:11px;font-weight:600;color:#B0A898;cursor:pointer;border-bottom:2.5px solid transparent;margin-bottom:-2px">내부</div>
                <div class="wt-bs-tab" data-tab="nodemap" style="flex:1;text-align:center;padding:8px;font-size:11px;font-weight:600;color:#B0A898;cursor:pointer;border-bottom:2.5px solid transparent;margin-bottom:-2px">약도</div>
                <div class="wt-bs-tab" data-tab="community" style="flex:1;text-align:center;padding:8px;font-size:11px;font-weight:600;color:#B0A898;cursor:pointer;border-bottom:2.5px solid transparent;margin-bottom:-2px;white-space:nowrap">🟢 실시간</div>
            </div>
            <div id="wt-bs-tab-overview" style="padding:10px 14px;overflow-y:auto">
                <!-- 분위기 카드 / 사진 갤러리 -->
                ${this._buildGalleryHtml(loc, style)}
                ${loc.address ? `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #F0EDE5;font-size:11px;color:#5A4030"><span style="font-size:13px;color:#9A8A7A">📍</span><div>${loc.address}</div></div>` : ''}
                <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #F0EDE5;font-size:11px;color:#5A4030"><span style="font-size:13px;color:#9A8A7A">📊</span><div>방문 ${v}회<div style="font-size:9px;color:#B0A898">첫 ${loc.rpFirstVisited || (loc.firstVisited ? this._fmt(loc.firstVisited) : '—')} · 최근 ${loc.rpLastVisited || (loc.lastVisited ? this._fmt(loc.lastVisited) : '—')}</div></div></div>
                ${specialHtml}
                ${nearbyHtml}
                <!-- 🟢 커뮤니티 실시간 미니 피드 (v0.6.0 NEW) -->
                ${(loc.community?.length) ? `<div style="margin-top:10px;border:1px solid #EFF3F4;border-radius:14px;overflow:hidden">
                    <div style="padding:10px 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #EFF3F4;background:#fff">
                        <div style="font-size:12px;font-weight:700;color:#0F1419;display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;background:#00BA7C;border-radius:50%;display:inline-block;animation:wtLivePulse 2s infinite"></span> 지금 이곳은</div>
                        <button class="wt-bs-comm-more" style="font-size:12px;color:#1D9BF0;font-weight:600;cursor:pointer;background:#E8F5FD;border:none;padding:6px 12px;border-radius:14px;font-family:inherit;-webkit-tap-highlight-color:rgba(29,155,240,.2);min-height:32px;touch-action:manipulation;position:relative;z-index:2">전체 보기 ›</button>
                    </div>
                    ${loc.community.slice(0,3).map(p => `<div style="padding:8px 12px;display:flex;gap:8px;border-bottom:1px solid #EFF3F4">
                        <div style="width:28px;height:28px;min-width:28px;border-radius:50%;background:${p.type==='animal'?'#FFF8E1':'#E8F0FE'};display:flex;align-items:center;justify-content:center;font-size:14px;line-height:1;flex-shrink:0;overflow:hidden;text-align:center">${this._firstGrapheme(p.avatar || '👤')}</div>
                        <div style="flex:1;min-width:0">
                            <div style="display:flex;align-items:center;gap:4px"><span style="font-size:11px;font-weight:600;color:#0F1419">${p.name}</span><span style="font-size:10px;color:#8B98A5">· ${this._timeAgo(p.timestamp)}</span></div>
                            <div style="font-size:11px;color:#536471;line-height:1.4;margin-top:1px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${this._renderCommunityText(p.text)}</div>
                        </div>
                    </div>`).join('')}
                    <button class="wt-bs-comm-gen" style="width:100%;padding:8px;background:#F7F9F9;border:none;border-top:1px solid #EFF3F4;font-size:11px;font-weight:500;color:#1D9BF0;cursor:pointer;font-family:inherit">🔄 실시간 반응 업데이트</button>
                </div>` : `<div style="margin-top:10px;padding:14px;background:#F7F9F9;border:1px dashed #DADCE0;border-radius:14px;text-align:center">
                    <div style="font-size:11px;color:#5F6368;margin-bottom:8px">💬 아직 이 장소의 커뮤니티 반응이 없어요</div>
                    <button class="wt-bs-comm-gen" style="padding:8px 16px;background:#1D9BF0;color:#fff;border:none;border-radius:18px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">✨ 실시간 반응 생성</button>
                </div>`}
                ${(loc.npcs?.length) ? `<div style="margin-top:8px;padding:8px 10px;background:#F3EEFA;border-left:3px solid #8B6BB4;border-radius:0 8px 8px 0"><div style="font-size:10px;font-weight:600;color:#6B4F91;margin-bottom:3px">👥 터줏대감 (${loc.npcs.length})</div>${loc.npcs.slice(0,3).map(n => `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px;color:#5A4070"><span style="font-size:12px">${n.avatar||(n.type==='animal'?'🐾':'👤')}</span><span style="font-weight:600">${n.name}</span>${n.role?` <span style="font-size:9px;color:#8B6BB4">(${n.role})</span>`:''}<span style="margin-left:auto;font-size:10px">${Array.from({length:5},(_,i)=>i<(n.affinity||3)?'❤️':'🤍').join('')}</span></div>`).join('')}${loc.npcs.length > 3 ? `<div style="font-size:10px;color:#8B6BB4;text-align:center;margin-top:4px">+${loc.npcs.length-3}명 더...</div>` : ''}<button class="wt-bs-npc-more" style="margin-top:6px;padding:8px;background:#FAFAF5;border:1px solid #E0D8F0;border-radius:20px;font-size:11px;font-weight:500;color:#6B4F91;text-align:center;cursor:pointer;width:100%;font-family:inherit">모든 터줏대감 보기 ›</button></div>` : ''}
                ${this._buildPlanSectionHtml(loc)}
                <!-- T3: 리뷰 미리보기 (개요 안) -->
                <div id="wt-bs-rv-preview" style="margin-top:10px;padding-top:8px;border-top:1px solid #F0EDE5">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                        <span style="font-size:18px;font-weight:800;color:#202124" id="wt-bs-rv-score">—</span>
                        <div><div id="wt-bs-rv-stars" style="font-size:11px;color:#F6A93A">☆☆☆☆☆</div><div id="wt-bs-rv-count" style="font-size:9px;color:#70757A">(0건)</div></div>
                    </div>
                    <div id="wt-bs-rv-cards"></div>
                    <button id="wt-bs-rv-more" style="margin-top:6px;padding:9px;background:#F8F9FA;border:1px solid #E8EAED;border-radius:24px;font-size:11px;font-weight:500;color:#3C4043;text-align:center;cursor:pointer;width:100%;font-family:inherit">모든 리뷰 보기 ›</button>
                </div>
                <!-- T4: 최근 방문 기록 + 기억 링크 -->
                <div style="display:flex;align-items:center;gap:8px;padding:10px 0;border-top:1px solid #F0EDE5;margin-top:8px;cursor:pointer;font-size:12px;color:#3C4043;font-weight:500" class="wt-bs-mem-link" data-action="visits">
                    <span>🕐</span>
                    <div style="flex:1">최근 방문 기록<div style="font-size:10px;color:#9AA0A6;font-weight:400;margin-top:1px">${loc.rpLastVisited || (loc.lastVisited ? this._fmt(loc.lastVisited) : '—')}</div></div>
                    <span style="color:#9AA0A6;font-size:14px">›</span>
                </div>
                ${events.length ? `<div style="display:flex;align-items:center;gap:8px;padding:10px 0;border-top:1px solid #F0EDE5;cursor:pointer;font-size:12px;color:#3C4043;font-weight:500" class="wt-bs-mem-link" data-action="memories">
                    <span>💬</span>
                    <div style="flex:1">이 장소에서의 기억<div style="font-size:10px;color:#9AA0A6;font-weight:400;margin-top:1px">${events[events.length-1]?.title || events[events.length-1]?.text?.substring(0,20) || '—'}</div></div>
                    <span style="color:#9AA0A6;font-size:14px">›</span>
                </div>` : ''}
            </div>
            <div id="wt-bs-tab-events" style="display:none;padding:10px 14px;overflow-y:auto">
                <div style="margin-bottom:8px;padding:8px 10px;background:#FAFAF5;border-radius:8px;border:1px solid #EAE6DC">
                    <div style="font-size:10px;font-weight:600;color:#5A4030;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between">🌡️ 분위기 지수 <span style="display:flex;align-items:center;gap:6px"><span style="font-size:9px;color:#9AA0A6;font-weight:400">최근 7일</span><button class="wt-bs-mood-reset" style="font-size:10px;font-weight:500;background:transparent;border:1px solid #D4CCBA;border-radius:12px;padding:3px 10px;cursor:pointer;color:#8A7A6A;font-family:inherit;touch-action:manipulation;min-height:26px;letter-spacing:-.2px">↻ 리셋</button></span></div>
                    <div style="display:flex;align-items:flex-end;gap:3px;height:36px">
                        ${(() => { const filteredEvents = loc.moodResetAt ? events.filter(e => (e.timestamp||0) > loc.moodResetAt) : events; const moods = filteredEvents.slice(-7); const bars = []; for(let i=0;i<7;i++){const ev=moods[i]; const h=ev?(['💕','😊'].some(m=>m===ev.mood)?30:['⚡','🔍'].some(m=>m===ev.mood)?70:45):12; const c=ev?(['💕','😊'].some(m=>m===ev.mood)?'#A8D8EA':['⚡','🔍'].some(m=>m===ev.mood)?'#F5A8A8':'#F5C6AA'):'#E8E4D8'; bars.push(`<div style="flex:1;height:${h}%;background:${c};border-radius:2px 2px 0 0"></div>`);} return bars.join(''); })()}
                    </div>
                    <div style="font-size:8px;color:#9AA0A6;text-align:center;margin-top:4px">${(() => { const filteredEvents = loc.moodResetAt ? events.filter(e => (e.timestamp||0) > loc.moodResetAt) : events; return filteredEvents.length ? `이벤트 ${filteredEvents.length}건 기반${loc.moodResetAt ? ' (리셋 후)' : ''}` : '데이터 수집 중...'; })()}</div>
                </div>
                ${eventsHtml}
                ${this._buildPlanSectionHtml(loc)}
            </div>
            <div id="wt-bs-tab-review" style="display:none;padding:10px 14px;overflow-y:auto">
                <div style="text-align:center;padding:8px">
                    <button id="wt-bs-gen-review" style="padding:8px 16px;background:#E8F0FE;border:1.5px solid #1A73E8;border-radius:18px;font-size:11px;font-weight:600;color:#1A73E8;cursor:pointer;font-family:inherit">🔄 랜덤 리뷰 생성</button>
                </div>
                <div id="wt-bs-review-list"></div>
                <!-- 터줏대감 섹션 (리뷰 아래) -->
                <div id="wt-bs-npc-section" style="margin:16px 0 0;padding-top:14px;border-top:6px solid #F7F9F9">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
                        <div style="font-size:14px;font-weight:700;color:#202124">👥 이 장소의 터줏대감</div>
                        <span id="wt-bs-npc-count" style="font-size:12px;color:#9AA0A6">0명</span>
                    </div>
                    <div id="wt-bs-npc-list"></div>
                </div>
            </div>
            <div id="wt-bs-tab-rooms" style="display:none;padding:10px 14px;overflow-y:auto">
                ${(() => {
                    const subs = this.lm.getSubLocations(locId);
                    const subEmojis = { '거실':'🛋', '부엌':'🍳', '주방':'🍳', '방':'🛏', '침실':'🛏', '안방':'🛏', '화장실':'🚿', '욕실':'🚿', '베란다':'🌅', '발코니':'🌅', '옥상':'🌤', '서재':'📚', '마당':'🌳', '차고':'🚗', 'kitchen':'🍳', 'bedroom':'🛏', 'bathroom':'🚿', 'living room':'🛋', 'room':'🛏', 'study':'📚', 'garage':'🚗', 'balcony':'🌅' };
                    const getEmoji = n => subEmojis[n.toLowerCase()] || '🚪';
                    if (!subs.length) return '<div style="text-align:center;padding:20px;color:#9AA0A6;font-size:12px">아직 내부 장소가 없어요<br><span style="font-size:11px">RP 중 거실, 부엌 등이 자동 등록돼요!</span></div>';
                    return subs.map(s => {
                        const isCur = s.id === this.lm.currentSubLocationId;
                        const evCount = (s.events||[]).length;
                        return `<div class="wt-bs-sub-item" data-subid="${s.id}" style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid ${isCur?'#2B8A6E':'#F0EDE5'};border-radius:10px;margin-bottom:6px;cursor:pointer;background:${isCur?'#F0FFF4':'#fff'};-webkit-tap-highlight-color:transparent">
                            <span style="font-size:16px">${getEmoji(s.name)}</span>
                            <div style="flex:1"><div style="font-size:12px;font-weight:600;color:#202124">${s.name}${isCur?' <span style="font-size:9px;color:#2B8A6E;background:#E8F5E9;padding:1px 5px;border-radius:6px">현재</span>':''}</div><div style="font-size:10px;color:#70757A">${s.visitCount||0}회${evCount?' · 이벤트 '+evCount+'건':''}</div></div>
                            <span class="wt-bs-sub-del" data-subid="${s.id}" style="cursor:pointer;color:#B8A89A;background:transparent;font-size:14px;font-weight:500;padding:4px 8px;border-radius:8px;margin-left:4px;touch-action:manipulation;min-width:26px;text-align:center;border:1px solid transparent;transition:all .15s" title="삭제">✕</span>
                            <span style="color:#9AA0A6;font-size:12px">></span>
                        </div>`;
                    }).join('');
                })()}
                <div style="display:flex;gap:4px;margin-top:8px">
                    <input type="text" id="wt-bs-add-sub" placeholder="장소 이름 (EX. 거실)" style="flex:1;padding:7px 10px;border:1.5px solid #E8E4D8;border-radius:8px;font-size:12px;font-family:inherit"/>
                    <button id="wt-bs-add-sub-btn" style="width:34px;height:34px;background:#5E84E2;border:none;border-radius:8px;color:#fff;font-size:18px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center">+</button>
                </div>
            </div>
            <!-- 🗺️ 약도 탭 (v0.6.0 NEW) -->
            <div id="wt-bs-tab-nodemap" style="display:none;padding:12px;overflow-y:auto">
                <div style="background:#F8F9FA;border-radius:12px;padding:12px;text-align:center">
                    <div style="font-size:11px;font-weight:600;color:#5F6368;margin-bottom:6px;text-align:left">🔗 주변 관계도</div>
                    <div id="wt-bs-nodemap-svg" style="width:100%;height:180px;background:#fff;border-radius:8px;border:1px solid #E8EAED;overflow:hidden"></div>
                    <button id="wt-bs-nodemap-expand" style="margin-top:10px;padding:8px 16px;border-radius:20px;border:1px solid #DADCE0;background:#fff;font-size:12px;font-weight:500;color:#1A73E8;cursor:pointer;font-family:inherit;touch-action:manipulation;-webkit-tap-highlight-color:rgba(26,115,232,.2);min-height:38px;position:relative;z-index:2">🗺️ 전체 약도 보기</button>
                </div>
                <div style="margin-top:12px;padding:10px;background:#E8F0FE;border-radius:10px;font-size:11px;color:#1A73E8;line-height:1.5">
                    💡 현재 장소를 중심으로 주변 등록된 장소들의 관계를 보여줍니다. 도보 거리 기준.
                </div>
            </div>
            <!-- 🟢 실시간 탭 (v0.6.1 NEW) — 커뮤니티 피드 인라인 -->
            <div id="wt-bs-tab-community" style="display:none;overflow-y:auto;position:relative;background:#fff">
                <!-- Sticky 헤더: 개수 + ⛶ 전체화면 + ✨ 새 반응 -->
                <div id="wt-bs-comm-sticky" style="position:sticky;top:0;z-index:5;background:#fff;display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #EFF3F4">
                    <div style="font-size:12px;color:#536471;display:flex;align-items:center;gap:6px">
                        <span style="width:7px;height:7px;background:#00BA7C;border-radius:50%;display:inline-block;animation:wtLivePulse 2s infinite"></span>
                        실시간 반응 <b id="wt-bs-comm-count" style="color:#0F1419;font-weight:700">${(loc.community || []).length}</b>개
                    </div>
                    <div style="display:flex;gap:6px">
                        <button class="wt-bs-comm-fs" style="padding:6px 10px;background:#F7F9F9;border:1px solid #EFF3F4;border-radius:18px;font-size:11px;color:#536471;cursor:pointer;font-family:inherit;touch-action:manipulation;-webkit-tap-highlight-color:rgba(0,0,0,.1);min-height:32px" title="전체화면">⛶</button>
                        <button class="wt-bs-comm-gen-inline" style="padding:6px 14px;background:#1D9BF0;color:#fff;border:none;border-radius:18px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;box-shadow:0 1px 3px rgba(29,155,240,.3);touch-action:manipulation;-webkit-tap-highlight-color:rgba(29,155,240,.4);min-height:32px;display:flex;align-items:center;gap:4px">✨ <span>새 반응</span></button>
                    </div>
                </div>
                <!-- 피드 본문 -->
                <div id="wt-bs-comm-feed" style="background:#fff">
                    ${(loc.community && loc.community.length) ? loc.community.map(p => this._renderCommunityPostCard(p)).join('') : `<div style="padding:60px 20px;text-align:center;color:#8B98A5;font-size:13px"><div style="font-size:40px;margin-bottom:12px">💭</div><div style="font-size:13px;color:#536471;font-weight:500;margin-bottom:4px">아직 반응이 없어요</div><div style="font-size:11px;color:#8B98A5">✨ 버튼을 눌러 실시간 반응을 생성해보세요</div></div>`}
                </div>
                <!-- FAB (우하단) -->
                <button class="wt-bs-comm-fab" style="position:sticky;bottom:16px;margin-left:auto;margin-right:16px;margin-top:-60px;margin-bottom:16px;display:block;width:48px;height:48px;border-radius:50%;background:#1D9BF0;color:#fff;border:none;font-size:22px;cursor:pointer;box-shadow:0 4px 14px rgba(29,155,240,.4);font-family:inherit;touch-action:manipulation;-webkit-tap-highlight-color:rgba(29,155,240,.4);z-index:4">✨</button>
            </div>`;

        bs.html(html).show().css({ background: '#fff' });
        this._applyBsStage(1); // peek
        this._bindBsDrag(bs[0]); // ★ 터치 드래그 바인딩!
        bs.find('.wt-bs-handle').css({ position: 'sticky', top: 0, zIndex: 10, background: '#fff' });

        // 이벤트 바인딩 (핸들은 글로벌 _bindBottomSheet가 처리)
        const self = this;
        bs.find('#wt-bs-x').on('click', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); self._hideBottomSheet(); });
        bs.find('.wt-bs-pill-btn').on('click', function(e) {
            e.stopPropagation();
            const action = $(this).data('action');
            const id = bs.attr('data-id');
            if (action === 'move' && id) { self.lm.moveTo(id).then(() => { self.pi?.inject(); self.refresh(); self._hideBottomSheet(); toastSuccess('🐾 이동!'); }); }
            if (action === 'edit' && id) { self._hideBottomSheet(); self.showPop(id); }
            if (action === 'dist' && id) { self._showDistanceMeasure(id); }
            if (action === 'save' && id) { self._showTagPopup(id, $(this)); }
        });
        bs.find('.wt-bs-tab').on('click', function(e) {
            e.stopPropagation();
            const tab = $(this).data('tab');
            const tabColors = { overview: '#1A73E8', events: '#CF6E2E', review: '#1A73E8', rooms: '#8B6B4A', nodemap: '#34A853', community: '#1D9BF0' };
            const color = tabColors[tab] || '#2B8A6E';
            bs.find('.wt-bs-tab').css({ color: '#B0A898', borderBottomColor: 'transparent' });
            $(this).css({ color, borderBottomColor: color });
            bs.find('[id^="wt-bs-tab-"]').hide();
            bs.find(`#wt-bs-tab-${tab}`).show();
            // 이벤트/리뷰/커뮤니티 탭은 full로 확장
            if (tab !== 'overview' && self._bsStage < 3) self._applyBsStage(3);
        });
        // 7. 이벤트 아코디언 클릭 → 펼치기
        bs.find('.wt-bs-ev-card').on('click', function(e) {
            // r22: 삭제 버튼 클릭 시 토글 방지
            if ($(e.target).hasClass('wt-bs-ev-del')) return;
            const det = $(this).find('.wt-bs-ev-detail');
            const arrow = $(this).find('.wt-bs-ev-arrow');
            if (det.length) {
                det.slideToggle(200);
                arrow.text(det.is(':visible') ? '▼' : '▲');
            }
        });
        // r22: 바텀시트 내 삭제/리셋 버튼들 전부 document-delegated로 변경 — 모바일 호환성 (r14의 comm-more와 동일 이슈)
        $(document).off('click.wtEvDel touchend.wtEvDel click.wtMoodRst touchend.wtMoodRst click.wtPlanDel touchend.wtPlanDel');

        // 이벤트 카드 삭제
        $(document).on('click.wtEvDel touchend.wtEvDel', '.wt-bs-ev-del', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (window._wtTapFireLock) return;
            window._wtTapFireLock = true;
            setTimeout(() => window._wtTapFireLock = false, 600);
            const curBs = document.getElementById('wt-bottomsheet');
            const lid = curBs?.getAttribute('data-id');
            if (!lid) return;
            const evTs = parseInt($(this).data('ev-ts'));
            if (!evTs || !confirm('이 기억을 삭제할까요?')) return;
            const loc = self.lm.locations.find(l => l.id === lid);
            if (!loc) return;
            const realIdx = (loc.events || []).findIndex(ev => ev.timestamp === evTs);
            if (realIdx >= 0) {
                loc.events.splice(realIdx, 1);
                self.lm.updateLocation(lid, { events: loc.events });
                self._showBottomSheet(lid);
                setTimeout(() => self._applyBsStage(3), 100);
                toastSuccess('✕ 기억 삭제');
            }
        });

        // 분위기 지수 리셋
        $(document).on('click.wtMoodRst touchend.wtMoodRst', '.wt-bs-mood-reset', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (window._wtTapFireLock) return;
            window._wtTapFireLock = true;
            setTimeout(() => window._wtTapFireLock = false, 600);
            const curBs = document.getElementById('wt-bottomsheet');
            const lid = curBs?.getAttribute('data-id');
            if (!lid) return;
            if (!confirm('분위기 지수를 리셋할까요?\n(이후 이벤트만 차트에 반영됩니다)')) return;
            self.lm.updateLocation(lid, { moodResetAt: Date.now() });
            self._showBottomSheet(lid);
            setTimeout(() => self._applyBsStage(3), 100);
            toastSuccess('🌡️ 분위기 지수 리셋');
        });

        // 예정 일정 삭제
        $(document).on('click.wtPlanDel touchend.wtPlanDel', '.wt-plan-del', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (window._wtTapFireLock) return;
            window._wtTapFireLock = true;
            setTimeout(() => window._wtTapFireLock = false, 600);
            const curBs = document.getElementById('wt-bottomsheet');
            const lid = curBs?.getAttribute('data-id');
            if (!lid) return;
            const idx = parseInt($(this).data('plan-idx'));
            const loc = self.lm.locations.find(l => l.id === lid);
            if (!loc) return;
            const planEvents = (loc.events || []).filter(ev => ev.isPlan);
            if (idx >= 0 && idx < planEvents.length) {
                const target = planEvents[idx];
                const realIdx = loc.events.indexOf(target);
                if (realIdx >= 0) {
                    loc.events.splice(realIdx, 1);
                    self.lm.updateLocation(lid, { events: loc.events });
                    self._showBottomSheet(lid);
                    toastSuccess('✕ 일정 삭제');
                }
            }
        });
        // ★ 사진 추가 — 숨겨진 file input 사용 (모바일 호환)
        bs.find('.wt-photo-add').each(function() {
            const btn = $(this);
            const lid = btn.data('locid');
            // 숨김 input 바로 옆에 삽입
            const inputId = 'wt-photo-input-' + lid;
            if (!$('#' + inputId).length) {
                btn.after(`<input type="file" id="${inputId}" accept="image/*" style="display:none">`);
            }
            btn.off('click').on('click', (e) => {
                e.stopPropagation();
                const loc = self.lm.locations.find(l => l.id === lid);
                if ((loc?.photos || []).length >= 5) { toastWarn('📷 최대 5장까지!'); return; }
                $('#' + inputId).trigger('click');
            });
            $('#' + inputId).off('change').on('change', async function(ev) {
                const file = this.files?.[0];
                if (!file) return;
                try {
                    toastSuccess('📷 사진 처리 중...');
                    const base64 = await self._compressPhoto(file);
                    const loc = self.lm.locations.find(l => l.id === lid);
                    if (!loc) return;
                    if (!loc.photos) loc.photos = [];
                    loc.photos.push(base64);
                    await self.lm.updateLocation(lid, { photos: loc.photos });
                    // ★ 깜빡임 최소화: 갤러리만 교체
                    const savedStage = self._bsStage;
                    const bs = $('#wt-bottomsheet');
                    bs.css('opacity', '0.7');
                    self._showBottomSheet(lid);
                    setTimeout(() => { self._applyBsStage(savedStage); bs.css('opacity', '1'); }, 80);
                    toastSuccess(`📷 사진 추가! (${loc.photos.length}/5)`);
                } catch(err) {
                    toastWarn('📷 사진 처리 실패');
                    console.error('[wt] photo error:', err);
                }
                $(this).val('');
            });
        });
        // ★ 사진 삭제 (마지막 사진)
        bs.find('.wt-photo-del-last').on('click', function(e) {
            e.stopPropagation();
            const lid = $(this).data('locid');
            const loc = self.lm.locations.find(l => l.id === lid);
            if (!loc?.photos?.length) return;
            loc.photos.pop();
            self.lm.updateLocation(lid, { photos: loc.photos });
            const savedStage = self._bsStage;
            const bs = $('#wt-bottomsheet');
            bs.css('opacity', '0.7');
            self._showBottomSheet(lid);
            setTimeout(() => { self._applyBsStage(savedStage); bs.css('opacity', '1'); }, 80);
            toastSuccess('🗑 사진 삭제');
        });
        // ★ 사진 풀스크린 뷰어
        bs.find('.wt-photo-view').on('click', function(e) {
            e.stopPropagation();
            const idx = parseInt($(this).data('idx')) || 0;
            const loc = self.lm.locations.find(l => l.id === locId);
            if (!loc?.photos?.length) return;
            self._showPhotoViewer(locId, idx);
        });
        bs.find('#wt-bs-gen-review').on('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            self._generateReviews(locId, 'bottomsheet');
        });
        this._renderCachedReviews(locId, '#wt-bs-review-list');
        // T3: 개요 탭 리뷰 미리보기 렌더 + "모든 리뷰 보기" 클릭
        this._renderReviewPreview(locId);
        // ★ 터줏대감 탭 렌더
        this._renderNpcTab(locId);
        this._renderMiniNodemap(locId);
        // r14: 약도 + 커뮤니티 전체보기 둘 다 document-level delegated로 통일
        // bs.find().on() 방식이 환경에 따라 유실되는 케이스 원천 차단
        $(document).off('click.wtNodemapExp touchend.wtNodemapExp');
        let _nodemapExpLock = false;
        $(document).on('click.wtNodemapExp', '#wt-bs-nodemap-expand', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (window._wtTapFireLock) { window._wtDlog?.('click NMAP skipped (tap lock)', '#888'); return; }
            if (_nodemapExpLock) return;
            _nodemapExpLock = true;
            setTimeout(() => _nodemapExpLock = false, 500);
            window._wtDlog?.('click FIRE NMAP', '#0f8');
            const curBs = document.getElementById('wt-bottomsheet');
            const lid = curBs?.getAttribute('data-id');
            if (lid) self._showNodemapFullscreen(lid);
        });
        // 💬 커뮤니티 버튼 핸들러 (debounce로 중복 호출 방지)
        let _commHandlerLock = false;
        const commGenHandler = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (_commHandlerLock) return;
            _commHandlerLock = true;
            setTimeout(() => _commHandlerLock = false, 500);
            const btn = $(e.currentTarget);
            if (btn.prop('disabled')) return;
            btn.prop('disabled', true).text('⏳ 생성 중...');
            await self._generateCommunity(locId);
        };
        bs.find('.wt-bs-comm-gen').on('click touchend', commGenHandler);

        // v0.6.1: 🟢 실시간 탭 내부 버튼들 (인라인 ✨ 새 반응 + 우하단 FAB) — 동일 핸들러
        bs.find('.wt-bs-comm-gen-inline, .wt-bs-comm-fab').on('click touchend', commGenHandler);

        // v0.6.1: ⛶ 전체화면 버튼 → 기존 풀스크린 오버레이 호출
        bs.find('.wt-bs-comm-fs').on('click touchend', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (window._wtTapFireLock) return;
            const lid = bs.attr('data-id');
            if (lid) self._showCommunityFullFeed(lid);
        });

        // r13: document-level delegated event로 변경 — DOM 재생성/모바일 scroll intercept 이슈에도 안전
        // 기존 bs.find() 바인딩은 _showBottomSheet마다 재생성되면서 놓칠 수 있음
        $(document).off('click.wtCommMore touchend.wtCommMore');
        let _commMoreLock = false;
        $(document).on('click.wtCommMore', '.wt-bs-comm-more', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (window._wtTapFireLock) { window._wtDlog?.('click COMM skipped (tap lock)', '#888'); return; }
            if (_commMoreLock) return;
            _commMoreLock = true;
            setTimeout(() => _commMoreLock = false, 500);
            window._wtDlog?.('click FIRE COMM → community tab', '#0f8');
            // v0.6.1: 오버레이 대신 🟢 실시간 탭으로 전환
            const curBs = $('#wt-bottomsheet');
            const commTab = curBs.find('.wt-bs-tab[data-tab="community"]');
            if (commTab.length) {
                commTab.click();
            } else {
                // 폴백: 탭이 없으면 기존 오버레이
                const lid = curBs.attr('data-id');
                if (lid) self._showCommunityFullFeed(lid);
            }
        });
        bs.find('#wt-bs-rv-more').on('click', (e) => {
            e.stopPropagation();
            // 리뷰 탭으로 전환
            bs.find('.wt-bs-tab').css({ color: '#B0A898', borderBottomColor: 'transparent' });
            bs.find('.wt-bs-tab[data-tab="review"]').css({ color: '#5E84E2', borderBottomColor: '#5E84E2' });
            bs.find('[id^="wt-bs-tab-"]').hide();
            bs.find('#wt-bs-tab-review').show();
            if (self._bsStage < 3) self._applyBsStage(3);
        });
        // ★ 터줏대감 탭 전환
        bs.find('.wt-bs-npc-more').on('click', (e) => {
            e.stopPropagation();
            bs.find('.wt-bs-tab').css({ color: '#B0A898', borderBottomColor: 'transparent' });
            bs.find('.wt-bs-tab[data-tab="review"]').css({ color: '#1A73E8', borderBottomColor: '#1A73E8' });
            bs.find('[id^="wt-bs-tab-"]').hide();
            bs.find('#wt-bs-tab-review').show();
            if (self._bsStage < 3) self._applyBsStage(3);
            // NPC 섹션으로 스크롤
            setTimeout(() => bs.find('#wt-bs-npc-section')[0]?.scrollIntoView({ behavior: 'smooth' }), 100);
        });
        // T4: 기억 링크 클릭 → 이벤트 탭으로 전환
        bs.find('.wt-bs-mem-link').on('click', function(e) {
            e.stopPropagation();
            bs.find('.wt-bs-tab').css({ color: '#B0A898', borderBottomColor: 'transparent' });
            bs.find('.wt-bs-tab[data-tab="events"]').css({ color: '#2B8A6E', borderBottomColor: '#2B8A6E' });
            bs.find('[id^="wt-bs-tab-"]').hide();
            bs.find('#wt-bs-tab-events').show();
            if (self._bsStage < 3) self._applyBsStage(3);
        });
        // ★ 내부 장소 클릭 → 서브 상세 뷰
        bs.find('.wt-bs-sub-item').on('click', function(e) {
            // r22: 삭제 버튼 클릭 시 상세 뷰 전환 방지
            if ($(e.target).hasClass('wt-bs-sub-del')) return;
            e.stopPropagation();
            const subId = $(this).data('subid');
            self._showSubLocationDetail(locId, subId);
        });
        // r22: 서브 장소 삭제 — document-delegated (모바일 대응)
        $(document).off('click.wtSubDel touchend.wtSubDel');
        $(document).on('click.wtSubDel touchend.wtSubDel', '.wt-bs-sub-del', async function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (window._wtTapFireLock) return;
            window._wtTapFireLock = true;
            setTimeout(() => window._wtTapFireLock = false, 600);
            const curBs = document.getElementById('wt-bottomsheet');
            const lid = curBs?.getAttribute('data-id');
            if (!lid) return;
            const subId = $(this).data('subid');
            const sub = self.lm.locations.find(l => l.id === subId);
            if (!sub) return;
            if (!confirm(`"${sub.name}" 장소를 삭제할까요?\n(이벤트도 모두 삭제됩니다)`)) return;
            await self.lm.deleteLocation(subId);
            toastSuccess(`✕ "${sub.name}" 삭제`);
            self._showBottomSheet(lid);
            setTimeout(() => {
                $('#wt-bottomsheet').find('.wt-bs-tab[data-tab="rooms"]').click();
            }, 100);
        });
        // ★ 내부 장소 추가 버튼
        bs.find('#wt-bs-add-sub-btn').on('click', async (e) => {
            e.stopPropagation();
            const name = bs.find('#wt-bs-add-sub').val().trim();
            if (!name) { bs.find('#wt-bs-add-sub').css('borderColor', '#F5A8A8'); return; }
            await self.lm.findOrCreateSub(locId, name);
            toastSuccess(`🏠 "${name}" 추가!`);
            self._showBottomSheet(locId); // 리렌더
            // 내부 탭 다시 열기
            setTimeout(() => {
                bs.find('.wt-bs-tab[data-tab="rooms"]').click();
            }, 100);
        });
    }

    _hideBottomSheet() {
        // r18: 호출자 추적 — _showCommunityFullFeed 직후 호출되는지 확인
        window._wtDlog?.('_hideBS called', '#f80');
        // r13: 바텀시트 닫을 때 body에 남아있던 오버레이들 강제 제거 (잔존 헤더 버그 수정)
        ['wt-community-overlay', 'wt-nodemap-overlay', 'wt-npc-profile-overlay'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { window._wtDlog?.(` removing ${id}`, '#f55'); el.remove(); }
        });
        // B1: 검색창 자동포커스 방지
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) activeEl.blur();
        const bs = document.getElementById('wt-bottomsheet');
        if (bs) { bs.style.cssText = 'display:none'; bs.innerHTML = ''; }
        setTimeout(() => this.leafletRenderer?.invalidateSize(), 200);
        this._bsStage = 0;
    }

    // ★ 서브 장소 상세 뷰
    _showSubLocationDetail(parentId, subId) {
        const parent = this.lm.locations.find(l => l.id === parentId);
        const sub = this.lm.locations.find(l => l.id === subId);
        if (!parent || !sub) return;
        const bs = $('#wt-bottomsheet');
        const isCur = sub.id === this.lm.currentSubLocationId;
        const events = (sub.events || []).slice(-10);

        const subEmojis = { '거실':'🛋', '부엌':'🍳', '주방':'🍳', '방':'🛏', '침실':'🛏', '안방':'🛏', '화장실':'🚿', '욕실':'🚿', '서재':'📚', '마당':'🌳', '차고':'🚗', 'kitchen':'🍳', 'bedroom':'🛏', 'bathroom':'🚿', 'living room':'🛋', 'room':'🛏', 'study':'📚' };
        const emoji = subEmojis[sub.name.toLowerCase()] || '🚪';

        let evHtml = '';
        if (events.length) {
            evHtml = events.map((ev, i) => {
                const title = ev.title || ev.text?.substring(0, 40) || '—';
                const fullText = ev.text || '';
                const hasDetail = fullText.length > 0 && fullText !== title;
                return `<div class="wt-sub-ev-card" data-idx="${i}" style="padding:8px 0;border-bottom:1px solid #F1F3F4;cursor:${hasDetail ? 'pointer' : 'default'};-webkit-tap-highlight-color:transparent">
                    <div style="display:flex;align-items:center;gap:6px">
                        <span style="font-size:12px;flex-shrink:0">${ev.mood || '📝'}</span>
                        <span style="flex:1;font-weight:600;font-size:12px;color:#202124">${title}</span>
                        <span class="wt-sub-ev-del" data-idx="${i}" style="cursor:pointer;color:#E53935;background:#FFEBEE;font-size:14px;font-weight:700;padding:4px 8px;border-radius:10px;margin-left:4px;touch-action:manipulation;min-width:28px;text-align:center" title="삭제">✕</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;margin-top:2px;padding-left:18px">
                        <span style="font-size:10px;color:#9AA0A6">${ev.timestamp ? this._fmt(ev.timestamp) : '—'}</span>
                        ${hasDetail ? '<span class="wt-sub-ev-arrow" style="margin-left:auto;font-size:10px;color:#B0A898;cursor:pointer">▼</span>' : ''}
                    </div>
                    ${hasDetail ? `<div class="wt-sub-ev-detail" style="display:none;margin-top:4px;padding:6px 8px;background:#FAFAF5;border-radius:6px;font-size:11px;color:#5A4030;line-height:1.6;margin-left:18px">${fullText}</div>` : ''}
                </div>`;
            }).join('');
        } else {
            evHtml = '<div style="text-align:center;padding:16px;color:#9AA0A6;font-size:11px">아직 이벤트가 없어요</div>';
        }

        const html = `<div class="wt-bs-handle" style="display:flex;justify-content:center;padding:14px 0 8px;min-height:44px;cursor:pointer"><div style="width:36px;height:4px;background:#D4D0C8;border-radius:2px"></div></div>
            <div style="padding:0 14px;overflow-y:auto">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                    <span class="wt-sub-back" data-parentid="${parentId}" style="font-size:16px;color:#9AA0A6;cursor:pointer">←</span>
                    <span style="font-size:11px;color:#9AA0A6">${parent.name}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                    <span style="font-size:22px">${emoji}</span>
                    <div>
                        <div style="font-size:17px;font-weight:800;color:#202124">${sub.name}</div>
                        <div style="font-size:11px;color:#70757A">방문 ${sub.visitCount||0}회${isCur ? ' · 현재 🐾' : ''}</div>
                    </div>
                </div>
                ${sub.memo ? `<div style="padding:8px 0;border-top:1px solid #F0EDE5"><div style="font-size:11px;color:#5A4030;font-style:italic;border-left:3px solid #D4D0C8;padding-left:8px">"${sub.memo}"</div></div>` : ''}
                <div style="padding:8px 0;border-top:1px solid #F0EDE5">
                    <div style="font-size:12px;font-weight:700;color:#202124;margin-bottom:6px">이벤트</div>
                    <div style="max-height:40vh;overflow-y:auto;-webkit-overflow-scrolling:touch">${evHtml}</div>
                </div>
            </div>`;

        bs.html(html).show().css({ background: '#fff' });
        this._applyBsStage(3); // full
        this._bindBsDrag(bs[0]);
        bs.find('.wt-bs-handle').css({ position: 'sticky', top: 0, zIndex: 10, background: '#fff' });

        const self = this;
        bs.find('.wt-sub-back').on('click', (e) => {
            e.stopPropagation();
            const pid = $(e.currentTarget).data('parentid');
            // ★ 현재 스테이지 보존 (깜빡임 방지)
            const prevStage = self._bsStage || 2;
            self._showBottomSheet(pid);
            self._applyBsStage(prevStage);
            setTimeout(() => { $('#wt-bottomsheet').find('.wt-bs-tab[data-tab="rooms"]').click(); }, 100);
        });
        // ★ 이벤트 아코디언 토글
        bs.find('.wt-sub-ev-card').on('click', function(e) {
            if ($(e.target).closest('.wt-sub-ev-del').length) return; // 삭제 버튼 클릭 시 무시
            const det = $(this).find('.wt-sub-ev-detail');
            const arrow = $(this).find('.wt-sub-ev-arrow');
            if (det.length) {
                det.slideToggle(200);
                arrow.text(det.is(':visible') ? '▲' : '▼');
            }
        });
        // ★ 이벤트 삭제
        bs.find('.wt-sub-ev-del').on('click', function(e) {
            e.stopPropagation();
            const idx = parseInt($(this).data('idx'));
            if (isNaN(idx)) return;
            sub.events.splice(idx, 1);
            self.lm.updateLocation(subId, { events: sub.events });
            self._showSubLocationDetail(parentId, subId); // 리렌더
            toastSuccess('✕ 이벤트 삭제');
        });
    }

    // ★ 바텀시트 3단계 + 터치 드래그 (구글맵 스타일)
    _bsStage = 0;
    _bsDragStartY = 0;
    _bsDragStartH = 0;
    _bsDragging = false;

    _applyBsStage(stage) {
        const bs = document.getElementById('wt-bottomsheet');
        if (!bs || bs.style.display === 'none') return;
        this._bsStage = stage;

        // #5: 모든 단계 전환 시 포커스 해제 (키보드 튀어나옴 방지)
        try { const ae = document.activeElement; if (ae && ae !== document.body) ae.blur(); } catch(_){}

        // #8: 단계 전환 후 400ms 클릭 차단 (내페이지 장소 클릭 방지)
        this._bsTransitioning = true;
        clearTimeout(this._bsTransTimer);
        this._bsTransTimer = setTimeout(() => { this._bsTransitioning = false; }, 400);

        // ★ 인라인 스타일 완전 초기화
        bs.style.cssText = 'display:block;background:#fff;position:absolute;bottom:0;left:0;right:0;z-index:2000;border-radius:16px 16px 0 0;box-shadow:0 -4px 20px rgba(0,0,0,.12);';

        if (stage === 0) { this._hideBottomSheet(); return; }

        // Stage 1/2: 검색바 보이게 (Full에서 내려올 때)
        if (stage !== 3) {
            bs.style.zIndex = '2000';
        }

        bs.style.transition = 'max-height 0.3s ease, top 0.3s ease';

        if (stage === 1) {
            bs.style.maxHeight = '80px';
            bs.style.overflowY = 'hidden';
        }
        if (stage === 2) {
            bs.style.maxHeight = '50vh';
            bs.style.overflowY = 'auto';
        }
        if (stage === 3) {
            // ★ FULL: top:0으로 늘려서 전체 덮기
            bs.style.top = '0';
            bs.style.maxHeight = 'none';
            bs.style.overflowY = 'auto';
            bs.style.borderRadius = '16px 16px 0 0'; // T1: Full에서도 radius 유지
            bs.style.zIndex = '9999';
        }
    }

    _toggleBsStage() {
        const bs = document.getElementById('wt-bottomsheet');
        if (!bs || bs.style.display === 'none') return;
        // ★ 순환: peek(1)→half(2)→full(3)→peek(1)
        const next = this._bsStage >= 3 ? 1 : this._bsStage + 1;
        this._applyBsStage(next);
    }

    // ★ 터치 드래그 전용 (클릭 이벤트 없음)
    _bsTransitioning = false;
    _bsTransTimer = null;
    _bindBsDrag(bsEl) {
        const self = this;
        const handle = bsEl.querySelector('.wt-bs-handle');
        if (!handle) return;
        let startY = 0, startH = 0, dragged = false, totalDelta = 0;
        const DRAG_THRESHOLD = 8;

        // #8: 핸들 클릭 이벤트 차단
        handle.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); });

        // ★ 공통 드래그 로직 (터치 + 마우스 둘 다 지원)
        const startDrag = (clientY) => {
            startY = clientY;
            startH = bsEl.offsetHeight;
            dragged = false;
            totalDelta = 0;
            bsEl.style.transition = 'none';
            bsEl.style.overflowY = 'hidden';
            if (self._bsStage === 3) {
                const wrapEl = bsEl.closest('#wt-leaflet-wrap') || bsEl.parentElement;
                const wrapH = wrapEl?.offsetHeight || window.innerHeight;
                bsEl.style.top = 'auto';
                bsEl.style.maxHeight = wrapH + 'px';
                startH = wrapH;
                bsEl.style.zIndex = '2000';
            }
        };

        const moveDrag = (clientY) => {
            const delta = startY - clientY;
            totalDelta = delta;
            if (Math.abs(delta) < DRAG_THRESHOLD) return;
            dragged = true;
            const newH = Math.max(40, startH + delta);
            bsEl.style.maxHeight = newH + 'px';
            bsEl.style.top = 'auto';
            bsEl.style.overflowY = newH > 100 ? 'auto' : 'hidden';
        };

        const endDrag = () => {
            if (!dragged) {
                bsEl.style.transition = 'max-height 0.3s ease, top 0.3s ease';
                let next;
                if (self._bsStage === 1) next = 2;
                else if (self._bsStage === 2) next = 3;
                else if (self._bsStage === 3) next = 2;
                else next = 1;
                self._applyBsStage(next);
                return;
            }
            const h = bsEl.offsetHeight;
            const wrapEl = bsEl.closest('#wt-leaflet-wrap') || bsEl.parentElement;
            const wrapH = wrapEl?.offsetHeight || window.innerHeight;
            bsEl.style.transition = 'max-height 0.3s ease, top 0.3s ease';
            const velocity = totalDelta;
            const s1 = 80, s2 = wrapH * 0.5, s3 = wrapH;
            if (h < 40) { self._applyBsStage(0); return; }
            if (Math.abs(velocity) > 80) {
                if (velocity > 0) {
                    if (self._bsStage === 1) self._applyBsStage(2);
                    else self._applyBsStage(3);
                } else {
                    if (self._bsStage === 3) self._applyBsStage(2);
                    else if (self._bsStage === 2) self._applyBsStage(1);
                    else self._applyBsStage(0);
                }
                return;
            }
            const d1 = Math.abs(h - s1);
            const d2 = Math.abs(h - s2);
            const d3 = Math.abs(h - s3);
            if (d1 <= d2 && d1 <= d3) { self._applyBsStage(1); }
            else if (d2 <= d3) { self._applyBsStage(2); }
            else { self._applyBsStage(3); }
        };

        // ★ 터치 이벤트 (모바일)
        handle.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            startDrag(e.touches[0].clientY);
        }, { passive: true });
        handle.addEventListener('touchmove', (e) => {
            e.preventDefault();
            moveDrag(e.touches[0].clientY);
        }, { passive: false });
        handle.addEventListener('touchend', endDrag);

        // ★ 마우스 이벤트 (웹 브라우저) — v0.6.0 NEW
        handle.style.cursor = 'grab';
        let isMouseDown = false;
        handle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            isMouseDown = true;
            handle.style.cursor = 'grabbing';
            startDrag(e.clientY);
        });
        const onMouseMove = (e) => {
            if (!isMouseDown) return;
            e.preventDefault();
            moveDrag(e.clientY);
        };
        const onMouseUp = () => {
            if (!isMouseDown) return;
            isMouseDown = false;
            handle.style.cursor = 'grab';
            endDrag();
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    _navLock = false;
    _bindBottomSheet() {
        const self = this;

        // ★ 최후의 수단: window 전역 함수 (ST DOM 간섭 완전 우회)
        window.__wtNavTab = (tab, el) => {
            if (self._navLock) return;
            self._navLock = true; setTimeout(() => self._navLock = false, 300);
            console.log('[wt] Nav tab:', tab);

            document.querySelectorAll('.wt-paw-tab span:last-child').forEach(s => { s.style.color = '#5F6368'; s.style.fontWeight = '500'; });
            if (el) { const s = el.querySelector('span:last-child'); if (s) { s.style.color = '#1A73E8'; s.style.fontWeight = '700'; } }

            // ★ 모든 탭에서 공통: 바텀시트 + 내페이지 정리
            const bs = document.getElementById('wt-bottomsheet');
            if (bs) { bs.style.display = 'none'; bs.innerHTML = ''; }
            self._bsStage = 0;
            const mp = document.getElementById('wt-paw-mypage');
            if (mp) mp.remove();

            if (tab === 'explore') {
                $('#wt-map-section').show();
                setTimeout(() => self.leafletRenderer?.invalidateSize(), 200);
                console.log('[wt] Explore: map shown');
            } else if (tab === 'mypage') {
                self._showMyPageBS();
            } else if (tab === 'timeline') {
                self._showTimelineBS();
            }
        };

        window.__wtBsHandle = () => {
            self._toggleBsStage();
        };

        // ★ 뒤로가기 → 약도로 전환
        window.__wtBackToMap = () => {
            // (v0.6.0 deprecated — 유지만, 약도 모드 전환 없음)
            self._hideBottomSheet();
        };
        // v0.6.0: 지도 닫기 (패널 자체 닫기)
        window.__wtCloseMap = () => {
            self._hideBottomSheet();
            self.togglePanel(false);
        };

        // 지도 클릭 → 바텀시트 peek 복귀 (T1: 닫기 대신 peek)
        $(document).off('click.wtMap', '#wt-leaflet-container').on('click.wtMap', '#wt-leaflet-container', (e) => {
            if ($(e.target).closest('.wt-bs, .wt-bs-handle, .wt-gmap-pin, .leaflet-marker-icon, .leaflet-popup').length) return;
            if (self._bsStage > 1) {
                self._applyBsStage(1); // peek으로 복귀
            } else if (self._bsStage === 1) {
                self._hideBottomSheet(); // peek 상태에서 한번 더 누르면 닫기
            }
        });
    }

    // ========== 🔖 내 페이지 (바텀시트 형식) ==========
    _showMyPageBS() {
        $('#wt-paw-mypage').remove();
        const locs = [...this.lm.locations].sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0));
        const totalVisits = locs.reduce((s, l) => s + (l.visitCount || 0), 0);
        const mostVisited = locs.length ? [...locs].sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0))[0] : null;

        // 카테고리별 카운트
        const tagCounts = {
            favorites: locs.filter(l => (l.tags || []).includes('favorites')).length,
            starred: locs.filter(l => (l.tags || []).includes('starred')).length,
            wantToGo: locs.filter(l => (l.tags || []).includes('wantToGo')).length,
            travel: locs.filter(l => (l.tags || []).includes('travel')).length,
        };

        let recentHtml = locs.filter(l => l.visitCount > 0).slice(0, 5).map(l => {
            const st = this.leafletRenderer?._locStyle?.(l.name) || { emoji: '📍' };
            const tags = (l.tags || []).map(t => {
                const icons = { favorites: '💜', starred: '⭐', wantToGo: '🚩', travel: '🧳' };
                return icons[t] || '';
            }).join('');
            return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #F1F3F4;cursor:pointer" class="wt-mp-loc" data-id="${l.id}">
                <div style="width:28px;height:28px;border-radius:50%;background:#F1F3F4;display:flex;align-items:center;justify-content:center;font-size:14px">${st.emoji}</div>
                <div style="flex:1"><div style="font-size:12px;font-weight:600;color:#202124">${l.name}${tags ? ' ' + tags : ''}</div><div style="font-size:10px;color:#70757A">방문 ${l.visitCount||0}회</div></div>
                <span style="font-size:14px;color:#9AA0A6">›</span>
            </div>`;
        }).join('');

        // 미방문 장소 (미래 등록)
        const unvisited = locs.filter(l => !l.visitCount || l.visitCount === 0);
        let unvisitedHtml = '';
        if (unvisited.length) {
            unvisitedHtml = `<div style="font-size:12px;font-weight:700;color:#202124;margin:14px 0 4px">🔮 미방문 장소</div>` +
                unvisited.map(l => {
                    const st = this.leafletRenderer?._locStyle?.(l.name) || { emoji: '📍' };
                    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #F1F3F4;cursor:pointer;opacity:.7" class="wt-mp-loc" data-id="${l.id}">
                        <div style="width:28px;height:28px;border-radius:50%;background:#F1F3F4;display:flex;align-items:center;justify-content:center;font-size:14px">${st.emoji}</div>
                        <div style="flex:1"><div style="font-size:12px;font-weight:600;color:#202124">${l.name}</div><div style="font-size:10px;color:#9AA0A6">미방문</div></div>
                        <span style="font-size:14px;color:#9AA0A6">›</span>
                    </div>`;
                }).join('');
        }

        const html = `<div class="wt-bs-handle" style="display:flex;justify-content:center;padding:14px 0 8px;min-height:44px;cursor:pointer"><div style="width:32px;height:4px;background:#D4D0C8;border-radius:2px"></div></div>
            <div style="padding:8px 14px;overflow-y:auto">
                <div style="font-size:16px;font-weight:800;color:#202124;margin-bottom:8px">내 페이지</div>
                <div style="display:flex;gap:6px;margin-bottom:12px;overflow-x:auto">
                    <div style="padding:8px 12px;background:#F8F9FA;border-radius:10px;border:1px solid #E8EAED;white-space:nowrap;min-width:60px;text-align:center"><div style="font-size:16px;font-weight:800;color:#2B8A6E">${locs.length}</div><div style="font-size:8px;color:#70757A">총 장소</div></div>
                    <div style="padding:8px 12px;background:#F8F9FA;border-radius:10px;border:1px solid #E8EAED;white-space:nowrap;min-width:60px;text-align:center"><div style="font-size:16px;font-weight:800;color:#2B8A6E">${totalVisits}</div><div style="font-size:8px;color:#70757A">총 방문</div></div>
                    <div style="padding:8px 12px;background:#F8F9FA;border-radius:10px;border:1px solid #E8EAED;white-space:nowrap;min-width:60px;text-align:center;overflow:hidden;text-overflow:ellipsis"><div style="font-size:14px;font-weight:800;color:#2B8A6E;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${mostVisited?.name||'—'}</div><div style="font-size:8px;color:#70757A">최다 방문</div></div>
                </div>
                <div style="font-size:12px;font-weight:700;color:#202124;margin-bottom:4px">최근 방문한 장소</div>
                ${recentHtml || '<div style="padding:12px;text-align:center;color:#9AA0A6;font-size:11px">아직 없어요</div>'}
                ${unvisitedHtml}
                <div style="font-size:12px;font-weight:700;color:#202124;margin:14px 0 6px;display:flex;justify-content:space-between;align-items:center">
                    내 목록
                    <span class="wt-mp-addloc" style="font-size:10px;color:#1A73E8;font-weight:500;cursor:pointer">+ 장소 등록</span>
                </div>
                <div class="wt-mp-list-item" data-tag="favorites" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #F1F3F4;cursor:pointer;-webkit-tap-highlight-color:transparent">
                    <span style="font-size:16px">💜</span>
                    <div style="flex:1"><div style="font-size:12px;font-weight:600">즐겨찾는 장소</div><div style="font-size:10px;color:#70757A">${tagCounts.favorites}곳</div></div>
                    <span style="color:#9AA0A6;font-size:14px">›</span>
                </div>
                <div class="wt-mp-list-item" data-tag="starred" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #F1F3F4;cursor:pointer;-webkit-tap-highlight-color:transparent">
                    <span style="font-size:16px">⭐</span>
                    <div style="flex:1"><div style="font-size:12px;font-weight:600">별표표시된 장소</div><div style="font-size:10px;color:#70757A">${tagCounts.starred}곳</div></div>
                    <span style="color:#9AA0A6;font-size:14px">›</span>
                </div>
                <div class="wt-mp-list-item" data-tag="wantToGo" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #F1F3F4;cursor:pointer;-webkit-tap-highlight-color:transparent">
                    <span style="font-size:16px">🚩</span>
                    <div style="flex:1"><div style="font-size:12px;font-weight:600">가고 싶은 장소</div><div style="font-size:10px;color:#70757A">${tagCounts.wantToGo}곳</div></div>
                    <span style="color:#9AA0A6;font-size:14px">›</span>
                </div>
                <div class="wt-mp-list-item" data-tag="travel" style="display:flex;align-items:center;gap:10px;padding:10px 0;cursor:pointer;-webkit-tap-highlight-color:transparent">
                    <span style="font-size:16px">🧳</span>
                    <div style="flex:1"><div style="font-size:12px;font-weight:600">여행 계획</div><div style="font-size:10px;color:#70757A">${tagCounts.travel}곳</div></div>
                    <span style="color:#9AA0A6;font-size:14px">›</span>
                </div>
            </div>`;

        const bs = $('#wt-bottomsheet');
        bs.html(html).show().css({ background: '#fff' });
        this._applyBsStage(2); // half — 타임라인과 동일 높이
        this._bindBsDrag(bs[0]);
        bs.find('.wt-bs-handle').css({ position: 'sticky', top: 0, zIndex: 10, background: '#fff' });

        const self = this;
        // 최근 방문 장소 클릭 → 바텀시트
        bs.find('.wt-mp-loc').on('click', function(e) {
            if (self._bsTransitioning) { e.stopPropagation(); return; }
            const id = $(this).data('id');
            self._hideBottomSheet();
            $('.wt-paw-tab[data-tab="explore"]').click();
            setTimeout(() => self._showBottomSheet(id), 300);
        });
        // 카테고리 목록 클릭 → 해당 태그 장소 리스트
        bs.find('.wt-mp-list-item').on('click', function(e) {
            console.log(`[${EXTENSION_NAME}] 🔧 tag list clicked: transitioning=${self._bsTransitioning}`);
            if (self._bsTransitioning) { e.stopPropagation(); return; }
            const tag = $(this).data('tag');
            console.log(`[${EXTENSION_NAME}] 🔧 opening tag list: ${tag}`);
            self._showTagList(tag);
        });
        // + 장소 등록
        bs.find('.wt-mp-addloc').on('click', (e) => {
            e.stopPropagation();
            this._showAddLocationPopup();
        });
    }

    // ========== 태그별 장소 리스트 ==========
    _showTagList(tag) {
        const tagNames = { favorites: '💜 즐겨찾는 장소', starred: '⭐ 별표표시된 장소', wantToGo: '🚩 가고 싶은 장소', travel: '🧳 여행 계획' };
        const tagged = this.lm.locations.filter(l => (l.tags || []).includes(tag));
        const bs = $('#wt-bottomsheet');

        let listHtml = '';
        if (tagged.length) {
            listHtml = tagged.map(l => {
                const st = this.leafletRenderer?._locStyle?.(l.name) || { emoji: '📍' };
                return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #F1F3F4;cursor:pointer" class="wt-tl-loc" data-id="${l.id}">
                    <div style="width:28px;height:28px;border-radius:50%;background:#F1F3F4;display:flex;align-items:center;justify-content:center;font-size:14px">${st.emoji}</div>
                    <div style="flex:1"><div style="font-size:12px;font-weight:600;color:#202124">${l.name}</div><div style="font-size:10px;color:#70757A">${l.visitCount ? '방문 ' + l.visitCount + '회' : '미방문'}</div></div>
                    <button class="wt-tl-untag" data-id="${l.id}" data-tag="${tag}" style="border:none;background:#F5A8A8;border-radius:6px;padding:4px 8px;font-size:10px;color:#501313;cursor:pointer;font-family:inherit">삭제</button>
                </div>`;
            }).join('');
        } else {
            listHtml = '<div style="padding:24px;text-align:center;color:#9AA0A6;font-size:12px">아직 등록된 장소가 없어요<br><span style="font-size:11px">바텀시트에서 장소를 태그해보세요!</span></div>';
        }

        const html = `<div class="wt-bs-handle" style="display:flex;justify-content:center;padding:14px 0 8px;min-height:44px;cursor:pointer"><div style="width:32px;height:4px;background:#D4D0C8;border-radius:2px"></div></div>
            <div style="padding:8px 14px;overflow-y:auto">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
                    <span onclick="window.__wtNavTab&&window.__wtNavTab('mypage',document.querySelector('.wt-paw-tab[data-tab=mypage]'))" style="font-size:18px;cursor:pointer;color:#9AA0A6">←</span>
                    <div style="font-size:15px;font-weight:800;color:#202124">${tagNames[tag] || tag}</div>
                    <span style="font-size:11px;color:#9AA0A6;margin-left:auto">${tagged.length}곳</span>
                </div>
                ${listHtml}
            </div>`;

        bs.html(html).show().css({ background: '#fff' });
        this._applyBsStage(2);
        this._bindBsDrag(bs[0]);
        bs.find('.wt-bs-handle').css({ position: 'sticky', top: 0, zIndex: 10, background: '#fff' });

        const self = this;
        bs.find('.wt-tl-loc').on('click', function(e) {
            if ($(e.target).closest('.wt-tl-untag').length) return;
            if (self._bsTransitioning) { e.stopPropagation(); return; }
            const id = $(this).data('id');
            self._hideBottomSheet();
            $('.wt-paw-tab[data-tab="explore"]').click();
            setTimeout(() => self._showBottomSheet(id), 300);
        });
        // 태그 삭제
        bs.find('.wt-tl-untag').on('click', async function(e) {
            e.stopPropagation();
            const locId = $(this).data('id');
            const t = $(this).data('tag');
            const loc = self.lm.locations.find(l => l.id === locId);
            if (loc) {
                loc.tags = (loc.tags || []).filter(x => x !== t);
                await self.lm.updateLocation(locId, { tags: loc.tags });
                self._showTagList(t); // 리스트 리렌더
                toastSuccess('🏷️ 태그 해제!');
            }
        });
    }

    // ========== 📏 거리 측정 (바텀시트 "거리" 버튼) ==========
    _showDistanceMeasure(locId) {
        const loc = this.lm.locations.find(l => l.id === locId);
        if (!loc) return;
        const others = this.lm.locations.filter(l => l.id !== locId && !l.parentId);
        if (!others.length) { toastSuccess('📏 다른 장소가 없어요!'); return; }

        const self = this;
        const bs = $('#wt-bottomsheet');

        let listHtml = others.map(o => {
            const existing = this.lm.getDistanceBetween(locId, o.id);
            const st = this.leafletRenderer?._locStyle?.(o.name) || { emoji: '📍' };

            let autoInfo = '';
            if (loc.lat && loc.lng && o.lat && o.lng) {
                const R = 6371000;
                const dLat = (o.lat - loc.lat) * Math.PI / 180;
                const dLon = (o.lng - loc.lng) * Math.PI / 180;
                const a = Math.sin(dLat/2)**2 + Math.cos(loc.lat*Math.PI/180) * Math.cos(o.lat*Math.PI/180) * Math.sin(dLon/2)**2;
                const meters = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
                const walkMin = Math.max(1, Math.round((meters * 1.4) / 80));
                autoInfo = `<span style="font-size:10px;color:#2B8A6E;font-weight:500">${meters}m · 도보 ${walkMin}분</span>`;
            }

            const savedInfo = existing ? `<span style="font-size:10px;color:#9AA0A6">저장: ${existing.distanceText || ''}</span>` : '';

            return `<div class="wt-dist-item" data-id="${o.id}" style="display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid #F1F3F4;cursor:pointer;-webkit-tap-highlight-color:transparent">
                <span style="font-size:16px">${st.emoji}</span>
                <div style="flex:1;min-width:0">
                    <div style="font-size:13px;font-weight:600;color:#202124;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${o.name}</div>
                    <div style="display:flex;gap:8px;align-items:center">${autoInfo}${savedInfo}</div>
                </div>
                <span style="font-size:12px;color:#9AA0A6">›</span>
            </div>`;
        }).join('');

        const html = `<div class="wt-bs-handle" style="display:flex;justify-content:center;padding:14px 0 8px;min-height:44px;cursor:pointer;position:sticky;top:0;z-index:10;background:#fff;border-radius:16px 16px 0 0"><div style="width:36px;height:4px;background:#D4D0C8;border-radius:2px"></div></div>
            <div style="padding:8px 14px;overflow-y:auto">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
                    <span class="wt-dist-back" data-locid="${locId}" style="font-size:18px;cursor:pointer;color:#9AA0A6">←</span>
                    <div style="font-size:15px;font-weight:800;color:#202124">📏 ${loc.name}에서의 거리</div>
                </div>
                ${listHtml}
            </div>`;

        bs.html(html).show().css({ background: '#fff' });
        this._applyBsStage(2);
        this._bindBsDrag(bs[0]);

        // ← 뒤로가기
        bs.find('.wt-dist-back').on('click', (e) => {
            e.stopPropagation();
            const lid = $(e.currentTarget).data('locid');
            self._showBottomSheet(lid);
        });

        // 장소 클릭 → 거리 자동 저장
        bs.find('.wt-dist-item').on('click', async function() {
            const otherId = $(this).data('id');
            const other = self.lm.locations.find(l => l.id === otherId);
            if (!other) return;

            if (loc.lat && loc.lng && other.lat && other.lng) {
                const R = 6371000;
                const dLat = (other.lat - loc.lat) * Math.PI / 180;
                const dLon = (other.lng - loc.lng) * Math.PI / 180;
                const a = Math.sin(dLat/2)**2 + Math.cos(loc.lat*Math.PI/180) * Math.cos(other.lat*Math.PI/180) * Math.sin(dLon/2)**2;
                const meters = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
                const walkMin = Math.max(1, Math.round((meters * 1.4) / 80));
                const distText = `도보 ${walkMin}분`;
                const level = walkMin <= 1 ? 1 : walkMin <= 3 ? 2 : walkMin <= 5 ? 3 : walkMin <= 8 ? 4 : walkMin <= 12 ? 5 : walkMin <= 15 ? 6 : walkMin <= 20 ? 7 : walkMin <= 30 ? 8 : 9;

                await self.lm.setDistance(locId, otherId, distText, null, level);
                toastSuccess(`📏 ${loc.name} ↔ ${other.name}: ${meters}m (${distText})`);
                self.pi?.inject();
                // 리스트 리렌더
                self._showDistanceMeasure(locId);
            } else {
                self._showBottomSheet(locId);
                setTimeout(() => { self._hideBottomSheet(); self.showPop(locId); }, 200);
                toastSuccess('📏 좌표가 없어서 수동 설정으로 이동합니다');
            }
        });
    }

    // ========== 태그 토글 팝업 (바텀시트 "저장됨" 버튼) ==========
    _showTagPopup(locId, btnEl) {
        $('#wt-tag-popup').remove();
        const loc = this.lm.locations.find(l => l.id === locId);
        if (!loc) return;
        const tags = loc.tags || [];
        const allTags = [
            { key: 'favorites', icon: '💜', label: '즐겨찾기' },
            { key: 'starred', icon: '⭐', label: '별표' },
            { key: 'wantToGo', icon: '🚩', label: '가고싶은곳' },
            { key: 'travel', icon: '🧳', label: '여행계획' },
        ];

        const items = allTags.map(t => {
            const on = tags.includes(t.key);
            return `<div class="wt-tag-item" data-key="${t.key}" style="display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;border-radius:8px;background:${on ? '#E8F4F0' : 'transparent'};-webkit-tap-highlight-color:transparent">
                <span style="font-size:16px">${t.icon}</span>
                <span style="font-size:12px;font-weight:${on ? '700' : '400'};color:${on ? '#2B8A6E' : '#5A4030'};flex:1">${t.label}</span>
                <span style="font-size:14px">${on ? '✓' : ''}</span>
            </div>`;
        }).join('');

        const popup = $(`<div id="wt-tag-popup" style="position:absolute;bottom:auto;top:120px;left:14px;right:14px;background:#fff;border:1.5px solid #E8E4D8;border-radius:12px;padding:6px;z-index:9999;box-shadow:0 6px 20px rgba(0,0,0,.15);font-family:-apple-system,'Noto Sans KR',sans-serif">
            <div style="font-size:11px;color:#9A8A7A;padding:4px 10px 6px;font-weight:500">목록에 저장</div>
            ${items}
        </div>`);

        $('#wt-bottomsheet').append(popup);
        const self = this;

        popup.find('.wt-tag-item').on('click', async function() {
            const key = $(this).data('key');
            let curTags = loc.tags || [];
            if (curTags.includes(key)) {
                curTags = curTags.filter(t => t !== key);
            } else {
                curTags.push(key);
            }
            loc.tags = curTags;
            await self.lm.updateLocation(locId, { tags: curTags });
            // 리렌더 팝업
            popup.remove();
            self._showTagPopup(locId, btnEl);
            // 저장됨 버튼 텍스트 업데이트
            const tagIcons = curTags.map(t => {
                const icons = { favorites: '💜', starred: '⭐', wantToGo: '🚩', travel: '🧳' };
                return icons[t] || '';
            }).join('');
            btnEl.html(tagIcons ? `🔖 ${tagIcons}` : '🔖 저장');
            console.log(`[${EXTENSION_NAME}] 🔧 tag toggle: "${loc.name}" tags=${curTags}`);
        });

        // 바깥 클릭 → 닫기
        setTimeout(() => {
            $(document).one('click.wtTagPopup', (e) => {
                if (!$(e.target).closest('#wt-tag-popup').length) popup.remove();
            });
        }, 100);
    }

    // ========== 장소 추가 팝업 (#7 미래 장소 등록) ==========
    _showAddLocationPopup() {
        $('#wt-addloc-popup').remove();
        const popup = $(`<div id="wt-addloc-popup" style="position:absolute;top:60px;left:14px;right:14px;background:#fff;border:2px solid #F6A93A;border-radius:14px;padding:14px;z-index:9999;box-shadow:0 6px 24px rgba(0,0,0,.15);font-family:-apple-system,'Noto Sans KR',sans-serif">
            <div style="font-size:14px;font-weight:700;color:#775537;margin-bottom:8px">📍 새 장소 등록</div>
            <input type="text" id="wt-addloc-name" placeholder="장소 이름" style="width:100%;padding:8px 10px;border:1.5px solid #E8E4D8;border-radius:8px;font-size:13px;font-family:inherit;margin-bottom:6px;box-sizing:border-box"/>
            <input type="text" id="wt-addloc-addr" placeholder="주소 (선택 — 비우면 자동 지정)" style="width:100%;padding:8px 10px;border:1.5px solid #E8E4D8;border-radius:8px;font-size:12px;font-family:inherit;margin-bottom:6px;box-sizing:border-box;color:#5A4030"/>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">
                <label style="display:flex;align-items:center;gap:3px;font-size:11px;color:#5A4030;cursor:pointer"><input type="checkbox" class="wt-addloc-tag" value="wantToGo"/> 🚩 가고싶은곳</label>
                <label style="display:flex;align-items:center;gap:3px;font-size:11px;color:#5A4030;cursor:pointer"><input type="checkbox" class="wt-addloc-tag" value="favorites"/> 💜 즐겨찾기</label>
                <label style="display:flex;align-items:center;gap:3px;font-size:11px;color:#5A4030;cursor:pointer"><input type="checkbox" class="wt-addloc-tag" value="travel"/> 🧳 여행계획</label>
            </div>
            <div style="display:flex;gap:6px">
                <button id="wt-addloc-ok" style="flex:1;padding:8px;background:#F7EC8D;border:1.5px solid #F6A93A;border-radius:8px;font-size:12px;font-weight:600;color:#775537;cursor:pointer;font-family:inherit">✚ 등록</button>
                <button id="wt-addloc-cancel" style="flex:1;padding:8px;background:#fff;border:1.5px solid #E8E4D8;border-radius:8px;font-size:12px;color:#9A8A7A;cursor:pointer;font-family:inherit">취소</button>
            </div>
        </div>`);

        $('#wt-bottomsheet').append(popup);
        const self = this;

        popup.find('#wt-addloc-ok').on('click', async () => {
            const name = popup.find('#wt-addloc-name').val().trim();
            if (!name) { popup.find('#wt-addloc-name').css('borderColor', '#F5A8A8'); return; }
            const addr = popup.find('#wt-addloc-addr').val().trim();
            const tags = [];
            popup.find('.wt-addloc-tag:checked').each(function() { tags.push($(this).val()); });

            const loc = await self.lm.addLocation(name);
            if (loc) {
                const updates = {};
                if (tags.length) updates.tags = tags;
                // 주소 입력 → Nominatim 검색해서 좌표도 저장
                if (addr) {
                    updates.address = addr;
                    try {
                        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1`, { headers: { 'User-Agent': 'RP-World-Tracker/0.3' } });
                        const data = await res.json();
                        if (data?.[0]) {
                            updates.lat = parseFloat(data[0].lat);
                            updates.lng = parseFloat(data[0].lon);
                            console.log(`[${EXTENSION_NAME}] 🔧 addLoc geocode: "${addr}" → (${updates.lat},${updates.lng})`);
                        }
                    } catch(e) { console.warn(`[${EXTENSION_NAME}] 🔧 addLoc geocode failed:`, e.message); }
                }
                if (Object.keys(updates).length) await self.lm.updateLocation(loc.id, updates);
            }
            popup.remove();
            self._showMyPageBS();
            toastSuccess(`📍 "${name}" 등록!`);
            // 거리 자동 계산
            try { await self.lm.autoCalcDistances(); } catch(_){}
            console.log(`[${EXTENSION_NAME}] 🔧 addLocation from MyPage: "${name}" addr="${addr}" tags=${tags}`);
        });
        popup.find('#wt-addloc-cancel').on('click', () => popup.remove());
        popup.find('#wt-addloc-name').focus();
    }

    // ========== 🕐 타임라인 (아코디언 — 오늘 펼침, 과거 접힘) ==========
    _showTimelineBS() {
        const bs = $('#wt-bottomsheet');
        const movements = [...(this.lm.movements || [])].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const locs = this.lm.locations;
        const dists = this.lm.distances || [];
        const curLocId = this.lm.currentLocationId;

        // 날짜별 그룹핑 — ★ rpDate 우선, 없으면 실제 날짜
        const groups = new Map();
        const _dayKey = (mov) => {
            if (mov.rpDate) {
                // rpDate: "2024/12/19" → "2024.12.19"
                return mov.rpDate.replace(/\//g, '.');
            }
            const d = new Date(mov.timestamp);
            return `${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()}`;
        };
        const _dayLabel = (mov) => {
            if (mov.rpDate) {
                const parts = mov.rpDate.split('/').map(Number);
                if (parts.length >= 3) {
                    const d = new Date(parts[0], parts[1]-1, parts[2]);
                    const wk = ['일','월','화','수','목','금','토'][d.getDay()];
                    return `${parts[0]}.${parts[1]}.${parts[2]} (${wk})`;
                }
                return mov.rpDate;
            }
            const d = new Date(mov.timestamp);
            const wk = ['일','월','화','수','목','금','토'][d.getDay()];
            return `${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()} (${wk})`;
        };

        for (const mov of movements) {
            const key = _dayKey(mov);
            if (!groups.has(key)) groups.set(key, { label: _dayLabel(mov), items: [], ts: mov.timestamp, rpDate: mov.rpDate || '' });
            groups.get(key).items.push(mov);
        }

        // 현재 위치도 타임라인에 추가 — 최신 rpDate 사용
        const curLoc = locs.find(l => l.id === curLocId);
        const latestRpDate = movements.length ? (movements[0].rpDate || '') : '';
        const curMov = { toId: curLocId, timestamp: Date.now(), rpDate: latestRpDate, _isCurrent: true };
        const todayKey = _dayKey(curMov);
        if (curLoc) {
            if (!groups.has(todayKey)) groups.set(todayKey, { label: _dayLabel(curMov), items: [], ts: Date.now(), rpDate: latestRpDate });
            const g = groups.get(todayKey);
            if (!g.items.some(m => m._isCurrent)) {
                g.items.unshift(curMov);
            }
        }

        // 날짜 내림차순 정렬
        const sorted = [...groups.entries()].sort((a, b) => b[1].ts - a[1].ts);

        // 통계
        let totalPlaces = 0, totalEvents = 0;

        // 날짜별 HTML 빌드
        let timelineHtml = '';
        let dayIdx = 0;
        for (const [dayKey, group] of sorted) {
            const isToday = dayIdx === 0; // ★ 가장 최근 날짜 = "오늘"
            const isRpDate = group.rpDate ? true : false;
            const items = group.items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

            // 이 날의 통계
            const dayLocIds = new Set();
            let dayEventCount = 0;
            for (const mov of items) {
                if (mov.toId) dayLocIds.add(mov.toId);
                const toLoc = locs.find(l => l.id === mov.toId);
                if (toLoc?.events) {
                    dayEventCount += toLoc.events.filter(e => e.timestamp && Math.abs(e.timestamp - mov.timestamp) < 3600000).length;
                }
            }
            totalPlaces += dayLocIds.size;
            totalEvents += dayEventCount;

            const summaryText = `${dayLocIds.size}곳${dayEventCount ? ' · 이벤트 ' + dayEventCount : ''}`;
            const dayId = 'wt-tl-' + dayIdx;

            // 날짜 헤더
            timelineHtml += `<div style="border-top:${dayIdx > 0 ? '1px solid #F0EDE5' : 'none'}">
                <div onclick="window.__wtTlToggle&&window.__wtTlToggle('${dayId}')" style="display:flex;align-items:center;gap:8px;padding:10px 16px;cursor:pointer;-webkit-tap-highlight-color:transparent">
                    <span style="font-size:14px">📅</span>
                    <span style="font-size:13px;font-weight:800;color:#202124">${group.label}</span>
                    ${isToday ? '<span style="font-size:9px;padding:2px 6px;border-radius:8px;background:#E8F5E9;color:#2E7D32;font-weight:500">오늘</span>' : ''}
                    <span style="font-size:11px;color:#9AA0A6;margin-left:auto;display:flex;align-items:center;gap:6px">
                        <span>${summaryText}</span>
                        <span id="${dayId}-arr" style="font-size:12px;color:#B0A898">${isToday ? '▾' : '▸'}</span>
                    </span>
                </div>
                <div id="${dayId}-body" style="${isToday ? '' : 'height:0;overflow:hidden'}">`;

            // 아이템들
            for (let i = 0; i < items.length; i++) {
                const mov = items[i];
                const toLoc = locs.find(l => l.id === mov.toId);
                if (!toLoc) continue;

                const fromLoc = mov.fromId ? locs.find(l => l.id === mov.fromId) : null;
                const st = this.leafletRenderer?._locStyle?.(toLoc.name) || { emoji: '📍' };
                const time = new Date(mov.timestamp);
                const timeStr = time.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                const isCurrent = mov._isCurrent;

                const locEvents = (toLoc.events || []).filter(e => e.timestamp && Math.abs(e.timestamp - mov.timestamp) < 3600000);
                const dotColor = isCurrent ? '#EA4335' : locEvents.length ? '#F6A93A' : '#2B8A6E';

                timelineHtml += `<div style="display:flex;gap:12px;padding:6px 16px;position:relative">
                    <div style="width:2px;background:#E0E0E0;position:absolute;left:27px;top:0;bottom:0"></div>
                    <div style="width:10px;height:10px;border-radius:50%;background:${dotColor};flex-shrink:0;margin-top:4px;z-index:1;border:2px solid #fff;box-shadow:0 0 0 2px ${dotColor}"></div>
                    <div style="flex:1">
                        <div style="font-size:10px;color:#9AA0A6;font-weight:500">${timeStr}${isCurrent ? ' — 현재' : ''}</div>
                        <div style="font-size:13px;font-weight:600;color:#202124;margin-top:1px">${st.emoji} ${toLoc.name}</div>
                        ${toLoc.memo ? `<div style="font-size:11px;color:#70757A;margin-top:2px">${toLoc.memo}</div>` : ''}
                        ${locEvents.map(ev => `<div style="display:inline-flex;align-items:center;gap:3px;padding:3px 8px;background:#FFF8E1;border-radius:12px;font-size:10px;color:#F57F17;font-weight:500;margin-top:4px">${ev.mood || '📝'} ${ev.title || (ev.text?.substring(0,20) || '')}</div>`).join('')}
                    </div>
                </div>`;

                // 이동 거리 표시
                if (i < items.length - 1 && fromLoc) {
                    const dist = dists.find(d =>
                        (d.fromId === mov.fromId && d.toId === mov.toId) ||
                        (d.toId === mov.fromId && d.fromId === mov.toId)
                    );
                    if (dist?.distanceText) {
                        timelineHtml += `<div style="display:flex;align-items:center;gap:6px;padding:2px 16px 2px 22px;font-size:10px;color:#9AA0A6"><span style="font-size:12px">↑</span> ${dist.distanceText}</div>`;
                    }
                }
            }

            timelineHtml += '</div></div>'; // close body + day wrapper
            dayIdx++;
        }

        if (!sorted.length) {
            timelineHtml = '<div style="padding:30px;text-align:center;color:#9AA0A6;font-size:13px">🕐 아직 이동 기록이 없어요<br><span style="font-size:11px;margin-top:4px;display:inline-block">RP를 진행하면 자동으로 기록돼요!</span></div>';
        } else {
            timelineHtml += `<div style="padding:16px;text-align:center;color:#9AA0A6;font-size:11px">— ${sorted.length}일간 ${totalPlaces}곳 방문 · 이벤트 ${totalEvents}건 —</div>`;
        }

        // ★ 예정 일정 모아보기
        const allPlans = [];
        for (const loc of this.lm.locations) {
            if (!loc.events) continue;
            for (const ev of loc.events) {
                if (ev.isPlan) allPlans.push({ ...ev, locName: loc.name });
            }
        }
        let planHtml = '';
        if (allPlans.length) {
            planHtml = `<div style="margin:0 16px;padding-top:10px;border-top:1.5px dashed #E0DDD5">
                <div style="display:flex;align-items:center;gap:5px;margin-bottom:8px">
                    <span style="font-size:12px">🗓️</span>
                    <span style="font-size:11px;font-weight:700;color:#B0A898">예정된 일정</span>
                    <span style="font-size:9px;color:#C0B8A8;background:#F0EDE5;padding:1px 6px;border-radius:8px">${allPlans.length}건</span>
                </div>
                ${allPlans.map(p => `<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid #F5F5F5;opacity:0.6">
                    <div style="width:12px;height:12px;border-radius:50%;border:2.5px dashed #B0B0B0;background:#fff;margin-top:3px;flex-shrink:0"></div>
                    <div>
                        <div style="font-size:10px;color:#B0B0B0;font-weight:500">${p.planDate ? p.planDate + ' (' + (p.planWhen || '') + ')' : (p.planWhen || '')}</div>
                        <div style="font-size:13px;font-weight:600;color:#888">${p.locName ? '📍 ' + p.locName : ''}</div>
                        <div style="font-size:10px;color:#AAA;margin-top:1px">${p.text || ''}</div>
                    </div>
                </div>`).join('')}
            </div>`;
        }

        const html = `<div class="wt-bs-handle" style="display:flex;justify-content:center;padding:18px 0 12px;cursor:pointer;min-height:48px;position:sticky;top:0;z-index:10;background:#fff;border-radius:16px 16px 0 0;-webkit-tap-highlight-color:transparent"><div style="width:36px;height:4px;background:#D4D0C8;border-radius:2px"></div></div>
            <div style="padding:2px 0 0"><div style="font-size:16px;font-weight:800;color:#202124;padding:0 16px 6px">타임라인</div></div>
            ${timelineHtml}
            ${planHtml}`;

        bs.html(html).show().css({ background: '#fff' });
        this._applyBsStage(2);
        this._bindBsDrag(bs[0]);

        // 아코디언 토글 전역 함수
        window.__wtTlToggle = (dayId) => {
            const body = document.getElementById(dayId + '-body');
            const arrow = document.getElementById(dayId + '-arr');
            if (!body || !arrow) return;
            if (body.style.height === '0px') {
                body.style.height = 'auto';
                body.style.overflow = 'visible';
                arrow.textContent = '▾';
            } else {
                body.style.height = '0px';
                body.style.overflow = 'hidden';
                arrow.textContent = '▸';
            }
        };
    }

    async _popSave() {
        const id=$('#wt-popover').attr('data-id');
        const newName = $('#wt-pop-title').val().trim();
        const aliases = $('#wt-pop-aliases').val().split(',').map(a=>a.trim()).filter(Boolean);
        const update = {
            memo:$('#wt-pop-memo').val().trim(),
            aliases: aliases,
            aiNotes:$('#wt-pop-ainotes').val().trim(),
            locationType: $('#wt-pop-icon-type').val() || '',
        };
        // 이름 변경
        if (newName) update.name = newName;
        await this.lm.updateLocation(id, update);
        toastSuccess('저장!'); this.pi?.inject(); this.refresh();
    }
    async _popDel() { const id=$('#wt-popover').attr('data-id'); const l=this.lm.locations.find(x=>x.id===id); if(!confirm(`"${l?.name}" 삭제?`))return; await this.lm.deleteLocation(id); this.hidePop(); this.pi?.inject(); this.refresh(); }
    // Bug E: 위치 수정 → 노드 이동모드 진입 (캐릭터 이동이 아닌 노드 좌표 이동)
    async _popMove() {
        const id = $('#wt-popover').attr('data-id');
        const loc = this.lm.locations.find(l => l.id === id);
        if (!loc) return;
        this.hidePop();
        // 맵 모드면 노드 이동모드 진입
        if (this.mapRenderer) {
            this.mapRenderer._movingNodeId = id;
            wtNotify(`📍 "${loc.name}" 이동 모드 — 맵을 터치하세요`, 'info', 3000);
        }
    }

    // ========== 등록 알림 (플로팅 오버레이) ==========
    showAutoToast(loc) {
        $('#wt-register-overlay').remove(); // 이전 제거

        // Bug G+I: 채팅 화면이 아니면 알림 안 띄움
        const sendBtn = document.querySelector('#send_but');
        if (!sendBtn || sendBtn.offsetParent === null) return;

        const sim = this._findSim(loc.name);
        let simHtml = '';
        if (sim.length) {
            const simBtns = sim.filter(s => s.id !== loc.id).map(s =>
                `<button class="wt-reg-merge" data-sid="${s.id}" data-sname="${s.name}" style="padding:4px 10px;background:#5E84E2;border:none;border-radius:6px;font-size:11px;color:#fff;cursor:pointer;font-family:inherit">📎 "${s.name}"에 병합</button>`
            ).join('');
            if (simBtns) simHtml = `<div style="margin-top:4px"><div style="font-size:10px;color:#9A8A7A;margin-bottom:3px">혹시 같은 장소?</div>${simBtns}</div>`;
        }

        const overlay = $(`<div id="wt-register-overlay" style="position:fixed;top:60px;left:50%;transform:translateX(-50%);width:320px;max-width:90vw;background:rgba(245,244,237,0.98);border:2px solid #F6A93A;border-radius:14px;padding:10px 14px;z-index:2147483646;box-shadow:0 6px 24px rgba(0,0,0,0.2);backdrop-filter:blur(8px);font-family:-apple-system,'Noto Sans KR',sans-serif">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
                <span style="font-size:16px">${wtMascot()}</span>
                <strong style="font-size:14px;color:#775537">${loc.name}</strong>
                <span style="font-size:12px;color:#9A8A7A">등록됨!</span>
            </div>
            ${simHtml}
            <div style="display:flex;gap:6px;margin-top:8px">
                <button id="wt-reg-ok" style="flex:1;padding:7px;background:#F7EC8D;border:1.5px solid #F6A93A;border-radius:8px;font-size:12px;font-weight:600;color:#775537;cursor:pointer;font-family:inherit">✅ 추가</button>
                <button id="wt-reg-edit" style="flex:1;padding:7px;background:#fff;border:1.5px solid #E8E4D8;border-radius:8px;font-size:12px;color:#775537;cursor:pointer;font-family:inherit">✏️ 수정</button>
                <button id="wt-reg-undo" style="flex:1;padding:7px;background:#fff;border:1.5px solid #F5A8A8;border-radius:8px;font-size:12px;color:#8B6EC7;cursor:pointer;font-family:inherit">↩️ 취소</button>
            </div>
        </div>`);

        $('body').append(overlay);
        const self = this;

        // 병합 버튼
        overlay.find('.wt-reg-merge').on('click', async function() {
            const sid = $(this).attr('data-sid');
            const sname = $(this).attr('data-sname');
            // ★ 이벤트 이전 (삭제 전에!)
            const target = self.lm.locations.find(l => l.id === sid);
            if (target && loc.events?.length) {
                if (!target.events) target.events = [];
                target.events.push(...loc.events);
                if (target.events.length > 20) target.events = target.events.slice(-20);
                await self.lm.updateLocation(sid, { events: target.events });
                dbg(`📎 Transferred ${loc.events.length} events from "${loc.name}" → "${sname}"`);
            }
            await self.lm.deleteLocation(loc.id);
            if (target) await self.lm.updateLocation(sid, { aliases: [...(target.aliases || []), loc.name] });
            await self.lm.moveTo(sid);
            toastSuccess(`📎 "${sname}"에 병합!`);
            self.pi?.inject(); self.refresh();
            overlay.remove();
        });

        // ✅ 추가 확인
        overlay.find('#wt-reg-ok').on('click', () => overlay.remove());

        // ✏️ 수정 — 패널 열고 수정 폼
        overlay.find('#wt-reg-edit').on('click', () => {
            overlay.remove();
            // ★ 이벤트 임시 보관 (삭제 전에!)
            const savedEvents = loc.events ? [...loc.events] : [];
            const curId = self.lm.currentLocationId;
            if (curId && savedEvents.length) {
                const curLoc = self.lm.locations.find(l => l.id === curId);
                if (curLoc) {
                    if (!curLoc.events) curLoc.events = [];
                    curLoc.events.push(...savedEvents);
                    self.lm.updateLocation(curId, { events: curLoc.events });
                    dbg(`✏️ Transferred ${savedEvents.length} events from "${loc.name}" → "${curLoc.name}"`);
                }
            }
            self.togglePanel(true);
            setTimeout(() => {
                $('#wt-add-form').slideDown(200); $('#wt-add-arrow').text('▴');
                $('#wt-input-name').val(loc.name).focus();
                self.lm.deleteLocation(loc.id).then(() => { self.pi?.inject(); self.refresh(); });
            }, 350);
        });

        // ↩️ 취소
        overlay.find('#wt-reg-undo').on('click', async () => {
            // ★ 이벤트 이전 → 현재 위치로 (삭제 전에!)
            const curId = self.lm.currentLocationId;
            if (curId && loc.events?.length) {
                const curLoc = self.lm.locations.find(l => l.id === curId);
                if (curLoc) {
                    if (!curLoc.events) curLoc.events = [];
                    curLoc.events.push(...loc.events);
                    if (curLoc.events.length > 20) curLoc.events = curLoc.events.slice(-20);
                    await self.lm.updateLocation(curId, { events: curLoc.events });
                    dbg(`↩️ Transferred ${loc.events.length} events from "${loc.name}" → "${curLoc.name}"`);
                }
            }
            await self.lm.deleteLocation(loc.id);
            self.pi?.inject(); self.refresh();
            overlay.remove();
            toastSuccess('↩️ 취소됨 (이벤트는 현재 장소로 이전)');
        });

        // 15초 후 자동 제거 (유저가 안 누르면)
        setTimeout(() => overlay.remove(), 15000);
    }

    // ★ AI 중복 방지: 유저 장소와 AI 장소 병합 제안
    showMergeToast(userLoc, aiName) {
        $('#wt-merge-overlay').remove();

        const sendBtn = document.querySelector('#send_but');
        if (!sendBtn || sendBtn.offsetParent === null) return;

        const overlay = $(`<div id="wt-merge-overlay" style="position:fixed;top:60px;left:50%;transform:translateX(-50%);width:320px;max-width:90vw;background:rgba(245,244,237,0.98);border:2px solid #5E84E2;border-radius:14px;padding:10px 14px;z-index:2147483646;box-shadow:0 6px 24px rgba(0,0,0,0.2);backdrop-filter:blur(8px);font-family:-apple-system,'Noto Sans KR',sans-serif">
            <div style="font-size:13px;font-weight:700;color:#3C4043;margin-bottom:6px">📍 "${aiName}"</div>
            <div style="font-size:12px;color:#5A4030;margin-bottom:8px">= "<strong>${userLoc.name}</strong>" 와 같은 장소인가요?</div>
            <div style="display:flex;gap:6px">
                <button id="wt-merge-yes" style="flex:1;padding:8px;background:#E8F0FE;border:1.5px solid #5E84E2;border-radius:8px;font-size:12px;font-weight:600;color:#1A73E8;cursor:pointer;font-family:inherit">🔗 같은 곳 (별칭 추가)</button>
                <button id="wt-merge-no" style="flex:1;padding:8px;background:#fff;border:1.5px solid #E8E4D8;border-radius:8px;font-size:12px;color:#775537;cursor:pointer;font-family:inherit">📍 다른 곳</button>
            </div>
        </div>`);

        $('body').append(overlay);
        const self = this;

        // 같은 곳 → 별칭 추가
        overlay.find('#wt-merge-yes').on('click', async () => {
            const aliases = [...(userLoc.aliases || []), aiName];
            await self.lm.updateLocation(userLoc.id, { aliases });
            toastSuccess(`📎 "${aiName}" → "${userLoc.name}"의 별칭으로 추가!`);
            self.pi?.inject();
            overlay.remove();
            console.log(`[${EXTENSION_NAME}] 🔧 merge: "${aiName}" → alias of "${userLoc.name}"`);
        });

        // 다른 곳 → 새로 등록
        overlay.find('#wt-merge-no').on('click', async () => {
            const loc = await self.lm.addLocation(aiName);
            if (loc) {
                await self.lm.moveTo(loc.id);
                self.pi?.inject(); self.refresh();
                self.showAutoToast(loc);
                setTimeout(async () => { try { await self.lm.autoCalcDistances(); await self.lm.autoReverseGeocode(); self.pi?.inject(); } catch(_){} }, 1500);
            }
            overlay.remove();
            toastSuccess(`📍 "${aiName}" 새로 등록!`);
        });

        // 10초 후 자동 → 같은 곳으로 처리
        setTimeout(() => {
            if ($('#wt-merge-overlay').length) {
                $('#wt-merge-yes').click();
            }
        }, 10000);
    }

    _findSim(name) {
        if(!this.lm.locations.length)return[]; const lo=name.toLowerCase();
        const mg=catGroups.filter(g=>g.some(w=>lo.includes(w))); if(!mg.length)return[];
        const r=[]; for(const loc of this.lm.locations){ const ns=[loc.name.toLowerCase(),...(loc.aliases||[]).map(a=>a.toLowerCase())];
        for(const g of mg){if(ns.some(n=>g.some(w=>n.includes(w)))){r.push(loc);break;}}} return r.slice(0,3);
    }

    // ========== 장소 검색 (로컬 + 주소) ==========
    async _doSearch() {
        const q = $('#wt-search-input').val().trim();
        if (!q || q.length < 1) { $('#wt-search-results').hide(); return; }

        if (this._searchMode === 'addr') {
            this._doAddrSearch(q);
        } else {
            this._doLocSearch(q.toLowerCase());
        }
    }

    // 🔍 등록된 장소 검색
    _doLocSearch(q) {
        const matches = this.lm.locations.filter(loc => {
            const names = [loc.name, ...(loc.aliases || [])].map(n => n.toLowerCase());
            return names.some(n => n.includes(q));
        });

        const list = $('#wt-search-results').empty();
        if (!matches.length) {
            // ★ 로컬 결과 없으면 → Leaflet 모드에서 자동 주소 검색!
            if (this.leafletRenderer?.map) {
                list.html('<div class="wt-search-empty">등록된 장소 없음 — 주소 검색 중...</div>').show();
                this._doAddrSearch(q);
                return;
            }
            list.html('<div class="wt-search-empty">일치하는 장소 없음</div>').show();
            return;
        }

        for (const loc of matches) {
            const isCur = loc.id === this.lm.currentLocationId;
            const visits = loc.visitCount || 0;
            const badge = isCur ? ' 🐾' : '';
            const item = $(`<div class="wt-search-item">
                <span class="wt-search-name">${loc.name}${badge}</span>
                <span style="font-size:11px;color:#9A8A7A;margin-left:6px">${visits}회</span>
            </div>`);
            item.on('click', () => {
                $('#wt-search-results').hide();
                $('#wt-search-input').val('');
                const s = extension_settings[EXTENSION_NAME];
                const mode = s?.mapMode || 'leaflet';

                // Leaflet/판타지 모드 → 지도에서 해당 장소 포커스 + 하이라이트
                if ((mode === 'leaflet' || mode === 'fantasy') && this.leafletRenderer?.map && loc.lat && loc.lng) {
                    this.leafletRenderer.map.flyTo([loc.lat, loc.lng], 16, { duration: 0.5 });
                    // 마커 하이라이트: 팝업 열기
                    const marker = this.leafletRenderer.markers[loc.id];
                    if (marker) marker.openPopup();
                }
                // 노드 맵 → ViewBox 센터링
                else if (this.mapRenderer?.svg) {
                    this.mapRenderer.vb.x = (loc.x || 300) - this.mapRenderer.vb.w / 2;
                    this.mapRenderer.vb.y = (loc.y || 250) - this.mapRenderer.vb.h / 2;
                    this.mapRenderer._applyVB();
                    // 노드 하이라이트: 잠깐 깜빡임
                    const node = this.mapRenderer.svg.querySelector(`g[data-id="${loc.id}"] circle`);
                    if (node) {
                        node.setAttribute('stroke', '#FF6B6B'); node.setAttribute('stroke-width', '4');
                        setTimeout(() => { node.setAttribute('stroke', loc.id === this.lm.currentLocationId ? '#775537' : '#9e8e7e'); node.setAttribute('stroke-width', loc.id === this.lm.currentLocationId ? '3' : '1.5'); }, 1500);
                    }
                }
                toastSuccess(`📍 ${loc.name}`);
            });
            list.append(item);
        }
        list.show();
    }

    // 📍 실제 주소 검색 (Nominatim)
    async _doAddrSearch(q) {
        if (q.length < 2) { $('#wt-search-results').hide(); return; }
        const list = $('#wt-search-results').empty();
        list.html('<div class="wt-search-empty">검색 중...</div>').show();

        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&accept-language=ko`;
            const res = await fetch(url, { headers: { 'User-Agent': 'RP-World-Tracker/0.3' } });
            if (!res.ok) { list.html('<div class="wt-search-empty">검색 실패</div>'); return; }
            const data = await res.json();
            if (!data.length) { list.html('<div class="wt-search-empty">결과 없음</div>'); return; }

            list.empty();
            for (const r of data.slice(0, 5)) {
                const name = r.display_name.split(',').slice(0, 3).join(', ');
                const lat = parseFloat(r.lat), lng = parseFloat(r.lon);
                const item = $(`<div class="wt-search-item">
                    <span class="wt-search-name">📍 ${name}</span>
                </div>`);
                item.on('click', async () => {
                    $('#wt-search-results').hide();
                    $('#wt-search-input').val('');
                    // Leaflet 모드로 전환 + 좌표 이동
                    if (!this.leafletRenderer?.map) {
                        await this._setMapMode('leaflet');
                        await new Promise(r => setTimeout(r, 500));
                    }
                    if (this.leafletRenderer?.map) {
                        this.leafletRenderer.showSearchResult(lat, lng, name);
                        this.leafletRenderer.map.setView([lat, lng], 15);
                    }
                    // 좌표 없는 장소 자동 매칭 제안
                    const noCoord = this.lm.locations.find(l => !l.lat && !l.lng);
                    if (noCoord) {
                        if (confirm(`"${noCoord.name}"에 이 좌표를 배치할까요?`)) {
                            await this.lm.updateLocation(noCoord.id, { lat, lng });
                            this.leafletRenderer?.clearSearchMarker();
                            this.leafletRenderer?.render();
                            toastSuccess(`📍 ${noCoord.name} 배치!`);
                        }
                    }
                });
                list.append(item);
            }
        } catch(e) { list.html('<div class="wt-search-empty">네트워크 오류</div>'); }
    }

    // ---- 거리 입력 섹션 ----
    _updDistSection(locId) {
        const others = this.lm.locations.filter(l => l.id !== locId && !l.parentId); // ★ 서브 장소 제외
        if (!others.length) { $('#wt-pop-dist-section').hide(); return; }
        $('#wt-pop-dist-section').show();

        const list = $('#wt-pop-dist-list').empty();
        const self = this;
        for (const d of this.lm.distances || []) {
            let otherId = d.fromId === locId ? d.toId : d.toId === locId ? d.fromId : null;
            if (!otherId) continue;
            const other = this.lm.locations.find(l => l.id === otherId);
            if (!other || other.parentId) continue; // ★ 서브 장소 거리 안 표시
            const item = $(`<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#5A4030;background:#FAFAF5;padding:4px 8px;border-radius:6px">
                <span style="flex:1">${other.name}</span><span style="color:#9A8A7A">${d.distanceText||'—'}</span>
                <button class="wt-btn-icon" style="font-size:12px;padding:2px 4px;color:#F5A8A8" data-did="${d.id}">✕</button>
            </div>`);
            item.find('button').on('click', function() {
                const did = $(this).attr('data-did');
                const idx = self.lm.distances.findIndex(x => x.id === did);
                if (idx >= 0) self.lm.distances.splice(idx, 1);
                // ★ DB에서도 삭제
                try { self.lm.db._tx('distances','readwrite').delete(did); } catch(_){}
                $(this).closest('div').remove();
                self.pi?.inject();
                if (self.mapRenderer) self.mapRenderer.render();
                toastSuccess('📏 거리 삭제!');
            });
            list.append(item);
        }

        const sel = $('#wt-pop-dist-target').empty();
        for (const o of others) {
            const existing = (this.lm.distances || []).find(d =>
                (d.fromId === locId && d.toId === o.id) || (d.toId === locId && d.fromId === o.id));
            if (!existing) sel.append(`<option value="${o.id}">${o.name}</option>`);
        }
        if (!sel.find('option').length) sel.append('<option value="" disabled>모든 장소에 거리 설정됨</option>');
    }

    // ========== 스캔 승인 (플로팅 오버레이) ==========
    showScanApproval(candidates) {
        if (!candidates.length) return;
        // 채팅 화면이 아니면 표시 안 함
        const sendBtn = document.querySelector('#send_but');
        if (!sendBtn || sendBtn.offsetParent === null) return;
        $('#wt-scan-overlay').remove();

        let items = '';
        candidates.forEach((c, i) => {
            items += `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:rgba(255,255,255,0.9);border-radius:6px">
                <input type="checkbox" data-idx="${i}" ${c.checked ? 'checked' : ''} style="width:16px;height:16px"/>
                <input type="text" value="${c.name}" data-idx="${i}" class="wt-scan-name" style="flex:1;border:1px solid #E8E4D8;border-radius:4px;padding:3px 6px;font-size:12px;font-family:inherit;background:#fff"/>
                ${c.existing ? '<span style="font-size:9px;color:#9A8A7A">기존</span>' : '<span style="font-size:9px;color:#F6A93A">새</span>'}
            </div>`;
        });

        const overlay = $(`<div id="wt-scan-overlay" style="position:fixed;bottom:100px;left:50%;transform:translateX(-50%);width:320px;max-width:90vw;background:rgba(245,244,237,0.98);border:2px solid #F6A93A;border-radius:14px;padding:12px;z-index:2147483646;box-shadow:0 8px 30px rgba(0,0,0,0.25);backdrop-filter:blur(8px);font-family:-apple-system,'Noto Sans KR',sans-serif">
            <div style="font-size:13px;font-weight:700;color:#775537;margin-bottom:6px">${wtMascot()} 장소 감지됨!</div>
            <div style="font-size:11px;color:#9A8A7A;margin-bottom:6px">이름 수정 가능 · 체크 해제 시 제외</div>
            <div id="wt-scan-items" style="display:flex;flex-direction:column;gap:3px;max-height:150px;overflow-y:auto">${items}</div>
            <div style="display:flex;gap:6px;margin-top:8px">
                <button id="wt-scan-ok" style="flex:1;padding:8px;background:#F7EC8D;border:1.5px solid #F6A93A;border-radius:8px;font-size:13px;font-weight:600;color:#775537;cursor:pointer;font-family:inherit">✅ 등록</button>
                <button id="wt-scan-cancel" style="flex:1;padding:8px;background:transparent;border:1px solid #E8E4D8;border-radius:8px;font-size:13px;color:#9A8A7A;cursor:pointer;font-family:inherit">❌ 무시</button>
            </div>
        </div>`);

        $('body').append(overlay);

        const self = this;
        overlay.find('#wt-scan-ok').on('click', async () => {
            const items = [];
            overlay.find('input[type=checkbox]').each(function() {
                const idx = parseInt($(this).attr('data-idx'));
                const checked = $(this).prop('checked');
                const name = overlay.find(`.wt-scan-name[data-idx="${idx}"]`).val().trim();
                if (checked && name) items.push({ ...candidates[idx], name });
            });
            await self._processScanApproval(items);
            overlay.remove();
        });
        overlay.find('#wt-scan-cancel').on('click', () => overlay.remove());

        // 10초 후 자동 제거
        setTimeout(() => overlay.remove(), 15000);
    }

    async _processScanApproval(items) {
        let lastLocId = null;
        for (const item of items) {
            if (item.existing && item.locId) {
                await this.lm.moveTo(item.locId);
                lastLocId = item.locId;
            } else {
                const existing = this.lm.findByName(item.name);
                if (existing) {
                    await this.lm.moveTo(existing.id);
                    lastLocId = existing.id;
                } else {
                    const loc = await this.lm.addLocation(item.name);
                    if (loc) { await this.lm.moveTo(loc.id); lastLocId = loc.id; }
                }
            }
        }
        if (lastLocId) {
            this.pi?.inject();
            this.refresh();
            wtNotify(`${wtMascot()} ${items.length}개 장소 등록!`, 'move', 2000);
        }
    }

    // ========== 지오코딩 (Nominatim 주소 검색) ==========
    _geoCache = {};

    async _geoSearch() {
        const locId = $('#wt-popover').attr('data-id');
        const query = $('#wt-pop-geo-input').val().trim();
        if (!locId || !query) return;

        const resultsDiv = $('#wt-pop-geo-results').show();

        // 캐시 확인
        if (this._geoCache[query]) {
            this._showGeoResults(resultsDiv, this._geoCache[query], locId);
            return;
        }

        resultsDiv.html('<div style="padding:4px;color:#9A8A7A">검색 중...</div>');

        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&accept-language=ko`;
            const res = await fetch(url, { headers: { 'User-Agent': 'RP-World-Tracker/0.2' } });
            if (!res.ok) { resultsDiv.html('<div style="padding:4px;color:#F5A8A8">검색 실패</div>'); return; }
            const data = await res.json();

            if (!data.length) { resultsDiv.html('<div style="padding:4px;color:#9A8A7A">결과 없음</div>'); return; }

            // 캐시 저장
            this._geoCache[query] = data;
            this._showGeoResults(resultsDiv, data, locId);
        } catch(e) {
            resultsDiv.html('<div style="padding:4px;color:#F5A8A8">네트워크 오류</div>');
        }
    }

    _showGeoResults(resultsDiv, data, locId) {
        resultsDiv.empty();
        const self = this;
        for (const r of data.slice(0, 5)) {
            const name = r.display_name.split(',').slice(0, 3).join(', ');
            const item = $(`<div style="padding:6px 4px;cursor:pointer;border-bottom:1px solid #E8E4D8" data-lat="${r.lat}" data-lng="${r.lon}">📍 ${name}</div>`);
            item.on('click', async function() {
                    const lat = parseFloat($(this).attr('data-lat'));
                    const lng = parseFloat($(this).attr('data-lng'));
                    const addrText = $(this).text().replace('📍 ', '').trim();
                    await self.lm.updateLocation(locId, { lat, lng, address: addrText, _tempAddress: false });

                    // 앵커 포인트 기반 원형 분포 — 좌표 없는 다른 장소들도 배치
                    const others = self.lm.locations.filter(l => l.id !== locId && !l.lat && !l.lng);
                    if (others.length > 0) {
                        const angleStep = (2 * Math.PI) / others.length;
                        for (let i = 0; i < others.length; i++) {
                            const dist = 30 + Math.random() * 120; // 30~150m
                            const angle = angleStep * i + (Math.random() * 0.3); // 약간 불규칙
                            const oLat = lat + (dist / 111320) * Math.cos(angle);
                            const oLng = lng + (dist / (111320 * Math.cos(lat * Math.PI / 180))) * Math.sin(angle);
                            await self.lm.updateLocation(others[i].id, { lat: oLat, lng: oLng });
                        }
                        toastSuccess(`📍 ${others.length + 1}개 장소 배치 완료!`);
                    } else {
                        toastSuccess(`📍 좌표 저장!`);
                    }

                    resultsDiv.hide();
                    $('#wt-pop-geo-input').val('');
                    self.hidePop();
                    self._setMapMode('leaflet');
                    setTimeout(async () => {
                        if (self.leafletRenderer?.map) {
                            self.leafletRenderer.render();
                            self.leafletRenderer.map.setView([lat, lng], 15);
                        }
                        // ★ 위치 기반 자동 확장
                        try { await self.lm.autoCalcDistances(); } catch(_){}
                        try { await self.lm.autoReverseGeocode(); } catch(_){}
                        self.pi?.inject();
                    }, 500);
                });
                resultsDiv.append(item);
            }
    }

    // ========== 데이터 관리 (채팅별) ==========
    async _exportChatData() {
        if (!this.lm.currentChatId) { toastWarn('채팅이 없어요!'); return; }
        const data = await this.lm.db.exportChat(this.lm.currentChatId);
        this._downloadJSON(data, `wt-chat-${this.lm.currentChatId.slice(0,12)}`);
        toastSuccess(`💾 이 채팅 백업 완료!`);
        $('#wt-data-menu').hide();
    }

    async _importChatData(e) {
        const file = e.target.files?.[0]; if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (!data.chatId && !data.locations) { toastWarn('잘못된 파일!'); return; }
            // 단일 채팅 데이터
            if (data.chatId) {
                await this.lm.db.importChat(data);
            } else {
                toastWarn('채팅 데이터가 아닙니다!'); return;
            }
            await this.lm.loadChat();
            this.refresh();
            toastSuccess(`📂 데이터 불러오기 완료!`);
        } catch(err) { toastWarn('파일 오류: ' + err.message); }
        e.target.value = '';
        $('#wt-data-menu').hide();
    }

    async _deleteChatData() {
        if (!this.lm.currentChatId) return;
        if (!confirm('이 채팅의 모든 장소/이동 데이터를 삭제할까요?')) return;
        await this.lm.db.deleteChat(this.lm.currentChatId);
        this.lm.locations = []; this.lm.movements = []; this.lm.distances = [];
        this.lm.currentLocationId = null;
        this.refresh();
        toastSuccess('🗑️ 이 채팅 데이터 삭제 완료!');
        $('#wt-data-menu').hide();
    }

    // ========== 데이터 관리 (전체) ==========
    async _exportAllData() {
        const data = await this.lm.db.exportAll();
        this._downloadJSON(data, `wt-all-backup`);
        toastSuccess(`💾 전체 백업 완료! (${data.locations?.length || 0}개 장소)`);
    }

    async _importAllData(e) {
        const file = e.target.files?.[0]; if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (data.chatId) {
                // 단일 채팅 데이터 → importChat
                await this.lm.db.importChat(data);
            } else if (data.locations) {
                // 전체 백업 → importAll
                await this.lm.db.importAll(data);
            } else { toastWarn('잘못된 파일!'); return; }
            await this.lm.loadChat();
            this.refresh();
            toastSuccess(`📂 데이터 불러오기 완료!`);
        } catch(err) { toastWarn('파일 오류: ' + err.message); }
        e.target.value = '';
    }

    async _deleteAllData() {
        if (!confirm('⚠️ 모든 채팅의 World Tracker 데이터를 삭제할까요?\n이 작업은 되돌릴 수 없습니다!')) return;
        if (!confirm('정말 삭제하시겠습니까?')) return;
        await this.lm.db.deleteAll();
        this.lm.locations = []; this.lm.movements = []; this.lm.distances = [];
        this.lm.currentLocationId = null;
        this.refresh();
        toastSuccess('🗑️ 전체 데이터 삭제 완료!');
    }

    _downloadJSON(data, prefix) {
        const str = JSON.stringify(data, null, 2);
        const blob = new Blob([str], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const date = new Date().toISOString().slice(0,10).replace(/-/g,'');
        a.href = url; a.download = `${prefix}-${date}.json`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    }

    // ========== 이벤트 기록 시스템 ==========
    _updEventsList(locId) {
        const loc = this.lm.locations.find(l => l.id === locId);
        const list = $('#wt-pop-events-list').empty();
        const events = loc?.events || [];
        if (!events.length) { list.html('<div style="font-size:11px;color:#9A8A7A;padding:4px;font-style:italic">아직 이벤트가 없어요</div>'); return; }
        const self = this;
        const recent = events.slice(-3).reverse();
        recent.forEach((ev, i) => {
            const realIdx = events.length - 1 - i;
            const mood = ev.mood || '📝';
            const title = ev.title || (ev.text?.length > 15 ? ev.text.substring(0, 15) + '...' : ev.text || '');
            const dateStr = ev.isPlan ? (ev.planDate ? `📌 ${ev.planDate}` : '📌 예정') : (ev.rpDate || (ev.timestamp ? new Date(ev.timestamp).toLocaleDateString('ko-KR', { month:'numeric', day:'numeric' }) : ''));
            const hasDetail = ev.text && ev.text !== title && ev.text.length > 15;

            // occurredAt 뱃지 (다른 장소에서 회상된 이벤트)
            let occurBadge = '';
            if (ev.recordedAt && ev.recordedAt !== locId) {
                const recLoc = this.lm.locations.find(l => l.id === ev.recordedAt);
                if (recLoc) occurBadge = `<span style="font-size:9px;color:#5E84E2;background:rgba(94,132,226,0.1);padding:1px 5px;border-radius:4px;white-space:nowrap">📍 ${recLoc.name}에서 회상</span>`;
            }

            const item = $(`<div style="background:var(--wt-surface);border-radius:8px;overflow:hidden;font-size:11px">
                <div class="wt-ev-header" style="padding:6px 8px;cursor:${hasDetail ? 'pointer' : 'default'}">
                    <div style="display:flex;align-items:center;gap:4px">
                        <span style="flex-shrink:0;font-size:12px">${mood}</span>
                        <span style="flex:1;color:var(--wt-text);font-weight:600;font-size:11.5px;line-height:1.3">${title}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;margin-top:2px;padding-left:18px">
                        <span class="wt-ev-date-view" style="font-size:10px;color:#B0A898;white-space:nowrap">${dateStr}</span>
                        ${occurBadge}
                        <input class="wt-ev-date-edit" type="text" value="${dateStr}" style="display:none;width:80px;font-size:10px;padding:2px 6px;border:1px solid #5E84E2;border-radius:4px;text-align:center;color:#5E84E2" />
                        <button class="wt-ev-date-btn" data-eidx="${realIdx}" style="font-size:12px;padding:2px 4px;min-width:24px;min-height:24px;background:none;border:none;cursor:pointer;flex-shrink:0;color:#B0A898" title="날짜 수정">✏️</button>
                        <span style="flex:1"></span>
                        <button class="wt-ev-del" style="font-size:12px;padding:2px 4px;min-width:24px;min-height:24px;color:var(--wt-pink);background:none;border:none;cursor:pointer;flex-shrink:0" data-eidx="${realIdx}">✕</button>
                        ${hasDetail ? '<span class="wt-ev-arrow" style="font-size:10px;color:#B0A898;flex-shrink:0;margin-left:4px">▼</span>' : ''}
                    </div>
                </div>
                ${hasDetail ? `<div class="wt-ev-detail" style="display:none;padding:4px 8px 8px 24px;font-size:11px;line-height:1.5;color:#7A7060;border-top:1px dashed #EAE6DC">${ev.text}</div>` : ''}
            </div>`);

            // 접기/펼치기
            if (hasDetail) {
                item.find('.wt-ev-header').on('click', function(e) {
                    if ($(e.target).closest('.wt-ev-del,.wt-ev-date-btn,.wt-ev-date-edit').length) return;
                    const detail = item.find('.wt-ev-detail');
                    const arrow = item.find('.wt-ev-arrow');
                    detail.slideToggle(200);
                    arrow.text(detail.is(':visible') ? '▼' : '▲');
                });
            }

            // ✏️ 날짜 수정 토글
            item.find('.wt-ev-date-btn').on('click', async function(e) {
                e.stopPropagation();
                const idx = parseInt($(this).attr('data-eidx'));
                const dateView = item.find('.wt-ev-date-view');
                const dateEdit = item.find('.wt-ev-date-edit');
                const btn = $(this);

                if (dateEdit.is(':visible')) {
                    // ✅ 저장 모드 → 저장하고 돌아가기
                    const newDate = dateEdit.val().trim();
                    if (newDate && !isNaN(idx)) {
                        events[idx].rpDate = newDate;
                        await self.lm.updateLocation(locId, { events });
                    }
                    dateView.text(newDate || dateView.text());
                    dateEdit.hide();
                    dateView.show();
                    btn.text('✏️');
                } else {
                    // ✏️ 편집 모드
                    dateEdit.val(dateView.text()).show().focus().select();
                    dateView.hide();
                    btn.text('✅');
                }
            });

            // 삭제
            item.find('.wt-ev-del').on('click', async function(e) {
                e.stopPropagation();
                const idx = parseInt($(this).attr('data-eidx'));
                if (isNaN(idx)) return;
                events.splice(idx, 1);
                await self.lm.updateLocation(locId, { events });
                self._updEventsList(locId);
            });
            list.append(item);
        });

        // 3개 초과 시 "전체 기억 보기" 버튼
        if (events.length > 3) {
            const btn = $(`<button style="width:100%;margin-top:6px;padding:8px;background:transparent;border:1.5px dashed #D8D4C8;border-radius:8px;font-size:12px;color:#9A8A7A;cursor:pointer;font-family:inherit">📖 전체 기억 보기 (${events.length}건)</button>`);
            btn.on('click', () => this._showEventPanel(locId));
            list.append(btn);
        }
    }

    async _addEvent() {
        const locId = $('#wt-popover').attr('data-id');
        const text = $('#wt-pop-event-input').val().trim();
        if (!locId || !text) return;
        const loc = this.lm.locations.find(l => l.id === locId);
        if (!loc) return;
        const events = loc.events || [];

        // title 자동 생성
        let title = text.length <= 15 ? text : text.substring(0, 15) + '...';

        // 긴 텍스트면 LLM으로 title 생성
        if (text.length > 20) {
            try {
                const prompt = `Create a short, witty title (max 15 chars) for this event that emphasizes the place's meaning. Write like "OO한 곳". Respond with ONLY the title text, nothing else.\n\nEvent: ${text.substring(0, 300)}`;
                const result = await callLLM(prompt);
                if (result?.trim()) title = result.trim().replace(/["\n]/g, '').substring(0, 20);
            } catch(e) {}
        }

        events.push({ text, title, mood: '📝', timestamp: Date.now(), source: 'manual' });
        await this.lm.updateLocation(locId, { events });
        $('#wt-pop-event-input').val('');
        this._updEventsList(locId);
        toastSuccess('📝 이벤트 추가!');
    }

    // ========== 💬 커뮤니티 피드 시스템 (v0.6.0 NEW) ==========
    _renderCommunityText(text) {
        if (!text) return '';
        // r25: LLM이 자유롭게 HTML/CSS 입체 카드 생성 가능 — XSS 위험 요소만 차단 (블랙리스트 sanitize)
        let t = text;
        // 위험 태그 제거 (XSS 경로 봉쇄)
        t = t.replace(/<script\b[\s\S]*?<\/script>/gi, '');
        t = t.replace(/<script\b[^>]*>/gi, '');
        t = t.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '');
        t = t.replace(/<iframe\b[^>]*>/gi, '');
        t = t.replace(/<object\b[\s\S]*?<\/object>/gi, '');
        t = t.replace(/<embed\b[^>]*\/?>/gi, '');
        t = t.replace(/<form\b[\s\S]*?<\/form>/gi, '');
        t = t.replace(/<(meta|link|base)\b[^>]*\/?>/gi, '');
        // 이벤트 핸들러 제거 (onclick, onload, onerror 등)
        t = t.replace(/\son\w+\s*=\s*"[^"]*"/gi, '');
        t = t.replace(/\son\w+\s*=\s*'[^']*'/gi, '');
        t = t.replace(/\son\w+\s*=\s*[^\s>]+/gi, '');
        // javascript: / data:text/html URL 차단
        t = t.replace(/javascript\s*:/gi, '');
        t = t.replace(/data\s*:\s*text\/html/gi, '');
        // *action* 액션 서술 제거 (HTML 바깥에서만 — 단순 처리)
        t = t.replace(/\*([^*\n<>]{1,40})\*/g, '').replace(/\s{2,}/g, ' ').trim();
        // 일반 트윗 (HTML 태그 없는 경우) — @멘션/#해시태그 색칠
        const hasHtml = /<[a-z][\s\S]*>/i.test(t);
        if (!hasHtml) {
            t = t.replace(/@([A-Za-z가-힣0-9_]+)/g, '<span style="color:#1D9BF0;font-weight:500">@$1</span>');
            t = t.replace(/#([A-Za-z가-힣0-9_]+)/g, '<span style="color:#1D9BF0">#$1</span>');
            t = t.replace(/\n/g, '<br>');
        }
        return t;
    }

    async _generateCommunity(locId) {
        const loc = this.lm.locations.find(l => l.id === locId);
        if (!loc) return;
        if (this._commPending === locId) return;
        this._commPending = locId;
        // r16: 영구 잠김 방지 — 60초 후 강제 해제 (LLM이 hang 걸려도 다음 호출 가능)
        const pendingId = locId;
        const safetyTimer = setTimeout(() => {
            if (this._commPending === pendingId) {
                console.warn('[wt] _commPending force-reset after timeout');
                this._commPending = null;
            }
        }, 60000);

        try {
            const ctx = getContext();
            const userName = ctx.name1 || 'User';
            const charName = ctx.name2 || 'Character';
            const charDesc = (ctx.characters?.[ctx.characterId]?.description || '').substring(0, 150);
            const recentChat = getRecentChatContext(800); // 줄임 (1500 → 800)
            const npcList = (loc.npcs || []).map(n => `"${n.name}"(${n.role || n.type}, ❤️${n.affinity||3}/5)`).join(', ');
            const evSummary = (loc.events || []).slice(-2).map(e => `${e.mood||'📝'} ${e.title||e.text?.substring(0,30)}`).join(', ') || 'none';
            const s = extension_settings[EXTENSION_NAME];
            const eLang = s?.eventLang || 'auto';
            const langInst = eLang === 'ko' ? 'Write in Korean (casual).' : eLang === 'en' ? 'Write in English (casual).' : 'Match RP language.';

            const prompt = `이 장소 주변에서 흘러나오는 **트위터 실시간 피드**를 생성해줘. 지역/장소 해시태그로 모인 **익명의 아무나**가 쓴 글이 대부분이다.

장소: "${loc.name}"${loc.memo ? ` (${loc.memo.substring(0,80)})` : ''}${loc.address ? ` · ${loc.address.substring(0,60)}` : ''}
유저="${userName}", 메인 캐릭터="${charName}"
${charDesc ? `캐릭터 설정: ${charDesc}` : ''}
이곳 등록된 NPC: ${npcList || '없음'}
최근 이곳 사건: ${evSummary}
${langInst}
${recentChat ? `\n[최근 RP 맥락 (배경 참고만, 직접 언급 금지)]:\n${recentChat.substring(0, 600)}\n` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━
🎯 핵심 원칙 — "장소 기반 트위터 타임라인"
━━━━━━━━━━━━━━━━━━━━━━━━

이곳은 리뷰가 아니다. **지역 해시태그를 타고 흘러오는 웅성웅성한 트위터 피드**다.
"이 장소 + 주변 지역을 공유하는 사람들"이 각자 살아가며 올리는 트윗.

━━━━━━━━━━━━━━━━━━━━━━━━
👥 구성 비율 (4~5개 포스트)
━━━━━━━━━━━━━━━━━━━━━━━━

**익명 유저 3~4개 (대다수) / 등록 캐릭·NPC 0~1개 (가끔)**

- 등록된 캐릭터(${charName})나 NPC(${npcList || '없음'})는 **4~5개 중 최대 1개만** 등장. 없어도 OK.
- 나머지는 전부 **이름 없는 트위터 유저** — 이곳에 살거나, 지나가거나, 관련 있는 익명들.

━━━━━━━━━━━━━━━━━━━━━━━━
🎭 익명 유저 프로필 (다양하게 섞기!)
━━━━━━━━━━━━━━━━━━━━━━━━

**이름**: 트위터 닉네임 스타일. 장르/지역에 맞게 자유롭게.
- 지역 연상: "헤리퍼드_주민", "Quarters_rat", "카자흐거주민", "사막여우42", "부대앞카페단골"
- 평범: "익명", "지나가는행인", "이름없음", "밤새는사람"
- 캐릭터성: "커피중독자", "야행성올빼미", "군인좋아함", "개덕후"

**@핸들**: 영문 소문자+언더스코어+숫자. "@desert_rat42", "@local_kazakh", "@coffee_addict"

**avatar**: 아래 3가지 **섞어서** 써. 각 포스트마다 다른 스타일. 반드시 **이모지 1개만**.
1. 고정 랜덤: ☺ 🌵 🤔 🌕 ☀ 🌙 💭 🫠 🐾 ✨ 📷 ☕ 🎧
2. 지역/장소 연상: (사막→🐪🌵, 기지→🪖⚙, 카페→☕🧁, 조선→🏯👘 중 하나)
3. 심플 아바타: 👤 👥 👨 👩 🧑 👻

**type**: 익명이면 "anon" (신규), 등록 NPC면 기존대로 "npc"/"animal"

━━━━━━━━━━━━━━━━━━━━━━━━
✍️ 톤·주제 (전부 섞어서 다양하게!)
━━━━━━━━━━━━━━━━━━━━━━━━

한 피드 안에 아래 톤들이 **골고루** 들어가야 함:

🔸 **불평/잡담/밈 (ㅋㅋㅋ 감성)**
   "여기 진짜 왜 이렇게 더움? ㅋㅋㅋ 에어컨 어디 감"
   "오늘도 출근. 집에 가고 싶다 #월요일 #극혐"
   "또 와이파이 끊김 이 동네 통신사 바꿔야 함 진짜"

🔸 **관찰/분위기 (사진 묘사, 풍경)**
   "창밖 노을 미쳤다."
   "아침 공기 선선하다. #산책 #아침"
   "이 골목 고양이 또 왔네 ㅋㅋ 살찜"

🔸 **뉴스/루머/소문 (속보 감성)**
   "방금 큰길에 검은차 대여섯대 지나감. 뭔 일?"
   "근처 상가 오늘 일찍 닫았다던데 왜임"
   "소문 들었는데 여기 예전에 군인들 자주 왔다며"

🔸 **일상/혼잣말 (짧고 툭)**
   "커피 마시는 중"
   "배고프다"
   "왜 이시간에 잠이 안 옴"

━━━━━━━━━━━━━━━━━━━━━━━━
📏 포맷 규칙
━━━━━━━━━━━━━━━━━━━━━━━━

- 1~3줄 짧은 트윗. @멘션·#해시태그 자연스럽게 (#장소명, #지역, #일상 등 2~3개)
- **"*행동*" 별표 액션 금지** — 그냥 트윗처럼 써
- **금지 유행어**: ㅇㅇ/ㄴㄴ/팩트/ㄱㅈㅇㅈ/ㅇㄱㄹㅇ/~노/~근/킹받네/~하노/~꺼라/디시체/일베/아재개그
- **메타 내레이션 금지** — "~에 있는 인물이 트윗을 작성한다" 같은 서술 X

📸 **이미지 첨부 (4~5개 중 1~2개에만)**
- URL: \`https://image.pollinations.ai/prompt/<영어설명 URL인코딩>?nologo=true&width=512&height=340\`
- HTML 내부는 **작은따옴표(')** 사용 (JSON 파싱 안전):
  ✅ \`style='width:100%;border-radius:10px;margin-top:8px'\`
  ❌ \`style="width:100%"\`
- 장소·분위기에 맞는 영어 키워드 (풍경/음식/하늘/동물/소품)

💬 **인용문 블록 (가끔, 선택)**
- \`<div style='border-left:3px solid #B0A898;padding:8px 12px;margin-top:8px;background:#F8F8F5;border-radius:0 8px 8px 0;font-size:13px;color:#4A4A4A;font-style:italic'>인용 내용<br><span style='font-style:normal;color:#8B98A5;font-size:11px'>— 출처</span></div>\`

❌ **금지**
- 복잡한 HTML 레이아웃 (SYSTEM ALERT 패널, 네온 박스, display:flex/grid 구조)
- \`<script>\`, \`<iframe>\`, \`onclick\` 등

━━━━━━━━━━━━━━━━━━━━━━━━
📦 JSON 출력
━━━━━━━━━━━━━━━━━━━━━━━━

감정 라벨: excited/chill/tense/sleepy/romantic 중 선택
likes: 익명은 0~15 사이 소소하게, 등록 NPC는 20~50 사이

JSON만 응답:
{"posts":[
  {"name":"사막여우42","handle":"@desert_fox42","avatar":"🦊","type":"anon","mood":"chill","moodLabel":"😌 나른","text":"해가 쨍쨍. 낮잠 자기 딱 좋은 날씨네 #카자흐스탄 #자연","likes":4},
  {"name":"Quarters_rat","handle":"@q_rat","avatar":"🤔","type":"anon","mood":"tense","moodLabel":"😵 멘붕","text":"또 와이파이 끊김 ㅋㅋㅋㅋ 이 동네 진짜 왜 이럼","likes":11},
  {"name":"야행성올빼미","handle":"@night_owl","avatar":"🌙","type":"anon","mood":"sleepy","moodLabel":"😮‍💨 피곤","text":"새벽 3시. 왜 잠이 안 오는지 모르겠음<br><img src='https://image.pollinations.ai/prompt/night%20window%20desert%20stars%20lonely%20atmosphere?nologo=true&width=512&height=340' style='width:100%;border-radius:10px;margin-top:8px'>","likes":7},
  {"name":"익명","handle":"@anon_local","avatar":"👤","type":"anon","mood":"excited","moodLabel":"👀 관찰","text":"방금 큰길에 검은 SUV 대여섯대 지나감. 뭔 일이래 #속보 #동네","likes":15},
  {"name":"Price","handle":"@captain","avatar":"🥃","type":"npc","mood":"tense","moodLabel":"😰 경계","text":"잠은 언제 자나. 또 밤샘이다 #임무중","likes":32}
]}

JSON만 응답. 앞뒤에 설명·코드블록·주석 금지.`;

            const result = await callLLM(prompt);
            if (!result) {
                const err = window._wtLastLLMError || '알 수 없는 오류';
                // r27: Google 과부하 전용 안내
                if (/503|429|500|502|504|과부하|overload/i.test(err)) {
                    toastWarn(`⚠️ Google 서버 과부하 중 (503). 1~2분 후 다시 시도해주세요`);
                } else {
                    toastWarn(`⚠️ LLM 응답 없음: ${err}`);
                }
                console.error('[wt] Community gen failed:', err);
                return;
            }
            const parsed = parseLLMJson(result);
            if (!parsed?.posts || !Array.isArray(parsed.posts)) { toastWarn('⚠️ 커뮤니티 파싱 실패'); console.error('[wt] Community parse failed, raw:', result.substring(0, 200)); return; }

            // 기존 커뮤니티 초기화하고 새로 추가 (최신순)
            await this.lm.clearCommunity(locId);
            for (const p of parsed.posts.filter(p => p && p.text)) {
                // 멘션/해시태그 추출
                const mentions = (p.text.match(/@([A-Za-z가-힣0-9_]+)/g) || []).map(m => m.substring(1));
                const hashtags = (p.text.match(/#([A-Za-z가-힣0-9_]+)/g) || []).map(h => h.substring(1));
                await this.lm.addCommunityPost(locId, {
                    name: p.name || 'Unknown',
                    avatar: p.avatar || '👤',
                    type: p.type || 'npc',
                    mood: p.mood || '',
                    moodLabel: p.moodLabel || '',
                    text: p.text,
                    mentions,
                    hashtags,
                    likes: p.likes || 0,
                });
            }
            toastSuccess(`💬 ${parsed.posts.length}개 반응 생성!`);
            this.pi?.inject();
            // r13: 오버레이가 열려있으면 바텀시트 재렌더 생략 (race condition 방지)
            // 오버레이 닫힌 상태에서 바텀시트의 미니피드만 갱신할 때만 _showBottomSheet 호출
            if (!this._commOverlayOpen) {
                const prevStage = this._bsStage || 2;
                // v0.6.1: 현재 활성 탭 기억 → 재렌더 후 복원 (🟢 실시간 탭에서 생성 시 탭 유지)
                const prevTab = $('#wt-bottomsheet .wt-bs-tab').filter(function() {
                    return $(this).css('borderBottomColor') !== 'rgba(0, 0, 0, 0)' && $(this).css('borderBottomColor') !== 'transparent';
                }).data('tab') || 'overview';
                this._showBottomSheet(locId);
                setTimeout(() => {
                    this._applyBsStage(prevStage);
                    if (prevTab && prevTab !== 'overview') {
                        $('#wt-bottomsheet').find(`.wt-bs-tab[data-tab="${prevTab}"]`).click();
                    }
                }, 100);
            }
        } catch(e) {
            console.error('[wt] Community gen error:', e);
            toastWarn('❌ 생성 실패');
        } finally {
            clearTimeout(safetyTimer);
            this._commPending = null;
        }
    }

    _showCommunityFullFeed(locId) {
        window._wtDlog?.(`sCFF(${locId})`, '#ff0');
        const loc = this.lm.locations.find(l => l.id === locId);
        if (!loc) { window._wtDlog?.('sCFF !loc silent return', '#f55'); return; }
        $('#wt-community-overlay').remove();

        const posts = loc.community || [];
        const postsHtml = posts.length ? posts.map(p => this._renderCommunityPostCard(p)).join('') : '<div style="padding:60px 20px;text-align:center;color:#8B98A5;font-size:13px">아직 반응이 없어요<br><span style="font-size:11px">✨ 버튼을 눌러 실시간 반응을 생성해보세요</span></div>';

        const overlay = $(`<div id="wt-community-overlay" style="position:fixed !important;top:0 !important;left:0 !important;width:100vw !important;height:100vh;height:100dvh !important;background:#fff !important;z-index:2147483647 !important;display:flex !important;flex-direction:column !important;isolation:isolate">
            <div style="padding:14px 16px 0;background:#fff;border-bottom:1px solid #EFF3F4;position:sticky;top:0;z-index:50">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
                    <div id="wt-comm-back" style="font-size:20px;color:#0F1419;cursor:pointer;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:50%">←</div>
                    <div style="flex:1">
                        <div style="font-size:17px;font-weight:900;color:#0F1419">${loc.name}</div>
                        <div style="font-size:12px;color:#536471;display:flex;align-items:center;gap:4px" data-comm-count="1"><span style="width:8px;height:8px;background:#00BA7C;border-radius:50%;display:inline-block;animation:wtLivePulse 2s infinite"></span> 실시간 · ${posts.length}개 반응</div>
                    </div>
                </div>
            </div>
            <div id="wt-comm-feed-wrap" style="flex:1;overflow-y:auto;background:#fff;position:relative;overscroll-behavior:contain">
                <div id="wt-comm-ptr" style="position:absolute;top:0;left:0;right:0;height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#F7F9F9;transition:height .2s;pointer-events:none">
                    <div id="wt-comm-ptr-inner" style="display:flex;align-items:center;gap:8px;font-size:12px;color:#536471;font-weight:500"><span id="wt-comm-ptr-icon" style="display:inline-block;font-size:16px;transition:transform .2s">⬇</span><span id="wt-comm-ptr-text">당겨서 새로고침</span></div>
                </div>
                <div id="wt-comm-feed">${postsHtml}</div>
            </div>
            <button id="wt-comm-fab" style="position:absolute;bottom:20px;right:16px;width:52px;height:52px;border-radius:50%;background:#1D9BF0;color:#fff;border:none;font-size:24px;cursor:pointer;box-shadow:0 2px 12px rgba(29,155,240,.4);display:flex;align-items:center;justify-content:center;touch-action:manipulation">✨</button>
        </div>`);
        $('body').append(overlay);
        // r21: z-index 최대치로 올림 + 중앙 elementFromPoint로 덮는 요소 확정
        try {
            const r0 = overlay[0].getBoundingClientRect();
            const bcs = getComputedStyle(document.body);
            const hcs = getComputedStyle(document.documentElement);
            window._wtDlog?.(`sCFF ap ${r0.width.toFixed(0)}x${r0.height.toFixed(0)}@(${r0.left.toFixed(0)},${r0.top.toFixed(0)})`, '#0f0');
            window._wtDlog?.(`body.tf=${bcs.transform.substring(0,20)} html.tf=${hcs.transform.substring(0,20)}`, '#0af');
            // 오버레이 중앙 좌표에서 실제 최상위 요소 확인
            setTimeout(() => {
                const cx = r0.left + r0.width/2, cy = r0.top + r0.height/2;
                const topEl = document.elementFromPoint(cx, cy);
                const isOv = topEl && (topEl === overlay[0] || overlay[0].contains(topEl));
                const desc = topEl ? `${topEl.tagName}#${topEl.id||''}.${(typeof topEl.className === 'string' ? topEl.className.split(' ')[0] : '')}` : 'NULL';
                window._wtDlog?.(`topAt center: ${desc.substring(0,40)}`, isOv ? '#0f0' : '#f55');
                if (!isOv && topEl) {
                    const tcs = getComputedStyle(topEl);
                    window._wtDlog?.(` COVERING z=${tcs.zIndex} pos=${tcs.position}`, '#f80');
                    // 덮는 요소의 조상 중 stacking context 범인 찾기
                    let cur = topEl, depth = 0;
                    while (cur && cur !== document.documentElement && depth < 8) {
                        const cs = getComputedStyle(cur);
                        if (cs.zIndex !== 'auto' && cs.position !== 'static') {
                            window._wtDlog?.(`  sc:${cur.tagName}#${(cur.id||'').substring(0,15)} z=${cs.zIndex}`, '#f80');
                        }
                        cur = cur.parentElement;
                        depth++;
                    }
                }
            }, 30);
        } catch(e) {}

        const self = this;
        const close = () => {
            // r20: 즉시 제거 (애니메이션 없음)
            overlay.remove();
        };
        let _closeLock = false;
        overlay.find('#wt-comm-back').on('click touchend', (e) => {
            e.preventDefault();
            if (_closeLock) return;
            _closeLock = true;
            close();
        });
        // r22: 피드 갱신 공용 함수 (FAB + pull-to-refresh 둘 다 사용)
        let _refreshLock = false;
        const refreshFeed = async () => {
            if (_refreshLock) return false;
            _refreshLock = true;
            overlay.find('#wt-comm-fab').text('⏳').prop('disabled', true);
            self._commOverlayOpen = true;
            try {
                await self._generateCommunity(locId);
            } finally {
                self._commOverlayOpen = false;
                _refreshLock = false;
            }
            // 오버레이 내용 갱신 (race 없이)
            const loc = self.lm.locations.find(l => l.id === locId);
            const posts = loc?.community || [];
            const postsHtml = posts.length ? posts.map(p => self._renderCommunityPostCard(p)).join('') : '<div style="padding:60px 20px;text-align:center;color:#8B98A5;font-size:13px">아직 반응이 없어요<br><span style="font-size:11px">✨ 버튼을 눌러 실시간 반응을 생성해보세요</span></div>';
            overlay.find('#wt-comm-feed').html(postsHtml);
            overlay.find('#wt-comm-fab').text('✨').prop('disabled', false);
            overlay.find('[data-comm-count]').html(`<span style="width:8px;height:8px;background:#00BA7C;border-radius:50%;display:inline-block;animation:wtLivePulse 2s infinite"></span> 실시간 · ${posts.length}개 반응`);
            return true;
        };

        // r22: FAB (✨) — 명시적 생성 버튼
        overlay.find('#wt-comm-fab').on('click touchend', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await refreshFeed();
        });

        // r22: Pull-to-refresh — 트위터 감성 당겨서 새로고침
        const feedWrap = overlay.find('#wt-comm-feed-wrap')[0];
        const ptr = overlay.find('#wt-comm-ptr')[0];
        const ptrIcon = overlay.find('#wt-comm-ptr-icon');
        const ptrText = overlay.find('#wt-comm-ptr-text');
        const PTR_THRESHOLD = 70; // 임계값 (이상 당기면 새로고침)
        const PTR_MAX = 100;
        let ptrStartY = null, ptrActive = false, ptrDist = 0;

        feedWrap.addEventListener('touchstart', (e) => {
            if (_refreshLock) return;
            if (feedWrap.scrollTop > 0) { ptrStartY = null; return; }
            ptrStartY = e.touches[0].clientY;
            ptrActive = false;
            ptrDist = 0;
        }, { passive: true });

        feedWrap.addEventListener('touchmove', (e) => {
            if (ptrStartY === null || _refreshLock) return;
            const dy = e.touches[0].clientY - ptrStartY;
            if (dy <= 0) { ptrStartY = null; return; }
            // scrollTop이 0일 때만 pull 효과
            if (feedWrap.scrollTop > 0) { ptrStartY = null; return; }
            ptrActive = true;
            // 저항 효과 — dy 늘릴수록 느려짐
            ptrDist = Math.min(PTR_MAX, dy * 0.55);
            ptr.style.height = ptrDist + 'px';
            ptr.style.transition = 'none';
            if (ptrDist >= PTR_THRESHOLD) {
                ptrIcon.css('transform', 'rotate(180deg)').text('⬆');
                ptrText.text('놓으면 새로고침');
            } else {
                ptrIcon.css('transform', 'rotate(0deg)').text('⬇');
                ptrText.text('당겨서 새로고침');
            }
        }, { passive: true });

        feedWrap.addEventListener('touchend', async () => {
            if (!ptrActive) { ptrStartY = null; return; }
            const shouldRefresh = ptrDist >= PTR_THRESHOLD;
            ptrStartY = null;
            ptrActive = false;
            ptr.style.transition = 'height .25s';
            if (shouldRefresh) {
                // 로딩 상태 유지
                ptr.style.height = '50px';
                ptrIcon.text('🔄').css('transform', 'rotate(0deg)');
                ptrText.text('생성 중...');
                // 아이콘 회전 애니메이션
                const spinInterval = setInterval(() => {
                    const cur = parseInt(ptrIcon.css('transform').match(/-?\d+(\.\d+)?/g)?.[0] || 0);
                    // 실제 회전은 css로 더 쉽게 - animation 프로퍼티 추가
                }, 100);
                ptrIcon[0].style.animation = 'wtSpin 0.8s linear infinite';
                await refreshFeed();
                clearInterval(spinInterval);
                ptrIcon[0].style.animation = '';
                ptrIcon.text('✓').css('transform', 'rotate(0deg)');
                ptrText.text('완료!');
                setTimeout(() => {
                    ptr.style.height = '0';
                    ptrIcon.text('⬇');
                    ptrText.text('당겨서 새로고침');
                }, 600);
            } else {
                ptr.style.height = '0';
            }
            ptrDist = 0;
        }, { passive: true });
    }

    // v0.6.1: 이모지/멀티바이트 문자의 첫 grapheme만 추출 (아바타 overflow 방지)
    _firstGrapheme(s) {
        if (!s) return '👤';
        try {
            const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
            const first = segmenter.segment(s).containing(0)?.segment;
            return first || s;
        } catch(_) {
            return s.length > 4 ? s.substring(0, 2) : s;
        }
    }

    _renderCommunityPostCard(p) {
        const moodColors = {
            excited: 'background:#FFF3E0;color:#B36B00',
            chill: 'background:#E8F5FD;color:#1D6FAD',
            tense: 'background:#FBE9E7;color:#C62828',
            romantic: 'background:#FCE4EC;color:#AD1457',
            sleepy: 'background:#EDE7F6;color:#4527A0',
        };
        const moodStyle = moodColors[p.mood] || 'background:#F7F9F9;color:#536471';
        // v0.6.1: 아바타 정규화 — 이모지 2~3개 겹친 거("🍯🦡", "1️⃣4️⃣1️⃣") 터지지 않도록 첫 grapheme만 사용
        const avatarChar = this._firstGrapheme(p.avatar || (p.type === 'animal' ? '🐾' : '👤'));
        return `<div style="padding:12px 16px;border-bottom:1px solid #EFF3F4;display:flex;gap:12px;align-items:flex-start">
            <div style="width:40px;height:40px;min-width:40px;border-radius:50%;background:${p.type==='animal'?'#FFF8E1':'#E8F0FE'};display:flex;align-items:center;justify-content:center;font-size:20px;line-height:1;flex-shrink:0;overflow:hidden;text-align:center">${avatarChar}</div>
            <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:2px">
                    <span style="font-size:14px;font-weight:700;color:#0F1419">${p.name}</span>
                    <span style="font-size:13px;color:#536471">${p.handle || ''}</span>
                    <span style="font-size:13px;color:#536471">· ${this._timeAgo(p.timestamp)}</span>
                </div>
                ${p.moodLabel ? `<div style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:14px;font-size:11px;font-weight:600;margin-bottom:6px;${moodStyle}">${p.moodLabel}</div>` : ''}
                <div style="font-size:14px;color:#0F1419;line-height:1.55;margin-bottom:4px;word-break:break-word">${this._renderCommunityText(p.text)}</div>
                <div style="display:flex;gap:8px;margin-top:4px;margin-left:-8px">
                    <div style="display:flex;align-items:center;gap:4px;padding:6px 10px;border-radius:50px;font-size:12px;color:#536471;cursor:pointer">💬 ${(p.replies||[]).length}</div>
                    <div style="display:flex;align-items:center;gap:4px;padding:6px 10px;border-radius:50px;font-size:12px;color:#536471;cursor:pointer">🔁 0</div>
                    <div style="display:flex;align-items:center;gap:4px;padding:6px 10px;border-radius:50px;font-size:12px;color:#F91880;cursor:pointer">❤️ ${p.likes||0}</div>
                </div>
            </div>
        </div>`;
    }

    // ========== 🗺️ 미니 약도 (장소 주변 관계도) ==========
    _showNodemapFullscreen(anchorLocId) {
        $('#wt-nodemap-overlay').remove();

        const overlay = $(`<div id="wt-nodemap-overlay" style="position:fixed !important;top:0 !important;left:0 !important;width:100vw !important;height:100vh;height:100dvh !important;background:#F8F9FA !important;z-index:2147483647 !important;display:flex !important;flex-direction:column !important;isolation:isolate">
            <div style="padding:12px 16px;background:#fff;border-bottom:1px solid #DADCE0;display:flex;align-items:center;gap:12px;box-shadow:0 1px 3px rgba(60,64,67,.15)">
                <div id="wt-nodemap-back" style="font-size:20px;color:#202124;cursor:pointer;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:50%">←</div>
                <div style="flex:1">
                    <div style="font-size:16px;font-weight:700;color:#202124">🗺️ 전체 약도</div>
                    <div style="font-size:11px;color:#5F6368">장소 관계도 · 노드 이동: 드래그</div>
                </div>
                <div id="wt-nodemap-refresh" style="padding:6px 12px;border-radius:18px;background:#E8F0FE;color:#1A73E8;font-size:12px;font-weight:500;cursor:pointer">🔄 재배치</div>
            </div>
            <div id="wt-nodemap-full-container" style="flex:1;background:#fff;position:relative;overflow:hidden"></div>
        </div>`);
        $('body').append(overlay);
        // r20: 슬라이드 애니메이션 제거

        const self = this;
        const close = () => {
            // r20: 즉시 제거
            overlay.remove();
        };
        overlay.find('#wt-nodemap-back').on('click touchend', (e) => { e.preventDefault(); close(); });

        // ★ 약도 렌더러 생성 (풀스크린 컨테이너에)
        setTimeout(async () => {
            const container = document.getElementById('wt-nodemap-full-container');
            if (!container) return;
            try {
                const { MapRenderer } = await import('./map-renderer.js');
                const mr = new MapRenderer(container, self.lm);
                mr.onLocationClick = id => {
                    // 클릭하면 해당 장소 바텀시트 + 약도 오버레이 닫기
                    close();
                    setTimeout(() => self._showBottomSheet(id), 400);
                };
                mr.render();
                overlay.find('#wt-nodemap-refresh').on('click', () => {
                    mr.relayout?.();
                    mr.render();
                    toastSuccess('🔄 재배치 완료');
                });
                // 중심 장소로 이동
                if (anchorLocId && mr.centerOn) mr.centerOn(anchorLocId);
            } catch(e) {
                console.error('[wt] Nodemap fullscreen error:', e);
                container.innerHTML = '<div style="padding:40px;text-align:center;color:#9AA0A6">약도를 불러올 수 없습니다</div>';
            }
        }, 100);
    }

    _renderMiniNodemap(locId) {
        const svg = $('#wt-bs-nodemap-svg');
        if (!svg.length) return;
        const loc = this.lm.locations.find(l => l.id === locId);
        if (!loc) return;

        // 주변 장소 찾기 (거리 정보 있는 것들)
        const neighbors = [];
        for (const d of this.lm.distances || []) {
            let otherId = null;
            if (d.fromId === locId) otherId = d.toId;
            else if (d.toId === locId) otherId = d.fromId;
            if (otherId) {
                const other = this.lm.locations.find(l => l.id === otherId);
                if (other) neighbors.push({ loc: other, distance: d.distanceText, walkTime: d.walkTime });
            }
        }
        // 거리 정보 없으면 같은 지역의 다른 장소 최대 4개
        if (!neighbors.length) {
            const others = this.lm.locations.filter(l => l.id !== locId && !l.parentId).slice(0, 4);
            others.forEach(o => neighbors.push({ loc: o, distance: '?', walkTime: null }));
        }
        const shown = neighbors.slice(0, 5);

        if (!shown.length) {
            svg.html('<div style="padding:40px 20px;text-align:center;color:#9AA0A6;font-size:12px">주변에 등록된 장소가 없어요</div>');
            return;
        }

        // 원형 배치
        const cx = 150, cy = 90, radius = 60;
        const emojis = { '카페':'☕','커피':'☕','cafe':'☕','coffee':'☕','집':'🏠','house':'🏠','home':'🏠','학교':'🏫','school':'🏫','병원':'🏥','의무실':'🏥','hospital':'🏥','공원':'🌳','park':'🌳','마트':'🛒','mart':'🛒','market':'🛒','store':'🛒','barracks':'🪖','막사':'🪖','base':'🪖','기지':'🪖' };
        const getEmoji = (name) => {
            const low = name.toLowerCase();
            for (const [k, v] of Object.entries(emojis)) if (low.includes(k)) return v;
            return '📍';
        };

        let svgContent = `<svg width="100%" height="100%" viewBox="0 0 300 180" xmlns="http://www.w3.org/2000/svg">`;

        // 연결선 먼저
        shown.forEach((n, i) => {
            const angle = (Math.PI * 2 * i) / shown.length - Math.PI / 2;
            const nx = cx + Math.cos(angle) * radius;
            const ny = cy + Math.sin(angle) * radius;
            const mid_x = (cx + nx) / 2, mid_y = (cy + ny) / 2;
            svgContent += `<line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="#DADCE0" stroke-width="1.5" stroke-dasharray="3"/>`;
            if (n.walkTime) {
                svgContent += `<text x="${mid_x}" y="${mid_y - 3}" font-size="8" fill="#9AA0A6" text-anchor="middle" font-family="sans-serif">도보 ${n.walkTime}분</text>`;
            }
        });

        // 현재 장소 (중앙, 구글맵 블루)
        svgContent += `<circle cx="${cx}" cy="${cy}" r="22" fill="#1A73E8" stroke="#fff" stroke-width="3"/>`;
        svgContent += `<text x="${cx}" y="${cy + 5}" text-anchor="middle" fill="#fff" font-size="14">${getEmoji(loc.name)}</text>`;
        svgContent += `<text x="${cx}" y="${cy + 38}" text-anchor="middle" fill="#202124" font-size="9" font-weight="700" font-family="sans-serif">${loc.name.substring(0, 10)}</text>`;

        // 주변 장소들
        shown.forEach((n, i) => {
            const angle = (Math.PI * 2 * i) / shown.length - Math.PI / 2;
            const nx = cx + Math.cos(angle) * radius;
            const ny = cy + Math.sin(angle) * radius;
            const color = n.loc.tags?.includes('wantToGo') ? '#FBBC04' : '#EA4335';
            svgContent += `<circle cx="${nx}" cy="${ny}" r="14" fill="${color}" stroke="#fff" stroke-width="2" class="wt-mini-pin" data-id="${n.loc.id}" style="cursor:pointer"/>`;
            svgContent += `<text x="${nx}" y="${ny + 4}" text-anchor="middle" fill="#fff" font-size="10" pointer-events="none">${getEmoji(n.loc.name)}</text>`;
            // 라벨 위치 (원 바깥쪽)
            const labelRadius = radius + 20;
            const lx = cx + Math.cos(angle) * labelRadius;
            const ly = cy + Math.sin(angle) * labelRadius;
            svgContent += `<text x="${lx}" y="${ly}" text-anchor="middle" fill="#5F6368" font-size="8" font-family="sans-serif">${n.loc.name.substring(0, 8)}</text>`;
        });

        svgContent += `</svg>`;
        svg.html(svgContent);

        // 핀 클릭 → 해당 장소 바텀시트
        const self = this;
        svg.find('.wt-mini-pin').on('click', function(e) {
            e.stopPropagation();
            const id = $(this).attr('data-id');
            self._hideBottomSheet();
            setTimeout(() => self._showBottomSheet(id), 300);
        });
    }

    // ========== 👥 터줏대감 풀 시스템 ==========
    _renderNpcTab(locId) {
        const loc = this.lm.locations.find(l => l.id === locId);
        const list = $('#wt-bs-npc-list');
        list.empty();
        $('#wt-bs-npc-count').text(`${loc?.npcs?.length || 0}명`);
        if (!loc?.npcs?.length) {
            list.html('<div style="text-align:center;padding:24px 10px;color:#9AA0A6;font-size:12px">아직 감지된 인물이 없어요<br><span style="font-size:11px;color:#B0A898">RP 중 등장하는 NPC가 자동 등록돼요!</span></div>');
            return;
        }
        const npcs = loc.npcs.filter(n => n.type !== 'animal');
        const animals = loc.npcs.filter(n => n.type === 'animal');
        const self = this;

        const renderCards = (arr) => arr.map(n => {
            const hearts = Array.from({length: 5}, (_, i) =>
                `<span style="font-size:11px;${i >= (n.affinity || 3) ? 'filter:grayscale(1) opacity(.3)' : ''}">❤️</span>`
            ).join('');
            const ago = n.lastSeen ? this._timeAgo(n.lastSeen) : '';
            return `<div class="wt-bs-npc-card" data-npc="${n.name}" style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:#FAFAF5;border:1px solid #E8E4D8;border-radius:14px;margin-bottom:8px;cursor:pointer;position:relative;-webkit-tap-highlight-color:transparent">
                <div style="width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;background:${n.type==='animal'?'#FFF8E1':'#F3EAFA'}">${n.avatar || (n.type==='animal'?'🐾':'👤')}</div>
                <div style="flex:1;min-width:0">
                    <div style="font-size:13px;font-weight:700;color:#5A4030">${n.name}</div>
                    <div style="font-size:10px;color:#9A8A7A;margin-top:1px">${n.role || n.type}</div>
                    <div style="display:flex;gap:2px;margin-top:4px">${hearts}</div>
                </div>
                <div style="position:absolute;top:8px;right:10px;font-size:9px;color:#9A8A7A;background:#F5F4ED;padding:2px 6px;border-radius:10px">×${n.count||1}</div>
                ${ago ? `<div style="font-size:9px;color:#B0A898;position:absolute;bottom:8px;right:10px">${ago}</div>` : ''}
            </div>`;
        }).join('');

        let html = '';
        if (npcs.length) {
            html += `<div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:#6B4F91;margin:4px 0 8px;padding-bottom:4px;border-bottom:1px dashed #E0D8F0"><span>🧑</span> 인물 (${npcs.length})</div>`;
            html += renderCards(npcs);
        }
        if (animals.length) {
            html += `<div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:#6B4F91;margin:14px 0 8px;padding-bottom:4px;border-bottom:1px dashed #E0D8F0"><span>🐾</span> 동물 (${animals.length})</div>`;
            html += renderCards(animals);
        }
        list.html(html);

        list.find('.wt-bs-npc-card').on('click', function(e) {
            e.stopPropagation();
            self._showNpcProfile(locId, $(this).data('npc'));
        });
    }

    _timeAgo(ts) {
        const d = Date.now() - ts;
        if (d < 60000) return '방금';
        if (d < 3600000) return Math.floor(d / 60000) + '분 전';
        if (d < 86400000) return Math.floor(d / 3600000) + '시간 전';
        return Math.floor(d / 86400000) + '일 전';
    }

    _affinityDesc(level) {
        const descs = {
            1: '경계 — 아직 마음을 열지 않은 사이',
            2: '어색함 — 서로 조심스러운 사이',
            3: '보통 — 알고 지내는 사이',
            4: '신뢰 — 믿을 수 있는 사이',
            5: '깊은 유대 — 특별한 사이',
        };
        return descs[Math.round(level)] || descs[3];
    }

    _showNpcProfile(locId, npcName) {
        const loc = this.lm.locations.find(l => l.id === locId);
        const npc = loc?.npcs?.find(n => n.name === npcName);
        if (!npc) return;
        const self = this;

        // 관련 이벤트 (이 장소에서 NPC 이름 언급된 것)
        const relEvents = (loc.events || []).filter(e => e.text && e.text.includes(npc.name)).slice(-3);

        const hearts = Array.from({length: 5}, (_, i) =>
            `<span class="wt-npc-heart" data-val="${i+1}" style="font-size:24px;cursor:pointer;transition:transform .15s;${i >= (npc.affinity || 3) ? 'filter:grayscale(1) opacity(.3)' : 'filter:saturate(1.2)'}"">❤️</span>`
        ).join('');

        const tags = (npc.personality || []).map((t, i) =>
            `<span style="display:inline-block;padding:3px 8px;background:${i >= 3 ? '#FFF5E0' : '#F3EAFA'};color:${i >= 3 ? '#B07810' : '#8B6BB4'};border-radius:12px;font-size:10px;font-weight:600;margin:2px 2px 0 0">${t}</span>`
        ).join('') || '<span style="font-size:11px;color:#B0A898">AI 재생성으로 추가해보세요</span>';

        const evHtml = relEvents.length ? relEvents.map(e =>
            `<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;background:#FAFAF5;border-radius:10px;border:1px solid #E8E4D8;margin-bottom:4px">
                <span style="font-size:14px;margin-top:1px">${e.mood || '📝'}</span>
                <div><div style="font-size:11px;color:#5A4030;line-height:1.5">${e.title || e.text?.substring(0, 30)}</div>
                <div style="font-size:9px;color:#B0A898;margin-top:2px">${e.rpDate || this._fmt(e.timestamp)}</div></div>
            </div>`
        ).join('') : '<div style="font-size:11px;color:#B0A898;padding:8px;text-align:center">관련 이벤트가 없어요</div>';

        const overlay = $(`<div id="wt-npc-profile-overlay" style="position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;background:rgba(0,0,0,.4);z-index:10100;display:flex;align-items:flex-end;opacity:0;transition:opacity .25s">
            <div id="wt-npc-profile-sheet" style="width:100%;background:#F5F4ED;border-radius:20px 20px 0 0;padding:0 0 20px;max-height:85vh;overflow-y:auto;transform:translateY(100%);transition:transform .35s cubic-bezier(.22,1,.36,1)">
                <div style="text-align:center;padding:20px 20px 16px;position:relative">
                    <div style="width:36px;height:4px;background:#D0C8B8;border-radius:2px;margin:0 auto 16px"></div>
                    <button id="wt-npc-close" style="position:absolute;top:16px;right:16px;width:28px;height:28px;border-radius:50%;background:#E8E4D8;border:none;font-size:14px;cursor:pointer;color:#9A8A7A;display:flex;align-items:center;justify-content:center">×</button>
                    <div style="width:72px;height:72px;border-radius:50%;background:${npc.type==='animal'?'#FFF8E1':'#F3EAFA'};display:flex;align-items:center;justify-content:center;font-size:36px;margin:0 auto 10px;border:3px solid ${npc.type==='animal'?'#F6A93A':'#8B6BB4'};box-shadow:0 4px 12px ${npc.type==='animal'?'rgba(246,169,58,.2)':'rgba(139,107,180,.2)'}">${npc.avatar || (npc.type==='animal'?'🐾':'👤')}</div>
                    <div style="font-size:18px;font-weight:800;color:#5A4030">${npc.name}</div>
                    <div style="font-size:12px;color:#8B6BB4;font-weight:600;margin-top:2px">${npc.role || npc.type}</div>
                </div>
                <div style="margin:0 20px;padding:14px 16px;background:#FFF0F3;border-radius:14px;border:1px solid #F5D0D8">
                    <div style="font-size:10px;font-weight:600;color:#E8577E;margin-bottom:8px;display:flex;align-items:center;gap:4px">💗 호감도</div>
                    <div id="wt-npc-hearts" style="display:flex;gap:6px;justify-content:center;margin-bottom:6px">${hearts}</div>
                    <div id="wt-npc-aff-desc" style="text-align:center;font-size:11px;color:#C05070;font-weight:500;font-style:italic">${this._affinityDesc(npc.affinity || 3)}</div>
                </div>
                <div style="margin:12px 20px 0;padding:12px 14px;background:#FAFAF5;border-radius:12px;border:1px solid #E8E4D8">
                    <div style="font-size:10px;font-weight:700;color:#6B4F91;margin-bottom:6px">✍️ 한줄 소개</div>
                    <p id="wt-npc-bio" style="font-size:12px;color:#5A4030;line-height:1.6;margin:0">${npc.bio || '<span style="color:#B0A898">아직 소개가 없어요 — AI 재생성을 눌러보세요</span>'}</p>
                </div>
                <div style="margin:12px 20px 0;padding:12px 14px;background:#FAFAF5;border-radius:12px;border:1px solid #E8E4D8">
                    <div style="font-size:10px;font-weight:700;color:#6B4F91;margin-bottom:6px">🎭 성격</div>
                    <div>${tags}</div>
                </div>
                <div style="margin:12px 20px 0;padding:12px 14px;background:#FAFAF5;border-radius:12px;border:1px solid #E8E4D8">
                    <div style="font-size:10px;font-weight:700;color:#6B4F91;margin-bottom:6px">🤝 관계</div>
                    <p style="font-size:12px;color:#5A4030;line-height:1.6;margin:0">${npc.relationship || '<span style="color:#B0A898">아직 관계 메모가 없어요</span>'}</p>
                </div>
                <div style="margin:12px 20px 0">
                    <div style="font-size:10px;font-weight:700;color:#9A8A7A;margin-bottom:6px">📖 최근 등장</div>
                    ${evHtml}
                </div>
                <div id="wt-npc-actions" style="display:flex;gap:8px;margin:16px 20px 0">
                    <button id="wt-npc-edit-btn" style="flex:1;padding:10px;border-radius:12px;font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid #8B6BB4;background:#F3EAFA;color:#8B6BB4;font-family:inherit">✏️ 수정</button>
                    <button id="wt-npc-regen-btn" style="flex:1;padding:10px;border-radius:12px;font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid #5E84E2;background:#E8F0FE;color:#5E84E2;font-family:inherit">🔄 AI 재생성</button>
                    <button id="wt-npc-del-btn" style="flex:0.5;padding:10px;border-radius:12px;font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid #E8577E;background:#FFF0F3;color:#E8577E;font-family:inherit">🗑️</button>
                </div>
                <div id="wt-npc-edit-area" style="display:none;margin:12px 20px 0">
                    <div style="margin-bottom:8px"><label style="font-size:10px;font-weight:600;color:#6B4F91;display:block;margin-bottom:4px">이름</label><input id="wt-npc-ed-name" type="text" value="${npc.name}" style="width:100%;padding:8px 10px;border:1.5px solid #E8E4D8;border-radius:10px;font-size:12px;font-family:inherit;color:#5A4030;background:#FAFAF5;box-sizing:border-box"/></div>
                    <div style="margin-bottom:8px"><label style="font-size:10px;font-weight:600;color:#6B4F91;display:block;margin-bottom:4px">역할</label><input id="wt-npc-ed-role" type="text" value="${npc.role || ''}" style="width:100%;padding:8px 10px;border:1.5px solid #E8E4D8;border-radius:10px;font-size:12px;font-family:inherit;color:#5A4030;background:#FAFAF5;box-sizing:border-box"/></div>
                    <div style="margin-bottom:8px"><label style="font-size:10px;font-weight:600;color:#6B4F91;display:block;margin-bottom:4px">아바타 이모지</label><input id="wt-npc-ed-avatar" type="text" value="${npc.avatar || ''}" style="width:60px;padding:8px 10px;border:1.5px solid #E8E4D8;border-radius:10px;font-size:14px;font-family:inherit;text-align:center"/></div>
                    <div style="margin-bottom:8px"><label style="font-size:10px;font-weight:600;color:#6B4F91;display:block;margin-bottom:4px">한줄 소개</label><textarea id="wt-npc-ed-bio" rows="2" style="width:100%;padding:8px 10px;border:1.5px solid #E8E4D8;border-radius:10px;font-size:12px;font-family:inherit;color:#5A4030;background:#FAFAF5;resize:none;box-sizing:border-box">${npc.bio || ''}</textarea></div>
                    <div style="margin-bottom:8px"><label style="font-size:10px;font-weight:600;color:#6B4F91;display:block;margin-bottom:4px">성격 태그 (쉼표 구분)</label><input id="wt-npc-ed-personality" type="text" value="${(npc.personality||[]).join(', ')}" style="width:100%;padding:8px 10px;border:1.5px solid #E8E4D8;border-radius:10px;font-size:12px;font-family:inherit;color:#5A4030;background:#FAFAF5;box-sizing:border-box"/></div>
                    <div style="margin-bottom:8px"><label style="font-size:10px;font-weight:600;color:#6B4F91;display:block;margin-bottom:4px">관계 메모</label><textarea id="wt-npc-ed-rel" rows="2" style="width:100%;padding:8px 10px;border:1.5px solid #E8E4D8;border-radius:10px;font-size:12px;font-family:inherit;color:#5A4030;background:#FAFAF5;resize:none;box-sizing:border-box">${npc.relationship || ''}</textarea></div>
                    <div style="margin-bottom:8px"><label style="font-size:10px;font-weight:600;color:#6B4F91;display:block;margin-bottom:4px">호감도 (1~5)</label><input id="wt-npc-ed-aff" type="number" value="${npc.affinity||3}" min="1" max="5" style="width:60px;padding:8px 10px;border:1.5px solid #E8E4D8;border-radius:10px;font-size:12px;text-align:center"/></div>
                    <div style="display:flex;gap:8px;margin-top:8px">
                        <button id="wt-npc-ed-cancel" style="flex:1;padding:10px;border-radius:12px;font-size:12px;font-weight:600;cursor:pointer;border:none;background:#E8E4D8;color:#5A4030;font-family:inherit">취소</button>
                        <button id="wt-npc-ed-save" style="flex:1;padding:10px;border-radius:12px;font-size:12px;font-weight:600;cursor:pointer;border:none;background:#8B6BB4;color:#fff;font-family:inherit">💾 저장</button>
                    </div>
                </div>
            </div>
        </div>`);

        $('body').append(overlay);
        requestAnimationFrame(() => {
            overlay.css('opacity', '1');
            overlay.find('#wt-npc-profile-sheet').css('transform', 'translateY(0)');
        });

        const closeProfile = () => {
            overlay.find('#wt-npc-profile-sheet').css('transform', 'translateY(100%)');
            overlay.css('opacity', '0');
            setTimeout(() => overlay.remove(), 350);
        };

        overlay.on('click', (e) => { if (e.target === overlay[0]) closeProfile(); });
        overlay.find('#wt-npc-close').on('click', closeProfile);

        // 호감도 하트 클릭 → 수동 변경
        overlay.find('.wt-npc-heart').on('click', async function(e) {
            e.stopPropagation();
            const val = parseInt($(this).data('val'));
            await self.lm.updateNpc(locId, npc.name, { affinity: val });
            npc.affinity = val;
            overlay.find('.wt-npc-heart').each(function(i) {
                $(this).css({ filter: i < val ? 'saturate(1.2)' : 'grayscale(1) opacity(.3)' });
            });
            overlay.find('#wt-npc-aff-desc').text(self._affinityDesc(val));
            self._renderNpcTab(locId);
        });

        // 수정 버튼
        overlay.find('#wt-npc-edit-btn').on('click', () => {
            overlay.find('#wt-npc-actions').hide();
            overlay.find('#wt-npc-edit-area').slideDown(200);
            overlay.find('#wt-npc-edit-area')[0]?.scrollIntoView({ behavior: 'smooth' });
        });
        overlay.find('#wt-npc-ed-cancel').on('click', () => {
            overlay.find('#wt-npc-edit-area').slideUp(200);
            overlay.find('#wt-npc-actions').show();
        });
        overlay.find('#wt-npc-ed-save').on('click', async () => {
            const oldName = npc.name;
            const updates = {
                name: overlay.find('#wt-npc-ed-name').val().trim() || npc.name,
                role: overlay.find('#wt-npc-ed-role').val().trim(),
                avatar: overlay.find('#wt-npc-ed-avatar').val().trim() || npc.avatar,
                bio: overlay.find('#wt-npc-ed-bio').val().trim(),
                personality: overlay.find('#wt-npc-ed-personality').val().split(',').map(s=>s.trim()).filter(Boolean),
                relationship: overlay.find('#wt-npc-ed-rel').val().trim(),
                affinity: Math.max(1, Math.min(5, parseInt(overlay.find('#wt-npc-ed-aff').val()) || 3)),
            };
            await self.lm.updateNpc(locId, oldName, updates);
            toastSuccess('💾 저장!');
            closeProfile();
            self._renderNpcTab(locId);
            self.pi?.inject();
        });

        // 삭제
        overlay.find('#wt-npc-del-btn').on('click', async () => {
            if (!confirm(`"${npc.name}" 삭제?`)) return;
            await self.lm.removeNpcFromLocation(locId, npc.name);
            toastSuccess('🗑️ 삭제됨');
            closeProfile();
            self._renderNpcTab(locId);
        });

        // AI 재생성
        overlay.find('#wt-npc-regen-btn').on('click', async () => {
            overlay.find('#wt-npc-regen-btn').text('⏳ 생성 중...').prop('disabled', true);
            await self._generateNpcProfile(locId, npc.name);
            closeProfile();
            // 재열기 (갱신된 데이터)
            self._renderNpcTab(locId);
            self._showNpcProfile(locId, npc.name);
        });
    }

    async _generateNpcProfile(locId, npcName) {
        const loc = this.lm.locations.find(l => l.id === locId);
        const npc = loc?.npcs?.find(n => n.name === npcName);
        if (!npc) return;

        const ctx = getContext();
        const userName = ctx.name1 || 'User';
        const charName = ctx.name2 || 'Character';
        const charDesc = (ctx.characters?.[ctx.characterId]?.description || '').substring(0, 300);
        const recentChat = getRecentChatContext(2000);
        const evSummary = (loc.events || []).filter(e => e.text?.includes(npc.name)).slice(-5).map(e => `${e.mood||'📝'} ${e.title||e.text?.substring(0,30)}`).join(', ') || 'none';
        const s = extension_settings[EXTENSION_NAME];
        const eLang = s?.eventLang || 'auto';
        const langInst = eLang === 'ko' ? 'Write in Korean.' : eLang === 'en' ? 'Write in English.' : 'Write in the same language as the RP.';

        const prompt = `Generate a character profile for an NPC in an RP story.

NPC: "${npc.name}" (${npc.type}, ${npc.role || 'unknown role'})
Location: "${loc.name}"
Protagonists: "${userName}", "${charName}"
${charDesc ? `Character context: ${charDesc}` : ''}
Related events: ${evSummary}
${langInst}
${recentChat ? `\n[Recent conversation for context]:\n${recentChat}\n` : ''}

Based on the RP context, generate this NPC's profile.
Respond with ONLY valid JSON, no markdown:
{"avatar":"single emoji representing this character","bio":"one atmospheric sentence about this character (30-50 chars)","personality":["trait1","trait2","trait3","trait4"],"relationship":"1-2 sentence description of relationship with ${userName}","affinity":3}

affinity: 1=hostile 2=wary 3=neutral 4=friendly 5=deeply bonded
CRITICAL: Start with { end with }`;

        try {
            const result = await callLLM(prompt);
            if (!result) return;
            const parsed = parseLLMJson(result);
            if (!parsed) return;
            const updates = {};
            if (parsed.avatar) updates.avatar = parsed.avatar;
            if (parsed.bio) updates.bio = parsed.bio;
            if (Array.isArray(parsed.personality) && parsed.personality.length) updates.personality = parsed.personality;
            if (parsed.relationship) updates.relationship = parsed.relationship;
            if (parsed.affinity) updates.affinity = Math.max(1, Math.min(5, parsed.affinity));
            await this.lm.updateNpc(locId, npcName, updates);
            toastSuccess(`✨ ${npc.name} 프로필 생성!`);
        } catch(e) {
            console.error('[wt] NPC profile gen error:', e);
            toastWarn('⚠️ 프로필 생성 실패');
        }
    }

    // ========== ⭐ 랜덤 리뷰 생성 (구글맵 스타일) ==========
    _getReviewContainer(source) {
        if (source === 'bottomsheet') return $('#wt-bs-review-list');
        if (source === 'popover') return $('#wt-pop-review-list');
        if ($('#wt-bs-review-list').length && $('#wt-bottomsheet').is(':visible')) return $('#wt-bs-review-list');
        return $('#wt-pop-review-list');
    }

    _renderCachedReviews(locId, selector) {
        const loc = this.lm.locations.find(l => l.id === locId);
        const stored = Array.isArray(loc?.generatedReviews) && loc.generatedReviews.length
            ? { reviews: loc.generatedReviews, summary: loc.reviewSummary || '' }
            : null;
        const cached = this._reviewCache.get(locId) || stored;
        const container = $(selector);
        if (!cached || !container.length) return;
        if (!this._reviewCache.has(locId)) this._reviewCache.set(locId, cached);
        // ★ 캐시 리뷰 있으면 독립 생성 버튼 숨기기 (renderReviews 안에 재생성 버튼 있음)
        container.siblings().find('#wt-bs-gen-review,#wt-pop-review-gen').closest('div').hide();
        this._renderReviews(container, cached.reviews, cached.summary);
    }

    // T3: 개요 탭 리뷰 미리보기 (별점 + 카드 2개 + "모든 리뷰 보기")
    _renderReviewPreview(locId) {
        const loc = this.lm.locations.find(l => l.id === locId);
        const stored = Array.isArray(loc?.generatedReviews) && loc.generatedReviews.length
            ? { reviews: loc.generatedReviews, summary: loc.reviewSummary || '' }
            : null;
        const cached = this._reviewCache.get(locId) || stored;
        if (!cached || !cached.reviews?.length) {
            // 리뷰 없으면 "리뷰 생성" 버튼만 표시
            $('#wt-bs-rv-score').text('—');
            $('#wt-bs-rv-stars').text('☆☆☆☆☆');
            $('#wt-bs-rv-count').text('(0건)');
            $('#wt-bs-rv-cards').html('<div style="font-size:11px;color:#9AA0A6;padding:8px;text-align:center;font-style:italic">리뷰를 생성해보세요</div>');
            $('#wt-bs-rv-more').hide();
            return;
        }
        const reviews = cached.reviews;
        // 평균 별점 계산
        const avgRating = (reviews.reduce((s, r) => s + (r.rating || 3), 0) / reviews.length).toFixed(1);
        const fullStars = Math.floor(avgRating);
        const stars = '★'.repeat(fullStars) + '☆'.repeat(5 - fullStars);
        $('#wt-bs-rv-score').text(avgRating);
        $('#wt-bs-rv-stars').text(stars);
        $('#wt-bs-rv-count').text(`(${reviews.length}건)`);
        // 카드 최대 2개 미리보기
        const previewCards = reviews.slice(0, 2).map(r => {
            const avatarBg = r.rating >= 4 ? '#F1F3F4' : '#1a1a2e';
            const avatarColor = r.rating >= 4 ? '' : 'color:#fff';
            const rvStars = '★'.repeat(r.rating || 3) + '☆'.repeat(5 - (r.rating || 3));
            const text = (r.text || '').length > 60 ? r.text.substring(0, 60) + '...' : r.text || '';
            return `<div style="padding:6px 0;border-bottom:1px solid #F1F3F4">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
                    <div style="width:24px;height:24px;border-radius:50%;background:${avatarBg};display:flex;align-items:center;justify-content:center;font-size:11px;${avatarColor}">${r.avatar || '👤'}</div>
                    <span style="font-size:11px;font-weight:700;color:#202124">${r.author || '익명'}</span>
                    <span style="font-size:9px;color:#70757A">· ${rvStars}</span>
                </div>
                <div style="font-size:11px;line-height:1.5;color:#3C4043">${text}</div>
            </div>`;
        }).join('');
        $('#wt-bs-rv-cards').html(previewCards);
        if (reviews.length > 2) {
            $('#wt-bs-rv-more').show();
        }
    }

    async _generateReviews(locId, source = 'auto') {
        const loc = this.lm.locations.find(l => l.id === locId);
        if (!loc) return;
        if (this._reviewPending.has(locId)) return;
        if (this._isGeneratingReview) return; // 이미 생성 중

        const list = this._getReviewContainer(source);
        if (!list.length) return;
        this._reviewPending.add(locId);
        this._isGeneratingReview = true; // ★ 플래그 ON (scanMessage 차단)
        list.html('<div style="text-align:center;padding:12px;font-size:12px;color:#9A8A7A">🔄 리뷰 생성 중...</div>');

        try {
            const ctx = getContext();
            const userName = ctx.name1 || 'User';
            const charName = ctx.name2 || 'Character';
            // ★ 캐릭터 맥락 추출 (리뷰 맛 향상)
            const charDesc = (ctx.characters?.[ctx.characterId]?.description || '').substring(0, 300);
            const charPersonality = (ctx.characters?.[ctx.characterId]?.personality || '').substring(0, 200);
            const charScenario = (ctx.characters?.[ctx.characterId]?.scenario || '').substring(0, 200);
            const charContext = [charDesc, charPersonality, charScenario].filter(Boolean).join(' | ').substring(0, 500);
            const s = extension_settings[EXTENSION_NAME];
            const eLang = s?.eventLang || 'auto';
            const langInst = eLang === 'ko' ? 'Write ALL reviews in Korean.' : eLang === 'en' ? 'Write ALL reviews in English.' : 'Write in the same language as the RP.';

            // 이벤트 요약 (최근 5개)
            const evSummary = (loc.events || []).slice(-5).map(e => `${e.mood||'📝'} ${e.title||e.text||''}`).join(', ') || '아직 이벤트 없음';
            // ★ 최근 채팅 맥락 (리뷰 품질 향상 — 톤/말투/관계 흡수)
            const recentChat = getRecentChatContext(2500);

            // 방문횟수 보정 리뷰 수 (최소 3개 보장, 3~5개 중심)
            const visits = loc.visitCount || 0;
            let weights;
            if (visits <= 2) {
                // 3~5개: [3]=50%, [4]=30%, [5]=20%
                weights = [0.50, 0.80, 1.0];
            } else if (visits <= 5) {
                // 3~6개: [3]=25%, [4]=35%, [5]=25%, [6]=15%
                weights = [0.25, 0.60, 0.85, 1.0];
            } else {
                // 4~7개: [4]=30%, [5]=35%, [6]=20%, [7]=15%
                weights = [0.30, 0.65, 0.85, 1.0];
            }
            const rnd = Math.random();
            const baseCount = visits <= 5 ? 3 : 4;
            let reviewCount = baseCount;
            for (let i = 0; i < weights.length; i++) {
                if (rnd < weights[i]) { reviewCount = baseCount + i; break; }
            }
            // ★ 터줏대감 목록 (리뷰어로 활용)
            const npcList = (loc.npcs || []).map(n => `"${n.name}"(${n.role || n.type})`).join(', ');

            const prompt = `You are writing Google Maps-style character reviews for an RP location. Each reviewer has STRONG opinions, personal grudges, inside jokes, and emotional memories tied to this place. Write like real people leaving passionate, opinionated, sometimes petty reviews.

Generate ${reviewCount} reviews.
Place: "${loc.name}" | Visits: ${loc.visitCount || 0} | Memo: "${loc.memo || ''}"
Events: ${evSummary}
Characters: User="${userName}", Char="${charName}"
${charContext ? `Character context: ${charContext}` : ''}
${langInst}
${recentChat ? `\n[Recent RP scenes — use these to absorb character voice, tone, and relationship dynamics]:\n${recentChat}\n` : ''}
Reviewers: pick from "${charName}", "${userName}"${npcList ? `, ${npcList}` : ''}, or other NPCs/animals that might visit this place.

REVIEW STYLE RULES:
- Each review: 2-4 sentences. Be DETAILED and SPECIFIC.
- Reference ACTUAL events that happened here (from the Events list above).
- Use each character's UNIQUE speech patterns, slang, and personality quirks.
- Include sensory details (smells, sounds, textures, temperature).
- Mix emotions: nostalgia, complaint, humor, affection, sarcasm, passive-aggression.
- Some reviews should be hilariously petty or oddly specific.
- Animals/pets write from their perspective (a cat reviewing a kitchen = "the warm spot near the stove is acceptable").
- NPCs can have strong opinions about the main characters.
${npcList ? `\nIMPORTANT: Prioritize the known NPCs/animals listed above as reviewers — they are real characters from this location.` : ''}

OUTPUT THIS EXACT FORMAT (valid JSON, no markdown, no explanation):
{"summary":"one atmospheric, poetic sentence capturing this place's soul","reviews":[{"name":"reviewer","role":"role","avatar":"emoji","stars":4,"text":"detailed review 2-4 sentences","daysAgo":3}]}

CRITICAL: Start your response with { and end with }. Nothing else.`;

            let result = await callLLM(prompt);
            console.log(`[${EXTENSION_NAME}] 🔧 Review LLM result: ${result ? result.substring(0, 100) + '...' : 'null'}`);
            // ★ 실패 시 1회 재시도
            if (!result) {
                dbg('🔄 Review LLM retry (1st was null)...');
                result = await callLLM(prompt);
            }
            if (!result) {
                const err = window._wtLastLLMError || '알 수 없는 오류';
                list.html(`<div style="font-size:11px;color:#F5A8A8;padding:8px">⚠️ LLM 응답 없음<br><span style="font-size:10px;color:#B0A898">${err}</span><br><span style="font-size:10px;color:#B0A898">API 키 확인 또는 F12 콘솔 확인</span></div>`);
                return;
            }

            let parsed = parseLLMJson(result);
            // ★ 파싱 실패 시 1회 재시도
            if (!parsed) {
                dbg('🔄 Review JSON retry (1st parse failed)...');
                result = await callLLM(prompt);
                if (result) parsed = parseLLMJson(result);
            }
            if (!parsed) { list.html(`<div style="font-size:11px;color:#F5A8A8;padding:8px">⚠️ JSON 파싱 실패<div style="font-size:9px;margin-top:4px;color:#B0A898;word-break:break-all">${(result||'').substring(0, 150)}...</div></div>`); return; }
            const rawReviews = Array.isArray(parsed.reviews) ? parsed.reviews : Array.isArray(parsed) ? parsed : [];
            const reviews = rawReviews.filter(r => r && r.text);
            const aiSummary = parsed.summary || '';
            if (!reviews.length) { list.html('<div style="font-size:11px;color:#9A8A7A;padding:8px">리뷰 없음</div>'); return; }

            this._reviewCache.set(locId, { reviews, summary: aiSummary });
            await this.lm.updateLocation(locId, {
                generatedReviews: reviews,
                reviewSummary: aiSummary,
                reviewUpdatedAt: Date.now(),
            });
            this._renderReviews(list, reviews, aiSummary);
            this._renderCachedReviews(locId, '#wt-pop-review-list');
            this._renderCachedReviews(locId, '#wt-bs-review-list');
            // T3: 개요 탭 미리보기도 갱신
            this._renderReviewPreview(locId);

        } catch(e) {
            console.error('[wt] Review gen error:', e);
            list.html('<div style="font-size:11px;color:#F5A8A8;padding:8px">오류: ' + e.message + '</div>');
        } finally {
            this._reviewPending.delete(locId);
            setTimeout(() => { this._isGeneratingReview = false; }, 1000); // ★ 1초 후 해제 (안전 마진)
        }
    }

    _renderReviews(container, reviews, aiSummary) {
        container.empty();

        // 1. AI 요약 (골드 사이드바)
        if (aiSummary) {
            container.append(`<div style="padding:8px 10px;background:#FFFBF0;border-left:3px solid #F6A93A;border-radius:0 8px 8px 0;margin-bottom:10px">
                <div style="font-size:10px;color:#8B6B14;font-weight:600;margin-bottom:3px">AI 리뷰 요약</div>
                <div style="font-size:12px;color:#6B5B14;line-height:1.6;font-style:italic">"${aiSummary}"</div>
            </div>`);
        }

        // 2. 별점 바 그래프 (구글맵 스타일)
        const avgStars = (reviews.reduce((s, r) => s + (r.stars || 3), 0) / reviews.length).toFixed(1);
        const starsFull = '★'.repeat(Math.round(avgStars)) + '☆'.repeat(5 - Math.round(avgStars));
        const starCounts = [0,0,0,0,0];
        reviews.forEach(r => { const s = Math.min(5, Math.max(1, r.stars||3)); starCounts[s-1]++; });
        const maxCount = Math.max(...starCounts, 1);

        let barsHtml = '';
        for (let i = 5; i >= 1; i--) {
            const pct = Math.round((starCounts[i-1] / maxCount) * 100);
            barsHtml += `<div style="display:flex;align-items:center;gap:4px"><span style="font-size:10px;color:#70757A;width:8px">${i}</span><div style="flex:1;height:8px;background:#EAE6DC;border-radius:4px;overflow:hidden"><div style="width:${pct}%;height:100%;background:#F6A93A;border-radius:4px"></div></div></div>`;
        }

        container.append(`<div style="display:flex;align-items:center;gap:12px;padding:8px 0;margin-bottom:6px">
            <div style="text-align:center">
                <div style="font-size:32px;font-weight:800;color:#202124;line-height:1">${avgStars}</div>
                <div style="color:#F6A93A;font-size:12px;letter-spacing:1px;margin-top:2px">${starsFull}</div>
                <div style="font-size:10px;color:#70757A;margin-top:1px">(리뷰 ${reviews.length}건)</div>
            </div>
            <div style="flex:1;display:flex;flex-direction:column;gap:3px">${barsHtml}</div>
        </div>`);

        // 3. 감정 키워드 칩
        const keywords = {};
        reviews.forEach(r => {
            const t = (r.text || '').toLowerCase();
            const kw = [['💕','로맨틱'],['⚡','긴장'],['☕','커피'],['🌧️','비'],['😢','슬픔'],['😊','평온'],['🔥','분노'],['🍺','술']];
            kw.forEach(([emoji, word]) => { if (t.includes(word) || t.includes(emoji)) keywords[`${emoji} ${word}`] = (keywords[`${emoji} ${word}`]||0)+1; });
        });
        if (Object.keys(keywords).length) {
            container.append(`<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #F0EDE5">${
                Object.entries(keywords).map(([k,v]) => `<span style="padding:4px 10px;background:#F1F3F4;border-radius:14px;font-size:11px;color:#3C4043;font-weight:500">${k} ${v}</span>`).join('')
            }</div>`);
        }

        // 4. 캐릭터 리뷰 헤더 + 재생성 버튼
        container.append(`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span style="font-size:14px;font-weight:700;color:#202124">캐릭터 리뷰</span>
            <button class="wt-rv-regen" style="font-size:11px;color:#1A73E8;background:none;border:none;cursor:pointer;font-family:inherit;font-weight:500;padding:4px 8px">🔄 새 리뷰 생성</button>
        </div>`);

        // 재생성 버튼 이벤트
        container.find('.wt-rv-regen').on('click', (e) => {
            e.stopPropagation();
            const locId = $('#wt-bottomsheet').attr('data-id') || $('#wt-popover').attr('data-id');
            if (locId) this._generateReviews(locId);
        });

        // 5. 개별 리뷰 카드 (3개 이상이면 2개만 미리보기)
        const showAll = reviews.length < 3;
        const previewReviews = showAll ? reviews : reviews.slice(0, 2);

        previewReviews.forEach(rv => {
            const stars = '★'.repeat(rv.stars || 3) + '☆'.repeat(5 - (rv.stars || 3));
            const daysText = rv.daysAgo === 1 ? '어제' : rv.daysAgo <= 7 ? `${rv.daysAgo}일 전` : `${Math.ceil(rv.daysAgo / 7)}주 전`;

            container.append(`<div class="wt-rv-card-item" style="padding:10px 0;border-bottom:1px solid #F1F3F4">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
                    <div style="width:32px;height:32px;border-radius:50%;background:#F1F3F4;display:flex;align-items:center;justify-content:center;font-size:16px">${rv.avatar || '👤'}</div>
                    <div>
                        <div style="font-size:13px;font-weight:700;color:#202124">${rv.name || 'Unknown'}</div>
                        <div style="font-size:10px;color:#70757A">${rv.role || ''}</div>
                    </div>
                </div>
                <div style="font-size:10px;color:#F6A93A;margin-bottom:4px">${stars} · ${daysText}</div>
                <div style="font-size:13px;line-height:1.7;color:#3C4043">${rv.text || ''}</div>
            </div>`);
        });

        // ★ 3개 이상이면 "모든 리뷰 보기" 버튼
        if (!showAll) {
            const hiddenCards = reviews.slice(2);
            const moreBtn = $(`<div style="display:flex;justify-content:center;padding:12px;margin-top:4px">
                <button class="wt-rv-showmore" style="padding:10px 0;width:100%;background:#F8F9FA;border:1px solid #E8EAED;border-radius:24px;font-size:13px;font-weight:500;color:#3C4043;cursor:pointer;text-align:center;font-family:inherit">모든 리뷰 보기 ›</button>
            </div>`);
            container.append(moreBtn);

            moreBtn.find('.wt-rv-showmore').on('click', function(e) {
                e.stopPropagation();
                // 나머지 리뷰 펼치기
                hiddenCards.forEach(rv => {
                    const stars = '★'.repeat(rv.stars || 3) + '☆'.repeat(5 - (rv.stars || 3));
                    const daysText = rv.daysAgo === 1 ? '어제' : rv.daysAgo <= 7 ? `${rv.daysAgo}일 전` : `${Math.ceil(rv.daysAgo / 7)}주 전`;
                    moreBtn.before(`<div style="padding:10px 0;border-bottom:1px solid #F1F3F4">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
                            <div style="width:32px;height:32px;border-radius:50%;background:#F1F3F4;display:flex;align-items:center;justify-content:center;font-size:16px">${rv.avatar || '👤'}</div>
                            <div><div style="font-size:13px;font-weight:700;color:#202124">${rv.name || 'Unknown'}</div><div style="font-size:10px;color:#70757A">${rv.role || ''}</div></div>
                        </div>
                        <div style="font-size:10px;color:#F6A93A;margin-bottom:4px">${stars} · ${daysText}</div>
                        <div style="font-size:13px;line-height:1.7;color:#3C4043">${rv.text || ''}</div>
                    </div>`);
                });
                moreBtn.remove(); // 버튼 제거
            });
        }
    }

    // (첫 번째 _showEventPanel 제거됨 — 아래 두 번째만 사용)

    // 패널 복귀 시 이벤트 리바인드
    _rebindPanel() {
        try {
            // 핵심 이벤트 리스너 재등록
            const self = this;
            $('.wt-loc-item').off('click').on('click', function() { self.showPop($(this).attr('data-id')); });
            $('#wt-add-name').off('keydown').on('keydown', (e) => { if (e.key === 'Enter') this._addLoc(); });
            $('#wt-add-btn').off('click').on('click', () => this._addLoc());
        } catch(e) { console.log('[wt] rebind:', e); }
    }

    // ========== 전체 이벤트 패널 뷰 ==========
    _showEventPanel(locId) {
        const loc = this.lm.locations.find(l => l.id === locId);
        if (!loc) return;
        const events = loc.events || [];
        const ps = { emoji: '📍' }; // 기본 이모지

        // 현재 패널 바디 저장
        const body = $('#wt-panel-body');
        if (!this._savedPanelHTML) this._savedPanelHTML = body.html();

        // 헤더
        let html = `<div style="padding:8px 12px">`;
        html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">`;
        html += `<button id="wt-event-back" style="background:none;border:none;font-size:18px;cursor:pointer;padding:4px;color:#775537">←</button>`;
        html += `<div style="flex:1">`;
        html += `<div style="font-size:16px;font-weight:800;color:#2D2418">${loc.name}</div>`;
        html += `<div style="font-size:11px;color:#B0A898">📖 기억 ${events.length}건</div>`;
        html += `</div></div>`;

        // 이벤트 없음
        if (!events.length) {
            html += `<div style="text-align:center;padding:40px 20px;color:#B0A898;font-size:13px;font-style:italic">`;
            html += `아직 이 장소에 기억이 없어요<br>RP를 진행하면 자동으로 쌓여요 🐶`;
            html += `</div>`;
        } else {
            // 이벤트 리스트 (역순 = 최신 먼저)
            html += `<div style="display:flex;flex-direction:column;gap:8px">`;
            [...events].reverse().forEach((ev, i) => {
                const realIdx = events.length - 1 - i;
                const mood = ev.mood || '📝';
                const dateStr = ev.isPlan ? (ev.planDate ? `📌 ${ev.planDate}` : '📌 예정') : (ev.rpDate || (ev.timestamp ? new Date(ev.timestamp).toLocaleDateString('ko-KR', { year:'numeric', month:'short', day:'numeric' }) : (ev.date || '')));
                const timeStr = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' }) : '';
                const src = ev.source === 'USER' ? '✍️' : '🤖';

                html += `<div class="wt-event-card" data-eidx="${realIdx}" style="background:#FAFAF5;border:1px solid #EAE6DC;border-radius:12px;padding:10px 12px;position:relative">`;
                html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">`;
                html += `<span style="font-size:14px">${mood}</span>`;
                html += `<div style="display:flex;align-items:center;gap:6px">`;
                html += `<span style="font-size:9px;color:#B0A898">${src}</span>`;
                html += `<span style="font-size:10px;color:#B0A898">${dateStr} ${timeStr}</span>`;
                html += `<button class="wt-event-del" data-eidx="${realIdx}" style="background:none;border:none;font-size:11px;color:#D4A0A0;cursor:pointer;padding:2px 4px">✕</button>`;
                html += `</div></div>`;
                html += `<div style="font-size:12.5px;color:#3D3028;line-height:1.5">${ev.text}</div>`;
                html += `</div>`;
            });
            html += `</div>`;
        }

        html += `</div>`;
        body.html(html);

        // 뒤로가기
        const self = this;
        $('#wt-event-back').on('click', () => self._closeEventPanel());

        // 이벤트 삭제
        $('.wt-event-del').on('click', async function() {
            const idx = parseInt($(this).attr('data-eidx'));
            events.splice(idx, 1);
            await self.lm.updateLocation(locId, { events });
            self._showEventPanel(locId); // 새로고침
        });
    }

    _closeEventPanel() {
        if (this._savedPanelHTML) {
            $('#wt-panel-body').html(this._savedPanelHTML);
            this._savedPanelHTML = null;
            this._rebindPanel();
            this.refresh();
        }
    }

    // 자동 이벤트 기록 — AI 응답에서 키워드 추출 후 플로팅 알림
    showEventNotify(locName, ev, locId) {
        $('#wt-event-overlay').remove();

        const evText = typeof ev === 'string' ? ev : ev.text;
        const evTag = typeof ev === 'object' ? (ev.tag || '📝') : '📝';
        const preview = evText.length > 80 ? evText.substring(0, 80) + '...' : evText;

        const overlay = $(`<div id="wt-event-overlay" style="position:fixed;top:60px;left:50%;transform:translateX(-50%);width:320px;max-width:90vw;background:rgba(245,244,237,0.98);border:2px solid #5E84E2;border-radius:14px;padding:10px 14px;z-index:2147483646;box-shadow:0 6px 24px rgba(0,0,0,0.2);backdrop-filter:blur(8px);font-family:-apple-system,'Noto Sans KR',sans-serif">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
                <span style="font-size:16px">${evTag}</span>
                <strong style="font-size:14px;color:#775537">${locName}</strong>
                <span style="font-size:12px;color:#9A8A7A">기억 등록!</span>
            </div>
            <div style="font-size:11.5px;color:#5A4030;line-height:1.5;padding:6px 8px;background:rgba(0,0,0,0.03);border-radius:8px;margin-bottom:8px;white-space:pre-wrap">${preview}</div>
            <button id="wt-event-ok" style="width:100%;padding:7px;background:#F7EC8D;border:1.5px solid #F6A93A;border-radius:8px;font-size:12px;font-weight:600;color:#775537;cursor:pointer;font-family:inherit">✅ 확인</button>
        </div>`);

        $('body').append(overlay);
        overlay.find('#wt-event-ok').on('click', () => overlay.remove());
        setTimeout(() => overlay.remove(), 6000);
    }

    async _addDist() {
        const locId = $('#wt-popover').attr('data-id');
        const targetId = $('#wt-pop-dist-target').val();
        const value = $('#wt-pop-dist-value').val().trim();
        const level = parseInt($('#wt-pop-dist-level').val()) || 5;
        if (!locId || !targetId) return;
        const text = value || `거리 ${level}`;

        await this.lm.setDistance(locId, targetId, text, null, level);
        $('#wt-pop-dist-value').val(''); $('#wt-pop-dist-level').val(5); $('#wt-pop-dist-lvl-val').text('5');
        this._updDistSection(locId);
        this.pi?.inject();
        // ★ 맵 리렌더 (점선+pill 즉시 표시)
        if (this.mapRenderer) this.mapRenderer.render();
        toastSuccess(`📏 거리 저장!`);
    }

    _fmt(ts) { return new Date(ts).toLocaleDateString('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }

    // ========== 드래그 요약 (텍스트 선택 → 📝 → LLM 요약 → 이벤트 저장) ==========
    registerDragSummary() {
        // 📝 플로팅 버튼 생성
        const btn = document.createElement('div');
        btn.id = 'wt-drag-btn';
        btn.innerHTML = '📝';
        btn.style.cssText = 'display:none;position:fixed;bottom:80px;right:16px;width:44px;height:44px;border-radius:50%;background:#F7EC8D;border:2px solid #F6A93A;box-shadow:0 4px 12px rgba(0,0,0,0.2);font-size:20px;text-align:center;line-height:44px;cursor:pointer;z-index:2147483645;transition:transform 0.2s;user-select:none';
        document.body.appendChild(btn);

        let selectedText = '';
        const self = this;

        // 텍스트 선택 감지 (PC: selectionchange, 모바일: touchend 백업)
        document.addEventListener('selectionchange', () => {
            const sel = window.getSelection();
            const text = sel?.toString().trim() || '';
            // 채팅 영역에서 선택된 텍스트만 (20자 이상)
            if (text.length >= 20) {
                selectedText = text;
                btn.style.display = 'block';
                btn.style.transform = 'scale(1.1)';
                setTimeout(() => btn.style.transform = 'scale(1)', 150);
            } else {
                selectedText = '';
                btn.style.display = 'none';
            }
        });

        // 📱 모바일 백업: touchend 후 선택 확인 (selectionchange 미발동 대비)
        document.addEventListener('touchend', () => {
            setTimeout(() => {
                const sel = window.getSelection();
                const text = sel?.toString().trim() || '';
                if (text.length >= 20 && btn.style.display === 'none') {
                    selectedText = text;
                    btn.style.display = 'block';
                    btn.style.transform = 'scale(1.1)';
                    setTimeout(() => btn.style.transform = 'scale(1)', 150);
                }
            }, 300); // 모바일 선택 확정 대기
        });

        // 📝 클릭 → LLM 요약 → 이벤트 저장
        btn.addEventListener('click', async () => {
            if (!selectedText || !self.lm.currentLocationId) {
                btn.style.display = 'none';
                return;
            }

            const loc = self.lm.locations.find(l => l.id === self.lm.currentLocationId);
            if (!loc) { btn.style.display = 'none'; return; }

            // 로딩 표시
            btn.innerHTML = '⏳';
            btn.style.pointerEvents = 'none';

            try {
                const ctx = getContext();
                const userName = ctx?.name1 || 'User';
                const charName = ctx?.name2 || 'Character';
                const s = extension_settings[EXTENSION_NAME];
                const eLang = s?.eventLang || 'auto';
                const langInst = eLang === 'ko' ? 'Write in Korean.'
                               : eLang === 'en' ? 'Write in English.'
                               : 'Write in the same language as the text.';

                let evTitle = null, evText = null, evMood = '📝';
                const trimmed = selectedText.substring(0, 1500);

                try {
                    const prompt = `Summarize this RP scene excerpt as a place-event memory. ${langInst}
Character info: protagonist="${userName}", main character="${charName}".
Respond with ONLY JSON: {"mood":"💕 or 📅 or ⚡","title":"place-meaning hook max 15chars","summary":"detailed 2-sentence summary"}
If mundane: {"mood":null}

Text: ${trimmed}`;

                    const result = await callLLM(prompt);
                    if (result) {
                        const p = parseLLMJson(result);
                        if (p?.mood && p?.summary) {
                            evTitle = p.title || p.summary.substring(0, 15) + '...';
                            evText = p.summary;
                            evMood = p.mood;
                        }
                    }
                } catch(_) {}

                // LLM 실패 시 선택 텍스트 그대로
                if (!evText) {
                    evText = trimmed.length > 60 ? trimmed.substring(0, 60) + '...' : trimmed;
                    evTitle = trimmed.length > 15 ? trimmed.substring(0, 15) + '...' : trimmed;
                }

                // 저장
                if (!loc.events) loc.events = [];
                loc.events.push({ text: evText, title: evTitle, mood: evMood, timestamp: Date.now(), source: 'drag' });
                if (loc.events.length > 20) loc.events = loc.events.slice(-20);
                await self.lm.updateLocation(loc.id, { events: loc.events });

                // 알림
                self.showEventNotify(loc.name, { text: evText, tag: evMood }, loc.id);
                // ★ 팝오버 열려있으면 이벤트 목록 자동 갱신
                const openId = $('#wt-popover').attr('data-id');
                if (openId === loc.id && $('#wt-popover').is(':visible')) {
                    self._updEventsList(loc.id);
                }
                window.getSelection()?.removeAllRanges();

            } catch(e) {
                console.error('[wt] Drag summary error:', e);
                toastr?.warning?.('요약 실패');
            }

            btn.innerHTML = '📝';
            btn.style.pointerEvents = 'auto';
            btn.style.display = 'none';
            selectedText = '';
        });
    }
}
