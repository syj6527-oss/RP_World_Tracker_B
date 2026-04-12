// 🐶 월드맵 — location-manager.js (Single Scene)

import { getContext, extension_settings } from '../../../extensions.js';
import { EXTENSION_NAME } from './index.js';

export class LocationManager {
    constructor(db) {
        this.db = db;
        this.currentChatId = null;
        this.currentLocationId = null;
        this.currentSubLocationId = null; // ★ 현재 서브로케이션 엔티티 ID
        this.locations = [];
        this.movements = [];
        this.distances = [];
    }

    // ★ 서브로케이션 키워드
    static SUB_LOCATIONS = [
        '거실','부엌','주방','방','침실','안방','작은방','큰방','화장실','욕실','샤워실',
        '베란다','발코니','옥상','지하실','다락','서재','창고','세탁실','드레스룸',
        '복도','현관','로비','계단','엘리베이터',
        '마당','뒤뜰','앞마당','정원','차고','테라스',
        '사무실','회의실','휴게실','탕비실','대기실','접수처',
        '교실','강당','운동장','도서실','급식실','보건실',
        '과자 코너','음료 코너','계산대','진열대','매대',
        'room','bedroom','kitchen','bathroom','living room','restroom','washroom',
        'balcony','rooftop','basement','attic','study','garage','closet','pantry',
        'hallway','corridor','lobby','stairs','staircase','elevator',
        'yard','backyard','front yard','garden','terrace','porch',
        'office','meeting room','break room','waiting room','reception',
        'classroom','auditorium','gym','library','cafeteria',
        'aisle','counter','checkout','shelf',
    ];

    isSubLocation(name) {
        if (!name) return false;
        const lo = name.toLowerCase().trim();
        // 기본 키워드
        if (LocationManager.SUB_LOCATIONS.some(s => lo === s.toLowerCase() || lo.endsWith(s.toLowerCase()))) return true;
        // 별칭 맵
        for (const [key, aliases] of Object.entries(LocationManager.SUB_ALIASES)) {
            if (lo === key || aliases.some(a => lo === a.toLowerCase() || lo.endsWith(a.toLowerCase()))) return true;
        }
        return false;
    }

    // ★ 서브 장소 별칭 맵 (같은 장소의 다른 이름)
    static SUB_ALIASES = {
        '거실': ['리빙룸', '리빙 룸', 'living room', 'livingroom', 'lounge', '응접실', '라운지'],
        '부엌': ['주방', 'kitchen', '키친', '조리실', '요리실'],
        '침실': ['방', 'bedroom', '안방', '침대방', '자는방', '숙소'],
        '화장실': ['욕실', 'bathroom', 'restroom', 'toilet', '세면실', '샤워실', 'washroom', 'lavatory'],
        '서재': ['공부방', 'study', 'study room', '작업실', 'office'],
        '현관': ['입구', 'entrance', 'hallway', 'foyer', '복도'],
        '마당': ['정원', 'garden', 'yard', '뜰', 'backyard'],
        '차고': ['주차장', 'garage', 'parking'],
        '발코니': ['테라스', 'balcony', 'terrace', '베란다', 'veranda'],
        '지하실': ['지하', 'basement', '지하층'],
        '옥상': ['rooftop', '지붕'],
        '다락': ['다락방', 'attic'],
    };

