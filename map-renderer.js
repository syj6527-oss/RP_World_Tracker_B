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
        if (!needsInit && !this._layoutDirty) return;
        this._layoutDirty = false;

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
        this._layoutDirty = false;
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
