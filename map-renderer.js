// 🐶 World Tracker — map-renderer.js (Zoom + Pan + Touch)

export class MapRenderer {
    constructor(container, lm) {
        this.container = container; this.lm = lm;
        this.svg = null; this._wasDrag = false; this._movingNodeId = null;
        this.onLocationClick = null; this.onMoveRequest = null;
        // ViewBox state for zoom/pan
        this.vb = { x: 0, y: 0, w: 600, h: 500 };
        this._pinch = null; this._pan = null;
        this._init();
    }

    _init() {
        if (!this.container) { console.error('[MAP] Container is null!'); return; }
        // 🐛 Bug1 Fix: 기존 SVG 제거 → 중복 방지 (overflow:hidden에서 밀려나는 문제)
        this.container.querySelectorAll('svg.wt-map-svg').forEach(el => el.remove());
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.setAttribute('class', 'wt-map-svg');
        this.svg.setAttribute('width', '100%');
        // 모바일: height 100% → 0px 버그 방지, 명시적 높이
        const h = this.container.offsetHeight || this.container.clientHeight || 320;
        this.svg.setAttribute('height', Math.max(h, 320) + 'px');
        this.svg.style.minHeight = '320px';
        this._applyVB();
        this.container.appendChild(this.svg);

        // Mouse
        this.svg.addEventListener('mousedown', e => this._onDown(e));
        this.svg.addEventListener('mousemove', e => this._onMove(e));
        this.svg.addEventListener('mouseup', () => this._onUp());
        this.svg.addEventListener('mouseleave', () => this._onUp());
        // Mouse wheel zoom
        this.svg.addEventListener('wheel', e => { e.preventDefault(); this._zoom(e.deltaY > 0 ? 1.1 : 0.9, e); }, { passive: false });

        // Touch
        this.svg.addEventListener('touchstart', e => this._touchStart(e), { passive: false });
        this.svg.addEventListener('touchmove', e => this._touchMove(e), { passive: false });
        this.svg.addEventListener('touchend', e => this._touchEnd(e));
    }

    _applyVB() { this.svg.setAttribute('viewBox', `${this.vb.x} ${this.vb.y} ${this.vb.w} ${this.vb.h}`); }

