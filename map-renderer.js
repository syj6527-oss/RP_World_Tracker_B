// 🐶 World Tracker — map-renderer.js (v0.3.0-beta hotfix4)
// 레퍼런스 품질 약도 + 15분 반경 + Geo-aware

export class MapRenderer {
    constructor(container, lm) {
        this.container = container; this.lm = lm;
        this.svg = null; this._wasDrag = false; this._movingNodeId = null;
        this.onLocationClick = null; this.onMoveRequest = null;
        this.vb = { x: 0, y: 0, w: 600, h: 500 };
        this._pinch = null; this._pan = null;
        this._init();
    }
    _srand(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

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
    //  RENDER
    // ================================================================
    render() {
        if (!this.svg) return;
        if (this.container) {
            const h = this.container.offsetHeight || this.container.clientHeight || 320;
            this.svg.setAttribute('height', Math.max(h, 320) + 'px');
        }
        if (this.fantasyMode) { this._renderFantasy(); return; }

        this.svg.innerHTML = `<defs>
            <filter id="wt-sh"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.08"/></filter>
            <filter id="wt-shp"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000" flood-opacity="0.25"/></filter>
        </defs>`;

        const { locations, movements, currentLocationId } = this.lm;
        if (locations.length >= 2) this._autoLayout();

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

        this._drawCity(vb, ex, seed, cx, cy);
        this._drawDistLines(locations, movements, currentLocationId);
        this._drawPins(locations, currentLocationId, vb);
        this._drawCompass(vb);

        if (!locations.length) {
            this.svg.appendChild(this._el('text', { x: cx, y: cy, class: 'wt-empty-text' }, 'RP를 시작해보세요! 🐶'));
        }
    }

    // ================================================================
    //  도시 배경 (강 독립 영역, 겹침 방지)
    // ================================================================
    _drawCity(vb, ex, seed, cx, cy) {
        const rng = this._srand(seed * 31337);
        const W = vb.w + ex * 2, H = vb.h + ex * 2;
        const ox = vb.x - ex, oy = vb.y - ex;

        // 배경 (도로 색)
        this.svg.appendChild(this._el('rect', { x: ox, y: oy, width: W, height: H, fill: '#EBE8E0' }));

        // ========== 강 영역 계산 (블록 배치 전에!) ==========
        const hasRiver = seed % 4 !== 0;
        const riverY = oy + H * (0.33 + (seed % 15) / 100);
        const riverH = 20; // 강 폭

        // ========== 격자 ==========
        const cols = 5, rows = 7;
        const cw = [], rh = [];
        let tw = 0, th = 0;
        for (let i = 0; i < cols; i++) { cw[i] = 0.6 + rng() * 0.8; tw += cw[i]; }
        for (let i = 0; i < rows; i++) { rh[i] = 0.6 + rng() * 0.8; th += rh[i]; }
        cw.forEach((_, i) => cw[i] = cw[i] / tw * W);
        rh.forEach((_, i) => rh[i] = rh[i] / th * H);

        // 공원/녹지 셀
        const parkSet = new Set();
        const pc = 2 + (seed % 2);
        for (let i = 0; i < pc; i++) parkSet.add(`${1 + Math.floor(rng() * (rows - 2))}_${Math.floor(rng() * cols)}`);

        // 랜드마크 셀 (건물 단지)
        const lmSet = new Set();
        lmSet.add(`${2 + (seed % 2)}_${3 + (seed % 2)}`);

        // ========== 블록 배치 (강 영역 회피) ==========
        const gap = 0.08;
        let yy = oy;
        for (let r = 0; r < rows; r++) {
            let xx = ox;
            for (let c = 0; c < cols; c++) {
                const bw = cw[c], bh = rh[r];
                const gx = bw * gap, gy = bh * gap;
                const offX = (rng() - 0.5) * 3, offY = (rng() - 0.5) * 3;
                const bx = xx + gx + offX, by = yy + gy + offY;
                const bww = Math.max(8, bw - gx * 2), bhh = Math.max(8, bh - gy * 2);

                // 강과 겹치는지 확인
                if (hasRiver && by < riverY + riverH + 4 && by + bhh > riverY - 4) {
                    // 강 위/아래로 분할
                    const aboveH = Math.max(0, riverY - 6 - by);
                    const belowY = riverY + riverH + 6;
                    const belowH = Math.max(0, (by + bhh) - belowY);

                    if (aboveH > 12) this._drawBlock(bx, by, bww, aboveH, rng, parkSet.has(`${r}_${c}`), lmSet.has(`${r}_${c}`));
                    if (belowH > 12) this._drawBlock(bx, belowY, bww, belowH, rng, false, false);
                } else {
                    this._drawBlock(bx, by, bww, bhh, rng, parkSet.has(`${r}_${c}`), lmSet.has(`${r}_${c}`));
                }
                xx += bw;
            }
            yy += rh[r];
        }

        // ========== 강 (블록 위에, 독립 레이어) ==========
        if (hasRiver) {
            const rMid = cx + (rng() - 0.5) * 60;
            const curve = 20 + rng() * 20;
            this.svg.appendChild(this._el('path', {
                d: `M${ox - 20},${riverY + riverH / 2} Q${rMid},${riverY + riverH / 2 + curve} ${ox + W + 20},${riverY + riverH / 2 - curve / 3}`,
                fill: 'none', stroke: '#C2DCF0', 'stroke-width': riverH, 'stroke-linecap': 'round',
            }));
        }

        // ========== 메인 도로 (곡선, 연한 노랑) ==========
        const mainRow = 2 + (seed % 2);
        let mainY = oy;
        for (let i = 0; i <= mainRow && i < rows; i++) mainY += rh[i];
        // 강과 겹치면 건너뛰기
        if (!hasRiver || Math.abs(mainY - riverY) > riverH + 10) {
            const my2 = mainY + (rng() - 0.5) * 4;
            this.svg.appendChild(this._el('path', {
                d: `M${ox - 10},${mainY} Q${ox + W / 2},${my2} ${ox + W + 10},${mainY}`,
                fill: 'none', stroke: '#EDE5A0', 'stroke-width': 5, 'stroke-linecap': 'round',
            }));
        }
        const mainCol = 1 + (seed % 2);
        let mainX = ox;
        for (let i = 0; i <= mainCol && i < cols; i++) mainX += cw[i];
        const mx2 = mainX + (rng() - 0.5) * 4;
        this.svg.appendChild(this._el('path', {
            d: `M${mainX},${oy - 10} Q${mx2},${oy + H / 2} ${mainX},${oy + H + 10}`,
            fill: 'none', stroke: '#EDE5A0', 'stroke-width': 5, 'stroke-linecap': 'round',
        }));
    }

    // ========== 단일 블록 렌더링 ==========
    _drawBlock(x, y, w, h, rng, isPark, isLandmark) {
        const rx = isPark ? (12 + Math.floor(rng() * 10)) : isLandmark ? 14 : (4 + Math.floor(rng() * 7));

        if (isPark) {
            this.svg.appendChild(this._el('rect', { x, y, width: w, height: h, rx, fill: '#D4EACC' }));
            // 연못
            if (rng() < 0.5 && w > 30 && h > 25) {
                this.svg.appendChild(this._el('ellipse', {
                    cx: x + w * (0.35 + rng() * 0.3), cy: y + h * (0.35 + rng() * 0.3),
                    rx: Math.min(w, h) * 0.15, ry: Math.min(w, h) * 0.1,
                    fill: '#B8D4A8', opacity: 0.4,
                }));
            }
        } else if (isLandmark) {
            this.svg.appendChild(this._el('rect', { x, y, width: w, height: h, rx, fill: '#DDD9D1', opacity: 0.75 }));
            this._drawBuildings(x, y, w, h, rng, 3, 0.5);
        } else {
            const tone = rng();
            const fill = tone < 0.5 ? '#E2DFD7' : tone < 0.8 ? '#E5E2DA' : '#E8E5DD';
            this.svg.appendChild(this._el('rect', { x, y, width: w, height: h, rx, fill }));
            if (rng() < 0.7 && w > 25 && h > 20) {
                this._drawBuildings(x, y, w, h, rng, 2, 0.4);
            }
        }
    }

    // ========== 건물 디테일 ==========
    _drawBuildings(bx, by, bw, bh, rng, maxCount, opacity) {
        const margin = 0.12, gap = 3, placed = [];
        for (let att = 0; att < maxCount * 4; att++) {
            if (placed.length >= maxCount) break;
            const sr = rng();
            let w, h;
            if (sr < 0.3) { w = bw * (0.3 + rng() * 0.15); h = bh * (0.2 + rng() * 0.15); }
            else if (sr < 0.65) { w = bw * (0.12 + rng() * 0.12); h = bh * (0.25 + rng() * 0.2); }
            else { w = bw * (0.15 + rng() * 0.1); h = bh * (0.12 + rng() * 0.1); }
            const xMin = bx + bw * margin, yMin = by + bh * margin;
            const xR = bw * (1 - margin * 2) - w, yR = bh * (1 - margin * 2) - h;
            if (xR < 0 || yR < 0) continue;
            const x = xMin + rng() * xR, y = yMin + rng() * yR;
            if (placed.some(p => x < p.x + p.w + gap && x + w + gap > p.x && y < p.y + p.h + gap && y + h + gap > p.y)) continue;
            placed.push({ x, y, w, h });
            this.svg.appendChild(this._el('rect', {
                x, y, width: w, height: h,
                rx: (h > w * 1.4 || w > h * 1.4) ? 3 : 2,
                fill: '#D2CEC6', opacity,
            }));
        }
    }

    // ================================================================
    //  거리 점선 + pill (15분 이내만)
    // ================================================================
    _drawDistLines(locations, movements, curId) {
        const drawn = new Set();
        for (const d of (this.lm.distances || [])) {
            const f = locations.find(l => l.id === d.fromId), t = locations.find(l => l.id === d.toId);
            if (!f || !t) continue;
            // 15분 반경 필터: 현재 위치와의 거리가 level > 6이면 스킵
            const lvl = d.level || 5;
            if (lvl > 6 && (d.fromId === curId || d.toId === curId)) continue;
            const k = [d.fromId, d.toId].sort().join('-');
            if (drawn.has(k)) continue; drawn.add(k);
            const lw = lvl <= 3 ? 2 : 1.5;
            this.svg.appendChild(this._el('line', { x1: f.x, y1: f.y, x2: t.x, y2: t.y, stroke: '#C0B8A8', 'stroke-width': lw, 'stroke-dasharray': '5 3', 'stroke-linecap': 'round', opacity: 0.3 }));
            if (d.distanceText) {
                const mx = (f.x + t.x) / 2, my = (f.y + t.y) / 2;
                const tl = d.distanceText.length * 5 + 10;
                const pill = this._el('g', { transform: `translate(${mx},${my - 8})` });
                pill.appendChild(this._el('rect', { x: -tl / 2, y: -7, width: tl, height: 14, rx: 7, fill: '#fff', stroke: '#E8E4D8', 'stroke-width': 0.6, filter: 'url(#wt-sh)' }));
                pill.appendChild(this._el('text', { x: 0, y: 3, 'text-anchor': 'middle', fill: '#5E84E2', 'font-size': '7.5', 'font-weight': '600' }, d.distanceText));
                this.svg.appendChild(pill);
            }
        }
        for (const m of movements) {
            const f = locations.find(l => l.id === m.fromId), t = locations.find(l => l.id === m.toId);
            if (!f || !t) continue;
            const k = [m.fromId, m.toId].sort().join('-');
            if (drawn.has(k)) continue; drawn.add(k);
            this.svg.appendChild(this._el('line', { x1: f.x, y1: f.y, x2: t.x, y2: t.y, stroke: '#C0B8A8', 'stroke-width': 1.5, 'stroke-dasharray': '5 3', 'stroke-linecap': 'round', opacity: 0.2 }));
        }
    }

    // ================================================================
    //  핀 (15분 반경 필터 — 렌더 시점)
    // ================================================================
    _drawPins(locations, currentLocationId, vb) {
        const curLoc = locations.find(l => l.id === currentLocationId);

        for (const loc of locations) {
            const cur = loc.id === currentLocationId;
            const ps = this._pinStyle(loc.name);

            // 15분 반경 체크
            let distLevel = 0;
            if (!cur && curLoc) {
                const d = (this.lm.distances || []).find(d =>
                    (d.fromId === currentLocationId && d.toId === loc.id) ||
                    (d.toId === currentLocationId && d.fromId === loc.id)
                );
                distLevel = d?.level || 5;
            }

            // level > 6: 가장자리 미니 표시
            if (distLevel > 6) {
                this._drawEdgeIndicator(loc, curLoc, ps, distLevel, vb);
                continue;
            }

            // 정상 핀 렌더
            const g = this._el('g', { class: 'wt-location-node', 'data-id': loc.id, transform: `translate(${loc.x},${loc.y})` });

            if (cur) {
                const pulse = this._el('circle', { r: 22, fill: 'none', stroke: ps.color, 'stroke-width': 2, opacity: '0.25' });
                const aR = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
                aR.setAttribute('attributeName', 'r'); aR.setAttribute('from', '18'); aR.setAttribute('to', '36');
                aR.setAttribute('dur', '2s'); aR.setAttribute('repeatCount', 'indefinite'); pulse.appendChild(aR);
                const aO = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
                aO.setAttribute('attributeName', 'opacity'); aO.setAttribute('from', '0.35'); aO.setAttribute('to', '0');
                aO.setAttribute('dur', '2s'); aO.setAttribute('repeatCount', 'indefinite'); pulse.appendChild(aO);
                g.appendChild(pulse);
            }
            const sz = cur ? 19 : 13, ph = cur ? 26 : 18;
            const pin = this._el('g', { transform: `translate(0,${-ph})`, filter: 'url(#wt-shp)' });
            pin.appendChild(this._el('path', { d: `M0,${ph}C0,${ph},${-sz},${ph * 0.35},${-sz},${-sz * 0.15}A${sz},${sz},0,1,1,${sz},${-sz * 0.15}C${sz},${ph * 0.35},0,${ph},0,${ph}Z`, fill: ps.color, stroke: cur ? '#fff' : ps.border, 'stroke-width': cur ? 1.5 : 0.8 }));
            pin.appendChild(this._el('text', { x: 0, y: -sz * 0.1 + 5, 'text-anchor': 'middle', 'font-size': cur ? '14' : '11', style: 'pointer-events:none' }, ps.emoji));
            g.appendChild(pin);
            if (loc.visitCount > 0) { const bx = sz * 0.5, by = -(ph + sz * 0.3); const bdg = this._el('g', { transform: `translate(${bx},${by})` }); bdg.appendChild(this._el('circle', { r: 8, fill: '#fff', stroke: ps.color, 'stroke-width': 1.5 })); bdg.appendChild(this._el('text', { 'text-anchor': 'middle', y: 3.5, 'font-size': '8.5', 'font-weight': '700', fill: ps.color }, loc.visitCount)); g.appendChild(bdg); }
            const nl = loc.name.length * 6.5 + 12;
            const lg = this._el('g', { transform: 'translate(0,6)' });
            lg.appendChild(this._el('rect', { x: -nl / 2, y: -8, width: nl, height: 16, rx: 8, fill: '#fff', stroke: '#E8E4D8', 'stroke-width': 0.7, filter: 'url(#wt-sh)' }));
            lg.appendChild(this._el('text', { class: 'wt-location-label', y: 3, 'font-size': '9', 'font-weight': '600' }, loc.name));
            g.appendChild(lg);
            if (cur) { const paw = this._el('text', { 'text-anchor': 'middle', y: -(ph + sz + 5), 'font-size': '15' }, '🐾'); const pa = document.createElementNS('http://www.w3.org/2000/svg', 'animateTransform'); pa.setAttribute('attributeName', 'transform'); pa.setAttribute('type', 'translate'); pa.setAttribute('values', '0 0;0 -4;0 0'); pa.setAttribute('dur', '1.2s'); pa.setAttribute('repeatCount', 'indefinite'); paw.appendChild(pa); g.appendChild(paw); }
            this.svg.appendChild(g);
        }
    }

    // ========== 가장자리 인디케이터 (15분 밖) ==========
    _drawEdgeIndicator(loc, curLoc, ps, level, vb) {
        if (!curLoc) return;
        const dx = loc.x - curLoc.x, dy = loc.y - curLoc.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1) return;
        const mg = 28;
        const mDx = dx > 0 ? (vb.x + vb.w - mg - curLoc.x) : (vb.x + mg - curLoc.x);
        const mDy = dy > 0 ? (vb.y + vb.h - mg - curLoc.y) : (vb.y + mg - curLoc.y);
        const sX = Math.abs(dx) > 1 ? Math.abs(mDx / dx) : 99;
        const sY = Math.abs(dy) > 1 ? Math.abs(mDy / dy) : 99;
        const sc = Math.min(sX, sY, 1);
        const eX = curLoc.x + dx * sc, eY = curLoc.y + dy * sc;

        // 점선
        this.svg.appendChild(this._el('line', { x1: curLoc.x, y1: curLoc.y, x2: eX, y2: eY, stroke: '#C8C0B0', 'stroke-width': 1, 'stroke-dasharray': '4 3', opacity: 0.18 }));

        // 미니 핀 + 라벨
        const dist = (this.lm.distances || []).find(dd => (dd.fromId === curLoc.id && dd.toId === loc.id) || (dd.toId === curLoc.id && dd.fromId === loc.id));
        const distText = dist?.distanceText || '';
        const g = this._el('g', { class: 'wt-location-node', 'data-id': loc.id, transform: `translate(${eX},${eY})`, opacity: 0.5 });
        const msz = 7, mph = 10;
        const mp = this._el('g', { transform: `translate(0,${-mph})` });
        mp.appendChild(this._el('path', { d: `M0,${mph}C0,${mph},${-msz},${mph * 0.35},${-msz},${-msz * 0.15}A${msz},${msz},0,1,1,${msz},${-msz * 0.15}C${msz},${mph * 0.35},0,${mph},0,${mph}Z`, fill: ps.color, opacity: 0.6 }));
        mp.appendChild(this._el('text', { x: 0, y: -msz * 0.1 + 3, 'text-anchor': 'middle', 'font-size': '6' }, ps.emoji));
        g.appendChild(mp);
        const lw = Math.max(loc.name.length * 4.5 + 8, distText.length * 4.5 + 8);
        const lg = this._el('g', { transform: 'translate(0,4)' });
        lg.appendChild(this._el('rect', { x: -lw / 2, y: -6, width: lw, height: 20, rx: 4, fill: 'rgba(255,255,255,0.8)', stroke: '#C8C0B0', 'stroke-width': 0.5 }));
        lg.appendChild(this._el('text', { y: 2, 'text-anchor': 'middle', fill: '#775537', 'font-size': '7', 'font-weight': '600' }, loc.name));
        lg.appendChild(this._el('text', { y: 11, 'text-anchor': 'middle', fill: '#5E84E2', 'font-size': '6.5' }, distText ? distText + ' →' : ''));
        g.appendChild(lg);
        this.svg.appendChild(g);
    }

