// 🐶 World Tracker — map-renderer.js (v0.3.0-beta hotfix3)
// Voronoi-style blocks + Geo-aware layout + Regen fix

export class MapRenderer {
    constructor(container, lm) {
        this.container = container; this.lm = lm;
        this.svg = null; this._wasDrag = false; this._movingNodeId = null;
        this.onLocationClick = null; this.onMoveRequest = null;
        this.vb = { x: 0, y: 0, w: 600, h: 500 };
        this._pinch = null; this._pan = null;
        this._init();
    }

    // ========== Seeded PRNG (Mulberry32) ==========
    _srand(s) {
        return () => { s|=0; s=s+0x6D2B79F5|0; let t=Math.imul(s^s>>>15,1|s); t=t+Math.imul(t^t>>>7,61|t)^t; return((t^t>>>14)>>>0)/4294967296; };
    }

    _init() {
        if (!this.container) return;
        this.container.querySelectorAll('svg.wt-map-svg').forEach(el => el.remove());
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.setAttribute('class', 'wt-map-svg');
        this.svg.setAttribute('width', '100%');
        const h = this.container.offsetHeight || this.container.clientHeight || 320;
        this.svg.setAttribute('height', Math.max(h, 320) + 'px');
        this.svg.style.minHeight = '320px';
        this._applyVB();
        this.container.appendChild(this.svg);
        this.svg.addEventListener('mousedown', e => this._onDown(e));
        this.svg.addEventListener('mousemove', e => this._onMove(e));
        this.svg.addEventListener('mouseup', () => this._onUp());
        this.svg.addEventListener('mouseleave', () => this._onUp());
        this.svg.addEventListener('wheel', e => { e.preventDefault(); this._zoom(e.deltaY > 0 ? 1.1 : 0.9, e); }, { passive: false });
        this.svg.addEventListener('touchstart', e => this._touchStart(e), { passive: false });
        this.svg.addEventListener('touchmove', e => this._touchMove(e), { passive: false });
        this.svg.addEventListener('touchend', e => this._touchEnd(e));
    }

    _applyVB() { this.svg.setAttribute('viewBox', `${this.vb.x} ${this.vb.y} ${this.vb.w} ${this.vb.h}`); }

    // ================================================================
    //  RENDER (일반 약도)
    // ================================================================
    render() {
        if (!this.svg) return;
        document.getElementById('wt-map-debug')?.remove();
        if (this.container) {
            const h = this.container.offsetHeight || this.container.clientHeight || 320;
            this.svg.setAttribute('height', Math.max(h, 320) + 'px');
        }
        if (this.fantasyMode) { this._renderFantasy(); return; }

        this.svg.innerHTML = `<defs>
            <filter id="wt-sh"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.2"/></filter>
            <filter id="wt-sh-s"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.1"/></filter>
            <filter id="wt-sh-p"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.28"/></filter>
        </defs>`;

        const { locations, movements, currentLocationId } = this.lm;
        if (locations.length >= 2) this._autoLayout();

        // ========== ViewBox ==========
        const cW = this.container?.offsetWidth || 360;
        const cH = this.container?.offsetHeight || 480;
        const aspect = cW / cH;
        const vbW = 500, vbH = Math.round(vbW / aspect);
        let cx, cy;
        if (!this._vbManual) {
            const curLoc = locations.find(l => l.id === currentLocationId) || locations[0];
            cx = curLoc ? curLoc.x : 300; cy = curLoc ? curLoc.y : Math.round(vbH / 2);
            this.vb = { x: cx - vbW / 2, y: cy - vbH / 2, w: vbW, h: vbH };
        } else {
            cx = this.vb.x + this.vb.w / 2; cy = this.vb.y + this.vb.h / 2;
            this.vb.w = vbW; this.vb.h = vbH; this._vbManual = false;
        }
        this._applyVB();
        const vb = this.vb, ex = 50;
        const seed = (locations.length * 7 + 13) % 97 + 1;

        // ========== 배경: 도시 블록 (Voronoi-style) ==========
        this._drawCityBackground(vb, ex, seed, cx, cy);

        // ========== 거리 점선 + pill ==========
        this._drawDistanceLines(locations, movements);

        // ========== 핀 마커 ==========
        this._drawPins(locations, currentLocationId);

        // ========== 나침반 ==========
        this._drawCompass(vb);

        if (!locations.length) {
            this.svg.appendChild(this._el('text', { x: cx, y: cy, class: 'wt-empty-text' }, 'RP를 시작해보세요! 🐶'));
        }
    }

