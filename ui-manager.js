// 🐶 World Tracker — ui-manager.js (Inline Toast + Popover)

import { getContext, extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { EXTENSION_NAME, wtNotify, toastWarn, toastSuccess, loadLeaflet, wtMascot, wtTreat } from './index.js';
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
    constructor(lm, pi) { this.lm=lm; this.pi=pi; this.mapRenderer=null; this.leafletRenderer=null; this.panelVisible=false; }

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
                <div class="wt-s-row"><label><span id="wt-secret" style="cursor:default">💭</span> 기억</label>
                    <select id="wt-s-mem" class="text_pole wt-select"><option value="natural">🌿 자연</option><option value="perfect">💎 완벽</option></select>
                </div>
                <div class="wt-divider"></div>
                <div class="wt-s-row"><label>🧠 감지 모델</label></div>
                <div class="wt-s-row"><select id="wt-s-profile" class="text_pole wt-select wt-select-full"><option value="">없음 (regex만)</option></select></div>
                <div class="wt-s-row"><button id="wt-s-profile-save" class="menu_button" style="font-size:12px;padding:4px 12px">💾 모델 저장</button><span id="wt-s-profile-status" style="font-size:11px;color:#9A8A7A;margin-left:6px"></span></div>
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
        bind('#wt-s-enabled','enabled',true); bind('#wt-s-detect','autoDetect',true); bind('#wt-s-toast','showDetectToast',true); bind('#wt-s-inject','aiInjection',true);
        $('#wt-s-inject').on('change', () => { s.aiInjection ? this.pi?.inject() : this.pi?.clear(); });
        $('#wt-s-mem').val(s?.memoryMode||'natural').on('change', () => { s.memoryMode=$('#wt-s-mem').val(); saveSettingsDebounced(); this.pi?.inject(); });
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
                <div class="wt-opacity-row"><span>🔮</span><input type="range" id="wt-opacity" min="30" max="100" value="100"/><span id="wt-op-val">100%</span></div>

                <div class="wt-map-toggle" id="wt-map-toggle">🗺️ 지도 ▾</div>
                <div id="wt-map-section" style="display:none">
                    <div class="wt-map-mode-bar">
                        <button id="wt-mode-node" class="wt-mode-btn wt-mode-active">🗺️ 약도</button>
                        <button id="wt-mode-leaflet" class="wt-mode-btn">🌍 실제</button>
                        <button id="wt-mode-fantasy" class="wt-mode-btn" style="display:none">🏰 지도</button>
                    </div>
                    <div id="wt-search-bar" class="wt-search-bar">
                        <div id="wt-search-tabs" style="display:none;gap:2px;margin-bottom:3px">
                            <button id="wt-search-tab-loc" class="wt-mode-btn wt-mode-active" style="flex:1;padding:4px;font-size:11px">🔍 장소</button>
                            <button id="wt-search-tab-addr" class="wt-mode-btn" style="flex:1;padding:4px;font-size:11px">📍 주소</button>
                        </div>
                        <input type="search" id="wt-search-input" class="wt-input" placeholder="🔍 등록된 장소 검색..." autocomplete="off" inputmode="search"/>
                        <button id="wt-btn-refresh" style="border:none;background:none;font-size:16px;cursor:pointer;opacity:.5;padding:2px 4px" title="약도 재배치">🔄</button>
                        <div id="wt-search-results" class="wt-search-results" style="display:none"></div>
                    </div>
                    <div id="wt-map-wrap" class="wt-map-wrap">
                        <div id="wt-map-container" class="wt-map-container"></div>
                    </div>
                    <div id="wt-leaflet-wrap" class="wt-map-wrap" style="display:none">
                        <div id="wt-leaflet-container" class="wt-map-container wt-leaflet-map"></div>
                    </div>
                </div>

                <!-- 팝오버 (인라인!) -->
                <div id="wt-popover" class="wt-popover-inline" style="display:none">
                    <div class="wt-pop-header">
                        <input type="text" id="wt-pop-title" style="font-size:14px;font-weight:700;color:var(--wt-brown);background:transparent;border:none;border-bottom:1.5px dashed transparent;outline:none;flex:1;padding:2px 0;font-family:inherit" onfocus="this.style.borderBottomColor='var(--wt-yellow-d)'" onblur="this.style.borderBottomColor='transparent'"/>
                        <button id="wt-pop-close" class="wt-btn-icon">✕</button>
                    </div>
                    <div class="wt-pop-body">
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
                        <textarea id="wt-pop-memo" class="wt-input wt-textarea" placeholder="메모..." rows="2"></textarea>
                        <div id="wt-pop-events-section" style="margin-top:4px">
                            <div style="font-size:12px;color:#9A8A7A;margin-bottom:4px">📝 이벤트 기록</div>
                            <div id="wt-pop-events-list" style="display:flex;flex-direction:column;gap:3px;max-height:120px;overflow-y:auto"></div>
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
                // 모든 핀 위치 리셋 → 새 levelToPx 적용 (③ 15분 반경)
                for (const loc of this.lm.locations) {
                    loc._manualXY = false;
                    loc.x = 0; loc.y = 0;
                    this.lm.updateLocation(loc.id, { _manualXY: false, x: 0, y: 0 });
                }
                this.mapRenderer._layoutDirty = true;
                this.mapRenderer._layoutDone = false;
                this.mapRenderer._skipLayout = false;
                this.mapRenderer._vbManual = false;
                // ① 배경 캐시 무효화 → 새 배경 생성
                if (this.mapRenderer.invalidateCity) this.mapRenderer.invalidateCity();
                this.mapRenderer.render();
                toastSuccess('🗺️ 약도 재생성!');
            }
        }); // 기본: 장소 검색
        $('#wt-search-tab-loc').on('click', () => {
            this._searchMode = 'loc';
            $('#wt-search-tab-loc').addClass('wt-mode-active'); $('#wt-search-tab-addr').removeClass('wt-mode-active');
            $('#wt-search-input').attr('placeholder', '🔍 등록된 장소 검색...').val('');
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
        $('#wt-opacity').on('input', function(){ const v=$(this).val(); $('#wt-op-val').text(v+'%'); $('#wt-panel').css('opacity',v/100); extension_settings[EXTENSION_NAME].panelOpacity=+v; saveSettingsDebounced(); });
        const op = extension_settings[EXTENSION_NAME]?.panelOpacity ?? 100;
        $('#wt-opacity').val(op); $('#wt-op-val').text(op+'%');

        // ========== Feature 2: 문장 드래그 → 이벤트 저장 ==========
        this._setupTextSelection();
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
        // 🐛 Bug1 Fix: 컨테이너 DOM도 클리어 → SVG 잔존 방지
        const nodeContainer = document.querySelector('#wt-map-container');
        if (nodeContainer) nodeContainer.innerHTML = '';
        this.mapRenderer = null;
        if (this.leafletRenderer) { this.leafletRenderer.destroy(); this.leafletRenderer = null; }
        const leafletContainer = document.querySelector('#wt-leaflet-container');
        if (leafletContainer) leafletContainer.innerHTML = '';
        $('#wt-scan-overlay').remove();
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
        this._updLocList(); this._updMoveList();
    }

    // ========== 맵 모드 전환 ==========
    async _setMapMode(mode) {
        const s = extension_settings[EXTENSION_NAME];
        s.mapMode = mode; saveSettingsDebounced();

        // UI 버튼 활성화
        $('.wt-mode-btn').removeClass('wt-mode-active');
        $(`#wt-mode-${mode}`).addClass('wt-mode-active');

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
                    this.mapRenderer.onMoveRequest = (id, name) => {
                        wtNotify(`📍 "${name}" 이동 모드 — 맵을 터치하세요`, 'info', 3000);
                    };
                }
            }
            this.mapRenderer.render();
        } else if (mode === 'leaflet') {
            $('#wt-map-wrap').hide();
            $('#wt-leaflet-wrap').show();
            if (!this.leafletRenderer) {
                const ok = await loadLeaflet();
                if (!ok) { toastWarn('Leaflet CDN 로드 실패!'); this._setMapMode('node'); return; }
                // #46: 컨테이너가 레이아웃 완료될 때까지 대기
                const container = document.querySelector('#wt-leaflet-container');
                if (container) {
                    container.style.width = '100%';
                    container.style.height = '320px';
                    container.style.minHeight = '320px';
                }
                // rAF 2번 → 브라우저 레이아웃 확정 후 init
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                this.leafletRenderer = new LeafletRenderer(document.querySelector('#wt-leaflet-container'), this.lm);
                await this.leafletRenderer.init();
                this.leafletRenderer.onLocationClick = id => this.showPop(id);
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
        $('#wt-pop-first').text(l.firstVisited?this._fmt(l.firstVisited):'—');
        $('#wt-pop-last').text(l.lastVisited?this._fmt(l.lastVisited):'—');
        $('#wt-pop-memo').val(l.memo||''); $('#wt-pop-status').val(l.status||'');
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
        // 지도 섹션 상태 저장 후 숨김
        this._mapWasVisible = $('#wt-map-section').is(':visible');
        if (this._mapWasVisible) {
            $('#wt-map-section').hide();
            $('#wt-map-toggle').text('🗺️ 지도 ▾');
        }
        $('#wt-popover').show();
        const pop = document.getElementById('wt-popover');
        const body = document.getElementById('wt-panel-body');
        if (pop && body) body.scrollTop = pop.offsetTop - 10;
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

    async _popSave() {
        const id=$('#wt-popover').attr('data-id');
        const newName = $('#wt-pop-title').val().trim();
        const aliases = $('#wt-pop-aliases').val().split(',').map(a=>a.trim()).filter(Boolean);
        const update = {
            memo:$('#wt-pop-memo').val().trim(),
            status:$('#wt-pop-status').val().trim(),
            aliases: aliases,
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
                $(this).closest('div').remove();
                self.pi?.inject();
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
                    setTimeout(() => {
                        if (self.leafletRenderer?.map) {
                            self.leafletRenderer.render();
                            self.leafletRenderer.map.setView([lat, lng], 15);
                        }
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
        events.forEach((ev, i) => {
            const item = $(`<div style="display:flex;align-items:flex-start;gap:4px;padding:4px 6px;background:var(--wt-surface);border-radius:4px;font-size:11px">
                <span style="flex:1;color:var(--wt-text);line-height:1.3">${ev.text}</span>
                <span style="font-size:9px;color:#9A8A7A;white-space:nowrap">${ev.date || ''}</span>
                <button class="wt-btn-icon" style="font-size:10px;padding:1px 3px;color:var(--wt-pink)" data-eidx="${i}">✕</button>
            </div>`);
            item.find('button').on('click', async function() {
                events.splice(parseInt($(this).attr('data-eidx')), 1);
                await self.lm.updateLocation(locId, { events });
                self._updEventsList(locId);
            });
            list.append(item);
        });
    }

    async _addEvent() {
        const locId = $('#wt-popover').attr('data-id');
        const text = $('#wt-pop-event-input').val().trim();
        if (!locId || !text) return;
        const loc = this.lm.locations.find(l => l.id === locId);
        if (!loc) return;
        const events = loc.events || [];
        const date = new Date().toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
        events.push({ text, date, timestamp: Date.now() });
        await this.lm.updateLocation(locId, { events });
        $('#wt-pop-event-input').val('');
        this._updEventsList(locId);
        toastSuccess('📝 이벤트 추가!');
    }

    // 자동 이벤트 기록 — AI 응답에서 키워드 추출 후 플로팅 알림
    showEventNotify(locName, summary, locId) {
        // 채팅 화면이 아니면 알림 안 띄움
        const sendBtn = document.querySelector('#send_but');
        if (!sendBtn || sendBtn.offsetParent === null) return;
        $('#wt-event-overlay').remove();
        const overlay = $(`<div id="wt-event-overlay" style="position:fixed;bottom:100px;left:50%;transform:translateX(-50%);width:300px;max-width:90vw;background:rgba(245,244,237,0.98);border:2px solid #5E84E2;border-radius:14px;padding:10px 12px;z-index:2147483646;box-shadow:0 6px 24px rgba(0,0,0,0.2);backdrop-filter:blur(8px);font-family:-apple-system,'Noto Sans KR',sans-serif">
            <div style="font-size:12px;font-weight:700;color:#775537;margin-bottom:4px">📝 이벤트 감지 — ${locName}</div>
            <input type="text" id="wt-event-edit" value="${summary}" style="width:100%;border:1px solid #E8E4D8;border-radius:6px;padding:5px 8px;font-size:12px;font-family:inherit;box-sizing:border-box"/>
            <div style="display:flex;gap:6px;margin-top:6px">
                <button id="wt-event-save" style="flex:1;padding:6px;background:#5E84E2;border:none;border-radius:6px;font-size:12px;font-weight:600;color:#fff;cursor:pointer">💾 저장</button>
                <button id="wt-event-skip" style="flex:1;padding:6px;background:transparent;border:1px solid #E8E4D8;border-radius:6px;font-size:12px;color:#9A8A7A;cursor:pointer">무시</button>
            </div>
        </div>`);

        $('body').append(overlay);
        const self = this;
        overlay.find('#wt-event-save').on('click', async () => {
            const text = overlay.find('#wt-event-edit').val().trim();
            if (text && locId) {
                const loc = self.lm.locations.find(l => l.id === locId);
                if (loc) {
                    const events = loc.events || [];
                    const date = new Date().toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
                    events.push({ text, date, timestamp: Date.now() });
                    await self.lm.updateLocation(locId, { events });
                    toastSuccess('📝 이벤트 저장!');
                }
            }
            overlay.remove();
        });
        overlay.find('#wt-event-skip').on('click', () => overlay.remove());
        setTimeout(() => overlay.remove(), 12000);
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
        toastSuccess(`📏 거리 저장!`);
    }

    _fmt(ts) { return new Date(ts).toLocaleDateString('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
}