    _drawCompass(vb) {
        const ccx = vb.x + 20, ccy = vb.y + vb.h - 20, s = 14;
        const cg = this._el('g', { transform: `translate(${ccx},${ccy})`, opacity: '0.4' });
        cg.appendChild(this._el('circle', { r: s, fill: 'rgba(242,238,228,0.7)', stroke: '#B0A090', 'stroke-width': 0.6 }));
        cg.appendChild(this._el('polygon', { points: `0,${-s + 3} -2.5,${-s * 0.35} 2.5,${-s * 0.35}`, fill: '#E07060', opacity: 0.7 }));
        cg.appendChild(this._el('text', { y: -s - 1, 'text-anchor': 'middle', fill: '#E07060', 'font-size': '4.5', 'font-weight': '600' }, 'N'));
        this.svg.appendChild(cg);
    }

    // ================================================================
    //  AUTO LAYOUT
    // ================================================================
    _autoLayout() {
        const locs = this.lm.locations, dists = this.lm.distances || [];
        if (locs.length < 2) return;
        if (this._skipLayout) { this._skipLayout = false; return; }
        const needsInit = locs.some(l => l.x === 0 && l.y === 0);
        if (!needsInit && !this._layoutDirty && this._layoutDone === true) return;
        this._layoutDirty = false; this._layoutDone = true;
        const cW = this.container?.offsetWidth || 360, cH = this.container?.offsetHeight || 480;
        const centerX = 300, centerY = Math.round((500 / (cW / cH)) / 2);
        const curId = this.lm.currentLocationId;
        const curLoc = locs.find(l => l.id === curId) || locs[0];
        const geoLocs = locs.filter(l => l.lat != null && l.lng != null);
        if (geoLocs.length >= 2) this._geoAwareLayout(locs, geoLocs, curLoc, centerX, centerY);
        else this._circularLayout(locs, dists, curLoc, centerX, centerY);
        for (let iter = 0; iter < 3; iter++) {
            for (let i = 0; i < locs.length; i++) for (let j = i + 1; j < locs.length; j++) {
                const dx = locs[j].x - locs[i].x, dy = locs[j].y - locs[i].y, d = Math.sqrt(dx * dx + dy * dy);
                if (d < 70) { const push = (70 - d) / 2, nx = dx / (d || 1), ny = dy / (d || 1); if (locs[i].id !== curLoc.id) { locs[i].x -= Math.round(push * nx); locs[i].y -= Math.round(push * ny); } if (locs[j].id !== curLoc.id) { locs[j].x += Math.round(push * nx); locs[j].y += Math.round(push * ny); } }
            }
        }
        for (const loc of locs) this.lm.updateLocation(loc.id, { x: loc.x, y: loc.y });
    }
    _geoAwareLayout(locs, geoLocs, curLoc, centerX, centerY) {
        let baseLat, baseLng;
        if (curLoc.lat != null && curLoc.lng != null) { baseLat = curLoc.lat; baseLng = curLoc.lng; } else { baseLat = geoLocs.reduce((s, l) => s + l.lat, 0) / geoLocs.length; baseLng = geoLocs.reduce((s, l) => s + l.lng, 0) / geoLocs.length; }
        const toM = (lat, lng) => ({ mx: (lng - baseLng) * 111320 * Math.cos(baseLat * Math.PI / 180), my: -(lat - baseLat) * 111320 });
        let maxR = 1; for (const l of geoLocs) { const { mx, my } = toM(l.lat, l.lng); maxR = Math.max(maxR, Math.abs(mx), Math.abs(my)); }
        const scale = 180 / maxR;
        curLoc.x = centerX; curLoc.y = centerY;
        for (const loc of locs) {
            if (loc.id === curLoc.id || loc._manualXY) continue;
            if (loc.lat != null && loc.lng != null) { const { mx, my } = toM(loc.lat, loc.lng); loc.x = Math.round(centerX + mx * scale); loc.y = Math.round(centerY + my * scale); }
            else { const dist = (this.lm.distances || []).find(d => (d.fromId === curLoc.id && d.toId === loc.id) || (d.toId === curLoc.id && d.fromId === loc.id)); const level = dist?.level || 5; const px = { 1: 50, 2: 70, 3: 90, 4: 115, 5: 140, 6: 170, 7: 350, 8: 500, 9: 750, 10: 1000 }[level] || 140; const angle = ((loc.id.charCodeAt(4) || 0) * 37 + 11) % 360 * Math.PI / 180; loc.x = Math.round(centerX + px * Math.cos(angle)); loc.y = Math.round(centerY + px * Math.sin(angle)); }
        }
    }
    _circularLayout(locs, dists, curLoc, centerX, centerY) {
        const levelToPx = { 1: 50, 2: 70, 3: 90, 4: 115, 5: 140, 6: 170, 7: 350, 8: 500, 9: 750, 10: 1000 };
        curLoc.x = centerX; curLoc.y = centerY;
        const others = locs.filter(l => l.id !== curLoc.id && !l._manualXY);
        const angleStep = (2 * Math.PI) / Math.max(others.length, 1);
        let angle = ((locs.length * 37 + 11) % 360) * Math.PI / 180;
        for (const loc of others) {
            const dist = dists.find(d => (d.fromId === curLoc.id && d.toId === loc.id) || (d.toId === curLoc.id && d.fromId === loc.id));
            const px = levelToPx[dist?.level || 5] || 140;
            loc.x = Math.round(centerX + px * Math.cos(angle)); loc.y = Math.round(centerY + px * Math.sin(angle)); angle += angleStep;
        }
    }

