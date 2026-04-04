// 🐶 월드맵 — location-manager.js (Single Scene)

import { getContext, extension_settings } from '../../../extensions.js';
import { EXTENSION_NAME } from './index.js';

export class LocationManager {
    constructor(db) {
        this.db = db;
        this.currentChatId = null;
        this.currentLocationId = null;
        this.locations = [];
        this.movements = [];
        this.distances = [];
    }

    getChatId() { const ctx = getContext(); return ctx?.chatId ? String(ctx.chatId) : null; }
    getCharacterId() { const ctx = getContext(); return ctx?.characterId != null ? `char_${ctx.characterId}` : null; }
    generateId() { return `loc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`; }

    // ★ 세계관 이어가기: 설정에 따라 characterId 또는 chatId 반환
    getDataKey() {
        const s = extension_settings[EXTENSION_NAME];
        if (s?.worldContinuity) {
            const charKey = this.getCharacterId();
            if (charKey) return charKey;
        }
        return this.getChatId();
    }

    async loadChat() {
        this.currentChatId = this.getDataKey();
        if (!this.currentChatId) { this.locations=[]; this.movements=[]; this.distances=[]; this.currentLocationId=null; return; }
        this.locations = await this.db.getLocationsByChatId(this.currentChatId) || [];
        this.movements = await this.db.getMovementsByChatId(this.currentChatId) || [];
        this.distances = await this.db.getDistancesByChatId(this.currentChatId) || [];
        const cfg = await this.db.getMapConfig(this.currentChatId);
        if (cfg) this.currentLocationId = cfg.currentLocationId || null;
        console.log(`[${EXTENSION_NAME}] Loaded (key=${this.currentChatId}): ${this.locations.length} locs, ${this.movements.length} moves`);
    }

    // ★ 마이그레이션: chatId 데이터를 characterId 키로 복사
    async migrateToCharacter() {
        const chatId = this.getChatId();
        const charKey = this.getCharacterId();
        if (!chatId || !charKey || chatId === charKey) return false;
        const existing = await this.db.getLocationsByChatId(charKey);
        if (existing && existing.length > 0) return true;
        const locs = await this.db.getLocationsByChatId(chatId) || [];
        const movs = await this.db.getMovementsByChatId(chatId) || [];
        const dists = await this.db.getDistancesByChatId(chatId) || [];
        const cfg = await this.db.getMapConfig(chatId);
        for (const l of locs) { l.chatId = charKey; await this.db.putLocation(l); }
        for (const m of movs) { m.chatId = charKey; try { await this.db._p(this.db._tx('movements','readwrite').put(m), m); } catch(_){} }
        for (const d of dists) { d.chatId = charKey; await this.db.saveDistance(d); }
        if (cfg) { cfg.chatId = charKey; await this.db.saveMapConfig(cfg); }
        console.log(`[${EXTENSION_NAME}] Migrated ${locs.length} locs from ${chatId} → ${charKey}`);
        return true;
    }

    async addLocation(name, memo = '', aliases = []) {
        if (!this.currentChatId) return null;
        // B6: 이동경로 분리 — "카페→집" 또는 "카페 -> 집" 등
        const arrowPat = /\s*(?:→|->|➡|⟶|=>)\s*/;
        if (arrowPat.test(name)) {
            const parts = name.split(arrowPat).map(p => p.trim()).filter(p => p.length >= 1);
            let lastLoc = null;
            for (const part of parts) {
                const existing = this.findByName(part);
                if (existing) { lastLoc = existing; continue; }
                lastLoc = await this._createSingleLocation(part, memo, aliases);
            }
            return lastLoc; // 마지막 장소(도착지) 반환
        }
        return this._createSingleLocation(name, memo, aliases);
    }

    async _createSingleLocation(name, memo = '', aliases = []) {
        if (!this.currentChatId) return null;
        const loc = {
            id: this.generateId(), chatId: this.currentChatId,
            name: name.trim(), aliases: aliases.map(a => a.trim()).filter(Boolean),
            x: 0, y: 0, lat: null, lng: null,
            visitCount: 0, firstVisited: null, lastVisited: null,
            memo: memo.trim(), status: '', color: this._rndColor(), createdAt: Date.now(),
        };
        const p = this._autoPos(); loc.x = p.x; loc.y = p.y;
        await this.db.putLocation(loc); this.locations.push(loc); return loc;
    }

