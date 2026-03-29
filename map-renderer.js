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

        this.svg.innerHTML = '<defs><filter id="wt-glow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>';
        const { locations, movements, currentLocationId } = this.lm;

        // 거리 기반 약도 자동 배치
        if (locations.length >= 2) this._autoLayout();

        // 경로선 + 거리 표시
        const drawn = new Set();
        for (const m of movements) {
            const f = locations.find(l => l.id === m.fromId), t = locations.find(l => l.id === m.toId);
            if (!f || !t) continue;
            const k = [m.fromId, m.toId].sort().join('-'); if (drawn.has(k)) continue; drawn.add(k);
            this.svg.appendChild(this._el('line', { x1: f.x, y1: f.y, x2: t.x, y2: t.y, class: 'wt-path-line' }));

            // 거리 라벨 + 레벨 점
            const dist = this.lm.getDistanceBetween(m.fromId, m.toId);
            const mx = (f.x + t.x) / 2, my = (f.y + t.y) / 2;
            if (dist) {
                const lvl = dist.level || 5;
                const filled = Math.min(lvl, 10);
                const dots = '●'.repeat(Math.ceil(filled/2)) + '○'.repeat(Math.ceil((10-filled)/2));
                this.svg.appendChild(this._el('text', { x: mx, y: my - 8, 'text-anchor': 'middle', fill: '#9A8A7A', 'font-size': '9' }, dots));
                if (dist.distanceText) {
                    this.svg.appendChild(this._el('text', { x: mx, y: my + 6, 'text-anchor': 'middle', fill: '#A08060', 'font-size': '10' }, dist.distanceText));
                }
            }
        }

        // 노드 색상 결정 함수
        const nodeColor = (loc) => {
            if (loc.id === currentLocationId) return '#8B6EC7'; // Violet — 현재
            const v = loc.visitCount || 0;
            if (v >= 5) return '#5E84E2'; // Blue — 자주
            if (v >= 2) return '#F6A93A'; // Orange — 일반
            return '#F7EC8D'; // Yellow — 새 장소
        };

        // 노드 렌더링
        for (const loc of locations) {
            const cur = loc.id === currentLocationId;
            const r = cur ? 26 : 18;
            const color = nodeColor(loc);
            const g = this._el('g', { class: 'wt-location-node', 'data-id': loc.id, transform: `translate(${loc.x},${loc.y})` });

            // 그림자 (현재 위치만)
            if (cur) {
                g.appendChild(this._el('circle', { r: r + 4, fill: color, opacity: '0.2', filter: 'url(#wt-glow)' }));
            }

            // 메인 원
            g.appendChild(this._el('circle', {
                r, fill: color, class: 'wt-node-circle',
                stroke: cur ? '#775537' : '#9e8e7e',
                'stroke-width': cur ? 3 : 1.5,
            }));

            // 방문 횟수 (원 안에)
            if (loc.visitCount > 0) {
                g.appendChild(this._el('text', {
                    class: 'wt-visit-badge', y: 5,
                    fill: (color === '#F7EC8D') ? '#5A4030' : '#fff',
                    'font-size': cur ? '14' : '12',
                }, loc.visitCount));
            }

            // 장소명
            g.appendChild(this._el('text', { class: 'wt-location-label', y: r + 16 }, loc.name));

            // 🐾 현재 위치 마커
            if (cur) g.appendChild(this._el('text', { class: 'wt-paw-marker', y: -(r + 10) }, '🐾'));

            this.svg.appendChild(g);
        }

        if (!locations.length) this.svg.appendChild(this._el('text', { x: 300, y: 250, class: 'wt-empty-text' }, 'RP를 시작해보세요! 🐶'));

        // ViewBox 자동 맞춤
        if (locations.length) {
            const pad = 80;
            const xs = locations.map(l => l.x), ys = locations.map(l => l.y);
            const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
            const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
            this.vb = { x: minX, y: minY, w: Math.max(300, maxX - minX), h: Math.max(250, maxY - minY) };
        } else {
            this.vb = { x: 0, y: 0, w: 600, h: 500 };
        }
        this._applyVB();
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

        // ViewBox 계산
        if (locations.length) {
            const pad = 100;
            const xs = locations.map(l => l.x), ys = locations.map(l => l.y);
            const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
            const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
            this.vb = { x: minX, y: minY, w: Math.max(350, maxX - minX), h: Math.max(280, maxY - minY) };
        } else {
            this.vb = { x: 0, y: 0, w: 600, h: 500 };
        }
        this._applyVB();

        const vb = this.vb;
        let svg = `<defs>
            <filter id="wt-glow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            <filter id="wt-parchment-noise"><feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="4" result="n"/><feColorMatrix type="saturate" values="0" in="n" result="ng"/><feBlend in="SourceGraphic" in2="ng" mode="multiply" result="b"/><feComposite in="b" in2="SourceGraphic" operator="in"/></filter>
        </defs>`;

        // 양피지 배경
        svg += `<rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="#E8D5A3" filter="url(#wt-parchment-noise)"/>`;
        // 얼룩/낡은 느낌
        const cx1 = vb.x + vb.w * 0.2, cy1 = vb.y + vb.h * 0.3;
        const cx2 = vb.x + vb.w * 0.7, cy2 = vb.y + vb.h * 0.7;
        const cx3 = vb.x + vb.w * 0.5, cy3 = vb.y + vb.h * 0.15;
        svg += `<circle cx="${cx1}" cy="${cy1}" r="${vb.w*0.12}" fill="rgba(196,168,124,0.15)"/>`;
        svg += `<circle cx="${cx2}" cy="${cy2}" r="${vb.w*0.15}" fill="rgba(180,150,100,0.12)"/>`;
        svg += `<circle cx="${cx3}" cy="${cy3}" r="${vb.w*0.08}" fill="rgba(160,130,92,0.1)"/>`;

        // 테두리
        const bx = vb.x + 6, by = vb.y + 6, bw = vb.w - 12, bh = vb.h - 12;
        svg += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="none" stroke="#8B6914" stroke-width="1.5" stroke-dasharray="4 2" opacity="0.3" rx="2"/>`;

        // 모서리 장식
        svg += this._cornerOrnament(bx, by, 1, 1);
        svg += this._cornerOrnament(bx + bw, by, -1, 1);
        svg += this._cornerOrnament(bx, by + bh, 1, -1);
        svg += this._cornerOrnament(bx + bw, by + bh, -1, -1);

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

        // 나침반 장미
        const compassX = vb.x + vb.w - 40, compassY = vb.y + vb.h - 40;
        svg += this._compassRose(compassX, compassY);

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
    _fantasyIcon(x, y, type, isCurrent, visits, locId) {
        const s = isCurrent ? 1.2 : 1; // 현재 위치는 좀 더 크게
        const stroke = '#5D4037';
        const fill1 = '#C4A87C'; // 밝은 갈색
        const fill2 = '#8B6914'; // 어두운 갈색
        let svg = `<g transform="translate(${x},${y}) scale(${s})" class="wt-location-node" data-id="${locId}">`;

        switch (type) {
            case 'castle':
                // 성 — 탑 3개 + 벽
                svg += `<rect x="-10" y="-4" width="20" height="14" fill="${fill1}" stroke="${stroke}" stroke-width="1.2"/>`;
                svg += `<rect x="-12" y="-12" width="6" height="10" fill="${fill1}" stroke="${stroke}" stroke-width="1"/>`;
                svg += `<rect x="6" y="-12" width="6" height="10" fill="${fill1}" stroke="${stroke}" stroke-width="1"/>`;
                svg += `<rect x="-3" y="-16" width="6" height="14" fill="${fill1}" stroke="${stroke}" stroke-width="1"/>`;
                // 성벽 톱니
                svg += `<rect x="-13" y="-14" width="2" height="3" fill="${stroke}"/><rect x="-9" y="-14" width="2" height="3" fill="${stroke}"/>`;
                svg += `<rect x="7" y="-14" width="2" height="3" fill="${stroke}"/><rect x="11" y="-14" width="2" height="3" fill="${stroke}"/>`;
                svg += `<rect x="-2" y="-18" width="2" height="3" fill="${stroke}"/><rect x="2" y="-18" width="2" height="3" fill="${stroke}"/>`;
                // 문
                svg += `<rect x="-3" y="3" width="6" height="7" rx="3" fill="${stroke}" opacity="0.5"/>`;
                break;

            case 'mountain':
                // 산 — 봉우리 2개 + 눈
                svg += `<polygon points="0,-18 -18,8 18,8" fill="#8B7355" stroke="${stroke}" stroke-width="1.2"/>`;
                svg += `<polygon points="10,-10 -4,8 24,8" fill="#9B8365" stroke="${stroke}" stroke-width="1"/>`;
                svg += `<polygon points="0,-18 -5,-8 5,-8" fill="#E8D5A3" opacity="0.7"/>`;
                svg += `<polygon points="10,-10 7,-4 13,-4" fill="#E8D5A3" opacity="0.5"/>`;
                break;

            case 'forest':
                // 숲 — 나무 3그루
                svg += `<polygon points="-8,-10 -14,4 -2,4" fill="#4A6741" stroke="#3D5A35" stroke-width="1"/>`;
                svg += `<polygon points="0,-16 -8,2 8,2" fill="#3D5A35" stroke="#2E4A28" stroke-width="1"/>`;
                svg += `<polygon points="8,-8 2,6 14,6" fill="#5B7A4A" stroke="#4A6741" stroke-width="1"/>`;
                svg += `<rect x="-1" y="2" width="2" height="5" fill="#5D4037"/>`;
                break;

            case 'temple':
                // 신전 — 뾰족 지붕 + 기둥
                svg += `<polygon points="0,-18 -12,-4 12,-4" fill="${fill2}" stroke="${stroke}" stroke-width="1"/>`;
                svg += `<rect x="-10" y="-4" width="20" height="12" fill="${fill1}" stroke="${stroke}" stroke-width="1"/>`;
                svg += `<line x1="0" y1="-22" x2="0" y2="-18" stroke="${fill2}" stroke-width="1.5"/>`;
                svg += `<circle cx="0" cy="-23" r="2" fill="${fill2}"/>`;
                // 기둥
                svg += `<rect x="-8" y="-4" width="2" height="12" fill="${stroke}" opacity="0.4"/>`;
                svg += `<rect x="6" y="-4" width="2" height="12" fill="${stroke}" opacity="0.4"/>`;
                break;

            case 'village':
                // 마을 — 오두막 2~3개
                svg += `<rect x="-12" y="-2" width="10" height="8" fill="${fill1}" stroke="${stroke}" stroke-width="1"/>`;
                svg += `<polygon points="-12,-2 -7,-8 -2,-2" fill="#A0825C" stroke="${stroke}" stroke-width="0.8"/>`;
                svg += `<rect x="2" y="0" width="8" height="6" fill="${fill1}" stroke="${stroke}" stroke-width="1"/>`;
                svg += `<polygon points="2,0 6,-6 10,0" fill="#A0825C" stroke="${stroke}" stroke-width="0.8"/>`;
                svg += `<rect x="-4" y="-6" width="6" height="10" fill="${fill1}" stroke="${stroke}" stroke-width="1"/>`;
                svg += `<polygon points="-4,-6 -1,-11 2,-6" fill="#A0825C" stroke="${stroke}" stroke-width="0.8"/>`;
                break;

            case 'house':
                // 집 — 심플 하우스
                svg += `<rect x="-8" y="-2" width="16" height="12" fill="${fill1}" stroke="${stroke}" stroke-width="1.2"/>`;
                svg += `<polygon points="0,-10 -10,-2 10,-2" fill="#A0825C" stroke="${stroke}" stroke-width="1"/>`;
                svg += `<rect x="-2" y="3" width="4" height="7" fill="${stroke}" opacity="0.4"/>`;
                svg += `<rect x="4" y="0" width="3" height="3" fill="#6B8BA4" opacity="0.4"/>`;
                break;

            case 'shop':
                // 상점 — 차양 달린 건물
                svg += `<rect x="-8" y="-2" width="16" height="12" fill="${fill1}" stroke="${stroke}" stroke-width="1"/>`;
                svg += `<polygon points="-10,-2 10,-2 8,-8 -8,-8" fill="#B8860B" stroke="${stroke}" stroke-width="0.8"/>`;
                svg += `<path d="M-10,-2 Q-7,-5 -4,-2 Q-1,-5 2,-2 Q5,-5 8,-2" fill="none" stroke="${stroke}" stroke-width="0.8"/>`;
                svg += `<rect x="-2" y="3" width="4" height="7" fill="${stroke}" opacity="0.3"/>`;
                break;

            case 'tavern':
                // 술집 — 건물 + 매달린 간판
                svg += `<rect x="-8" y="-2" width="16" height="12" fill="${fill1}" stroke="${stroke}" stroke-width="1.2"/>`;
                svg += `<polygon points="0,-8 -10,-2 10,-2" fill="#A0825C" stroke="${stroke}" stroke-width="1"/>`;
                // 간판
                svg += `<line x1="10" y1="-4" x2="16" y2="-4" stroke="${stroke}" stroke-width="1"/>`;
                svg += `<rect x="12" y="-2" width="7" height="5" rx="1" fill="#DAA520" stroke="${stroke}" stroke-width="0.8"/>`;
                svg += `<text x="15.5" y="2" text-anchor="middle" font-size="4" fill="${stroke}">🍺</text>`;
                break;

            case 'cave':
                // 동굴 — 어두운 입구
                svg += `<ellipse cx="0" cy="2" rx="14" ry="10" fill="#8B7355" stroke="${stroke}" stroke-width="1"/>`;
                svg += `<ellipse cx="0" cy="4" rx="8" ry="7" fill="#3E2723" opacity="0.7"/>`;
                svg += `<ellipse cx="0" cy="5" rx="4" ry="4" fill="#1a1410" opacity="0.6"/>`;
                // 암석
                svg += `<polygon points="-14,-4 -10,-10 -6,-2" fill="#8B7355" stroke="${stroke}" stroke-width="0.8"/>`;
                svg += `<polygon points="10,-3 14,-8 16,0" fill="#8B7355" stroke="${stroke}" stroke-width="0.8"/>`;
                break;

            case 'port':
                // 항구 — 파도 + 닻
                svg += `<path d="M-14,4 Q-7,-2 0,4 Q7,-2 14,4" fill="none" stroke="#6B8BA4" stroke-width="1.5"/>`;
                svg += `<path d="M-12,8 Q-5,2 2,8 Q9,2 16,8" fill="none" stroke="#6B8BA4" stroke-width="1" opacity="0.5"/>`;
                // 닻
                svg += `<line x1="0" y1="-14" x2="0" y2="2" stroke="${stroke}" stroke-width="1.5"/>`;
                svg += `<line x1="-5" y1="-12" x2="5" y2="-12" stroke="${stroke}" stroke-width="1.5"/>`;
                svg += `<path d="M-6,0 Q0,6 6,0" fill="none" stroke="${stroke}" stroke-width="1.5"/>`;
                svg += `<circle cx="0" cy="-14" r="2" fill="none" stroke="${stroke}" stroke-width="1.2"/>`;
                break;

            case 'water':
                // 강/호수 — 파도 패턴
                svg += `<ellipse cx="0" cy="0" rx="16" ry="10" fill="#6B8BA4" opacity="0.3" stroke="#5A7A93" stroke-width="1"/>`;
                svg += `<path d="M-10,-2 Q-5,-6 0,-2 Q5,-6 10,-2" fill="none" stroke="#5A7A93" stroke-width="1"/>`;
                svg += `<path d="M-8,3 Q-3,-1 2,3 Q7,-1 12,3" fill="none" stroke="#5A7A93" stroke-width="0.8" opacity="0.6"/>`;
                break;

            case 'library':
                // 도서관 — 책 + 건물
                svg += `<rect x="-9" y="-4" width="18" height="14" fill="${fill1}" stroke="${stroke}" stroke-width="1"/>`;
                svg += `<polygon points="0,-10 -11,-4 11,-4" fill="#A0825C" stroke="${stroke}" stroke-width="1"/>`;
                svg += `<rect x="-4" y="-1" width="3" height="8" fill="#8B4513" opacity="0.5"/>`;
                svg += `<rect x="-1" y="0" width="3" height="7" fill="#B8860B" opacity="0.5"/>`;
                svg += `<rect x="2" y="-1" width="3" height="8" fill="#CD853F" opacity="0.5"/>`;
                break;

            case 'arena':
                // 투기장 — 교차 검
                svg += `<circle cx="0" cy="0" rx="12" ry="12" fill="${fill1}" stroke="${stroke}" stroke-width="1" opacity="0.5"/>`;
                svg += `<line x1="-10" y1="10" x2="10" y2="-10" stroke="${stroke}" stroke-width="2"/>`;
                svg += `<line x1="10" y1="10" x2="-10" y2="-10" stroke="${stroke}" stroke-width="2"/>`;
                svg += `<polygon points="-12,12 -10,10 -8,12" fill="${stroke}"/>`;
                svg += `<polygon points="12,12 10,10 8,12" fill="${stroke}"/>`;
                svg += `<polygon points="-12,-12 -10,-10 -8,-12" fill="${stroke}"/>`;
                svg += `<polygon points="12,-12 10,-10 8,-12" fill="${stroke}"/>`;
                break;

            default: // flag — 나무 이정표(팻말)
                svg += `<line x1="0" y1="-8" x2="0" y2="10" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round"/>`;
                svg += `<rect x="-14" y="-14" width="28" height="12" rx="2" fill="${fill1}" stroke="${stroke}" stroke-width="1.2"/>`;
                svg += `<line x1="-10" y1="-8" x2="10" y2="-8" stroke="${stroke}" stroke-width="0.6" opacity="0.3"/>`;
                svg += `<circle cx="-10" cy="-10" r="1" fill="${stroke}" opacity="0.3"/>`;
                svg += `<circle cx="10" cy="-10" r="1" fill="${stroke}" opacity="0.3"/>`;
                break;
        }

        // 방문 횟수 뱃지
        if (visits > 0) {
            svg += `<circle cx="12" cy="-10" r="7" fill="#DAA520" stroke="${stroke}" stroke-width="0.8"/>`;
            svg += `<text x="12" y="-7" text-anchor="middle" fill="#3E2723" font-size="8" font-weight="700">${visits}</text>`;
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
            const loc = this.lm.locations.find(l => l.id === this._movingNodeId);
            if (loc) {
                loc.x = Math.round(pt.x); loc.y = Math.round(pt.y);
                this.lm.updateLocation(loc.id, { x: loc.x, y: loc.y });
                this.render();
            }
            this._movingNodeId = null;
            return;
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
            if (Math.sqrt(dx * dx + dy * dy) < 55) return loc.id;
        }
        return null;
    }

    _pinchDist(e) {
        const a = e.touches[0], b = e.touches[1];
        return Math.sqrt((a.clientX - b.clientX) ** 2 + (a.clientY - b.clientY) ** 2);
    }
}
