// 🐶 World Tracker — leaflet-renderer.js

import { EXTENSION_NAME } from './index.js';

export class LeafletRenderer {
    constructor(container, lm) {
        this.container = container;
        this.lm = lm;
        this.map = null;
        this.markers = {};
        this.pathLines = [];
        this.distLabels = []; // 경로 위 거리 라벨
        this.onLocationClick = null;
        this._placingLocId = null; // 좌표 배치 모드
    }

    // ========== 장소 타입별 컬러 + 이모지 ==========
    _locStyle(name) {
        const lo = name.toLowerCase();
        if (/카페|cafe|coffee|커피/i.test(lo)) return { color: '#E74C3C', emoji: '🐱', border: '#C0392B' };
        if (/서점|book|도서|library|서재/i.test(lo)) return { color: '#3498DB', emoji: '📚', border: '#2980B9' };
        if (/집|home|house|숙소|기숙/i.test(lo)) return { color: '#27AE60', emoji: '🏠', border: '#1E8449' };
        if (/공원|park|정원|garden|광장/i.test(lo)) return { color: '#2ECC71', emoji: '🌳', border: '#27AE60' };
        if (/문구|stationery|편의|convenience|마트|mart|가게|shop|store/i.test(lo)) return { color: '#F39C12', emoji: '🏪', border: '#D68910' };
        if (/식당|restaurant|음식|레스토랑/i.test(lo)) return { color: '#E67E22', emoji: '🍽️', border: '#CA6F1E' };
        if (/학교|school|학원|academy/i.test(lo)) return { color: '#9B59B6', emoji: '🎓', border: '#7D3C98' };
        if (/병원|hospital|의원|clinic/i.test(lo)) return { color: '#1ABC9C', emoji: '🏥', border: '#17A589' };
        if (/역|station|지하철|subway|버스|bus/i.test(lo)) return { color: '#34495E', emoji: '🚉', border: '#2C3E50' };
        if (/술집|bar|pub|tavern|주점/i.test(lo)) return { color: '#8E44AD', emoji: '🍺', border: '#6C3483' };
        if (/체육|gym|운동|fitness|arena/i.test(lo)) return { color: '#E74C3C', emoji: '💪', border: '#C0392B' };
        if (/성|castle|궁|palace|요새/i.test(lo)) return { color: '#7F8C8D', emoji: '🏰', border: '#616A6B' };
        if (/숲|forest|산|mountain/i.test(lo)) return { color: '#1E8449', emoji: '🌲', border: '#145A32' };
        if (/해변|beach|바다|sea|강|river|호수|lake/i.test(lo)) return { color: '#2980B9', emoji: '🌊', border: '#1F618D' };
        return { color: '#F6A93A', emoji: '📍', border: '#D68910' };
    }