    // ★ 서브 장소 이름 정규화 (긴 이름에서 핵심 키워드 추출)
    _normalizeSubName(raw) {
        let name = raw.trim();
        // 콤마/괄호 정리 → 마지막 의미 있는 파트
        if (name.includes(',')) {
            const parts = name.split(',').map(p => p.trim()).filter(p => p.length >= 1);
            name = parts[parts.length - 1];
        }
        name = name.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
        // "Honey badger의 침실" → "침실"
        name = name.replace(/.*(?:의|'s)\s*/i, '');
        // "1층 라운지 소파 앞" → "라운지" (위치 수식어 제거)
        name = name.replace(/\d+층\s*/g, '').replace(/\s*(?:앞|뒤|옆|안|밖|위|아래|내부|외부|뒤편|맞은편)\s*$/g, '').trim();
        // 너무 길면 첫 의미 있는 단어만
        if (name.length > 15) {
            const subKws = [...LocationManager.SUB_LOCATIONS, ...Object.keys(LocationManager.SUB_ALIASES), ...Object.values(LocationManager.SUB_ALIASES).flat()];
            for (const kw of subKws) {
                if (name.toLowerCase().includes(kw.toLowerCase())) return kw;
            }
        }
        return name || raw.trim();
    }

    // ★ 서브 장소 찾기/생성 (별칭 매칭 강화)
    async findOrCreateSub(parentId, subName) {
        const normalized = this._normalizeSubName(subName);
        const lo = normalized.toLowerCase().trim();

        // 별칭 그룹 찾기 (입력이 어떤 그룹에 속하는지)
        let aliasGroup = null;
        for (const [key, aliases] of Object.entries(LocationManager.SUB_ALIASES)) {
            if (key === lo || aliases.some(a => a.toLowerCase() === lo)) {
                aliasGroup = [key, ...aliases].map(a => a.toLowerCase());
                break;
            }
        }

        // 기존 서브 찾기 (이름 + 별칭 + 별칭 그룹)
        const existing = this.locations.find(l => {
            if (l.parentId !== parentId) return false;
            const n = l.name.toLowerCase();
            // 정확 매칭
            if (n === lo) return true;
            // 별칭 매칭
            if ((l.aliases||[]).some(a => a.toLowerCase() === lo)) return true;
            // 별칭 그룹 매칭 (거실 = 리빙룸 = living room)
            if (aliasGroup) {
                if (aliasGroup.includes(n)) return true;
                if ((l.aliases||[]).some(a => aliasGroup.includes(a.toLowerCase()))) return true;
            }
            // 부분 포함 매칭 (침실 ⊂ "NCO Barracks 2층 침실")
            if (lo.length >= 2 && (n.includes(lo) || lo.includes(n))) return true;
            return false;
        });
        if (existing) {
            // 별칭 추가 (normalized 이름이 다르면)
            if (existing.name.toLowerCase() !== lo && !(existing.aliases||[]).some(a => a.toLowerCase() === lo)) {
                const aliases = [...new Set([...(existing.aliases || []), normalized])];
                await this.db.putLocation({ ...existing, aliases });
                existing.aliases = aliases;
            }
            return existing;
        }
        // 새로 생성
        const loc = {
            id: this.generateId(), chatId: this.currentChatId,
            name: normalized, aliases: normalized !== subName.trim() ? [subName.trim()] : [], parentId: parentId,
            x: 0, y: 0, lat: null, lng: null,
            visitCount: 0, firstVisited: null, lastVisited: null,
            memo: '', status: '', color: this._rndColor(), createdAt: Date.now(),
        };
        await this.db.putLocation(loc); this.locations.push(loc);
        console.log(`[${EXTENSION_NAME}] 🔧 sub-loc created: "${normalized}" under "${this.locations.find(l=>l.id===parentId)?.name}"`);
        return loc;
    }

    // ★ 서브 장소로 이동 (부모 이동 아님, visitCount만 업데이트)
    async moveToSub(subId) {
        const sub = this.locations.find(l => l.id === subId);
        if (!sub) return;
        sub.visitCount = (sub.visitCount || 0) + 1;
        sub.lastVisited = Date.now();
        if (!sub.firstVisited) sub.firstVisited = Date.now();
        await this.db.putLocation(sub);
        this.currentSubLocationId = subId;
    }

    // ★ 부모 장소의 서브 목록
    getSubLocations(parentId) {
        return this.locations.filter(l => l.parentId === parentId);
    }

    // ★ 최상위 장소만 (서브 제외)
    getTopLocations() {
        return this.locations.filter(l => !l.parentId);
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
        if (!this.currentChatId) { this.locations=[]; this.movements=[]; this.distances=[]; this.currentLocationId=null; this.currentSubLocationId=null; return; }
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

        // ★ 자동 좌표 배치: 기존에 GPS 좌표 있는 장소가 있으면 근처에 배치
        const geoLocs = this.locations.filter(l => l.lat != null && l.lng != null);
        if (geoLocs.length > 0) {
            // 현재 위치 또는 가장 최근 방문 장소 기준
            const anchor = geoLocs.find(l => l.id === this.currentLocationId) || geoLocs[0];
            const dist = 30 + Math.random() * 120; // 30~150m
            const angle = Math.random() * 2 * Math.PI;
            loc.lat = anchor.lat + (dist / 111320) * Math.cos(angle);
            loc.lng = anchor.lng + (dist / (111320 * Math.cos(anchor.lat * Math.PI / 180))) * Math.sin(angle);
            console.log(`[${EXTENSION_NAME}] 🔧 autoCoord: "${name}" placed ${Math.round(dist)}m from "${anchor.name}" (${loc.lat.toFixed(6)},${loc.lng.toFixed(6)})`);
        }

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
        // ★ 부분 포함 매칭 (3글자 이상일 때: "Barracks" ⊂ "NCO Barracks")
        if (lo.length >= 3) {
            const partial = this.locations.find(l => {
                const n = l.name.toLowerCase();
                if (n.includes(lo) || lo.includes(n)) return true;
                if ((l.aliases || []).some(a => { const al = a.toLowerCase(); return al.includes(lo) || lo.includes(al); })) return true;
                return false;
            });
            if (partial) return partial;
        }
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
        // ★ 다른 장소로 이동하면 서브로케이션 클리어
        if (prevId !== locationId) this.currentSubLocationId = null;
        loc.visitCount = (loc.visitCount || 0) + 1;
        loc.lastVisited = Date.now();
        if (rpDate) loc.rpLastVisited = rpDate;
        if (!loc.firstVisited) loc.firstVisited = Date.now();
        if (!loc.rpFirstVisited && rpDate) loc.rpFirstVisited = rpDate;
        await this.db.putLocation(loc);
        if (prevId && prevId !== locationId) {
            const d = this.getDistanceBetween(prevId, locationId);
            const mov = { chatId: this.currentChatId, fromId: prevId, toId: locationId, timestamp: Date.now(), rpDate: rpDate || '', distance: d?.distanceText || null };
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
        console.log(`[${EXTENSION_NAME}] 🔧 autoGeo: ${targets.length} locations need address (total ${this.locations.length}, with coords ${this.locations.filter(l=>l.lat!=null).length})`);
        if (!targets.length) return;

        for (const loc of targets) {
            try {
                // Nominatim 요청 간격 (1초)
                await new Promise(r => setTimeout(r, 1100));
                console.log(`[${EXTENSION_NAME}] 🔧 autoGeo: fetching address for "${loc.name}" (${loc.lat.toFixed(4)},${loc.lng.toFixed(4)})`);
                const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${loc.lat}&lon=${loc.lng}&accept-language=ko`, { headers: { 'User-Agent': 'RP-World-Tracker/0.3' } });
                if (!res.ok) { console.warn(`[${EXTENSION_NAME}] 🔧 autoGeo: HTTP ${res.status} for "${loc.name}"`); continue; }
                const d = await res.json();
                const addr = d.display_name?.split(',').slice(0, 3).join(', ') || '';
                if (addr) {
                    await this.updateLocation(loc.id, { address: addr });
                    console.log(`[${EXTENSION_NAME}] 🔧 autoGeo: "${loc.name}" → ${addr}`);
                }
            } catch(e) { console.warn(`[${EXTENSION_NAME}] 🔧 autoGeo error for "${loc.name}":`, e.message); }
        }
    }

    // 좌표 있는 장소 쌍 → 거리 자동 계산
    async autoCalcDistances() {
        const geoLocs = this.locations.filter(l => l.lat != null && l.lng != null && !l.parentId); // ★ 서브 제외
        if (geoLocs.length < 2) return;
        let added = 0;

        for (let i = 0; i < geoLocs.length; i++) {
            for (let j = i + 1; j < geoLocs.length; j++) {
                const a = geoLocs[i], b = geoLocs[j];
                const meters = this._haversine(a.lat, a.lng, b.lat, b.lng);
                const level = this._metersToLevel(meters);
                const text = this._metersToText(meters);

                // 항상 좌표 로그 (디버그)
                console.log(`[${EXTENSION_NAME}] 🔧 autoDist: "${a.name}" (${a.lat?.toFixed(6)},${a.lng?.toFixed(6)}) ↔ "${b.name}" (${b.lat?.toFixed(6)},${b.lng?.toFixed(6)}) = ${text} (${Math.round(meters)}m, lv${level})`);

                // 이미 거리 설정되어 있으면 업데이트
                const existing = this.getDistanceBetween(a.id, b.id);
                if (existing) {
                    // 수동 설정이면 스킵, 자동이면 업데이트
                    if (existing._manual) continue;
                    existing.distanceText = text;
                    existing.level = level;
                    await this.db.saveDistance(existing);
                    continue;
                }

                await this.setDistance(a.id, b.id, text, null, level);
                added++;
            }
        }
        if (added) console.log(`[${EXTENSION_NAME}] 🔧 autoDist: ${added} new distances added`);
    }

    // ========== 터줏대감 (NPC/동물) 관리 — 풀 버전 ==========
    async addNpcToLocation(locId, npc) {
        const loc = this.locations.find(l => l.id === locId);
        if (!loc) return false;
        if (!loc.npcs) loc.npcs = [];
        // 중복 방지 (이름 기준, 대소문자 무시)
        const existing = loc.npcs.find(n => n.name.toLowerCase() === npc.name.toLowerCase());
        if (existing) {
            existing.count = (existing.count || 1) + 1;
            existing.lastSeen = Date.now();
            await this.db.saveLocation(loc);
            return false; // 기존 NPC 카운트 업
        }
        loc.npcs.push({
            name: npc.name,
            type: npc.type || 'npc', // 'npc' | 'animal'
            role: npc.role || '',
            avatar: npc.avatar || (npc.type === 'animal' ? '🐾' : '👤'),
            bio: npc.bio || '',
            personality: npc.personality || [], // ['과묵함','충성심']
            relationship: npc.relationship || '',
            affinity: npc.affinity ?? 3, // 1~5 (기본 3: 보통)
            firstSeen: Date.now(),
            lastSeen: Date.now(),
            count: 1,
        });
        await this.db.saveLocation(loc);
        console.log(`[${EXTENSION_NAME}] 🧑 NPC added: "${npc.name}" (${npc.type}) → ${loc.name}`);
        return true; // 새 NPC
    }

    async updateNpc(locId, npcName, updates) {
        const loc = this.locations.find(l => l.id === locId);
        if (!loc?.npcs) return false;
        const npc = loc.npcs.find(n => n.name.toLowerCase() === npcName.toLowerCase());
        if (!npc) return false;
        Object.assign(npc, updates);
        await this.db.saveLocation(loc);
        return true;
    }

    async updateNpcAffinity(locId, npcName, delta) {
        const loc = this.locations.find(l => l.id === locId);
        if (!loc?.npcs) return;
        const npc = loc.npcs.find(n => n.name.toLowerCase() === npcName.toLowerCase());
        if (!npc) return;
        npc.affinity = Math.max(1, Math.min(5, (npc.affinity || 3) + delta));
        npc.lastSeen = Date.now();
        await this.db.saveLocation(loc);
        console.log(`[${EXTENSION_NAME}] 💗 NPC affinity: "${npc.name}" ${delta > 0 ? '+' : ''}${delta} → ${npc.affinity}`);
    }

    async removeNpcFromLocation(locId, npcName) {
        const loc = this.locations.find(l => l.id === locId);
        if (!loc?.npcs) return;
        loc.npcs = loc.npcs.filter(n => n.name.toLowerCase() !== npcName.toLowerCase());
        await this.db.saveLocation(loc);
    }
}
