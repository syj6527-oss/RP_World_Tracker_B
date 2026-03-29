// 🐶 월드맵 — location-manager.js (Single Scene)

import { getContext } from '../../../extensions.js';
import { EXTENSION_NAME } from './index.js';

export class LocationManager {
    constructor(db) {
        this.db = db;
        this.currentChatId = null;
        this.currentLocationId = null; // 현재 씬 위치
        this.locations = [];
        this.movements = [];
        this.distances = [];
    }

    getChatId() { const ctx = getContext(); return ctx?.chatId ? String(ctx.chatId) : null; }
    generateId() { return `loc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`; }

    async loadChat() {
        this.currentChatId = this.getChatId();
        if (!this.currentChatId) { this.locations=[]; this.movements=[]; this.distances=[]; this.currentLocationId=null; return; }
        this.locations = await this.db.getLocationsByChatId(this.currentChatId) || [];
        this.movements = await this.db.getMovementsByChatId(this.currentChatId) || [];
        this.distances = await this.db.getDistancesByChatId(this.currentChatId) || [];
        const cfg = await this.db.getMapConfig(this.currentChatId);
        if (cfg) this.currentLocationId = cfg.currentLocationId || null;
        console.log(`[${EXTENSION_NAME}] Loaded: ${this.locations.length} locs, ${this.movements.length} moves`);
    }

    async addLocation(name, memo = '', aliases = []) {
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

    async moveTo(locationId) {
        const loc = this.locations.find(l => l.id === locationId); if (!loc) return;
        const prevId = this.currentLocationId;
        loc.visitCount = (loc.visitCount || 0) + 1;
        loc.lastVisited = Date.now();
        if (!loc.firstVisited) loc.firstVisited = Date.now();
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
        const n = this.locations.length; if (n === 0) return { x: 300, y: 250 };
        const a = n * 0.8, r = 80 + n * 25;
        return { x: Math.round(300 + r * Math.cos(a)), y: Math.round(250 + r * Math.sin(a)) };
    }

    _rndColor() {
        const c = ['#F5A8A8','#FCE7AE','#A8E6CF','#A8D8EA','#C3B1E1','#F5C6AA','#B5EAD7','#FFD3B6'];
        return c[Math.floor(Math.random() * c.length)];
    }
}