    async updateLocation(id, u) {
        const l = this.locations.find(x => x.id === id); if (!l) return null;
        Object.assign(l, u); await this.db.putLocation(l); return l;
    }

    async deleteLocation(id) {
        await this.db.deleteLocation(id);
        this.locations = this.locations.filter(l => l.id !== id);
        if (this.currentLocationId === id) this.currentLocationId = null;
        await this._saveCfg();
    }

    // 한영 장소 사전 (이중 등록 방지)
    static PLACE_DICT = [
        ['집','Home','house'],['방','Room'],['학교','School'],['공원','Park'],['병원','Hospital'],
        ['카페','Cafe','cafe','coffee shop'],['식당','Restaurant'],['사무실','Office'],
        ['도서관','Library'],['교회','Church'],['가게','Shop','Store'],['시장','Market'],
        ['역','Station'],['공항','Airport'],['호텔','Hotel'],['숲','Forest'],
        ['해변','Beach'],['강','River'],['산','Mountain'],['궁전','Palace'],
        ['성','Castle'],['감옥','Prison'],['동굴','Cave'],['항구','Port','Harbor'],
        ['술집','Bar','Pub'],['체육관','Gym'],['극장','Theater','Theatre'],
        ['마트','Mart','Supermarket'],['편의점','Convenience store'],
    ];

    findByName(name) {
        const lo = name.toLowerCase();
        // 직접 매칭
        const direct = this.locations.find(l =>
            l.name.toLowerCase() === lo || (l.aliases || []).some(a => a.toLowerCase() === lo)
        );
        if (direct) return direct;
        // 한영 사전 매칭
        for (const group of LocationManager.PLACE_DICT) {
            const glo = group.map(w => w.toLowerCase());
            if (!glo.includes(lo)) continue;
            for (const loc of this.locations) {
                const names = [loc.name.toLowerCase(), ...(loc.aliases || []).map(a => a.toLowerCase())];
                if (names.some(n => glo.includes(n))) return loc;
            }
        }
        return null;
    }

    async moveTo(locationId, rpDate) {
        const loc = this.locations.find(l => l.id === locationId); if (!loc) return;
        const prevId = this.currentLocationId;
        loc.visitCount = (loc.visitCount || 0) + 1;
        loc.lastVisited = Date.now();
        if (rpDate) loc.rpLastVisited = rpDate;
        if (!loc.firstVisited) loc.firstVisited = Date.now();
        if (!loc.rpFirstVisited && rpDate) loc.rpFirstVisited = rpDate;
        await this.db.putLocation(loc);
        if (prevId && prevId !== locationId) {
            const d = this.getDistanceBetween(prevId, locationId);
            const mov = { chatId: this.currentChatId, fromId: prevId, toId: locationId, timestamp: Date.now(), distance: d?.distanceText || null };
            await this.db.addMovement(mov); this.movements.push(mov);
        }
        this.currentLocationId = locationId;
        await this._saveCfg();
    }

    async removeMovement(movId) {
        await this.db.deleteMovement(movId);
        this.movements = this.movements.filter(m => m.id !== movId);
    }

    async setDistance(a, b, text, walk = null, level = 3) {
        if (!this.currentChatId) return null;
        const id = [a, b].sort().join('_');
        const d = { id, chatId: this.currentChatId, fromId: a, toId: b, distanceText: text, walkTime: walk, level: level, updatedAt: Date.now() };
        await this.db.saveDistance(d);
        const i = this.distances.findIndex(x => x.id === id);
        if (i >= 0) this.distances[i] = d; else this.distances.push(d);
        return d;
    }

    getDistanceBetween(a, b) { return this.distances.find(d => d.id === [a, b].sort().join('_')) || null; }

    async _saveCfg() {
        if (!this.currentChatId) return;
        await this.db.saveMapConfig({ chatId: this.currentChatId, currentLocationId: this.currentLocationId });
    }