    async init() {
        if (!window.L) { console.warn(`[${EXTENSION_NAME}] Leaflet not loaded`); return false; }

        // 컨테이너 준비
        this.container.innerHTML = '';
        const mapDiv = document.createElement('div');
        mapDiv.id = 'wt-leaflet-map';
        mapDiv.style.width = '100%';
        mapDiv.style.height = '100%';
        mapDiv.style.minHeight = '320px';
        this.container.appendChild(mapDiv);

        // Leaflet 맵 초기화
        this.map = L.map(mapDiv, {
            zoomControl: false,
            attributionControl: false,
        }).setView([37.5665, 126.978], 13); // 기본: 서울

        // CartoDB Voyager 타일 (밝고 깔끔)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            subdomains: 'abcd',
        }).addTo(this.map);

        // 줌 버튼 (우하단)
        L.control.zoom({ position: 'bottomright' }).addTo(this.map);

        // 지도 클릭 → 좌표 배치
        // #1: 마커 롱프레스 → 이동 모드 → 빈 곳 터치 → 이동
        this._movingLocId = null;
        this._moveReady = false;

        // 지도 클릭: 이동 모드 + 준비 완료면 해당 위치로 이동
        this.map.on('click', (e) => {
            if (this._movingLocId && this._moveReady && this.onMoveComplete) {
                this.onMoveComplete(e.latlng, this._movingLocId);
                this._movingLocId = null;
                this._moveReady = false;
                this.map.getContainer().style.cursor = '';
            }
        });

        // 빈 곳 우클릭/롱프레스 → 이동 모드 취소
        this.map.on('contextmenu', (e) => {
            L.DomEvent.preventDefault(e);
            if (this._movingLocId) {
                this._movingLocId = null;
                this._moveReady = false;
                this.map.getContainer().style.cursor = '';
                if (this.onMoveStart) this.onMoveStart(null, '취소됨');
            }
        });

        console.log(`[${EXTENSION_NAME}] Leaflet initialized`);
        return true;
    }

    render() {
        if (!this.map) return;

        // 기존 마커/경로/라벨 제거
        for (const id in this.markers) { this.map.removeLayer(this.markers[id]); }
        this.markers = {};
        this.pathLines.forEach(l => this.map.removeLayer(l));
        this.pathLines = [];
        this.distLabels.forEach(l => this.map.removeLayer(l));
        this.distLabels = [];

        const { locations, movements, currentLocationId } = this.lm;
        const latlngs = [];

        // ========== 구글맵 스타일 물방울 핀 ==========
        for (const loc of locations) {
            if (!loc.lat || !loc.lng) continue;

            const isCur = loc.id === currentLocationId;
            const isSel = loc.id === this._selectedPinId;
            const style = this._locStyle(loc.name);

            // 핀 색상: 선택=빨강, 현재위치=초록, 기본=장소색상
            const pinColor = isSel ? '#EA4335' : isCur ? '#27AE60' : style.color;
            const pinSize = isSel ? 36 : isCur ? 32 : 26;
            const iconSize = isSel ? 14 : isCur ? 13 : 11;

            // 물방울 SVG 핀 + 내부 아이콘
            const iconHtml = `<div style="position:relative;display:flex;flex-direction:column;align-items:center">
                ${isCur && !isSel ? '<div style="position:absolute;top:-16px;font-size:12px;z-index:2;animation:wtPawBounce 1.2s infinite">🐾</div>' : ''}
                <svg width="${pinSize}" height="${Math.round(pinSize * 1.3)}" viewBox="0 0 40 52" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3))${isSel ? ';filter:drop-shadow(0 3px 8px rgba(234,67,53,0.4))' : ''}">
                    <path d="M20 50 C20 50 3 30 3 18 C3 8.6 10.6 1 20 1 C29.4 1 37 8.6 37 18 C37 30 20 50 20 50Z" fill="${pinColor}"/>
                    <circle cx="20" cy="18" r="11" fill="white"/>
                </svg>
                <div style="position:absolute;top:${isSel ? 8 : isCur ? 7 : 5}px;font-size:${iconSize}px;pointer-events:none;text-align:center;line-height:1">${style.emoji}</div>
            </div>`;

            const icon = L.divIcon({
                html: iconHtml, className: 'wt-gmap-pin',
                iconSize: [pinSize, Math.round(pinSize * 1.3)],
                iconAnchor: [pinSize / 2, Math.round(pinSize * 1.3)],
            });
            const marker = L.marker([loc.lat, loc.lng], { icon });

            // 라벨
            marker.bindTooltip(loc.name + (isCur ? ' 🐾' : ''), {
                permanent: true, direction: 'bottom', offset: [0, 4],
                className: 'wt-leaflet-label',
            });

            // 클릭 → 선택 핀 변경 + 바텀시트
            marker.on('click', () => {
                this._selectedPinId = loc.id;
                this.render(); // 핀 재렌더 (선택=빨강)
                if (this.onLocationClick) this.onLocationClick(loc.id);
            });

            // 마커 롱프레스/우클릭 → 이동 모드 활성화
            marker.on('contextmenu', (e) => {
                L.DomEvent.stopPropagation(e);
                L.DomEvent.preventDefault(e);
                this._movingLocId = loc.id;
                this._moveReady = false;
                this.map.getContainer().style.cursor = 'crosshair';
                if (navigator.vibrate) navigator.vibrate(50);
                if (this.onMoveStart) this.onMoveStart(loc.id, loc.name);
                setTimeout(() => { this._moveReady = true; }, 300);
            });

            marker.addTo(this.map);
            this.markers[loc.id] = marker;
            latlngs.push([loc.lat, loc.lng]);
        }

        // 경로선 삭제됨 — 약도에서 표현하므로 실제지도는 마커만

        // 뷰 조정 (첫 렌더링만)
        const curLoc = locations.find(l => l.id === currentLocationId);
        if (!this._viewSet && latlngs.length > 0) {
            if (curLoc?.lat && curLoc?.lng) {
                this.map.setView([curLoc.lat, curLoc.lng], 15);
            } else if (latlngs.length > 1) {
                this.map.fitBounds(latlngs, { padding: [30, 30], maxZoom: 15 });
            } else {
                this.map.setView(latlngs[0], 15);
            }
            this._viewSet = true;
        }

        this._removeNotice();
    }

    // ========== 리치 팝업 HTML (목업 기반) ==========
    _buildPopup(loc, isCur) {
        const v = loc.visitCount || 0;
        const style = this._locStyle(loc.name);
        const visitLabel = v === 1 ? '1st visit' : v === 2 ? '2nd visit' : v === 3 ? '3rd visit' : `${v}th visit`;

        // 근처 장소 찾기
        let nearbyHtml = '';
        const nearList = [];
        for (const other of this.lm.locations) {
            if (other.id === loc.id) continue;
            const dist = this.lm.getDistanceBetween(loc.id, other.id);
            if (dist) nearList.push({ name: other.name, text: dist.distanceText, level: dist.level || 5 });
        }
        if (nearList.length) {
            const nearest = nearList.sort((a, b) => a.level - b.level)[0];
            nearbyHtml = `<div style="font-size:11px;color:#888;margin-top:2px">Near ${nearest.name}</div>`;
        }

        // 메모
        let memoHtml = '';
        if (loc.memo) {
            const snippet = loc.memo.length > 50 ? loc.memo.substring(0, 50) + '...' : loc.memo;
            memoHtml = `<div style="font-style:italic;color:#555;font-size:12px;margin-top:6px;padding:4px 6px;background:rgba(0,0,0,0.03);border-radius:4px">"${snippet}"</div>`;
        }

        // 최근 이벤트
        let eventHtml = '';
        if (loc.events?.length) {
            const latest = loc.events[loc.events.length - 1];
            const evText = latest.text.length > 40 ? latest.text.substring(0, 40) + '...' : latest.text;
            eventHtml = `<div style="font-size:11px;color:#5E84E2;margin-top:4px">📝 ${evText}</div>`;
        }

        return `<div style="min-width:160px">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
                <span style="font-size:16px">${style.emoji}</span>
                <b style="font-size:14px;color:#333">${loc.name}</b>
            </div>
            <div style="font-size:12px;color:#777">${visitLabel}${nearbyHtml ? '' : ''}</div>
            ${nearbyHtml}${memoHtml}${eventHtml}
        </div>`;
    }

    // 좌표 배치 모드 시작
    startPlacing(locId) {
        this._placingLocId = locId;
        this.container.style.cursor = 'crosshair';
        console.log(`[${EXTENSION_NAME}] Placing mode for ${locId}`);
    }

    _onMapClick(e) {
        if (!this._placingLocId) return;
        const { lat, lng } = e.latlng;
        const locId = this._placingLocId;
        this._placingLocId = null;
        this.container.style.cursor = '';

        // 좌표 저장
        this.lm.updateLocation(locId, { lat, lng }).then(() => {
            console.log(`[${EXTENSION_NAME}] Placed ${locId} at ${lat.toFixed(4)},${lng.toFixed(4)}`);
            this.render();
        });
    }

    // 맵 리사이즈 (패널 열릴 때) — #46 회색 영역 방지
    invalidateSize() {
        if (!this.map) return;
        // 컨테이너 크기 강제 설정
        const container = this.map.getContainer();
        if (container) {
            const parent = container.parentElement;
            if (parent && parent.offsetWidth > 0) {
                container.style.width = parent.offsetWidth + 'px';
            }
            container.style.height = '320px';
        }
        // 즉시 + 지연 invalidateSize
        try { this.map.invalidateSize({animate:false}); } catch(_){}
        [100, 300, 600, 1200].forEach(ms => {
            setTimeout(() => {
                try {
                    if (container && container.parentElement) {
                        container.style.width = container.parentElement.offsetWidth + 'px';
                    }
                    this.map.invalidateSize({animate:false});
                } catch(_){}
            }, ms);
        });
    }

    // ========== Nominatim 검색 ==========
    async search(query, contextHint = '') {
        try {
            const q = contextHint ? `${query}, ${contextHint}` : query;
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&accept-language=ko`;
            const res = await fetch(url, { headers: { 'User-Agent': 'RP-World-Tracker/0.2' } });
            if (!res.ok) return [];
            const data = await res.json();
            return data.map(r => ({
                name: r.display_name.split(',').slice(0, 2).join(','),
                fullName: r.display_name,
                lat: parseFloat(r.lat),
                lng: parseFloat(r.lon),
                type: r.type,
            }));
        } catch(e) { console.error(`[${EXTENSION_NAME}] Nominatim:`, e); return []; }
    }

    // 장소명으로 자동 좌표 배치
    async autoGeocode(locId, name, contextHint = '') {
        const results = await this.search(name, contextHint);
        if (results.length > 0) {
            const best = results[0];
            await this.lm.updateLocation(locId, { lat: best.lat, lng: best.lng });
            console.log(`[${EXTENSION_NAME}] Auto-geocoded "${name}" → ${best.lat.toFixed(4)},${best.lng.toFixed(4)}`);
            this.render();
            return best;
        }
        return null;
    }

    // 검색 결과를 지도에 임시 마커로 표시
    showSearchResult(lat, lng, name) {
        if (this._searchMarker) this.map.removeLayer(this._searchMarker);
        this._searchMarker = L.marker([lat, lng])
            .addTo(this.map)
            .bindPopup(`<b>${name}</b><br><small>여기에 배치?</small>`)
            .openPopup();
        this.map.setView([lat, lng], 15);
    }

    clearSearchMarker() {
        if (this._searchMarker) { this.map.removeLayer(this._searchMarker); this._searchMarker = null; }
    }

    // 좌표 없음 안내 오버레이
    _showNotice(msg) {
        this._removeNotice();
        const div = document.createElement('div');
        div.id = 'wt-leaflet-notice';
        div.style.cssText = 'position:absolute;top:8px;left:8px;right:8px;z-index:999;background:rgba(255,249,240,0.95);border:1.5px solid #E8E4D8;border-radius:8px;padding:10px 14px;font-size:12px;color:#775537;text-align:center;pointer-events:none;white-space:pre-line;';
        div.textContent = msg;
        this.container.style.position = 'relative';
        this.container.appendChild(div);
    }
    _removeNotice() {
        const el = document.getElementById('wt-leaflet-notice');
        if (el) el.remove();
    }

    destroy() {
        if (this.map) { this.map.remove(); this.map = null; }
        this.markers = {};
        this.distLabels = [];
    }
}
