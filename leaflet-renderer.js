// 🐶 월드맵 — leaflet-renderer.js

import { EXTENSION_NAME } from './index.js';

export class LeafletRenderer {
    constructor(container, lm) {
        this.container = container;
        this.lm = lm;
        this.map = null;
        this.markers = {};
        this.pathLines = [];
        this.onLocationClick = null;
        this._placingLocId = null; // 좌표 배치 모드
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
        this.map.on('click', (e) => this._onMapClick(e));

        console.log(`[${EXTENSION_NAME}] Leaflet initialized`);
        return true;
    }

    render() {
        if (!this.map) return;

        // 기존 마커/경로 제거
        for (const id in this.markers) { this.map.removeLayer(this.markers[id]); }
        this.markers = {};
        this.pathLines.forEach(l => this.map.removeLayer(l));
        this.pathLines = [];

        const { locations, movements, currentLocationId } = this.lm;
        const latlngs = []; // 좌표 있는 장소들 (fitBounds용)

        // 마커 표시
        for (const loc of locations) {
            if (!loc.lat || !loc.lng) continue;

            const isCur = loc.id === currentLocationId;
            const marker = L.circleMarker([loc.lat, loc.lng], {
                radius: isCur ? 14 : 10,
                fillColor: loc.color || '#FCE7AE',
                color: isCur ? '#775537' : '#9e8e7e',
                weight: isCur ? 3 : 1.5,
                fillOpacity: isCur ? 0.9 : 0.7,
                className: isCur ? 'wt-leaflet-current' : '',
            });

            // 라벨
            marker.bindTooltip(loc.name + (isCur ? ' 🐾' : ''), {
                permanent: true, direction: 'bottom', offset: [0, 8],
                className: 'wt-leaflet-label',
            });

            // 방문횟수 팝업
            marker.bindPopup(`<b>${loc.name}</b><br>방문 ${loc.visitCount || 0}회`);

            // 클릭 → 팝오버
            marker.on('click', () => { if (this.onLocationClick) this.onLocationClick(loc.id); });

            marker.addTo(this.map);
            this.markers[loc.id] = marker;
            latlngs.push([loc.lat, loc.lng]);
        }

        // 경로 표시
        const drawn = new Set();
        for (const m of movements) {
            const f = locations.find(l => l.id === m.fromId);
            const t = locations.find(l => l.id === m.toId);
            if (!f?.lat || !f?.lng || !t?.lat || !t?.lng) continue;
            const k = [m.fromId, m.toId].sort().join('-');
            if (drawn.has(k)) continue; drawn.add(k);

            const line = L.polyline([[f.lat, f.lng], [t.lat, t.lng]], {
                color: '#C4A882', weight: 2, dashArray: '6 4', opacity: 0.5,
            }).addTo(this.map);
            this.pathLines.push(line);
        }

        // 좌표 있는 장소들이 보이도록 맵 조정
        // 현재 위치 우선 → 전체 fitBounds 폴백
        const curLoc = locations.find(l => l.id === currentLocationId);
        if (curLoc?.lat && curLoc?.lng) {
            this.map.setView([curLoc.lat, curLoc.lng], 14);
        } else if (latlngs.length > 1) {
            this.map.fitBounds(latlngs, { padding: [30, 30], maxZoom: 15 });
        } else if (latlngs.length === 1) {
            this.map.setView(latlngs[0], 14);
        }

        // 현재 위치 좌표 없으면 안내 오버레이
        this._removeNotice();
        if (curLoc && !curLoc.lat && !curLoc.lng) {
            this._showNotice(`📍 "${curLoc.name}"에 좌표가 없어요\n🔍 검색으로 좌표를 배치해보세요`);
        }
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
    }
}