    _autoPos() {
        // 월드 좌표 중심 (고정 월드 3000×2400 기준)
        const WCX = 1500, WCY = 1200;
        const n = this.locations.length; if (n === 0) return { x: WCX, y: WCY };
        const a = n * 0.8, r = 80 + n * 25;
        return { x: Math.round(WCX + r * Math.cos(a)), y: Math.round(WCY + r * Math.sin(a)) };
    }

    _rndColor() {
        const c = ['#F5A8A8','#FCE7AE','#A8E6CF','#A8D8EA','#C3B1E1','#F5C6AA','#B5EAD7','#FFD3B6'];
        return c[Math.floor(Math.random() * c.length)];
    }

    // ========== 위치 기반 자동 확장 ==========

    // Haversine 공식 (두 좌표 간 직선 거리, 미터)
    _haversine(lat1, lng1, lat2, lng2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    // 거리(m) → 레벨(1~10)
    _metersToLevel(m) {
        if (m < 50) return 1;      // 바로 옆
        if (m < 150) return 2;     // 매우 가까움
        if (m < 300) return 3;     // 가까움
        if (m < 500) return 4;     // 도보 5분
        if (m < 1000) return 5;    // 도보권
        if (m < 2000) return 6;    // 도보 15분+
        if (m < 5000) return 7;    // 대중교통
        if (m < 15000) return 8;   // 차량 필요
        if (m < 50000) return 9;   // 먼 거리
        return 10;                  // 다른 지역
    }

    // 거리(m) → 텍스트 (x1.4 도보 보정)
    _metersToText(m) {
        const walk = m * 1.4; // 직선→도보 보정
        if (m < 50) return '바로 옆';
        if (walk < 1200) return `도보 ${Math.round(walk / 80)}분`;
        if (m < 5000) return `${(m/1000).toFixed(1)}km`;
        return `${Math.round(m/1000)}km`;
    }

    // 좌표 있는 장소 → 주소 자동 저장 (역지오코딩)
    async autoReverseGeocode() {
        const targets = this.locations.filter(l => l.lat != null && l.lng != null && !l.address);
        if (!targets.length) return;
        console.log(`[${EXTENSION_NAME}] 🔧 autoReverseGeocode: ${targets.length} locations need address`);

        for (const loc of targets) {
            try {
                // Nominatim 요청 간격 (1초)
                await new Promise(r => setTimeout(r, 1100));
                const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${loc.lat}&lon=${loc.lng}&accept-language=ko`, { headers: { 'User-Agent': 'RP-World-Tracker/0.3' } });
                if (!res.ok) continue;
                const d = await res.json();
                const addr = d.display_name?.split(',').slice(0, 3).join(', ') || '';
                if (addr) {
                    await this.updateLocation(loc.id, { address: addr });
                    console.log(`[${EXTENSION_NAME}] 🔧 autoGeo: "${loc.name}" → ${addr}`);
                }
            } catch(e) { console.warn(`[${EXTENSION_NAME}] autoGeo error for "${loc.name}":`, e.message); }
        }
    }

    // 좌표 있는 장소 쌍 → 거리 자동 계산
    async autoCalcDistances() {
        const geoLocs = this.locations.filter(l => l.lat != null && l.lng != null);
        if (geoLocs.length < 2) return;
        let added = 0;

        for (let i = 0; i < geoLocs.length; i++) {
            for (let j = i + 1; j < geoLocs.length; j++) {
                const a = geoLocs[i], b = geoLocs[j];
                // 이미 거리 설정되어 있으면 스킵
                if (this.getDistanceBetween(a.id, b.id)) continue;

                const meters = this._haversine(a.lat, a.lng, b.lat, b.lng);
                const level = this._metersToLevel(meters);
                const text = this._metersToText(meters);

                await this.setDistance(a.id, b.id, text, null, level);
                added++;
                console.log(`[${EXTENSION_NAME}] 🔧 autoDist: "${a.name}" (${a.lat?.toFixed(4)},${a.lng?.toFixed(4)}) ↔ "${b.name}" (${b.lat?.toFixed(4)},${b.lng?.toFixed(4)}) = ${text} (${Math.round(meters)}m, lv${level})`);
            }
        }
        if (added) console.log(`[${EXTENSION_NAME}] 🔧 autoDist: ${added} distances added`);
    }
}