    // ========== Render ==========
    render() {
        if (!this.svg) return;
        document.getElementById('wt-map-debug')?.remove();
        if (this.container) {
            const h = this.container.offsetHeight || this.container.clientHeight || 320;
            this.svg.setAttribute('height', Math.max(h, 320) + 'px');
        }

        // 🏰 판타지 모드
        if (this.fantasyMode) { this._renderFantasy(); return; }

        // ========== SVG Defs ==========
        this.svg.innerHTML = `<defs>
            <filter id="wt-shadow"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000" flood-opacity="0.22"/></filter>
            <filter id="wt-shadow-sm"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#000" flood-opacity="0.12"/></filter>
        </defs>`;
        const { locations, movements, currentLocationId } = this.lm;

        // 거리 기반 약도 자동 배치
        if (locations.length >= 2) this._autoLayout();

        // ViewBox 먼저 계산 (배경 렌더링에 필요)
        if (locations.length) {
            const pad = 90;
            const xs = locations.map(l => l.x), ys = locations.map(l => l.y);
            const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
            const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
            this.vb = { x: minX, y: minY, w: Math.max(350, maxX - minX), h: Math.max(280, maxY - minY) };
        } else {
            this.vb = { x: 0, y: 0, w: 600, h: 500 };
        }
        this._applyVB();

        // ========== 배경: 도로 + 건물 (약도 느낌) ==========
        const vb = this.vb;
        const roadC = '#fff', roadB = '#E0DCD0';
        // 가로 도로
        for (let i = 0; i < 4; i++) {
            const ry = vb.y + vb.h * (0.18 + i * 0.22);
            const rw = vb.w * (0.5 + (i * 17 % 50) / 100);
            const rx = vb.x + (i * 31 % 50) / 100 * (vb.w - rw);
            const main = i === 1;
            this.svg.appendChild(this._el('rect', { x: rx, y: ry, width: rw, height: main ? 10 : 7, rx: 2, fill: main ? '#FDE68A' : roadC, stroke: main ? '#F5D56A' : roadB, 'stroke-width': 0.5, opacity: main ? 0.5 : 0.35 }));
        }
        // 세로 도로
        for (let i = 0; i < 3; i++) {
            const rx = vb.x + vb.w * (0.25 + i * 0.25);
            const rh = vb.h * (0.4 + (i * 23 % 40) / 100);
            const ry = vb.y + (i * 19 % 60) / 100 * (vb.h - rh);
            const main = i === 1;
            this.svg.appendChild(this._el('rect', { x: rx, y: ry, width: main ? 10 : 7, height: rh, rx: 2, fill: main ? '#FDBA74' : roadC, stroke: main ? '#F5A05A' : roadB, 'stroke-width': 0.5, opacity: main ? 0.4 : 0.3 }));
        }
        // 건물 블록
        const seed = (locations.length * 7 + 13) % 100;
        for (let i = 0; i < 7; i++) {
            const bx = vb.x + ((seed + i * 67) % 80) / 100 * vb.w;
            const by = vb.y + ((seed + i * 43) % 85) / 100 * vb.h;
            this.svg.appendChild(this._el('rect', { x: bx, y: by, width: 22 + (i * 13 % 25), height: 16 + (i * 11 % 18), rx: 2, fill: '#E6E2D8', stroke: '#D4D0C4', 'stroke-width': 0.5, opacity: 0.4 }));
        }
        // 공원
        this.svg.appendChild(this._el('rect', { x: vb.x + vb.w * 0.05, y: vb.y + vb.h * 0.72, width: 35, height: 25, rx: 5, fill: '#D4EDBC', stroke: '#B8D89E', 'stroke-width': 0.5, opacity: 0.35 }));

        // ========== 경로선 + 거리 pill ==========
        const drawn = new Set();
        for (const m of movements) {
            const f = locations.find(l => l.id === m.fromId), t = locations.find(l => l.id === m.toId);
            if (!f || !t) continue;
            const k = [m.fromId, m.toId].sort().join('-'); if (drawn.has(k)) continue; drawn.add(k);
            this.svg.appendChild(this._el('line', { x1: f.x, y1: f.y, x2: t.x, y2: t.y, class: 'wt-path-line' }));

            const dist = this.lm.getDistanceBetween(m.fromId, m.toId);
            if (dist?.distanceText) {
                const mx = (f.x + t.x) / 2, my = (f.y + t.y) / 2;
                const tl = dist.distanceText.length * 5.5 + 14;
                const pill = this._el('g', { transform: `translate(${mx},${my - 10})` });
                pill.appendChild(this._el('rect', { x: -tl/2, y: -8, width: tl, height: 16, rx: 8, fill: '#fff', stroke: '#E0E0E0', 'stroke-width': 0.8, filter: 'url(#wt-shadow-sm)' }));
                pill.appendChild(this._el('text', { x: 0, y: 4, 'text-anchor': 'middle', fill: '#5E84E2', 'font-size': '9', 'font-weight': '600' }, dist.distanceText));
                this.svg.appendChild(pill);
            }
        }

        // ========== 핀 마커 렌더링 ==========
        for (const loc of locations) {
            const cur = loc.id === currentLocationId;
            const ps = this._pinStyle(loc.name);
            const g = this._el('g', { class: 'wt-location-node', 'data-id': loc.id, transform: `translate(${loc.x},${loc.y})` });

            // GPS 펄스 (현재 위치)
            if (cur) {
                const pulse = this._el('circle', { r: 20, fill: 'none', stroke: ps.color, 'stroke-width': 2, opacity: '0.4' });
                const aR = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
                aR.setAttribute('attributeName', 'r'); aR.setAttribute('from', '14'); aR.setAttribute('to', '28');
                aR.setAttribute('dur', '2s'); aR.setAttribute('repeatCount', 'indefinite'); pulse.appendChild(aR);
                const aO = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
                aO.setAttribute('attributeName', 'opacity'); aO.setAttribute('from', '0.5'); aO.setAttribute('to', '0');
                aO.setAttribute('dur', '2s'); aO.setAttribute('repeatCount', 'indefinite'); pulse.appendChild(aO);
                g.appendChild(pulse);
            }

            // 핀 물방울
            const sz = cur ? 16 : 13;
            const ph = cur ? 22 : 18;
            const pin = this._el('g', { transform: `translate(0,${-ph})`, filter: 'url(#wt-shadow)' });
            pin.appendChild(this._el('path', { d: `M0,${ph}C0,${ph},${-sz},${ph*0.35},${-sz},${-sz*0.15}A${sz},${sz},0,1,1,${sz},${-sz*0.15}C${sz},${ph*0.35},0,${ph},0,${ph}Z`, fill: ps.color, stroke: ps.border, 'stroke-width': 0.8 }));
            pin.appendChild(this._el('text', { x: 0, y: -sz * 0.1 + 5, 'text-anchor': 'middle', 'font-size': cur ? '13' : '11' }, ps.emoji));
            g.appendChild(pin);

            // 방문 뱃지
            if (loc.visitCount > 0) {
                const bx = sz * 0.55, by = -(ph + sz * 0.45);
                const bg = this._el('g', { transform: `translate(${bx},${by})` });
                bg.appendChild(this._el('circle', { r: 7.5, fill: '#fff', stroke: ps.color, 'stroke-width': 1.5 }));
                bg.appendChild(this._el('text', { 'text-anchor': 'middle', y: 3.5, 'font-size': '8', 'font-weight': '700', fill: ps.color }, loc.visitCount));
                g.appendChild(bg);
            }

            // 장소명 pill
            const nl = loc.name.length * 7 + 12;
            const lg = this._el('g', { transform: 'translate(0,10)' });
            lg.appendChild(this._el('rect', { x: -nl/2, y: -8, width: nl, height: 16, rx: 8, fill: '#fff', stroke: '#E8E4D8', 'stroke-width': 0.7, filter: 'url(#wt-shadow-sm)' }));
            lg.appendChild(this._el('text', { class: 'wt-location-label', y: 3, 'font-size': '10' }, loc.name));
            g.appendChild(lg);

            // 🐾 바운스
            if (cur) {
                const paw = this._el('text', { 'text-anchor': 'middle', y: -(ph + sz + 6), 'font-size': '14' }, '🐾');
                const pa = document.createElementNS('http://www.w3.org/2000/svg', 'animateTransform');
                pa.setAttribute('attributeName', 'transform'); pa.setAttribute('type', 'translate');
                pa.setAttribute('values', '0 0;0 -4;0 0'); pa.setAttribute('dur', '1.2s');
                pa.setAttribute('repeatCount', 'indefinite'); paw.appendChild(pa);
                g.appendChild(paw);
            }
            this.svg.appendChild(g);
        }

        if (!locations.length) this.svg.appendChild(this._el('text', { x: 300, y: 250, class: 'wt-empty-text' }, 'RP를 시작해보세요! 🐶'));

    }