    _pinStyle(name) { const lo = name.toLowerCase(); if (/카페|cafe|coffee|커피/i.test(lo)) return { color: '#E74C3C', emoji: '🐱', border: '#C0392B' }; if (/서점|book|도서|library|서재/i.test(lo)) return { color: '#3498DB', emoji: '📚', border: '#2980B9' }; if (/집|home|house|숙소|기숙|방/i.test(lo)) return { color: '#27AE60', emoji: '🏠', border: '#1E8449' }; if (/공원|park|정원|garden|광장/i.test(lo)) return { color: '#2ECC71', emoji: '🌳', border: '#27AE60' }; if (/편의|convenience|마트|mart|가게|shop|store|문구|supermarket|grocery/i.test(lo)) return { color: '#F39C12', emoji: '🏪', border: '#D68910' }; if (/식당|restaurant|음식|레스토랑/i.test(lo)) return { color: '#E67E22', emoji: '🍽️', border: '#CA6F1E' }; if (/학교|school|학원|academy/i.test(lo)) return { color: '#9B59B6', emoji: '🎓', border: '#7D3C98' }; if (/병원|hospital|의원|clinic/i.test(lo)) return { color: '#1ABC9C', emoji: '🏥', border: '#17A589' }; if (/역|station|지하철|subway|버스|bus/i.test(lo)) return { color: '#34495E', emoji: '🚉', border: '#2C3E50' }; if (/술집|bar|pub|tavern|주점|주막/i.test(lo)) return { color: '#8E44AD', emoji: '🍺', border: '#6C3483' }; if (/체육|gym|운동|fitness|arena/i.test(lo)) return { color: '#E74C3C', emoji: '💪', border: '#C0392B' }; if (/성|castle|궁|palace|요새/i.test(lo)) return { color: '#7F8C8D', emoji: '🏰', border: '#616A6B' }; if (/숲|forest|산|mountain/i.test(lo)) return { color: '#1E8449', emoji: '🌲', border: '#145A32' }; if (/해변|beach|바다|sea|강|river|호수|lake/i.test(lo)) return { color: '#2980B9', emoji: '🌊', border: '#1F618D' }; if (/동굴|cave|dungeon|던전|지하/i.test(lo)) return { color: '#5D6D7E', emoji: '🕳️', border: '#4A5568' }; if (/항구|port|harbor|dock|부두/i.test(lo)) return { color: '#2471A3', emoji: '⚓', border: '#1A5276' }; return { color: '#F6A93A', emoji: '📍', border: '#D68910' }; }

