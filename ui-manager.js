// 🐶 World Tracker — ui-manager.js (Inline Toast + Popover)
// ★ BUILD: 2026-04-02 hotfix16 (session5 FINAL — mood cards + accordion timeline)
console.log('[wt] ui-manager hotfix16 loaded');

import { getContext, extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { EXTENSION_NAME, wtNotify, toastWarn, toastSuccess, loadLeaflet, wtMascot, wtTreat, runWithoutAutoDetect } from './index.js';
import { MapRenderer } from './map-renderer.js';
import { LeafletRenderer } from './leaflet-renderer.js';

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
    }

    // ========== 설정 패널 (SillyTavern 확장 설정) ==========
    createSettingsPanel() {
        const html = `<div id="wt-settings" class="wt-settings"><div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🐶 World Tracker <span class="wt-version">v0.3.0-beta</span></b>
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
        // 🔧 비밀 디버그: 💭 5번 탭
        let _t=0, _tm=null;
        $(document).on('click','#wt-secret', e => { e.stopPropagation(); _t++; clearTimeout(_tm);
            if(_t>=5){_t=0;s.debugMode=!s.debugMode;saveSettingsDebounced();wtNotify(s.debugMode?'🔧 Debug ON':'🔧 Debug OFF','info',2000);}
            _tm=setTimeout(()=>{_t=0},2000);
        });
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

                <div class="wt-map-toggle" id="wt-map-toggle">🗺️ 지도 ▾</div>
                <div id="wt-map-section" style="display:none">
                    <div class="wt-map-mode-bar">
                        <button id="wt-mode-node" class="wt-mode-btn wt-mode-active">🗺️ 약도</button>
                        <button id="wt-mode-leaflet" class="wt-mode-btn">🐾 Paw Maps</button>
                        <button id="wt-mode-fantasy" class="wt-mode-btn" style="display:none">🏰 지도</button>
                    </div>
                    <div id="wt-search-bar" class="wt-search-bar" style="position:relative">
                        <button class="wt-back-btn" style="display:none" onclick="window.__wtBackToMap&&window.__wtBackToMap()">←</button>
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
                        <div id="wt-pop-events-section" style="margin-top:4px">
                            <div style="font-size:12px;color:#9A8A7A;margin-bottom:4px">📝 이벤트 기록</div>
                            <div id="wt-pop-events-list" style="display:flex;flex-direction:column;gap:3px;max-height:300px;overflow-y:auto"></div>
                            <div style="display:flex;gap:4px;margin-top:4px">
                                <input type="text" id="wt-pop-event-input" class="wt-input" placeholder="이벤트 추가..." style="flex:1;font-size:12px;padding:5px 8px"/>
                                <button id="wt-pop-event-add" class="wt-btn-accent wt-btn-s">+</button>
                            </div>
                        </div>
                        <input type="text" id="wt-pop-status" class="wt-input" placeholder="상태 (붐빔, 한산...)"/>
                        <div style="font-size:12px;color:#9A8A7A;margin-top:2px">🏷️ 별칭 (쉼표 구분)</div>
                        <input type="text" id="wt-pop-aliases" class="wt-input" placeholder="예: 사격장, Shooting range" style="font-size:12px"/>
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
            // B5: 약도 모드일 때 지도 섹션 자동 표시 + 렌더 트리거
            const curMode = s?.mapMode || 'node';
            if (curMode === 'node' || curMode === 'fantasy') {
                $('#wt-map-section').show();
                $('#wt-map-toggle').text('🗺️ 지도 ▴');
            }
            setTimeout(() => {
                if (this.mapRenderer) this.mapRenderer.render();
                if (this.leafletRenderer?.map) this.leafletRenderer.invalidateSize();
            }, 350);
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
            if (s.mapMode !== 'fantasy') s._prevMapMode = s.mapMode || 'node';
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
        const mode = s?.mapMode || 'node';

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
        $('#wt-scene-name').text(cur?.name || '—').css('color', cur?.color || '');
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
                            if (addr) await this.lm.updateLocation(locId, { address: addr });
                            toastSuccess(`📍 "${loc.name}" → ${addr}`);
                        } else { toastSuccess(`📍 "${loc.name}" 이동!`); }
                    } catch(_) { toastSuccess(`📍 "${loc.name}" 이동!`); }
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
        const list=$('#wt-loc-list').empty(); $('#wt-loc-count').text(this.lm.locations.length);
        if (!this.lm.locations.length) { list.html('<div class="wt-empty">RP를 시작하면 장소가 자동 추가돼요!</div>'); return; }
        for (const loc of [...this.lm.locations].sort((a,b)=>(b.visitCount||0)-(a.visitCount||0))) {
            const cur = loc.id === this.lm.currentLocationId;
            const item = $(`<div class="wt-loc-item ${cur?'wt-loc-active':''}" data-id="${loc.id}">
                <div class="wt-loc-dot" style="background:${loc.color}"></div>
                <div class="wt-loc-info"><div class="wt-loc-name">${loc.name}${cur?' 🐾':''}</div></div>
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
        $('#wt-popover').attr('data-id', id);
        $('#wt-pop-title').val(l.name); $('#wt-pop-visits').text(l.visitCount||0);
        $('#wt-pop-first').text(l.rpFirstVisited || (l.firstVisited?this._fmt(l.firstVisited):'—'));
        $('#wt-pop-last').text(l.rpLastVisited || (l.lastVisited?this._fmt(l.lastVisited):'—'));
        $('#wt-pop-memo').val(l.memo||''); $('#wt-pop-status').val(l.status||'');
        $('#wt-pop-ainotes').val(l.aiNotes||'');
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
        const events = (loc.events || []).filter(e => e.source !== 'move');

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
            eventsHtml = events.slice(-5).reverse().map(ev => {
                const dateStr = ev.rpDate || (ev.timestamp ? new Date(ev.timestamp).toLocaleDateString('ko-KR', { month:'numeric', day:'numeric' }) : '');
                const hasDetail = ev.text && ev.text !== ev.title && ev.text.length > 15;
                return `<div class="wt-bs-ev-card" style="background:#FAFAF5;border-radius:7px;padding:7px 9px;border:1px solid #EAE6DC;margin-bottom:4px;cursor:${hasDetail ? 'pointer' : 'default'}">
                    <div style="display:flex;align-items:center;gap:5px"><span style="font-size:12px">${ev.mood||'📝'}</span><span style="flex:1;font-weight:600;font-size:10.5px;color:#5A4030">${ev.title||ev.text||''}</span><span style="font-size:8px;color:#B0A898">${dateStr}</span>${hasDetail ? '<span class="wt-bs-ev-arrow" style="font-size:8px;color:#B0A898">▼</span>' : ''}</div>
                    ${hasDetail ? `<div class="wt-bs-ev-detail" style="display:none;margin-top:5px;padding-top:5px;border-top:1px dashed #EAE6DC;font-size:9.5px;line-height:1.6;color:#7A7060">${ev.text}</div>` : ''}
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
            <div style="display:flex;gap:5px;padding:2px 14px 8px;overflow-x:auto">
                <button class="wt-bs-pill-btn" data-action="move" style="display:flex;align-items:center;gap:3px;padding:6px 12px;border-radius:18px;border:1.5px solid #2B8A6E;background:#2B8A6E;font-size:10.5px;font-weight:600;color:#fff;white-space:nowrap;cursor:pointer;font-family:inherit${cur ? ';opacity:.4' : ''}">🐾 이동</button>
                <button class="wt-bs-pill-btn" data-action="edit" style="display:flex;align-items:center;gap:3px;padding:6px 12px;border-radius:18px;border:1.5px solid #E0E0E0;background:#fff;font-size:10.5px;font-weight:600;color:#3C4043;white-space:nowrap;cursor:pointer;font-family:inherit">✏️ 수정</button>
                <button class="wt-bs-pill-btn" data-action="save" style="display:flex;align-items:center;gap:3px;padding:6px 12px;border-radius:18px;border:1.5px solid #2B8A6E;background:#E8F4F0;font-size:10.5px;font-weight:600;color:#2B8A6E;white-space:nowrap;cursor:pointer;font-family:inherit">🔖 저장됨</button>
                <button class="wt-bs-pill-btn" data-action="dist" style="display:flex;align-items:center;gap:3px;padding:6px 12px;border-radius:18px;border:1.5px solid #E0E0E0;background:#fff;font-size:10.5px;font-weight:600;color:#3C4043;white-space:nowrap;cursor:pointer;font-family:inherit">📏 거리</button>
            </div>
            <div id="wt-bs-tabs" style="display:flex;border-bottom:2px solid #F0EDE5">
                <div class="wt-bs-tab" data-tab="overview" style="flex:1;text-align:center;padding:8px;font-size:11px;font-weight:600;color:#2B8A6E;cursor:pointer;border-bottom:2.5px solid #2B8A6E;margin-bottom:-2px">개요</div>
                <div class="wt-bs-tab" data-tab="events" style="flex:1;text-align:center;padding:8px;font-size:11px;font-weight:600;color:#B0A898;cursor:pointer;border-bottom:2.5px solid transparent;margin-bottom:-2px">이벤트</div>
                <div class="wt-bs-tab" data-tab="review" style="flex:1;text-align:center;padding:8px;font-size:11px;font-weight:600;color:#B0A898;cursor:pointer;border-bottom:2.5px solid transparent;margin-bottom:-2px">리뷰</div>
            </div>
            <div id="wt-bs-tab-overview" style="padding:10px 14px;overflow-y:auto">
                <!-- 분위기 카드 갤러리 -->
                ${this._buildMoodCardHtml(loc, style)}
                ${loc.address ? `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #F0EDE5;font-size:11px;color:#5A4030"><span style="font-size:13px;color:#9A8A7A">📍</span><div>${loc.address}</div></div>` : ''}
                <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #F0EDE5;font-size:11px;color:#5A4030"><span style="font-size:13px;color:#9A8A7A">📊</span><div>방문 ${v}회<div style="font-size:9px;color:#B0A898">첫 ${loc.rpFirstVisited || (loc.firstVisited ? this._fmt(loc.firstVisited) : '—')} · 최근 ${loc.rpLastVisited || (loc.lastVisited ? this._fmt(loc.lastVisited) : '—')}</div></div></div>
                ${specialHtml}
                ${nearbyHtml}
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
                    <div style="flex:1">최근 방문 기록<div style="font-size:10px;color:#9AA0A6;font-weight:400;margin-top:1px">${loc.lastVisited ? this._fmt(loc.lastVisited) : '—'}</div></div>
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
                    <div style="font-size:10px;font-weight:600;color:#5A4030;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between">🌡️ 분위기 지수 <span style="font-size:9px;color:#9AA0A6;font-weight:400">최근 7일</span></div>
                    <div style="display:flex;align-items:flex-end;gap:3px;height:36px">
                        ${(() => { const moods = events.slice(-7); const bars = []; for(let i=0;i<7;i++){const ev=moods[i]; const h=ev?(['💕','😊'].some(m=>m===ev.mood)?30:['⚡','🔍'].some(m=>m===ev.mood)?70:45):12; const c=ev?(['💕','😊'].some(m=>m===ev.mood)?'#A8D8EA':['⚡','🔍'].some(m=>m===ev.mood)?'#F5A8A8':'#F5C6AA'):'#E8E4D8'; bars.push(`<div style="flex:1;height:${h}%;background:${c};border-radius:2px 2px 0 0"></div>`);} return bars.join(''); })()}
                    </div>
                    <div style="font-size:8px;color:#9AA0A6;text-align:center;margin-top:4px">${events.length ? `이벤트 ${events.length}건 기반` : '데이터 수집 중...'}</div>
                </div>
                ${eventsHtml}
            </div>
            <div id="wt-bs-tab-review" style="display:none;padding:10px 14px;overflow-y:auto">
                <div style="text-align:center;padding:8px">
                    <button id="wt-bs-gen-review" style="padding:8px 16px;background:#E8F0FE;border:1.5px solid #1A73E8;border-radius:18px;font-size:11px;font-weight:600;color:#1A73E8;cursor:pointer;font-family:inherit">🔄 랜덤 리뷰 생성</button>
                </div>
                <div id="wt-bs-review-list"></div>
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
            if (action === 'dist' && id) { self._hideBottomSheet(); self.showPop(id); }
        });
        bs.find('.wt-bs-tab').on('click', function(e) {
            e.stopPropagation();
            const tab = $(this).data('tab');
            bs.find('.wt-bs-tab').css({ color: '#B0A898', borderBottomColor: 'transparent' });
            $(this).css({ color: '#2B8A6E', borderBottomColor: '#2B8A6E' });
            bs.find('[id^="wt-bs-tab-"]').hide();
            bs.find(`#wt-bs-tab-${tab}`).show();
            // 이벤트/리뷰 탭은 full로 확장
            if (tab !== 'overview' && self._bsStage < 3) self._applyBsStage(3);
        });
        // 7. 이벤트 아코디언 클릭 → 펼치기
        bs.find('.wt-bs-ev-card').on('click', function() {
            const det = $(this).find('.wt-bs-ev-detail');
            const arrow = $(this).find('.wt-bs-ev-arrow');
            if (det.length) {
                det.slideToggle(200);
                arrow.text(det.is(':visible') ? '▼' : '▲');
            }
        });
        bs.find('#wt-bs-gen-review').on('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            self._generateReviews(locId, 'bottomsheet');
        });
        this._renderCachedReviews(locId, '#wt-bs-review-list');
        // T3: 개요 탭 리뷰 미리보기 렌더 + "모든 리뷰 보기" 클릭
        this._renderReviewPreview(locId);
        bs.find('#wt-bs-rv-more').on('click', (e) => {
            e.stopPropagation();
            // 리뷰 탭으로 전환
            bs.find('.wt-bs-tab').css({ color: '#B0A898', borderBottomColor: 'transparent' });
            bs.find('.wt-bs-tab[data-tab="review"]').css({ color: '#2B8A6E', borderBottomColor: '#2B8A6E' });
            bs.find('[id^="wt-bs-tab-"]').hide();
            bs.find('#wt-bs-tab-review').show();
            if (self._bsStage < 3) self._applyBsStage(3);
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
    }

    _hideBottomSheet() {
        // B1: 검색창 자동포커스 방지
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) activeEl.blur();
        const bs = document.getElementById('wt-bottomsheet');
        if (bs) { bs.style.cssText = 'display:none'; bs.innerHTML = ''; }
        setTimeout(() => this.leafletRenderer?.invalidateSize(), 200);
        this._bsStage = 0;
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

        handle.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            startY = e.touches[0].clientY;
            startH = bsEl.offsetHeight;
            dragged = false;
            totalDelta = 0;
            bsEl.style.transition = 'none';
            // ★ Full 상태면 top:0 → maxHeight 모드로 전환
            if (self._bsStage === 3) {
                const wrapEl = bsEl.closest('#wt-leaflet-wrap') || bsEl.parentElement;
                const wrapH = wrapEl?.offsetHeight || window.innerHeight;
                bsEl.style.top = 'auto';
                bsEl.style.maxHeight = wrapH + 'px';
                startH = wrapH;
                bsEl.style.zIndex = '2000';
            }
        }, { passive: true });

        handle.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const curY = e.touches[0].clientY;
            const delta = startY - curY;
            totalDelta = delta;
            // B3: threshold 미만이면 시각적 변경 없음
            if (Math.abs(delta) < DRAG_THRESHOLD) return;
            dragged = true;
            const newH = Math.max(40, startH + delta);
            bsEl.style.maxHeight = newH + 'px';
            bsEl.style.top = 'auto';
            bsEl.style.overflowY = newH > 100 ? 'auto' : 'hidden';
        }, { passive: false });

        handle.addEventListener('touchend', () => {
            if (!dragged) {
                // 터치만 하고 안 움직임 → 다음 단계
                bsEl.style.transition = 'max-height 0.3s ease, top 0.3s ease';
                // B2: 핸들 탭 시 peek→half→full→half 반복 (HANDOFF 스펙)
                let next;
                if (self._bsStage === 1) next = 2;
                else if (self._bsStage === 2) next = 3;
                else if (self._bsStage === 3) next = 2;
                else next = 1;
                self._applyBsStage(next);
                return;
            }
            // 드래그 끝 → 스냅
            const h = bsEl.offsetHeight;
            const wrapEl = bsEl.closest('#wt-leaflet-wrap') || bsEl.parentElement;
            const wrapH = wrapEl?.offsetHeight || window.innerHeight;
            bsEl.style.transition = 'max-height 0.3s ease, top 0.3s ease';

            // B2: 스와이프 방향 고려한 스냅
            const velocity = totalDelta; // 양수=위로, 음수=아래로
            const s1 = 80, s2 = wrapH * 0.5, s3 = wrapH;

            if (h < 40) { self._applyBsStage(0); return; } // 닫기

            // 강한 스와이프 → 방향에 따라 바로 이동
            if (Math.abs(velocity) > 80) {
                if (velocity > 0) {
                    // 위로 강하게 → 한 단계 위
                    if (self._bsStage === 1) self._applyBsStage(2);
                    else self._applyBsStage(3);
                } else {
                    // 아래로 강하게 → 한 단계 아래
                    if (self._bsStage === 3) self._applyBsStage(2);
                    else if (self._bsStage === 2) self._applyBsStage(1);
                    else self._applyBsStage(0);
                }
                return;
            }

            // 약한 드래그 → 가장 가까운 스냅포인트
            const d1 = Math.abs(h - s1);
            const d2 = Math.abs(h - s2);
            const d3 = Math.abs(h - s3);

            if (d1 <= d2 && d1 <= d3) { self._applyBsStage(1); }
            else if (d2 <= d3) { self._applyBsStage(2); }
            else { self._applyBsStage(3); }
        });
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
            self._hideBottomSheet();
            self._setMapMode('node');
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

        let recentHtml = locs.slice(0, 5).map(l => {
            const st = this.leafletRenderer?._locStyle?.(l.name) || { emoji: '📍' };
            return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #F1F3F4;cursor:pointer" class="wt-mp-loc" data-id="${l.id}">
                <div style="width:28px;height:28px;border-radius:50%;background:#F1F3F4;display:flex;align-items:center;justify-content:center;font-size:14px">${st.emoji}</div>
                <div style="flex:1"><div style="font-size:12px;font-weight:600;color:#202124">${l.name}</div><div style="font-size:10px;color:#70757A">방문 ${l.visitCount||0}회</div></div>
                <span style="font-size:14px;color:#9AA0A6">🔖</span>
            </div>`;
        }).join('');

        const html = `<div class="wt-bs-handle" style="display:flex;justify-content:center;padding:14px 0 8px;min-height:44px;cursor:pointer"><div style="width:32px;height:4px;background:#D4D0C8;border-radius:2px"></div></div>
            <div style="padding:8px 14px;overflow-y:auto">
                <div style="font-size:16px;font-weight:800;color:#202124;margin-bottom:8px">내 페이지</div>
                <div style="display:flex;gap:6px;margin-bottom:12px;overflow-x:auto">
                    <div style="padding:8px 12px;background:#F8F9FA;border-radius:10px;border:1px solid #E8EAED;white-space:nowrap;min-width:60px;text-align:center"><div style="font-size:16px;font-weight:800;color:#2B8A6E">${locs.length}</div><div style="font-size:8px;color:#70757A">총 장소</div></div>
                    <div style="padding:8px 12px;background:#F8F9FA;border-radius:10px;border:1px solid #E8EAED;white-space:nowrap;min-width:60px;text-align:center"><div style="font-size:16px;font-weight:800;color:#2B8A6E">${totalVisits}</div><div style="font-size:8px;color:#70757A">총 방문</div></div>
                    <div style="padding:8px 12px;background:#F8F9FA;border-radius:10px;border:1px solid #E8EAED;white-space:nowrap;min-width:60px;text-align:center"><div style="font-size:16px;font-weight:800;color:#2B8A6E">${mostVisited?.name||'—'}</div><div style="font-size:8px;color:#70757A">최다 방문</div></div>
                </div>
                <div style="font-size:12px;font-weight:700;color:#202124;margin-bottom:4px">최근 방문한 장소</div>
                ${recentHtml || '<div style="padding:12px;text-align:center;color:#9AA0A6;font-size:11px">아직 없어요</div>'}
                <div style="font-size:12px;font-weight:700;color:#202124;margin:14px 0 6px;display:flex;justify-content:space-between">내 목록 <span style="font-size:10px;color:#1A73E8;font-weight:500">+ 새 목록</span></div>
                <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #F1F3F4">💜<div style="flex:1"><div style="font-size:12px;font-weight:600">즐겨찾는 장소</div><div style="font-size:10px;color:#70757A">비공개 · ${locs.length}곳</div></div>⋮</div>
                <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #F1F3F4">⭐<div style="flex:1"><div style="font-size:12px;font-weight:600">별표표시된 장소</div><div style="font-size:10px;color:#70757A">비공개</div></div>⋮</div>
                <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #F1F3F4">🚩<div style="flex:1"><div style="font-size:12px;font-weight:600">가고 싶은 장소</div><div style="font-size:10px;color:#70757A">비공개</div></div>⋮</div>
                <div style="display:flex;align-items:center;gap:10px;padding:10px 0">🧳<div style="flex:1"><div style="font-size:12px;font-weight:600">여행 계획</div><div style="font-size:10px;color:#70757A">비공개</div></div>⋮</div>
            </div>`;

        const bs = $('#wt-bottomsheet');
        bs.html(html).show().css({ background: '#fff' });
        this._applyBsStage(1); // peek (350px) — 전체 바텀시트 동일
        this._bindBsDrag(bs[0]);

        // 핸들바 sticky
        bs.find('.wt-bs-handle').css({ position: 'sticky', top: 0, zIndex: 10, background: '#fff' });

        const self = this;
        bs.find('.wt-mp-loc').on('click', function(e) {
            // #8: 단계 전환 중 클릭 차단
            if (self._bsTransitioning) { e.stopPropagation(); return; }
            const id = $(this).data('id');
            self._hideBottomSheet();
            $('.wt-paw-tab[data-tab="explore"]').click();
            setTimeout(() => self._showBottomSheet(id), 300);
        });
    }

    // ========== 🕐 타임라인 (아코디언 — 오늘 펼침, 과거 접힘) ==========
    _showTimelineBS() {
        const bs = $('#wt-bottomsheet');
        const movements = [...(this.lm.movements || [])].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const locs = this.lm.locations;
        const dists = this.lm.distances || [];
        const curLocId = this.lm.currentLocationId;

        // 날짜별 그룹핑 (키: 정렬용 timestamp, 값: { label, items })
        const groups = new Map();
        const _dayKey = (ts) => {
            const d = new Date(ts);
            return `${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()}`;
        };
        const _dayLabel = (ts) => {
            const d = new Date(ts);
            const wk = ['일','월','화','수','목','금','토'][d.getDay()];
            return `${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()} (${wk})`;
        };

        for (const mov of movements) {
            const key = _dayKey(mov.timestamp);
            if (!groups.has(key)) groups.set(key, { label: _dayLabel(mov.timestamp), items: [], ts: mov.timestamp });
            groups.get(key).items.push(mov);
        }

        // 현재 위치도 타임라인에 추가
        const curLoc = locs.find(l => l.id === curLocId);
        const todayKey = _dayKey(Date.now());
        if (curLoc) {
            if (!groups.has(todayKey)) groups.set(todayKey, { label: _dayLabel(Date.now()), items: [], ts: Date.now() });
            const g = groups.get(todayKey);
            if (!g.items.some(m => m._isCurrent)) {
                g.items.unshift({ toId: curLocId, timestamp: Date.now(), _isCurrent: true });
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
            const isToday = dayKey === todayKey;
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

        const html = `<div class="wt-bs-handle" style="display:flex;justify-content:center;padding:18px 0 12px;cursor:pointer;min-height:48px;position:sticky;top:0;z-index:10;background:#fff;border-radius:16px 16px 0 0;-webkit-tap-highlight-color:transparent"><div style="width:36px;height:4px;background:#D4D0C8;border-radius:2px"></div></div>
            <div style="padding:2px 0 0"><div style="font-size:16px;font-weight:800;color:#202124;padding:0 16px 6px">타임라인</div></div>
            ${timelineHtml}`;

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
            status:$('#wt-pop-status').val().trim(),
            aliases: aliases,
            aiNotes:$('#wt-pop-ainotes').val().trim(),
            locationType: $('#wt-pop-icon-type').val() || '',  // Task 5: 아이콘 타입
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
            await self.lm.deleteLocation(loc.id);
            const target = self.lm.locations.find(l => l.id === sid);
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
            self.togglePanel(true);
            setTimeout(() => {
                $('#wt-add-form').slideDown(200); $('#wt-add-arrow').text('▴');
                $('#wt-input-name').val(loc.name).focus();
                self.lm.deleteLocation(loc.id).then(() => { self.pi?.inject(); self.refresh(); });
            }, 350);
        });

        // ↩️ 취소
        overlay.find('#wt-reg-undo').on('click', async () => {
            await self.lm.deleteLocation(loc.id);
            self.pi?.inject(); self.refresh();
            overlay.remove();
            toastSuccess('↩️ 취소됨');
        });

        // 15초 후 자동 제거 (유저가 안 누르면)
        setTimeout(() => overlay.remove(), 15000);
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
        if (!matches.length) { list.html('<div class="wt-search-empty">일치하는 장소 없음</div>').show(); return; }

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
                const mode = s?.mapMode || 'node';

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
        const others = this.lm.locations.filter(l => l.id !== locId);
        if (!others.length) { $('#wt-pop-dist-section').hide(); return; }
        $('#wt-pop-dist-section').show();

        const list = $('#wt-pop-dist-list').empty();
        const self = this;
        for (const d of this.lm.distances || []) {
            let otherId = d.fromId === locId ? d.toId : d.toId === locId ? d.fromId : null;
            if (!otherId) continue;
            const other = this.lm.locations.find(l => l.id === otherId);
            if (!other) continue;
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
                    await self.lm.updateLocation(locId, { lat, lng, address: addrText });

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
            const dateStr = ev.rpDate || (ev.timestamp ? new Date(ev.timestamp).toLocaleDateString('ko-KR', { month:'numeric', day:'numeric' }) : '');
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
                const ctx = getContext();
                const gen = ctx?.generateQuietPrompt;
                if (gen) {
                    const prompt = `Create a short, witty title (max 15 chars) for this event that emphasizes the place's meaning. Write like "OO한 곳". Respond with ONLY the title text, nothing else.\n\nEvent: ${text.substring(0, 300)}`;
                    const result = await runWithoutAutoDetect(() => gen({ prompt }));
                    if (result?.trim()) title = result.trim().substring(0, 20);
                }
            } catch(e) {}
        }

        events.push({ text, title, mood: '📝', timestamp: Date.now(), source: 'manual' });
        await this.lm.updateLocation(locId, { events });
        $('#wt-pop-event-input').val('');
        this._updEventsList(locId);
        toastSuccess('📝 이벤트 추가!');
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
            const gen = ctx?.generateQuietPrompt;
            if (!gen) { list.html('<div style="font-size:11px;color:#F5A8A8;padding:8px">LLM 연결 필요</div>'); return; }

            const userName = ctx.name1 || 'User';
            const charName = ctx.name2 || 'Character';
            const s = extension_settings[EXTENSION_NAME];
            const eLang = s?.eventLang || 'auto';
            const langInst = eLang === 'ko' ? 'Write ALL reviews in Korean.' : eLang === 'en' ? 'Write ALL reviews in English.' : 'Write in the same language as the RP.';

            // 이벤트 요약 (최근 5개)
            const evSummary = (loc.events || []).slice(-5).map(e => `${e.mood||'📝'} ${e.title||e.text||''}`).join(', ') || '아직 이벤트 없음';

            // 방문횟수 보정 리뷰 수 (최대 10개, 수 많을수록 확률 급감)
            const visits = loc.visitCount || 0;
            let maxReviews, weights;
            if (visits <= 2) {
                maxReviews = 3;
                weights = [0.50, 0.85, 1.0];
            } else if (visits <= 5) {
                maxReviews = 5;
                weights = [0.30, 0.60, 0.80, 0.92, 1.0];
            } else if (visits <= 9) {
                maxReviews = 8;
                weights = [0.20, 0.45, 0.70, 0.85, 0.93, 0.97, 0.99, 1.0];
            } else {
                maxReviews = 10;
                weights = [0.15, 0.35, 0.60, 0.78, 0.88, 0.93, 0.96, 0.98, 0.99, 1.0];
            }
            const rnd = Math.random();
            let reviewCount = 1;
            for (let i = 0; i < weights.length; i++) {
                if (rnd < weights[i]) { reviewCount = i + 1; break; }
            }
            const prompt = `Generate ${reviewCount} Google Maps-style reviews for an RP location. Each reviewer is a CHARACTER from the story with a distinct voice.

Place: "${loc.name}" | Memo: "${loc.memo || ''}" | Notes: "${loc.aiNotes || ''}" | Visits: ${loc.visitCount || 0}
Events: ${evSummary}
User="${userName}", Character="${charName}"
${langInst}

REVIEWER POOL (pick ${reviewCount} randomly, can repeat types):
• "${charName}" — main character, write in their personality. Reference events. Show relationship with ${userName}.
• "${userName}" — protagonist, personal emotional reaction to this place.
• Pet/Animal — a pet, stray cat, military dog, bird, etc. Write from animal POV (smells, food, warmth, territory).
• NPC — barista, neighbor, soldier, ghost, street vendor, etc. Quirky and unexpected.
• Wild creature — crow watching from rooftop, alley cat, stray dog. Pure instinct-based review.

VOICE RULES:
• Tough character → blunt, short, reluctant praise
• Gentle character → emotional, poetic, nostalgic
• Animal → sensory (smell, warmth, food, nap spots). No human logic.
• NPC → unique quirk that reveals something about the place

Also generate a 1-sentence poetic SUMMARY that captures the emotional contrast of this place (combine the warmest and coldest memories).

JSON ONLY, no markdown:
{"summary":"poetic 1-sentence place summary","reviews":[{"name":"name","role":"role","avatar":"emoji","stars":1-5,"text":"1-2 sentences","daysAgo":1-30}]}`;

            const result = await runWithoutAutoDetect(() => gen({ prompt }), 2500);
            if (!result) { list.html('<div style="font-size:11px;color:#9A8A7A;padding:8px">생성 실패 — 다시 시도해주세요</div>'); return; }

            // JSON 파싱
            const jsonMatch = result.match(/\{[\s\S]*\}/);
            if (!jsonMatch) { list.html('<div style="font-size:11px;color:#9A8A7A;padding:8px">파싱 실패 — 다시 시도해주세요</div>'); return; }

            const parsed = JSON.parse(jsonMatch[0]);
            const reviews = parsed.reviews || parsed;
            const aiSummary = parsed.summary || '';
            if (!Array.isArray(reviews) || !reviews.length) { list.html('<div style="font-size:11px;color:#9A8A7A;padding:8px">리뷰 없음</div>'); return; }

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

        // 1. AI 요약 (블루박스)
        if (aiSummary) {
            container.append(`<div style="padding:10px 12px;background:rgba(94,132,226,.06);border-radius:8px;border:1px solid rgba(94,132,226,.1);margin-bottom:10px">
                <div style="font-size:10px;color:#5E84E2;font-weight:600;margin-bottom:3px">🤖 AI 리뷰 요약</div>
                <div style="font-size:12px;color:#5E84E2;line-height:1.6;font-style:italic">"${aiSummary}"</div>
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

    // ========== 이벤트 전체 보기 (패널 뷰 전환) ==========
    _showEventPanel(locId) {
        const loc = this.lm.locations.find(l => l.id === locId);
        if (!loc) return;
        const events = loc.events || [];
        const ps = this._pinStyle ? this._pinStyle(loc.name) : { emoji: '📍', color: '#5E84E2' };

        // 현재 패널 내용 저장
        const body = $('#wt-panel-body');
        if (!this._savedPanelHTML) this._savedPanelHTML = body.html();

        // 이벤트 패널 HTML
        let evHTML = `
        <div id="wt-event-panel" style="padding:8px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
                <button id="wt-ev-back" style="background:none;border:none;font-size:18px;cursor:pointer;padding:4px">←</button>
                <div style="flex:1">
                    <div style="font-size:16px;font-weight:800;color:var(--wt-brown,#775537)">${loc.name}</div>
                    <div style="font-size:11px;color:#9A8A7A">📖 기억 ${events.length}건</div>
                </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;max-height:60vh;overflow-y:auto;padding-right:4px">`;

        if (!events.length) {
            evHTML += `<div style="text-align:center;padding:24px;color:#B0A898;font-style:italic">아직 기억이 없어요</div>`;
        } else {
            [...events].reverse().forEach((ev, i) => {
                const realIdx = events.length - 1 - i;
                const mood = ev.mood || '📝';
                const title = ev.title || (ev.text?.length > 15 ? ev.text.substring(0, 15) + '...' : ev.text || '');
                const dateStr = ev.rpDate || (ev.timestamp ? new Date(ev.timestamp).toLocaleDateString('ko-KR', { month:'numeric', day:'numeric' }) : '');
                const cardId = `wt-ev-${realIdx}`;

                evHTML += `
                <div class="wt-ev-card" style="background:var(--wt-surface,#FAFAF5);border-radius:10px;border:1px solid #EAE6DC;overflow:hidden">
                    <div class="wt-ev-header" data-card="${cardId}" style="display:flex;align-items:center;gap:6px;padding:10px 12px;cursor:pointer">
                        <span style="font-size:14px">${mood}</span>
                        <span style="flex:1;font-size:13px;font-weight:600;color:var(--wt-text,#5A4030)">${title}</span>
                        <span style="font-size:10px;color:#B0A898;white-space:nowrap">${dateStr}</span>
                        <span class="wt-ev-arrow" style="font-size:10px;color:#B0A898;transition:transform 0.2s">▼</span>
                        <button class="wt-ev-del" data-eidx="${realIdx}" style="background:none;border:none;font-size:14px;color:#D4A0A0;cursor:pointer;padding:4px 6px;min-width:28px;min-height:28px;display:flex;align-items:center;justify-content:center">✕</button>
                    </div>
                    <div id="${cardId}" style="display:none;padding:0 12px 10px;font-size:12px;line-height:1.6;color:#7A7060;white-space:pre-wrap;border-top:1px dashed #EAE6DC">${ev.text || ''}</div>
                </div>`;
            });
        }

        evHTML += `</div></div>`;

        body.html(evHTML);

        // 뒤로가기
        const self = this;
        $('#wt-ev-back').on('click', () => {
            if (self._savedPanelHTML) {
                body.html(self._savedPanelHTML);
                self._savedPanelHTML = null;
                self._rebindPanel();
                self.refresh();
            }
        });

        // 아코디언 토글
        $('.wt-ev-header').on('click', function(e) {
            if ($(e.target).hasClass('wt-ev-del')) return; // 삭제 버튼 제외
            const cardId = $(this).attr('data-card');
            const content = $(`#${cardId}`);
            const arrow = $(this).find('.wt-ev-arrow');
            if (content.is(':visible')) {
                content.slideUp(200);
                arrow.css('transform', 'rotate(0deg)');
            } else {
                content.slideDown(200);
                arrow.css('transform', 'rotate(180deg)');
            }
        });

        // 삭제 버튼
        $('.wt-ev-del').on('click', async function(e) {
            e.stopPropagation();
            const idx = parseInt($(this).attr('data-eidx'));
            events.splice(idx, 1);
            await self.lm.updateLocation(locId, { events });
            self._showEventPanel(locId); // 새로고침
        });
    }

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
                const dateStr = ev.rpDate || (ev.timestamp ? new Date(ev.timestamp).toLocaleDateString('ko-KR', { year:'numeric', month:'short', day:'numeric' }) : (ev.date || ''));
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
                const generateQuietPrompt = ctx?.generateQuietPrompt;
                const userName = ctx?.name1 || 'User';
                const charName = ctx?.name2 || 'Character';
                const s = extension_settings[EXTENSION_NAME];
                const eLang = s?.eventLang || 'auto';
                const langInst = eLang === 'ko' ? 'Write in Korean.'
                               : eLang === 'en' ? 'Write in English.'
                               : 'Write in the same language as the text.';

                let evTitle = null, evText = null, evMood = '📝';
                const trimmed = selectedText.substring(0, 1500);

                if (generateQuietPrompt) {
                    const prompt = `Summarize this RP scene excerpt as a place-event memory. ${langInst}
Character info: protagonist="${userName}", main character="${charName}".
Respond with ONLY JSON: {"mood":"💕 or 📅 or ⚡","title":"place-meaning hook max 15chars","summary":"detailed 2-sentence summary"}
If mundane: {"mood":null}

Text: ${trimmed}`;

                    const result = await runWithoutAutoDetect(() => generateQuietPrompt({ prompt }), 2500);
                    if (result) {
                        const m = result.match(/\{[\s\S]*?\}/);
                        if (m) {
                            const p = JSON.parse(m[0]);
                            if (p.mood && p.summary) {
                                evTitle = p.title || p.summary.substring(0, 15) + '...';
                                evText = p.summary;
                                evMood = p.mood;
                            }
                        }
                    }
                }

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