    // ========== 핀 스타일 (카테고리별) ==========
    _pinStyle(name) {
        const lo = name.toLowerCase();
        if (/카페|cafe|coffee|커피/i.test(lo)) return { color: '#E74C3C', emoji: '🐱', border: '#C0392B' };
        if (/서점|book|도서|library|서재/i.test(lo)) return { color: '#3498DB', emoji: '📚', border: '#2980B9' };
        if (/집|home|house|숙소|기숙|방/i.test(lo)) return { color: '#27AE60', emoji: '🏠', border: '#1E8449' };
        if (/공원|park|정원|garden|광장/i.test(lo)) return { color: '#2ECC71', emoji: '🌳', border: '#27AE60' };
        if (/편의|convenience|마트|mart|가게|shop|store|문구/i.test(lo)) return { color: '#F39C12', emoji: '🏪', border: '#D68910' };
        if (/식당|restaurant|음식|레스토랑/i.test(lo)) return { color: '#E67E22', emoji: '🍽️', border: '#CA6F1E' };
        if (/학교|school|학원|academy/i.test(lo)) return { color: '#9B59B6', emoji: '🎓', border: '#7D3C98' };
        if (/병원|hospital|의원|clinic/i.test(lo)) return { color: '#1ABC9C', emoji: '🏥', border: '#17A589' };
        if (/역|station|지하철|subway|버스|bus/i.test(lo)) return { color: '#34495E', emoji: '🚉', border: '#2C3E50' };
        if (/술집|bar|pub|tavern|주점|주막/i.test(lo)) return { color: '#8E44AD', emoji: '🍺', border: '#6C3483' };
        if (/체육|gym|운동|fitness|arena/i.test(lo)) return { color: '#E74C3C', emoji: '💪', border: '#C0392B' };
        if (/성|castle|궁|palace|요새/i.test(lo)) return { color: '#7F8C8D', emoji: '🏰', border: '#616A6B' };
        if (/숲|forest|산|mountain/i.test(lo)) return { color: '#1E8449', emoji: '🌲', border: '#145A32' };
        if (/해변|beach|바다|sea|강|river|호수|lake/i.test(lo)) return { color: '#2980B9', emoji: '🌊', border: '#1F618D' };
        if (/동굴|cave|dungeon|던전|지하|underground/i.test(lo)) return { color: '#5D6D7E', emoji: '🕳️', border: '#4A5568' };
        if (/항구|port|harbor|dock|부두/i.test(lo)) return { color: '#2471A3', emoji: '⚓', border: '#1A5276' };
        return { color: '#F6A93A', emoji: '📍', border: '#D68910' };
    }