    // ================================================================
    //  🏰 FANTASY (기존 유지)
    // ================================================================
    _renderFantasy() { const{locations,movements,currentLocationId}=this.lm;if(locations.length>=2)this._autoLayout();const cW=Math.max(this.container?.offsetWidth||600,300),cH=Math.max(this.container?.offsetHeight||400,300),aspect=cW/cH;if(locations.length){const pad=100,xs=locations.map(l=>l.x),ys=locations.map(l=>l.y),minX=Math.min(...xs)-pad,maxX=Math.max(...xs)+pad,minY=Math.min(...ys)-pad,maxY=Math.max(...ys)+pad,w=Math.max(400,maxX-minX),h=Math.max(300,maxY-minY,w/aspect);this.vb={x:minX,y:minY,w,h};}else{this.vb={x:0,y:0,w:600,h:Math.max(400,Math.round(600/aspect))};}this._applyVB();const vb=this.vb;let svg=`<defs><filter id="wt-glow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;const drawn=new Set();for(const d of(this.lm.distances||[])){const f=locations.find(l=>l.id===d.fromId),t=locations.find(l=>l.id===d.toId);if(!f||!t)continue;const k=[d.fromId,d.toId].sort().join('-');if(drawn.has(k))continue;drawn.add(k);const mx=(f.x+t.x)/2+((k.charCodeAt(0)%20)-10),my=(f.y+t.y)/2+((k.charCodeAt(1%k.length)%20)-10);svg+=`<path d="M${f.x},${f.y} Q${mx},${my} ${t.x},${t.y}" fill="none" stroke="#6B3A2A" stroke-width="2.5" stroke-dasharray="10 6" opacity="0.55" stroke-linecap="round"/>`;if(d.distanceText){const lx=(f.x+t.x)/2,ly=(f.y+t.y)/2-6;svg+=`<text x="${lx}" y="${ly}" text-anchor="middle" fill="#5D4037" font-size="9" font-family="serif" opacity="0.6" font-style="italic">${d.distanceText}</text>`;}}for(const m of movements){const f=locations.find(l=>l.id===m.fromId),t=locations.find(l=>l.id===m.toId);if(!f||!t)continue;const k=[m.fromId,m.toId].sort().join('-');if(drawn.has(k))continue;drawn.add(k);const mx=(f.x+t.x)/2+((k.charCodeAt(0)%16)-8),my=(f.y+t.y)/2+((k.charCodeAt(1%k.length)%16)-8);svg+=`<path d="M${f.x},${f.y} Q${mx},${my} ${t.x},${t.y}" fill="none" stroke="#6B3A2A" stroke-width="2" stroke-dasharray="8 5" opacity="0.35" stroke-linecap="round"/>`;}for(const loc of locations){const cur=loc.id===currentLocationId,type=this._getLocType(loc.name);if(cur)svg+=`<circle cx="${loc.x}" cy="${loc.y}" r="28" fill="#CD853F" opacity="0.15" filter="url(#wt-glow)"/>`;svg+=this._fantasyIcon(loc.x,loc.y,type,cur,loc.visitCount||0,loc.id);svg+=`<text x="${loc.x}" y="${loc.y+24}" text-anchor="middle" fill="#3E2723" font-size="${cur?13:11}" font-weight="${cur?'700':'600'}" font-family="'Georgia',serif">${loc.name}</text>`;if(cur)svg+=`<text x="${loc.x}" y="${loc.y-24}" text-anchor="middle" font-size="14">🐾</text>`;}if(!locations.length)svg+=`<text x="${vb.x+vb.w/2}" y="${vb.y+vb.h/2}" text-anchor="middle" fill="#5D4037" font-size="14" font-family="serif" font-style="italic">모험을 시작해보세요... 🏰</text>`;svg+=this._compassRose(vb.x+32,vb.y+vb.h-32);this.svg.innerHTML=svg;}
    _getLocType(n){const l=n.toLowerCase();if(/성|castle|palace|궁|요새|tower|탑/.test(l))return'castle';if(/산|mountain|peak|봉/.test(l))return'mountain';if(/숲|forest|woods|jungle/.test(l))return'forest';if(/신전|temple|church|성당|교회/.test(l))return'temple';if(/마을|village|town/.test(l))return'village';if(/집|home|house|오두막/.test(l))return'house';if(/가게|shop|market|시장/.test(l))return'shop';if(/술집|tavern|bar|pub|inn|주막/.test(l))return'tavern';if(/동굴|cave|dungeon|지하/.test(l))return'cave';if(/항구|port|harbor|부두/.test(l))return'port';if(/강|river|lake|호수|바다|sea/.test(l))return'water';if(/학교|school|도서관|library/.test(l))return'library';if(/arena|훈련|체육|gym/.test(l))return'arena';return'flag';}
    _fantasyIcon(x,y,type,cur,v,id){const s=cur?1.15:1,em={castle:'🏰',mountain:'⛰️',forest:'🌲',temple:'⛪',village:'🏘️',house:'🏠',shop:'🏪',tavern:'🍺',cave:'🕳️',port:'⚓',water:'💧',library:'📚',arena:'⚔️',flag:'🪧'},e=em[type]||'📍',sz=cur?28:22;let svg=`<g transform="translate(${x},${y}) scale(${s})" class="wt-location-node" data-id="${id}">`;if(cur)svg+=`<circle r="20" fill="#CD853F" opacity="0.2" filter="url(#wt-glow)"/>`;svg+=`<text y="6" text-anchor="middle" font-size="${sz}" style="cursor:pointer;pointer-events:none;user-select:none">${e}</text>`;if(v>0)svg+=`<circle cx="14" cy="-8" r="7" fill="#DAA520" stroke="#5D4037" stroke-width="0.8"/><text x="14" y="-5" text-anchor="middle" fill="#3E2723" font-size="8" font-weight="700">${v}</text>`;svg+='</g>';return svg;}
    _compassRose(cx,cy){const s=22;let v=`<g transform="translate(${cx},${cy})"><circle r="${s}" fill="rgba(244,228,193,0.6)" stroke="#8B6914" stroke-width="1.2"/><circle r="${s*0.15}" fill="#8B6914"/><polygon points="0,${-s+3} -4,${-s*0.35} 4,${-s*0.35}" fill="#8B0000" stroke="#5D4037" stroke-width="0.5"/><polygon points="0,${s-3} -4,${s*0.35} 4,${s*0.35}" fill="#D4C5A0" stroke="#5D4037" stroke-width="0.5"/><text y="${-s-3}" text-anchor="middle" fill="#8B0000" font-size="8" font-weight="700" font-family="serif">N</text><text y="${s+9}" text-anchor="middle" fill="#5D4037" font-size="7" font-weight="600" font-family="serif">S</text></g>`;return v;}

    // ================================================================
    //  TOUCH / MOUSE
    // ================================================================
    _touchStart(e){if(e.touches.length===2){e.preventDefault();this._pinch=this._pinchDist(e);this._pan=null;this._longPress=null;return;}if(e.touches.length===1){const t=e.touches[0],pt=this._svgPt(t),hitId=this._hitTest(pt);this._touchInfo={x:t.clientX,y:t.clientY,time:Date.now(),nodeId:hitId,pt};this._wasDrag=false;if(hitId&&!this._movingNodeId){e.preventDefault();this._longPress=setTimeout(()=>{this._movingNodeId=hitId;const loc=this.lm.locations.find(l=>l.id===hitId);if(loc&&this.onMoveRequest)this.onMoveRequest(hitId,loc.name);this._longPress=null;},500);}else if(this._movingNodeId){e.preventDefault();const loc=this.lm.locations.find(l=>l.id===this._movingNodeId);if(loc){loc.x=Math.round(pt.x);loc.y=Math.round(pt.y);loc._manualXY=true;this.lm.updateLocation(loc.id,{x:loc.x,y:loc.y,_manualXY:true});this._vbManual=true;this._skipLayout=true;this.render();}this._movingNodeId=null;}else{this._pan={sx:t.clientX,sy:t.clientY,vx:this.vb.x,vy:this.vb.y};}}}
    _touchMove(e){if(e.touches.length===2&&this._pinch){e.preventDefault();const d=this._pinchDist(e),s=this._pinch/d;const cxv=this.vb.x+this.vb.w/2,cyv=this.vb.y+this.vb.h/2;const nw=Math.max(200,Math.min(1200,this.vb.w*s));const nh=nw*(this.vb.h/this.vb.w);this.vb={x:cxv-nw/2,y:cyv-nh/2,w:nw,h:nh};this._applyVB();this._pinch=d;return;}if(e.touches.length===1){const t=e.touches[0];if(this._longPress&&this._touchInfo){if(Math.abs(t.clientX-this._touchInfo.x)>10||Math.abs(t.clientY-this._touchInfo.y)>10){clearTimeout(this._longPress);this._longPress=null;}}if(this._pan){e.preventDefault();const dx=(t.clientX-this._pan.sx)*(this.vb.w/this.svg.getBoundingClientRect().width);const dy=(t.clientY-this._pan.sy)*(this.vb.h/this.svg.getBoundingClientRect().height);this.vb.x=this._pan.vx-dx;this.vb.y=this._pan.vy-dy;this._applyVB();this._wasDrag=true;}}}
    _touchEnd(){clearTimeout(this._longPress);this._longPress=null;if(this._touchInfo&&!this._wasDrag&&this._touchInfo.nodeId&&!this._movingNodeId){if(Date.now()-this._touchInfo.time<400)this.onLocationClick?.(this._touchInfo.nodeId);}this._pinch=null;this._pan=null;this._touchInfo=null;}
    _onDown(e){const pt=this._svgPt(e),hitId=this._hitTest(pt);this._wasDrag=false;if(this._movingNodeId){e.preventDefault();const loc=this.lm.locations.find(l=>l.id===this._movingNodeId);if(loc){loc.x=Math.round(pt.x);loc.y=Math.round(pt.y);loc._manualXY=true;this.lm.updateLocation(loc.id,{x:loc.x,y:loc.y,_manualXY:true});this._vbManual=true;this._skipLayout=true;this.render();}this._movingNodeId=null;return;}if(hitId){e.preventDefault();this._mouseClickId=hitId;}if(!hitId){this._pan={sx:e.clientX,sy:e.clientY,vx:this.vb.x,vy:this.vb.y};}}
    _onMove(e){if(this._pan){const dx=(e.clientX-this._pan.sx)*(this.vb.w/this.svg.getBoundingClientRect().width);const dy=(e.clientY-this._pan.sy)*(this.vb.h/this.svg.getBoundingClientRect().height);this.vb.x=this._pan.vx-dx;this.vb.y=this._pan.vy-dy;this._applyVB();this._wasDrag=true;this._mouseClickId=null;}}
    _onUp(){this._pan=null;if(this._mouseClickId&&!this._wasDrag)this.onLocationClick?.(this._mouseClickId);this._mouseClickId=null;}
    _zoom(f,e){const r=this.svg.getBoundingClientRect();const mx=(e.clientX-r.left)/r.width,my=(e.clientY-r.top)/r.height;const nw=Math.max(200,Math.min(1200,this.vb.w*f));const nh=nw*(this.vb.h/this.vb.w);this.vb.x+=(this.vb.w-nw)*mx;this.vb.y+=(this.vb.h-nh)*my;this.vb.w=nw;this.vb.h=nh;this._applyVB();}
    _el(tag,attrs,text){const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs||{}))el.setAttribute(k,v);if(text!==undefined)el.textContent=text;return el;}
    _svgPt(e){const r=this.svg.getBoundingClientRect();return{x:this.vb.x+(e.clientX-r.left)/r.width*this.vb.w,y:this.vb.y+(e.clientY-r.top)/r.height*this.vb.h};}
    _hitTest(pt){for(const l of this.lm.locations){const dx=pt.x-l.x,dy=pt.y-l.y;if(Math.sqrt(dx*dx+dy*dy)<30)return l.id;}return null;}
    _pinchDist(e){const a=e.touches[0],b=e.touches[1];return Math.sqrt((a.clientX-b.clientX)**2+(a.clientY-b.clientY)**2);}
}