    // ================================================================
    //  도시 배경 (GPT 디자인 조언 반영: 블록=배경, 핀=주인공)
    // ================================================================
    _drawCityBackground(vb, ex, seed, cx, cy) {
        const rng = this._srand(seed * 31337);
        const W = vb.w + ex * 2, H = vb.h + ex * 2;
        const ox = vb.x - ex, oy = vb.y - ex;

        // ① 베이스 (도로 색 — 아주 연한 회백색)
        this.svg.appendChild(this._el('rect', { x: ox, y: oy, width: W, height: H, fill: '#F0EDE6' }));

        // ② 격자 생성 (불규칙 간격)
        const cols = 6, rows = 8;
        const cw = [], rh = [];
        let tw = 0, th = 0;
        for (let i = 0; i < cols; i++) { cw[i] = 0.6 + rng() * 0.8; tw += cw[i]; }
        for (let i = 0; i < rows; i++) { rh[i] = 0.6 + rng() * 0.8; th += rh[i]; }
        cw.forEach((_, i) => cw[i] = cw[i] / tw * W);
        rh.forEach((_, i) => rh[i] = rh[i] / th * H);

        // 격자 교차점
        const pts = [];
        let py = oy;
        for (let r = 0; r <= rows; r++) {
            pts[r] = []; let px = ox;
            for (let c = 0; c <= cols; c++) {
                const j = 6;
                const jx = (r > 0 && r < rows && c > 0 && c < cols) ? (rng() - 0.5) * j : 0;
                const jy = (r > 0 && r < rows && c > 0 && c < cols) ? (rng() - 0.5) * j : 0;
                pts[r][c] = { x: px + jx, y: py + jy };
                if (c < cols) px += cw[c];
            }
            if (r < rows) py += rh[r];
        }

        // 구역 타입 결정 (seed 기반)
        const parkCells = new Set();
        const parkCount = 2 + (seed % 2);
        for (let i = 0; i < parkCount; i++) {
            parkCells.add(`${1 + Math.floor(rng() * (rows - 2))}_${Math.floor(rng() * cols)}`);
        }

        // ③ 블록 (rect + 라운딩 — 채도 낮게, 구역별 색상)
        const gap = 0.07; // 도로 갭 비율
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const tl = pts[r][c], tr = pts[r][c + 1], bl = pts[r + 1][c], br = pts[r + 1][c + 1];
                const bx = Math.min(tl.x, bl.x), by = Math.min(tl.y, tr.y);
                const bw = Math.max(tr.x, br.x) - bx, bh = Math.max(bl.y, br.y) - by;
                const gx = bw * gap, gy = bh * gap;

                const isPark = parkCells.has(`${r}_${c}`);
                // 구역 색상: 공원=연초록, 나머지=연회색 (미세 톤 변동)
                let fill;
                if (isPark) {
                    fill = '#D4E8C2';
                } else {
                    const tone = rng();
                    fill = tone < 0.6 ? '#E6E2DA' : tone < 0.85 ? '#E2DED5' : '#EAE6DE';
                }

                this.svg.appendChild(this._el('rect', {
                    x: bx + gx, y: by + gy,
                    width: Math.max(4, bw - gx * 2), height: Math.max(4, bh - gy * 2),
                    rx: 5, fill,
                }));

                // 건물 디테일 (공원 아닌 블록 70% — 채도 낮게, 적게)
                if (!isPark && rng() < 0.7) {
                    this._drawBuildingDetails(bx + gx, by + gy, bw - gx * 2, bh - gy * 2, rng);
                }

                // 공원 연못
                if (isPark && rng() < 0.45) {
                    const lx = (bx + bw / 2) + (rng() - 0.5) * 10;
                    const ly = (by + bh / 2) + (rng() - 0.5) * 8;
                    const lr = Math.min(bw, bh) * 0.12;
                    this.svg.appendChild(this._el('ellipse', { cx: lx, cy: ly, rx: lr * 1.3, ry: lr * 0.9, fill: '#B8D9EE', opacity: 0.4 }));
                }
            }
        }

        // ④ 메인 도로 (연한 노란색, 얇게 — 배경 도구)
        const mW = 8;
        const roadColor = '#F0E4A8';
        const mainR = 2 + (seed % 3);
        if (mainR < rows) {
            const ml = pts[mainR][0], mr = pts[mainR][cols];
            this.svg.appendChild(this._el('line', { x1: ml.x - 20, y1: ml.y, x2: mr.x + 20, y2: mr.y, stroke: roadColor, 'stroke-width': mW, 'stroke-linecap': 'round' }));
        }
        const mainC = 2 + (seed % 2);
        if (mainC < cols) {
            const mt = pts[0][mainC], mb = pts[rows][mainC];
            this.svg.appendChild(this._el('line', { x1: mt.x, y1: mt.y - 20, x2: mb.x, y2: mb.y + 20, stroke: roadColor, 'stroke-width': mW, 'stroke-linecap': 'round' }));
        }

        // ⑤ 강 (seed 기반 — 연한 파랑)
        if (seed % 4 !== 0) {
            const ry = oy + H * (0.25 + (seed % 20) / 100);
            const rMid = cx + (rng() - 0.5) * 80;
            const rCurve = 25 + rng() * 25;
            this.svg.appendChild(this._el('path', {
                d: `M${ox - 20},${ry} Q${rMid},${ry + rCurve} ${ox + W + 20},${ry - rCurve / 3}`,
                fill: 'none', stroke: '#C4DFF0', 'stroke-width': 14, 'stroke-linecap': 'round',
            }));
        }
    }

    // ========== 건물 디테일 (적게, 연하게 — 배경 역할만) ==========
    _drawBuildingDetails(bx, by, bw, bh, rng) {
        if (bw < 22 || bh < 22) return;
        const area = bw * bh;
        const maxCount = area > 2500 ? 3 : area > 1200 ? 2 : 1;
        const margin = 0.15;
        const placed = [];

        for (let att = 0; att < maxCount * 3; att++) {
            if (placed.length >= maxCount) break;
            const sr = rng();
            let w, h;
            if (sr < 0.3) { w = bw * (0.3 + rng() * 0.15); h = bh * (0.2 + rng() * 0.12); }
            else if (sr < 0.65) { w = bw * (0.12 + rng() * 0.12); h = bh * (0.25 + rng() * 0.2); }
            else { w = bw * (0.15 + rng() * 0.1); h = bh * (0.12 + rng() * 0.1); }

            const xMin = bx + bw * margin, yMin = by + bh * margin;
            const xR = bw * (1 - margin * 2) - w, yR = bh * (1 - margin * 2) - h;
            if (xR < 0 || yR < 0) continue;
            const x = xMin + rng() * xR, y = yMin + rng() * yR;
            if (placed.some(p => x < p.x + p.w + 3 && x + w + 3 > p.x && y < p.y + p.h + 3 && y + h + 3 > p.y)) continue;
            placed.push({ x, y, w, h });

            this.svg.appendChild(this._el('rect', {
                x, y, width: w, height: h,
                rx: (h > w * 1.4 || w > h * 1.4) ? 3 : 2,
                fill: '#D8D3CB', opacity: (0.35 + rng() * 0.1).toFixed(2),
            }));
        }
    }

    // ================================================================
    //  거리 점선 + pill 뱃지
    // ================================================================
    _drawDistanceLines(locations, movements) {
        const drawnDist = new Set();
        for (const d of (this.lm.distances || [])) {
            const f = locations.find(l => l.id === d.fromId), t = locations.find(l => l.id === d.toId);
            if (!f || !t) continue;
            const k = [d.fromId, d.toId].sort().join('-');
            if (drawnDist.has(k)) continue; drawnDist.add(k);
            const lvl = d.level || 5;
            const lw = lvl <= 3 ? 2.5 : lvl <= 6 ? 2 : 1.5;
            const lo = lvl <= 3 ? 0.5 : lvl <= 6 ? 0.4 : 0.25;
            this.svg.appendChild(this._el('line', { x1: f.x, y1: f.y, x2: t.x, y2: t.y, stroke: '#A8A090', 'stroke-width': lw, 'stroke-dasharray': '7 4', 'stroke-linecap': 'round', opacity: lo }));
            if (d.distanceText) {
                const mx = (f.x + t.x) / 2, my = (f.y + t.y) / 2;
                const tl = d.distanceText.length * 5.5 + 16;
                const pill = this._el('g', { transform: `translate(${mx},${my - 10})` });
                pill.appendChild(this._el('rect', { x: -tl / 2, y: -9, width: tl, height: 18, rx: 9, fill: '#fff', stroke: '#E8E4D8', 'stroke-width': 1, filter: 'url(#wt-sh-s)' }));
                pill.appendChild(this._el('text', { x: 0, y: 4, 'text-anchor': 'middle', fill: '#5E84E2', 'font-size': '8.5', 'font-weight': '600' }, d.distanceText));
                this.svg.appendChild(pill);
            }
        }
        for (const m of movements) {
            const f = locations.find(l => l.id === m.fromId), t = locations.find(l => l.id === m.toId);
            if (!f || !t) continue;
            const k = [m.fromId, m.toId].sort().join('-');
            if (drawnDist.has(k)) continue; drawnDist.add(k);
            this.svg.appendChild(this._el('line', { x1: f.x, y1: f.y, x2: t.x, y2: t.y, stroke: '#B0A898', 'stroke-width': 2, 'stroke-dasharray': '7 4', 'stroke-linecap': 'round', opacity: 0.3 }));
        }
    }

    // ================================================================
    //  핀 마커 (목업 v5 스타일)
    // ================================================================
    _drawPins(locations, currentLocationId) {
        for (const loc of locations) {
            const cur = loc.id === currentLocationId;
            const ps = this._pinStyle(loc.name);

            // ========== 15분 반경 페이드 ==========
            let fadeOpacity = 1;
            if (!cur) {
                const dist = (this.lm.distances || []).find(d =>
                    (d.fromId === currentLocationId && d.toId === loc.id) ||
                    (d.toId === currentLocationId && d.fromId === loc.id)
                );
                const level = dist?.level || 5;
                if (level >= 8) fadeOpacity = 0.3;       // 차량 필요+ → 많이 흐림
                else if (level >= 7) fadeOpacity = 0.5;   // 대중교통 → 중간 흐림
                else if (level >= 6) fadeOpacity = 0.7;   // 도보 15분+ → 살짝 흐림
            }

            const g = this._el('g', { class: 'wt-location-node', 'data-id': loc.id, transform: `translate(${loc.x},${loc.y})`, opacity: fadeOpacity });

            if (cur) {
                const pulse = this._el('circle', { r: 18, fill: 'none', stroke: ps.color, 'stroke-width': 2, opacity: '0.4' });
                const aR = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
                aR.setAttribute('attributeName', 'r'); aR.setAttribute('from', '14'); aR.setAttribute('to', '30');
                aR.setAttribute('dur', '2s'); aR.setAttribute('repeatCount', 'indefinite'); pulse.appendChild(aR);
                const aO = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
                aO.setAttribute('attributeName', 'opacity'); aO.setAttribute('from', '0.5'); aO.setAttribute('to', '0');
                aO.setAttribute('dur', '2s'); aO.setAttribute('repeatCount', 'indefinite'); pulse.appendChild(aO);
                g.appendChild(pulse);
            }

            const sz = cur ? 19 : 13, ph = cur ? 26 : 18;
            const pin = this._el('g', { transform: `translate(0,${-ph})`, filter: 'url(#wt-sh-p)' });
            pin.appendChild(this._el('path', {
                d: `M0,${ph}C0,${ph},${-sz},${ph * 0.35},${-sz},${-sz * 0.15}A${sz},${sz},0,1,1,${sz},${-sz * 0.15}C${sz},${ph * 0.35},0,${ph},0,${ph}Z`,
                fill: ps.color, stroke: cur ? '#fff' : ps.border, 'stroke-width': cur ? 1.2 : 0.8,
            }));
            pin.appendChild(this._el('text', { x: 0, y: -sz * 0.1 + 5, 'text-anchor': 'middle', 'font-size': cur ? '13' : '11', style: 'pointer-events:none' }, ps.emoji));
            g.appendChild(pin);

            if (loc.visitCount > 0) {
                const bx = sz * 0.55, by = -(ph + sz * 0.35);
                const bdg = this._el('g', { transform: `translate(${bx},${by})` });
                bdg.appendChild(this._el('circle', { r: 8, fill: '#fff', stroke: ps.color, 'stroke-width': 1.5 }));
                bdg.appendChild(this._el('text', { 'text-anchor': 'middle', y: 3.5, 'font-size': '8.5', 'font-weight': '700', fill: ps.color }, loc.visitCount));
                g.appendChild(bdg);
            }

            const nl = loc.name.length * 7 + 16;
            const lg = this._el('g', { transform: 'translate(0,6)' });
            lg.appendChild(this._el('rect', { x: -nl / 2, y: -9, width: nl, height: 18, rx: 9, fill: '#fff', stroke: '#E8E4D8', 'stroke-width': 0.8, filter: 'url(#wt-sh-s)' }));
            lg.appendChild(this._el('text', { class: 'wt-location-label', y: 3.5, 'font-size': '10', 'font-weight': '600' }, loc.name));
            g.appendChild(lg);

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
    }

    // ========== 나침반 ==========
    _drawCompass(vb) {
        const ccx = vb.x + 28, ccy = vb.y + vb.h - 28, s = 18;
        const cg = this._el('g', { transform: `translate(${ccx},${ccy})`, opacity: '0.7' });
        cg.appendChild(this._el('circle', { r: s, fill: 'rgba(242,238,228,0.85)', stroke: '#B0A090', 'stroke-width': 1 }));
        cg.appendChild(this._el('circle', { r: 2, fill: '#B0A090' }));
        cg.appendChild(this._el('polygon', { points: `0,${-s + 4} -3.5,${-s * 0.35} 3.5,${-s * 0.35}`, fill: '#E07060', opacity: 0.8 }));
        cg.appendChild(this._el('polygon', { points: `0,${s - 4} -3.5,${s * 0.35} 3.5,${s * 0.35}`, fill: '#8EB0C8', opacity: 0.6 }));
        cg.appendChild(this._el('text', { y: -s - 2, 'text-anchor': 'middle', fill: '#E07060', 'font-size': '6', 'font-weight': '600' }, 'N'));
        this.svg.appendChild(cg);
    }

    // ================================================================
    //  AUTO LAYOUT — Geo-aware + 거리 기반 fallback
    // ================================================================
    _autoLayout() {
        const locs = this.lm.locations;
        const dists = this.lm.distances || [];
        if (locs.length < 2) return;

        // 핀 수동 이동 시 레이아웃 스킵
        if (this._skipLayout) { this._skipLayout = false; return; }

        const needsInit = locs.some(l => l.x === 0 && l.y === 0);
        // 🐛 FIX: _layoutDone 초기값 undefined → 첫 렌더링 보장
        if (!needsInit && !this._layoutDirty && this._layoutDone === true) return;
        this._layoutDirty = false;
        this._layoutDone = true;

        const cW = this.container?.offsetWidth || 360;
        const cH = this.container?.offsetHeight || 480;
        const centerX = 300, centerY = Math.round((500 / (cW / cH)) / 2);
        const curId = this.lm.currentLocationId;
        const curLoc = locs.find(l => l.id === curId) || locs[0];

        // ========== Geo-aware 배치 (lat/lng 있는 장소 2개+) ==========
        const geoLocs = locs.filter(l => l.lat != null && l.lng != null);
        if (geoLocs.length >= 2) {
            this._geoAwareLayout(locs, geoLocs, curLoc, centerX, centerY);
        } else {
            this._circularLayout(locs, dists, curLoc, centerX, centerY);
        }

        // 겹침 방지 (3회)
        for (let iter = 0; iter < 3; iter++) {
            for (let i = 0; i < locs.length; i++) {
                for (let j = i + 1; j < locs.length; j++) {
                    const dx = locs[j].x - locs[i].x, dy = locs[j].y - locs[i].y;
                    const d = Math.sqrt(dx * dx + dy * dy);
                    if (d < 70) {
                        const push = (70 - d) / 2;
                        const nx = dx / (d || 1), ny = dy / (d || 1);
                        if (locs[i].id !== curLoc.id) { locs[i].x -= Math.round(push * nx); locs[i].y -= Math.round(push * ny); }
                        if (locs[j].id !== curLoc.id) { locs[j].x += Math.round(push * nx); locs[j].y += Math.round(push * ny); }
                    }
                }
            }
        }

        for (const loc of locs) this.lm.updateLocation(loc.id, { x: loc.x, y: loc.y });
    }

    // ========== Geo-aware 배치 (lat/lng → 상대 좌표) ==========
    _geoAwareLayout(locs, geoLocs, curLoc, centerX, centerY) {
        // 기준점: 현재 위치 (좌표 있으면 사용, 없으면 geo 평균)
        let baseLat, baseLng;
        if (curLoc.lat != null && curLoc.lng != null) {
            baseLat = curLoc.lat; baseLng = curLoc.lng;
        } else {
            baseLat = geoLocs.reduce((s, l) => s + l.lat, 0) / geoLocs.length;
            baseLng = geoLocs.reduce((s, l) => s + l.lng, 0) / geoLocs.length;
        }

        // lat/lng → 미터 오프셋
        const toMeters = (lat, lng) => ({
            mx: (lng - baseLng) * 111320 * Math.cos(baseLat * Math.PI / 180),
            my: -(lat - baseLat) * 111320, // 북쪽 = -y (화면 위)
        });

        // 최대 범위 계산 (스케일링용)
        let maxR = 1;
        for (const l of geoLocs) {
            const { mx, my } = toMeters(l.lat, l.lng);
            maxR = Math.max(maxR, Math.abs(mx), Math.abs(my));
        }

        // 미터 → px 스케일 (ViewBox의 40% 범위에 맞춤)
        const scale = 180 / maxR;

        // 좌표 있는 장소 배치
        curLoc.x = centerX; curLoc.y = centerY;
        for (const loc of locs) {
            if (loc.id === curLoc.id) continue;
            if (loc._manualXY) continue; // 수동 배치 보존
            if (loc.lat != null && loc.lng != null) {
                const { mx, my } = toMeters(loc.lat, loc.lng);
                loc.x = Math.round(centerX + mx * scale);
                loc.y = Math.round(centerY + my * scale);
            } else {
                // 좌표 없는 장소 → 거리 레벨 기반 배치 (기존 fallback)
                const dist = (this.lm.distances || []).find(d =>
                    (d.fromId === curLoc.id && d.toId === loc.id) || (d.toId === curLoc.id && d.fromId === loc.id)
                );
                const level = dist?.level || 5;
                const px = { 1: 55, 2: 75, 3: 95, 4: 115, 5: 135, 6: 160, 7: 190, 8: 220, 9: 260, 10: 300 }[level] || 135;
                const angle = ((loc.id.charCodeAt(4) || 0) * 37 + 11) % 360 * Math.PI / 180;
                loc.x = Math.round(centerX + px * Math.cos(angle));
                loc.y = Math.round(centerY + px * Math.sin(angle));
            }
        }
    }

    // ========== 기존 원형 배치 (거리 레벨 기반 — 15분 반경) ==========
    _circularLayout(locs, dists, curLoc, centerX, centerY) {
        // 도보 15분(level 6) 이내 = 화면 안, 그 밖 = 화면 밖으로 밀어냄
        const levelToPx = { 1:50, 2:70, 3:90, 4:115, 5:140, 6:170, 7:350, 8:500, 9:750, 10:1000 };
        curLoc.x = centerX; curLoc.y = centerY;
        const others = locs.filter(l => l.id !== curLoc.id && !l._manualXY);
        const angleStep = (2 * Math.PI) / Math.max(others.length, 1);
        let angle = ((locs.length * 37 + 11) % 360) * Math.PI / 180;
        for (const loc of others) {
            const dist = dists.find(d => (d.fromId === curLoc.id && d.toId === loc.id) || (d.toId === curLoc.id && d.fromId === loc.id));
            const level = dist?.level || 5;
            const px = levelToPx[level] || 140;
            loc.x = Math.round(centerX + px * Math.cos(angle));
            loc.y = Math.round(centerY + px * Math.sin(angle));
            angle += angleStep;
        }
    }

    // ================================================================
    //  PIN STYLE
    // ================================================================
    _pinStyle(name) {
        const lo = name.toLowerCase();
        if (/카페|cafe|coffee|커피/i.test(lo)) return { color: '#E74C3C', emoji: '🐱', border: '#C0392B' };
        if (/서점|book|도서|library|서재/i.test(lo)) return { color: '#3498DB', emoji: '📚', border: '#2980B9' };
        if (/집|home|house|숙소|기숙|방/i.test(lo)) return { color: '#27AE60', emoji: '🏠', border: '#1E8449' };
        if (/공원|park|정원|garden|광장/i.test(lo)) return { color: '#2ECC71', emoji: '🌳', border: '#27AE60' };
        if (/편의|convenience|마트|mart|가게|shop|store|문구|supermarket|grocery/i.test(lo)) return { color: '#F39C12', emoji: '🏪', border: '#D68910' };
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

    // ================================================================
    //  🏰 FANTASY MODE (기존 유지)
    // ================================================================
    _renderFantasy() {
        const { locations, movements, currentLocationId } = this.lm;
        if (locations.length >= 2) this._autoLayout();
        const cW = Math.max(this.container?.offsetWidth || 600, 300);
        const cH = Math.max(this.container?.offsetHeight || 400, 300);
        const aspect = cW / cH;
        if (locations.length) {
            const pad = 100;
            const xs = locations.map(l => l.x), ys = locations.map(l => l.y);
            const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
            const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
            const w = Math.max(400, maxX - minX), h = Math.max(300, maxY - minY, w / aspect);
            this.vb = { x: minX, y: minY, w, h };
        } else { this.vb = { x: 0, y: 0, w: 600, h: Math.max(400, Math.round(600 / aspect)) }; }
        this._applyVB();
        const vb = this.vb;
        let svg = `<defs><filter id="wt-glow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
        const drawn = new Set();
        for (const d of (this.lm.distances || [])) {
            const f = locations.find(l => l.id === d.fromId), t = locations.find(l => l.id === d.toId);
            if (!f || !t) continue;
            const k = [d.fromId, d.toId].sort().join('-'); if (drawn.has(k)) continue; drawn.add(k);
            const mx = (f.x + t.x) / 2 + ((k.charCodeAt(0) % 20) - 10);
            const my = (f.y + t.y) / 2 + ((k.charCodeAt(1 % k.length) % 20) - 10);
            svg += `<path d="M${f.x},${f.y} Q${mx},${my} ${t.x},${t.y}" fill="none" stroke="#6B3A2A" stroke-width="2.5" stroke-dasharray="10 6" opacity="0.55" stroke-linecap="round"/>`;
            if (d.distanceText) { const lx = (f.x + t.x) / 2, ly = (f.y + t.y) / 2 - 6; svg += `<text x="${lx}" y="${ly}" text-anchor="middle" fill="#5D4037" font-size="9" font-family="serif" opacity="0.6" font-style="italic">${d.distanceText}</text>`; }
        }
        for (const m of movements) {
            const f = locations.find(l => l.id === m.fromId), t = locations.find(l => l.id === m.toId);
            if (!f || !t) continue;
            const k = [m.fromId, m.toId].sort().join('-'); if (drawn.has(k)) continue; drawn.add(k);
            const mx = (f.x + t.x) / 2 + ((k.charCodeAt(0) % 16) - 8), my = (f.y + t.y) / 2 + ((k.charCodeAt(1 % k.length) % 16) - 8);
            svg += `<path d="M${f.x},${f.y} Q${mx},${my} ${t.x},${t.y}" fill="none" stroke="#6B3A2A" stroke-width="2" stroke-dasharray="8 5" opacity="0.35" stroke-linecap="round"/>`;
        }
        for (const loc of locations) {
            const cur = loc.id === currentLocationId;
            const type = this._getLocType(loc.name);
            if (cur) svg += `<circle cx="${loc.x}" cy="${loc.y}" r="28" fill="#CD853F" opacity="0.15" filter="url(#wt-glow)"/>`;
            svg += this._fantasyIcon(loc.x, loc.y, type, cur, loc.visitCount || 0, loc.id);
            svg += `<text x="${loc.x}" y="${loc.y + 24}" text-anchor="middle" fill="#3E2723" font-size="${cur ? 13 : 11}" font-weight="${cur ? '700' : '600'}" font-family="'Georgia',serif">${loc.name}</text>`;
            if (cur) svg += `<text x="${loc.x}" y="${loc.y - 24}" text-anchor="middle" font-size="14">🐾</text>`;
        }
        if (!locations.length) svg += `<text x="${vb.x + vb.w / 2}" y="${vb.y + vb.h / 2}" text-anchor="middle" fill="#5D4037" font-size="14" font-family="'Georgia',serif" font-style="italic">모험을 시작해보세요... 🏰</text>`;
        svg += this._compassRose(vb.x + 32, vb.y + vb.h - 32);
        svg += this._corner(vb.x + 8, vb.y + 8, 1, 1) + this._corner(vb.x + vb.w - 8, vb.y + 8, -1, 1);
        svg += this._corner(vb.x + 8, vb.y + vb.h - 8, 1, -1) + this._corner(vb.x + vb.w - 8, vb.y + vb.h - 8, -1, -1);
        this.svg.innerHTML = svg;
    }
    _getLocType(n) { const l=n.toLowerCase(); if(/성|castle|palace|궁|요새|tower|탑/.test(l))return'castle'; if(/산|mountain|peak|봉/.test(l))return'mountain'; if(/숲|forest|woods|jungle/.test(l))return'forest'; if(/신전|temple|church|성당|교회/.test(l))return'temple'; if(/마을|village|town/.test(l))return'village'; if(/집|home|house|오두막/.test(l))return'house'; if(/가게|shop|market|시장/.test(l))return'shop'; if(/술집|tavern|bar|pub|inn|주막/.test(l))return'tavern'; if(/동굴|cave|dungeon|지하/.test(l))return'cave'; if(/항구|port|harbor|부두/.test(l))return'port'; if(/강|river|lake|호수|바다|sea/.test(l))return'water'; if(/학교|school|도서관|library/.test(l))return'library'; if(/arena|훈련|체육|gym/.test(l))return'arena'; return'flag'; }
    _fantasyIcon(x, y, type, cur, v, id) { const s=cur?1.15:1; const em={castle:'🏰',mountain:'⛰️',forest:'🌲',temple:'⛪',village:'🏘️',house:'🏠',shop:'🏪',tavern:'🍺',cave:'🕳️',port:'⚓',water:'💧',library:'📚',arena:'⚔️',flag:'🪧'}; const e=em[type]||'📍'; const sz=cur?28:22; let svg=`<g transform="translate(${x},${y}) scale(${s})" class="wt-location-node" data-id="${id}">`; if(cur)svg+=`<circle r="20" fill="#CD853F" opacity="0.2" filter="url(#wt-glow)"/>`; svg+=`<text y="6" text-anchor="middle" font-size="${sz}" style="cursor:pointer;pointer-events:none;user-select:none">${e}</text>`; if(v>0){svg+=`<circle cx="14" cy="-8" r="7" fill="#DAA520" stroke="#5D4037" stroke-width="0.8"/><text x="14" y="-5" text-anchor="middle" fill="#3E2723" font-size="8" font-weight="700">${v}</text>`;} svg+='</g>'; return svg; }
    _compassRose(cx,cy){const s=22;let v=`<g transform="translate(${cx},${cy})">`; v+=`<circle r="${s}" fill="rgba(244,228,193,0.6)" stroke="#8B6914" stroke-width="1.2"/><circle r="${s*0.15}" fill="#8B6914"/>`; v+=`<polygon points="0,${-s+3} -4,${-s*0.35} 4,${-s*0.35}" fill="#8B0000" stroke="#5D4037" stroke-width="0.5"/>`; v+=`<polygon points="0,${s-3} -4,${s*0.35} 4,${s*0.35}" fill="#D4C5A0" stroke="#5D4037" stroke-width="0.5"/>`; v+=`<text y="${-s-3}" text-anchor="middle" fill="#8B0000" font-size="8" font-weight="700" font-family="serif">N</text>`; v+=`<text y="${s+9}" text-anchor="middle" fill="#5D4037" font-size="7" font-weight="600" font-family="serif">S</text>`; v+='</g>'; return v;}
    _corner(x,y,dx,dy){const s=18;return`<g transform="translate(${x},${y}) scale(${dx},${dy})"><path d="M0,0 C${s*0.3},0 ${s*0.5},${s*0.1} ${s*0.5},${s*0.3} M0,0 C0,${s*0.3} ${s*0.1},${s*0.5} ${s*0.3},${s*0.5}" fill="none" stroke="#8B6914" stroke-width="1.5" opacity="0.5"/><circle cx="${s*0.08}" cy="${s*0.08}" r="2" fill="#8B6914" opacity="0.4"/></g>`;}

    // ================================================================
    //  TOUCH / MOUSE HANDLING (기존 유지)
    // ================================================================
    _touchStart(e) {
        if (e.touches.length === 2) { e.preventDefault(); this._pinch = this._pinchDist(e); this._pan = null; this._longPress = null; return; }
        if (e.touches.length === 1) {
            const t = e.touches[0], pt = this._svgPt(t), hitId = this._hitTest(pt);
            this._touchInfo = { x: t.clientX, y: t.clientY, time: Date.now(), nodeId: hitId, pt }; this._wasDrag = false;
            if (hitId && !this._movingNodeId) {
                e.preventDefault();
                this._longPress = setTimeout(() => { this._movingNodeId = hitId; const loc = this.lm.locations.find(l => l.id === hitId); if (loc && this.onMoveRequest) this.onMoveRequest(hitId, loc.name); this._longPress = null; }, 500);
            } else if (this._movingNodeId) {
                e.preventDefault(); const loc = this.lm.locations.find(l => l.id === this._movingNodeId);
                if (loc) {
                    loc.x = Math.round(pt.x); loc.y = Math.round(pt.y);
                    loc._manualXY = true; // 수동 배치 플래그
                    this.lm.updateLocation(loc.id, { x: loc.x, y: loc.y, _manualXY: true });
                    this._vbManual = true; // 카메라 고정
                    this._skipLayout = true; // 레이아웃 재계산 방지
                    this.render();
                }
                this._movingNodeId = null;
            } else { this._pan = { sx: t.clientX, sy: t.clientY, vx: this.vb.x, vy: this.vb.y }; }
        }
    }
    _touchMove(e) {
        if (e.touches.length === 2 && this._pinch) { e.preventDefault(); const d = this._pinchDist(e), s = this._pinch / d; const cxv = this.vb.x + this.vb.w / 2, cyv = this.vb.y + this.vb.h / 2; const nw = Math.max(200, Math.min(1200, this.vb.w * s)); const nh = nw * (this.vb.h / this.vb.w); this.vb = { x: cxv - nw / 2, y: cyv - nh / 2, w: nw, h: nh }; this._applyVB(); this._pinch = d; return; }
        if (e.touches.length === 1) { const t = e.touches[0]; if (this._longPress && this._touchInfo) { if (Math.abs(t.clientX - this._touchInfo.x) > 10 || Math.abs(t.clientY - this._touchInfo.y) > 10) { clearTimeout(this._longPress); this._longPress = null; } } if (this._pan) { e.preventDefault(); const dx = (t.clientX - this._pan.sx) * (this.vb.w / this.svg.getBoundingClientRect().width); const dy = (t.clientY - this._pan.sy) * (this.vb.h / this.svg.getBoundingClientRect().height); this.vb.x = this._pan.vx - dx; this.vb.y = this._pan.vy - dy; this._applyVB(); this._wasDrag = true; } }
    }
    _touchEnd() { clearTimeout(this._longPress); this._longPress = null; if (this._touchInfo && !this._wasDrag && this._touchInfo.nodeId && !this._movingNodeId) { if (Date.now() - this._touchInfo.time < 400) this.onLocationClick?.(this._touchInfo.nodeId); } this._pinch = null; this._pan = null; this._touchInfo = null; }
    _onDown(e) { const pt = this._svgPt(e), hitId = this._hitTest(pt); this._wasDrag = false; if (this._movingNodeId) { e.preventDefault(); const loc = this.lm.locations.find(l => l.id === this._movingNodeId); if (loc) { loc.x = Math.round(pt.x); loc.y = Math.round(pt.y); loc._manualXY = true; this.lm.updateLocation(loc.id, { x: loc.x, y: loc.y, _manualXY: true }); this._vbManual = true; this._skipLayout = true; this.render(); } this._movingNodeId = null; return; } if (hitId) { e.preventDefault(); this._mouseClickId = hitId; } if (!hitId) { this._pan = { sx: e.clientX, sy: e.clientY, vx: this.vb.x, vy: this.vb.y }; } }
    _onMove(e) { if (this._pan) { const dx = (e.clientX - this._pan.sx) * (this.vb.w / this.svg.getBoundingClientRect().width); const dy = (e.clientY - this._pan.sy) * (this.vb.h / this.svg.getBoundingClientRect().height); this.vb.x = this._pan.vx - dx; this.vb.y = this._pan.vy - dy; this._applyVB(); this._wasDrag = true; this._mouseClickId = null; } }
    _onUp() { this._pan = null; if (this._mouseClickId && !this._wasDrag) this.onLocationClick?.(this._mouseClickId); this._mouseClickId = null; }
    _zoom(f, e) { const r = this.svg.getBoundingClientRect(); const mx = (e.clientX - r.left) / r.width, my = (e.clientY - r.top) / r.height; const nw = Math.max(200, Math.min(1200, this.vb.w * f)); const nh = nw * (this.vb.h / this.vb.w); this.vb.x += (this.vb.w - nw) * mx; this.vb.y += (this.vb.h - nh) * my; this.vb.w = nw; this.vb.h = nh; this._applyVB(); }

    // ========== Helpers ==========
    _el(tag, attrs, text) { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v); if (text !== undefined) el.textContent = text; return el; }
    _svgPt(e) { const r = this.svg.getBoundingClientRect(); return { x: this.vb.x + (e.clientX - r.left) / r.width * this.vb.w, y: this.vb.y + (e.clientY - r.top) / r.height * this.vb.h }; }
    _hitTest(pt) { for (const l of this.lm.locations) { const dx = pt.x - l.x, dy = pt.y - l.y; if (Math.sqrt(dx * dx + dy * dy) < 30) return l.id; } return null; }
    _pinchDist(e) { const a = e.touches[0], b = e.touches[1]; return Math.sqrt((a.clientX - b.clientX) ** 2 + (a.clientY - b.clientY) ** 2); }
}