    // ========== 거리 기반 약도 자동 배치 ==========
    _autoLayout() {
        const locs = this.lm.locations;
        const dists = this.lm.distances || [];
        if (locs.length < 2) return;

        // 거리 level → 픽셀 거리 매핑 (1~10)
        const levelToPx = { 1: 60, 2: 80, 3: 100, 4: 130, 5: 160, 6: 200, 7: 240, 8: 280, 9: 330, 10: 400 };

        // 첫 노드가 (0,0)이면 초기 배치 필요
        const needsInit = locs.some(l => l.x === 0 && l.y === 0);
        // 🐛 Bug1 Fix: 첫 렌더링(_layoutDone 미설정)이면 무조건 실행
        if (!needsInit && !this._layoutDirty && this._layoutDone) return;
        this._layoutDirty = false;
        this._layoutDone = true;

        // 현재 위치를 중심에
        const curId = this.lm.currentLocationId;
        const curLoc = locs.find(l => l.id === curId) || locs[0];
        curLoc.x = 300; curLoc.y = 250;

        // 거리 데이터 없는 노드는 원형 배치
        let angle = 0;
        const angleStep = (2 * Math.PI) / Math.max(locs.length - 1, 1);

        for (const loc of locs) {
            if (loc.id === curLoc.id) continue;
            // 거리 데이터 확인
            const dist = dists.find(d =>
                (d.fromId === curLoc.id && d.toId === loc.id) ||
                (d.toId === curLoc.id && d.fromId === loc.id)
            );
            const level = dist?.level || 3;
            const px = levelToPx[level] || 160;

            loc.x = Math.round(300 + px * Math.cos(angle));
            loc.y = Math.round(250 + px * Math.sin(angle));
            angle += angleStep;
        }

        // 스프링 시뮬레이션 (5회 반복)
        for (let iter = 0; iter < 5; iter++) {
            for (const d of dists) {
                const a = locs.find(l => l.id === d.fromId);
                const b = locs.find(l => l.id === d.toId);
                if (!a || !b) continue;

                const ideal = levelToPx[d.level || 5] || 160;
                const dx = b.x - a.x, dy = b.y - a.y;
                const actual = Math.sqrt(dx * dx + dy * dy) || 1;
                const force = (actual - ideal) * 0.15;
                const fx = (dx / actual) * force, fy = (dy / actual) * force;

                if (a.id !== curLoc.id) { a.x += Math.round(fx); a.y += Math.round(fy); }
                if (b.id !== curLoc.id) { b.x -= Math.round(fx); b.y -= Math.round(fy); }
            }

            // 겹침 방지 (최소 60px)
            for (let i = 0; i < locs.length; i++) {
                for (let j = i + 1; j < locs.length; j++) {
                    const dx = locs[j].x - locs[i].x, dy = locs[j].y - locs[i].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 60) {
                        const push = (60 - dist) / 2;
                        const nx = dx / (dist || 1), ny = dy / (dist || 1);
                        if (locs[i].id !== curLoc.id) { locs[i].x -= Math.round(push * nx); locs[i].y -= Math.round(push * ny); }
                        if (locs[j].id !== curLoc.id) { locs[j].x += Math.round(push * nx); locs[j].y += Math.round(push * ny); }
                    }
                }
            }
        }

        // DB에 위치 저장
        for (const loc of locs) {
            this.lm.updateLocation(loc.id, { x: loc.x, y: loc.y });
        }
    }

    // ========== 🏰 Fantasy Map Rendering ==========
    _renderFantasy() {
        const { locations, movements, currentLocationId } = this.lm;
        if (locations.length >= 2) this._autoLayout();

        // Bug H: 컨테이너 비율에 맞춰 ViewBox 설정 (가로 꽉 채움)
        const containerW = Math.max(this.container?.offsetWidth || 600, 300);
        const containerH = Math.max(this.container?.offsetHeight || 400, 300);
        const aspect = containerW / containerH;

        if (locations.length) {
            const pad = 100;
            const xs = locations.map(l => l.x), ys = locations.map(l => l.y);
            const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
            const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
            const contentW = Math.max(400, maxX - minX);
            const contentH = Math.max(300, maxY - minY);
            // 컨테이너 비율에 맞추되 최소 크기 보장
            const w = contentW;
            const h = Math.max(contentH, w / aspect);
            this.vb = { x: minX, y: minY, w, h };
        } else {
            this.vb = { x: 0, y: 0, w: 600, h: Math.max(400, Math.round(600 / aspect)) };
        }
        this._applyVB();

        const vb = this.vb;
        // 배경은 CSS로 처리 (.wt-fantasy-theme), SVG는 콘텐츠만
        let svg = `<defs>
            <filter id="wt-glow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>`;

        // 경로선 (빨간/갈색 점선 — 보물지도 스타일)
        const drawn = new Set();
        for (const m of movements) {
            const f = locations.find(l => l.id === m.fromId), t = locations.find(l => l.id === m.toId);
            if (!f || !t) continue;
            const k = [m.fromId, m.toId].sort().join('-'); if (drawn.has(k)) continue; drawn.add(k);

            // 약간 곡선 느낌: 중간점에 살짝 오프셋
            const mx = (f.x + t.x) / 2 + (Math.random() - 0.5) * 20;
            const my = (f.y + t.y) / 2 + (Math.random() - 0.5) * 20;
            svg += `<path d="M${f.x},${f.y} Q${mx},${my} ${t.x},${t.y}" fill="none" stroke="#6B3A2A" stroke-width="2.5" stroke-dasharray="10 6" opacity="0.55" stroke-linecap="round"/>`;

            // 거리 라벨
            const dist = this.lm.getDistanceBetween(m.fromId, m.toId);
            if (dist?.distanceText) {
                const lx = (f.x + t.x) / 2, ly = (f.y + t.y) / 2 - 6;
                svg += `<text x="${lx}" y="${ly}" text-anchor="middle" fill="#5D4037" font-size="9" font-family="serif" opacity="0.6" font-style="italic">${dist.distanceText}</text>`;
            }
        }

        // 장소 아이콘 렌더링
        for (const loc of locations) {
            const cur = loc.id === currentLocationId;
            const type = loc.locationType || this._getLocationType(loc.name);

            // 현재 위치 글로우
            if (cur) svg += `<circle cx="${loc.x}" cy="${loc.y}" r="28" fill="#CD853F" opacity="0.15" filter="url(#wt-glow)"/>`;

            // 아이콘
            svg += this._fantasyIcon(loc.x, loc.y, type, cur, loc.visitCount || 0, loc.id);

            // 장소명 라벨
            const fontSize = cur ? 13 : 11;
            const labelY = loc.y + (type === 'mountain' ? 28 : 24);
            svg += `<text x="${loc.x}" y="${labelY}" text-anchor="middle" fill="#3E2723" font-size="${fontSize}" font-weight="${cur?'700':'600'}" font-family="'Georgia',serif">${loc.name}</text>`;

            // 🐾 현재 위치
            if (cur) svg += `<text x="${loc.x}" y="${loc.y - 24}" text-anchor="middle" font-size="14">🐾</text>`;
        }

        if (!locations.length) {
            svg += `<text x="${vb.x + vb.w/2}" y="${vb.y + vb.h/2}" text-anchor="middle" fill="#5D4037" font-size="14" font-family="'Georgia',serif" font-style="italic">모험을 시작해보세요... 🏰</text>`;
        }

        this.svg.innerHTML = svg;
    }

    // 장소 타입 판별 (이름 키워드 매칭)
    _getLocationType(name) {
        const lo = name.toLowerCase();
        if (/성|castle|palace|궁|왕궁|요새|fortress|citadel|tower|탑/.test(lo)) return 'castle';
        if (/산|mountain|mount|peak|봉|ridge|cliff|절벽/.test(lo)) return 'mountain';
        if (/숲|forest|woods|grove|나무|밀림|jungle/.test(lo)) return 'forest';
        if (/신전|사원|temple|church|성당|교회|shrine|chapel|cathedral/.test(lo)) return 'temple';
        if (/마을|village|town|settlement|정착지|촌/.test(lo)) return 'village';
        if (/집|home|house|오두막|hut|cabin|cottage|lodge/.test(lo)) return 'house';
        if (/가게|shop|market|시장|store|상점|대장간|forge|smithy/.test(lo)) return 'shop';
        if (/술집|tavern|bar|pub|inn|주점|주막|여관/.test(lo)) return 'tavern';
        if (/동굴|cave|dungeon|던전|지하|underground|mine|광산/.test(lo)) return 'cave';
        if (/항구|port|harbor|dock|부두|선착장|pier/.test(lo)) return 'port';
        if (/강|river|lake|호수|바다|sea|ocean|해변|beach|연못|pond/.test(lo)) return 'water';
        if (/학교|school|academy|학원|도서관|library|archive/.test(lo)) return 'library';
        if (/arena|훈련|training|체육|gym|경기장|stadium|투기장/.test(lo)) return 'arena';
        return 'flag';
    }

    // 판타지 아이콘 SVG
    // Bug C: 이모지 기반 판타지 아이콘 (SVG path → 이모지 <text>)
    _fantasyIcon(x, y, type, isCurrent, visits, locId) {
        const s = isCurrent ? 1.15 : 1;
        const stroke = '#5D4037';
        let svg = `<g transform="translate(${x},${y}) scale(${s})" class="wt-location-node" data-id="${locId}">`;

        const emojiMap = {
            castle: '🏰', mountain: '⛰️', forest: '🌲', temple: '⛪',
            village: '🏘️', house: '🏠', shop: '🏪', tavern: '🍺',
            cave: '🕳️', port: '⚓', water: '💧', library: '📚',
            arena: '⚔️', flag: '🪧',
        };
        const emoji = emojiMap[type] || '📍';
        const size = isCurrent ? 28 : 22;

        // 현재 위치 글로우 배경
        if (isCurrent) {
            svg += `<circle r="20" fill="#CD853F" opacity="0.2" filter="url(#wt-glow)"/>`;
        }

        // 이모지 아이콘
        svg += `<text y="6" text-anchor="middle" font-size="${size}" style="cursor:pointer;pointer-events:none;user-select:none">${emoji}</text>`;

        // 방문 횟수 뱃지
        if (visits > 0) {
            svg += `<circle cx="14" cy="-8" r="7" fill="#DAA520" stroke="${stroke}" stroke-width="0.8"/>`;
            svg += `<text x="14" y="-5" text-anchor="middle" fill="#3E2723" font-size="8" font-weight="700">${visits}</text>`;
        }

        svg += '</g>';
        return svg;
    }

    // 나침반 장미
    _compassRose(cx, cy) {
        const s = 22;
        let svg = `<g transform="translate(${cx},${cy})">`;
        svg += `<circle r="${s}" fill="rgba(244,228,193,0.6)" stroke="#8B6914" stroke-width="1.2"/>`;
        svg += `<circle r="${s*0.15}" fill="#8B6914"/>`;
        // 큰 화살표 (N/S/E/W)
        svg += `<polygon points="0,${-s+3} -4,${-s*0.35} 4,${-s*0.35}" fill="#8B0000" stroke="#5D4037" stroke-width="0.5"/>`;
        svg += `<polygon points="0,${s-3} -4,${s*0.35} 4,${s*0.35}" fill="#D4C5A0" stroke="#5D4037" stroke-width="0.5"/>`;
        svg += `<polygon points="${-s+3},0 ${-s*0.35},-4 ${-s*0.35},4" fill="#D4C5A0" stroke="#5D4037" stroke-width="0.5"/>`;
        svg += `<polygon points="${s-3},0 ${s*0.35},-4 ${s*0.35},4" fill="#D4C5A0" stroke="#5D4037" stroke-width="0.5"/>`;
        // 대각선 작은 화살표
        const d = s * 0.55;
        svg += `<line x1="${-d}" y1="${-d}" x2="${d}" y2="${d}" stroke="#8B6914" stroke-width="0.6" opacity="0.4"/>`;
        svg += `<line x1="${d}" y1="${-d}" x2="${-d}" y2="${d}" stroke="#8B6914" stroke-width="0.6" opacity="0.4"/>`;
        // 방위 문자
        svg += `<text y="${-s-3}" text-anchor="middle" fill="#8B0000" font-size="8" font-weight="700" font-family="serif">N</text>`;
        svg += `<text y="${s+9}" text-anchor="middle" fill="#5D4037" font-size="7" font-weight="600" font-family="serif">S</text>`;
        svg += `<text x="${-s-4}" y="3" text-anchor="middle" fill="#5D4037" font-size="7" font-weight="600" font-family="serif">W</text>`;
        svg += `<text x="${s+5}" y="3" text-anchor="middle" fill="#5D4037" font-size="7" font-weight="600" font-family="serif">E</text>`;
        svg += '</g>';
        return svg;
    }

    // 모서리 장식
    _cornerOrnament(x, y, dx, dy) {
        const s = 18;
        return `<g transform="translate(${x},${y}) scale(${dx},${dy})">
            <path d="M0,0 C${s*0.3},0 ${s*0.5},${s*0.1} ${s*0.5},${s*0.3} M0,0 C0,${s*0.3} ${s*0.1},${s*0.5} ${s*0.3},${s*0.5}" fill="none" stroke="#8B6914" stroke-width="1.5" opacity="0.5"/>
            <circle cx="${s*0.08}" cy="${s*0.08}" r="2" fill="#8B6914" opacity="0.4"/>
        </g>`;
    }

    // ========== Touch Handling (롱프레스 이동) ==========
    _touchStart(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            this._pinch = this._pinchDist(e);
            this._pan = null; this._longPress = null;
            return;
        }
        if (e.touches.length === 1) {
            const t = e.touches[0];
            const pt = this._svgPt(t);
            const hitId = this._hitTest(pt);
            this._touchInfo = { x: t.clientX, y: t.clientY, time: Date.now(), nodeId: hitId, pt };
            this._wasDrag = false;

            if (hitId && !this._movingNodeId) {
                // 롱프레스 감지 시작 (500ms)
                e.preventDefault();
                this._longPress = setTimeout(() => {
                    this._movingNodeId = hitId;
                    const loc = this.lm.locations.find(l => l.id === hitId);
                    if (loc && this.onMoveRequest) this.onMoveRequest(hitId, loc.name);
                    this._longPress = null;
                }, 500);
            } else if (this._movingNodeId) {
                // 이동 모드 중 — 터치한 위치로 노드 이동
                e.preventDefault();
                const loc = this.lm.locations.find(l => l.id === this._movingNodeId);
                if (loc) {
                    loc.x = Math.round(pt.x); loc.y = Math.round(pt.y);
                    this.lm.updateLocation(loc.id, { x: loc.x, y: loc.y });
                    this.render();
                }
                this._movingNodeId = null;
            } else {
                // 맵 팬
                this._pan = { sx: t.clientX, sy: t.clientY, vx: this.vb.x, vy: this.vb.y };
            }
        }
    }

    _touchMove(e) {
        if (e.touches.length === 2 && this._pinch) {
            e.preventDefault();
            const dist = this._pinchDist(e);
            const scale = this._pinch / dist;
            const cx = this.vb.x + this.vb.w / 2, cy = this.vb.y + this.vb.h / 2;
            const nw = Math.max(200, Math.min(1200, this.vb.w * scale));
            const nh = nw * (500 / 600);
            this.vb = { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
            this._applyVB();
            this._pinch = dist;
            return;
        }
        if (e.touches.length === 1) {
            const t = e.touches[0];
            // 롱프레스 중 이동하면 취소
            if (this._longPress && this._touchInfo) {
                const dx = Math.abs(t.clientX - this._touchInfo.x);
                const dy = Math.abs(t.clientY - this._touchInfo.y);
                if (dx > 10 || dy > 10) { clearTimeout(this._longPress); this._longPress = null; }
            }
            if (this._pan) {
                e.preventDefault();
                const dx = (t.clientX - this._pan.sx) * (this.vb.w / this.svg.getBoundingClientRect().width);
                const dy = (t.clientY - this._pan.sy) * (this.vb.h / this.svg.getBoundingClientRect().height);
                this.vb.x = this._pan.vx - dx;
                this.vb.y = this._pan.vy - dy;
                this._applyVB(); this._wasDrag = true;
            }
        }
    }

    _touchEnd(e) {
        clearTimeout(this._longPress); this._longPress = null;
        if (this._touchInfo && !this._wasDrag && this._touchInfo.nodeId && !this._movingNodeId) {
            const dt = Date.now() - this._touchInfo.time;
            if (dt < 400) this.onLocationClick?.(this._touchInfo.nodeId);
        }
        this._pinch = null; this._pan = null; this._touchInfo = null;
    }

    // ========== Mouse Handling (롱프레스 이동) ==========
    _onDown(e) {
        const pt = this._svgPt(e);
        const hitId = this._hitTest(pt);
        this._wasDrag = false;
        if (this._movingNodeId) {
            // 이동 모드 — 클릭 위치로 노드 이동
            e.preventDefault();
            const loc = this.lm.locations.find(l => l.id === this._movingNodeId);
            if (loc) {
                loc.x = Math.round(pt.x); loc.y = Math.round(pt.y);
                this.lm.updateLocation(loc.id, { x: loc.x, y: loc.y });
                this.render();
            }
            this._movingNodeId = null;
            return;
        }
        if (hitId) {
            e.preventDefault(); // 브라우저 기본 드래그 방지
        }
        if (!hitId) {
            this._pan = { sx: e.clientX, sy: e.clientY, vx: this.vb.x, vy: this.vb.y };
        }
    }

    _onMove(e) {
        if (this._pan) {
            const dx = (e.clientX - this._pan.sx) * (this.vb.w / this.svg.getBoundingClientRect().width);
            const dy = (e.clientY - this._pan.sy) * (this.vb.h / this.svg.getBoundingClientRect().height);
            this.vb.x = this._pan.vx - dx; this.vb.y = this._pan.vy - dy;
            this._applyVB(); this._wasDrag = true;
        }
    }

    _onUp() {
        this._pan = null;
    }

    _zoom(factor, e) {
        const rect = this.svg.getBoundingClientRect();
        const mx = (e.clientX - rect.left) / rect.width, my = (e.clientY - rect.top) / rect.height;
        const nw = Math.max(200, Math.min(1200, this.vb.w * factor));
        const nh = nw * (500 / 600);
        this.vb.x += (this.vb.w - nw) * mx;
        this.vb.y += (this.vb.h - nh) * my;
        this.vb.w = nw; this.vb.h = nh;
        this._applyVB();
    }

    // ========== Helpers ==========
    _el(tag, attrs, text) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
        if (text !== undefined) el.textContent = text; return el;
    }

    _svgPt(e) {
        const r = this.svg.getBoundingClientRect();
        return { x: this.vb.x + (e.clientX - r.left) / r.width * this.vb.w, y: this.vb.y + (e.clientY - r.top) / r.height * this.vb.h };
    }

    _hitTest(pt) {
        for (const loc of this.lm.locations) {
            const dx = pt.x - loc.x, dy = pt.y - loc.y;
            if (Math.sqrt(dx * dx + dy * dy) < 30) return loc.id;
        }
        return null;
    }

    _pinchDist(e) {
        const a = e.touches[0], b = e.touches[1];
        return Math.sqrt((a.clientX - b.clientX) ** 2 + (a.clientY - b.clientY) ** 2);
    }
}
