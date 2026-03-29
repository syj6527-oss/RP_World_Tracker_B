// 🐶 World Tracker — map-renderer.js (v0.3.0-beta hotfix7)
// v4 아키텍처: 고정 월드(3000×2400) + 카메라(ViewBox) 분리
// 디자인: 도로 중심 생성 → 블록 채우기, rect+rx+rotate, snapToRoad

const WORLD_W = 3000, WORLD_H = 2400;
const WORLD_CX = 1500, WORLD_CY = 1200;

export class MapRenderer {
    constructor(container, lm) {
        this.container = container; this.lm = lm;
        this.svg = null; this._wasDrag = false; this._movingNodeId = null;
        this.onLocationClick = null; this.onMoveRequest = null;
        this.vb = { x: WORLD_CX - 250, y: WORLD_CY - 250, w: 500, h: 500 };
        this._pinch = null; this._pan = null;
        this._cityBgEl = null;  // 고정 월드 (1회 생성)
        this._roadPts = [];     // 도로 교차점 (snapToRoad용)
        this._init();
    }
    _srand(s){return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};}
    _hashStr(s){let h=0;for(let i=0;i<s.length;i++){h=((h<<5)-h+s.charCodeAt(i))|0;}return Math.abs(h);}

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

    // 🔄 재생성 전용 (배경 무효화)
    invalidateCity() { this._cityBgEl = null; this._roadPts = []; }

    // 핀 클릭 → ViewBox만 이동 (배경 재생성 ❌)
    recenterOn(locId) {
        const loc = this.lm.locations.find(l => l.id === locId);
        if (!loc) return;
        this.vb.x = loc.x - this.vb.w / 2;
        this.vb.y = loc.y - this.vb.h / 2;
        this._vbManual = true;
        this.render();
    }

    // ================================================================
    //  RENDER (카메라 = ViewBox, 배경은 고정 월드)
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
            <filter id="wt-bsh"><feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#000" flood-opacity="0.12"/></filter>
        </defs>`;

        const { locations, movements, currentLocationId } = this.lm;

        // ① 고정 월드 배경 (최초 1회만 생성)
        if (!this._cityBgEl) {
            const chatId = this.lm.currentChatId || 'default';
            const seed = this._hashStr(chatId) % 10000 + 1;
            this._buildCity(seed);
        }
        if (this._cityBgEl) this.svg.appendChild(this._cityBgEl.cloneNode(true));

        // ② 레이아웃 (필요 시만)
        if (locations.length >= 2) this._autoLayout();

        // ③ 카메라(ViewBox) — curLoc의 실제 월드 좌표로 팬
        const cW = this.container?.offsetWidth || 360;
        const cH = this.container?.offsetHeight || 480;
        const aspect = cW / cH;
        const vbW = 500, vbH = Math.round(vbW / aspect);

        if (!this._vbManual) {
            const curLoc = locations.find(l => l.id === currentLocationId) || locations[0];
            const cx = curLoc?.x || WORLD_CX;
            const cy = curLoc?.y || WORLD_CY;
            this.vb = { x: cx - vbW / 2, y: cy - vbH / 2, w: vbW, h: vbH };
        } else {
            this.vb.w = vbW; this.vb.h = vbH;
            this._vbManual = false;
        }
        this._applyVB();

        // ④ 핀/라인/나침반
        this._drawDistLines(locations, movements, currentLocationId);
        this._drawPins(locations, currentLocationId);
        this._drawCompass(this.vb);

        if (!locations.length) {
            this.svg.appendChild(this._el('text', { x: WORLD_CX, y: WORLD_CY, class: 'wt-empty-text' }, 'RP를 시작해보세요! 🐶'));
        }
    }

    // ================================================================
    //  고정 월드 생성 (도로 중심 → 블록 채우기)
    // ================================================================
    _buildCity(seed) {
        const rng = this._srand(seed * 31337);
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('id', 'wt-city-bg');

        // ① 배경 = 도로 색
        g.appendChild(this._el('rect', { x: -200, y: -200, width: WORLD_W + 400, height: WORLD_H + 400, fill: '#F4F1EA' }));

        // ② 도로 격자 정의 (위치 약간 비틀기)
        const cols = 5, rows = 5;
        const xR = [0], yR = [0];
        for (let c = 1; c < cols; c++) xR.push(c * (WORLD_W / cols) + (rng() - 0.5) * 30);
        xR.push(WORLD_W);
        for (let r = 1; r < rows; r++) yR.push(r * (WORLD_H / rows) + (rng() - 0.5) * 30);
        yR.push(WORLD_H);

        // 도로 교차점 저장 (snapToRoad용)
        this._roadPts = [];
        for (const x of xR) for (const y of yR) this._roadPts.push({ x, y });

        // ③ 강 계산 (블록 전에)
        const hasRiver = seed % 3 !== 0;
        const riverRow = 1 + (seed % (rows - 2));
        const riverCY = yR[riverRow] || WORLD_CY;
        const riverH = 26;

        // 공원 셀
        const parkSet = new Set();
        parkSet.add(`${2 + (seed % 2)}_${1 + (seed % 3)}`);
        if (seed % 4 === 0) parkSet.add(`${1}_${3}`);

        // ④ 블록 채우기 (도로 사이 공간)
        const roadW = 10; // 도로 폭 (gap)
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x1 = xR[c], x2 = xR[c + 1];
                const y1 = yR[r], y2 = yR[r + 1];
                const bx = x1 + roadW, by = y1 + roadW;
                const bw = (x2 - x1) - roadW * 2;
                const bh = (y2 - y1) - roadW * 2;
                if (bw < 40 || bh < 40) continue;

                // 강 겹침 → 분할
                const rTop = riverCY - riverH / 2 - 8;
                const rBot = riverCY + riverH / 2 + 8;
                if (hasRiver && by < rBot && by + bh > rTop) {
                    const aboveH = rTop - by;
                    const belowY = rBot;
                    const belowH = (by + bh) - rBot;
                    if (aboveH > 40) this._drawBlock(g, bx, by, bw, aboveH, rng);
                    if (belowH > 40) this._drawBlock(g, bx, belowY, bw, belowH, rng);
                    continue;
                }

                if (parkSet.has(`${r}_${c}`)) {
                    this._drawPark(g, bx, by, bw, bh, rng);
                } else {
                    this._drawBlock(g, bx, by, bw, bh, rng);
                }
            }
        }

        // ⑤ 메인 도로 강조 (가운데 라인)
        const mainX = xR[Math.floor(cols / 2)];
        const mainY = yR[Math.floor(rows / 2)];
        g.appendChild(this._el('line', { x1: mainX, y1: 0, x2: mainX, y2: WORLD_H, stroke: '#EBE6DC', 'stroke-width': 4, opacity: 0.35 }));
        g.appendChild(this._el('line', { x1: 0, y1: mainY, x2: WORLD_W, y2: mainY, stroke: '#EBE6DC', 'stroke-width': 4, opacity: 0.35 }));

        // ⑥ 대각선 도로 1개 (포인트)
        const dIdx = 1 + (seed % 2);
        g.appendChild(this._el('line', {
            x1: xR[dIdx], y1: yR[dIdx], x2: xR[dIdx + 2], y2: yR[dIdx + 2],
            stroke: '#EDE8DE', 'stroke-width': 10, 'stroke-linecap': 'round', opacity: 0.45,
        }));

        // ⑦ 강 (S자 bezier, 3중 레이어)
        if (hasRiver) {
            const ry = riverCY;
            const w1 = (rng() - 0.5) * 50, w2 = (rng() - 0.5) * 50;
            const rPath = `M-50,${ry + w1} C${WORLD_W * 0.2},${ry + w1 + 40} ${WORLD_W * 0.45},${ry + w2 - 35} ${WORLD_W * 0.65},${ry + w1 + 20} S${WORLD_W * 0.85},${ry + w2 - 20} ${WORLD_W + 50},${ry + w2}`;
            g.appendChild(this._el('path', { d: rPath, fill: 'none', stroke: '#8EC5E8', 'stroke-width': riverH, 'stroke-linecap': 'round', opacity: '0.55' }));
            g.appendChild(this._el('path', { d: rPath, fill: 'none', stroke: '#B0DAF0', 'stroke-width': riverH * 0.3, 'stroke-linecap': 'round', opacity: '0.4' }));
            // 물결
            const rPath2 = `M-50,${ry + w1 + 6} C${WORLD_W * 0.2},${ry + w1 + 46} ${WORLD_W * 0.45},${ry + w2 - 29} ${WORLD_W * 0.65},${ry + w1 + 26} S${WORLD_W * 0.85},${ry + w2 - 14} ${WORLD_W + 50},${ry + w2 + 6}`;
            g.appendChild(this._el('path', { d: rPath2, fill: 'none', stroke: '#D0E8F6', 'stroke-width': 1.5, 'stroke-linecap': 'round', opacity: '0.3' }));
        }

        this._cityBgEl = g;
    }

    // ========== 블록 (rect + rx + rotate) ==========
    _drawBlock(parent, x, y, w, h, rng) {
        const rot = (rng() - 0.5) * 5;     // ±2.5deg
        const rx = 6 + Math.floor(rng() * 6);
        const ox = (rng() - 0.5) * 8;      // ±4px
        const oy = (rng() - 0.5) * 8;
        const tones = ['#DCD6C8', '#E0DAD0', '#D8D2C6', '#E4DED4', '#DDD7CB'];
        const fill = tones[Math.floor(rng() * tones.length)];
        const cx = x + w / 2 + ox, cy = y + h / 2 + oy;

        parent.appendChild(this._el('rect', {
            x: x + ox, y: y + oy, width: w, height: h, rx,
            fill, stroke: '#D0C8BA', 'stroke-width': '0.4',
            transform: `rotate(${rot.toFixed(1)}, ${cx.toFixed(0)}, ${cy.toFixed(0)})`,
            filter: 'url(#wt-bsh)',
        }));

        // 건물
        if (rng() < 0.85 && w > 80 && h > 60) {
            this._drawBuildings(parent, x + ox, y + oy, w, h, rot, cx, cy, rng);
        }
    }

    // ========== 건물 (블록 rotate에 맞춤) ==========
    _drawBuildings(parent, bx, by, bw, bh, rot, rcx, rcy, rng) {
        const margin = 0.12, gap = 8;
        const max = 2 + Math.floor(rng() * 3);
        const placed = [];
        const tones = ['#C8C0B2', '#C2BAA8', '#CABFA8', '#BEB6A4', '#D0C8BA'];

        for (let att = 0; att < max * 6; att++) {
            if (placed.length >= max) break;
            const sr = rng();
            let w, h;
            if (sr < 0.3) { w = bw * (0.22 + rng() * 0.12); h = bh * (0.14 + rng() * 0.08); }
            else if (sr < 0.55) { w = bw * (0.08 + rng() * 0.07); h = bh * (0.20 + rng() * 0.12); }
            else if (sr < 0.8) { w = bw * (0.14 + rng() * 0.08); h = bh * (0.10 + rng() * 0.07); }
            else { w = bw * (0.16 + rng() * 0.06); h = bh * (0.16 + rng() * 0.06); }
            const xMin = bx + bw * margin, yMin = by + bh * margin;
            const xR = bw * (1 - margin * 2) - w, yR = bh * (1 - margin * 2) - h;
            if (xR < 0 || yR < 0) continue;
            const x = xMin + rng() * xR, y = yMin + rng() * yR;
            if (placed.some(p => x < p.x + p.w + gap && x + w + gap > p.x && y < p.y + p.h + gap && y + h + gap > p.y)) continue;
            placed.push({ x, y, w, h });
            parent.appendChild(this._el('rect', {
                x, y, width: w, height: h, rx: 1.5,
                fill: tones[Math.floor(rng() * tones.length)],
                opacity: 0.35 + rng() * 0.12,
                transform: `rotate(${rot.toFixed(1)}, ${rcx.toFixed(0)}, ${rcy.toFixed(0)})`,
            }));
        }
    }

    // ========== 공원 (ellipse blob) ==========
    _drawPark(parent, x, y, w, h, rng) {
        const rot = (rng() - 0.5) * 6;
        const cx = x + w / 2, cy = y + h / 2;
        parent.appendChild(this._el('ellipse', {
            cx, cy, rx: w / 2 - 4, ry: h / 2 - 4,
            fill: '#B7D7A8', opacity: '0.75',
            transform: `rotate(${rot.toFixed(1)}, ${cx.toFixed(0)}, ${cy.toFixed(0)})`,
        }));
        // 연못
        if (rng() < 0.6 && w > 80) {
            parent.appendChild(this._el('ellipse', {
                cx: cx + (rng() - 0.5) * w * 0.3, cy: cy + (rng() - 0.5) * h * 0.3,
                rx: Math.min(w, h) * 0.10, ry: Math.min(w, h) * 0.07,
                fill: '#8EBFB0', opacity: '0.40',
            }));
        }
        // 나무
        const tc = 3 + Math.floor(rng() * 5);
        for (let i = 0; i < tc; i++) {
            parent.appendChild(this._el('circle', {
                cx: x + w * (0.1 + rng() * 0.8), cy: y + h * (0.1 + rng() * 0.8),
                r: 3 + rng() * 5, fill: '#9CCF95', opacity: 0.25 + rng() * 0.15,
            }));
        }
    }

    // ========== snapToRoad (핀 → 도로 교차점 스냅) ==========
    _snapToRoad(x, y) {
        if (!this._roadPts.length) return { x, y };
        let minD = Infinity, closest = { x, y };
        for (const p of this._roadPts) {
            const d = (x - p.x) ** 2 + (y - p.y) ** 2;
            if (d < minD) { minD = d; closest = { x: p.x, y: p.y }; }
        }
        // 교차점에서 살짝 오프셋 (도로 위 말고 도로 옆)
        return { x: closest.x + 20, y: closest.y + 15 };
    }

    // ================================================================
    //  거리 점선 + pill (15분 완전 배제)
    // ================================================================
    _drawDistLines(locations, movements, curId) {
        // 숨길 핀 ID (level > 6)
        const hiddenIds = new Set();
        for (const d of (this.lm.distances || [])) {
            if ((d.level || 5) > 6) {
                if (d.fromId === curId) hiddenIds.add(d.toId);
                if (d.toId === curId) hiddenIds.add(d.fromId);
            }
        }

        const drawn = new Set();
        for (const d of (this.lm.distances || [])) {
            const f = locations.find(l => l.id === d.fromId), t = locations.find(l => l.id === d.toId);
            if (!f || !t) continue;
            if (hiddenIds.has(d.fromId) || hiddenIds.has(d.toId)) continue;
            const k = [d.fromId, d.toId].sort().join('-');
            if (drawn.has(k)) continue; drawn.add(k);
            const lvl = d.level || 5;
            this.svg.appendChild(this._el('line', { x1: f.x, y1: f.y, x2: t.x, y2: t.y, stroke: '#C0B8A8', 'stroke-width': lvl <= 3 ? 2 : 1.5, 'stroke-dasharray': '5 3', 'stroke-linecap': 'round', opacity: 0.3 }));
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
            if (hiddenIds.has(m.fromId) || hiddenIds.has(m.toId)) continue;
            const k = [m.fromId, m.toId].sort().join('-');
            if (drawn.has(k)) continue; drawn.add(k);
            this.svg.appendChild(this._el('line', { x1: f.x, y1: f.y, x2: t.x, y2: t.y, stroke: '#C0B8A8', 'stroke-width': 1.5, 'stroke-dasharray': '5 3', 'stroke-linecap': 'round', opacity: 0.2 }));
        }
    }

    // ================================================================
    //  핀 (level > 6 완전 숨김)
    // ================================================================
    _drawPins(locations, currentLocationId) {
        const curLoc = locations.find(l => l.id === currentLocationId);
        for (const loc of locations) {
            const cur = loc.id === currentLocationId;
            const ps = this._pinStyle(loc.name);

            // 15분 밖 완전 숨김
            if (!cur && curLoc) {
                const d = (this.lm.distances || []).find(d =>
                    (d.fromId === currentLocationId && d.toId === loc.id) ||
                    (d.toId === currentLocationId && d.fromId === loc.id)
                );
                if (d && (d.level || 5) > 6) continue;
            }

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
            if (loc.visitCount > 0) { const bx2 = sz * 0.5, by2 = -(ph + sz * 0.3); const bdg = this._el('g', { transform: `translate(${bx2},${by2})` }); bdg.appendChild(this._el('circle', { r: 8, fill: '#fff', stroke: ps.color, 'stroke-width': 1.5 })); bdg.appendChild(this._el('text', { 'text-anchor': 'middle', y: 3.5, 'font-size': '8.5', 'font-weight': '700', fill: ps.color }, loc.visitCount)); g.appendChild(bdg); }
            const nl = loc.name.length * 6.5 + 12;
            const lg = this._el('g', { transform: 'translate(0,6)' });
            lg.appendChild(this._el('rect', { x: -nl / 2, y: -8, width: nl, height: 16, rx: 8, fill: '#fff', stroke: '#E8E4D8', 'stroke-width': 0.7, filter: 'url(#wt-sh)' }));
            lg.appendChild(this._el('text', { class: 'wt-location-label', y: 3, 'font-size': '9', 'font-weight': '600' }, loc.name));
            g.appendChild(lg);
            if (cur) { const paw = this._el('text', { 'text-anchor': 'middle', y: -(ph + sz + 5), 'font-size': '15' }, '🐾'); const pa = document.createElementNS('http://www.w3.org/2000/svg', 'animateTransform'); pa.setAttribute('attributeName', 'transform'); pa.setAttribute('type', 'translate'); pa.setAttribute('values', '0 0;0 -4;0 0'); pa.setAttribute('dur', '1.2s'); pa.setAttribute('repeatCount', 'indefinite'); paw.appendChild(pa); g.appendChild(paw); }
            this.svg.appendChild(g);
        }
    }

    // ========== 나침반 (ViewBox 좌하단 고정) ==========
    _drawCompass(vb) {
        const ccx = vb.x + 22, ccy = vb.y + vb.h - 22, s = 14;
        const cg = this._el('g', { transform: `translate(${ccx},${ccy})`, opacity: '0.45' });
        cg.appendChild(this._el('circle', { r: s, fill: 'rgba(242,238,228,0.75)', stroke: '#B0A090', 'stroke-width': 0.7 }));
        cg.appendChild(this._el('polygon', { points: `0,${-s + 3} -2.5,${-s * 0.35} 2.5,${-s * 0.35}`, fill: '#E07060', opacity: 0.7 }));
        cg.appendChild(this._el('polygon', { points: `0,${s - 3} -2.5,${s * 0.35} 2.5,${s * 0.35}`, fill: '#D0C8B8', opacity: 0.5 }));
        cg.appendChild(this._el('text', { y: -s - 2, 'text-anchor': 'middle', fill: '#E07060', 'font-size': '5', 'font-weight': '700' }, 'N'));
        this.svg.appendChild(cg);
    }

    // ================================================================
    //  AUTO LAYOUT (curLoc 강제 중심 ❌, level>6 배제)
    // ================================================================
    _autoLayout() {
        const locs = this.lm.locations, dists = this.lm.distances || [];
        if (locs.length < 2) return;
        if (this._skipLayout) { this._skipLayout = false; return; }
        const needsInit = locs.some(l => l.x === 0 && l.y === 0);
        if (!needsInit && !this._layoutDirty && this._layoutDone === true) return;
        this._layoutDirty = false; this._layoutDone = true;

        const curId = this.lm.currentLocationId;
        const curLoc = locs.find(l => l.id === curId) || locs[0];

        // curLoc이 좌표 없으면 월드 중심 배치
        if (curLoc.x === 0 && curLoc.y === 0) {
            const snapped = this._snapToRoad(WORLD_CX, WORLD_CY);
            curLoc.x = snapped.x; curLoc.y = snapped.y;
        }

        // level > 6 핀 제외한 근거리 핀만 레이아웃
        const nearLocs = locs.filter(l => {
            if (l.id === curLoc.id || l._manualXY) return true;
            const d = dists.find(dd =>
                (dd.fromId === curLoc.id && dd.toId === l.id) ||
                (dd.toId === curLoc.id && dd.fromId === l.id)
            );
            return !d || (d.level || 5) <= 6;
        });

        const levelToPx = { 1: 50, 2: 70, 3: 90, 4: 115, 5: 140, 6: 170 };

        // 좌표 없는 핀만 배치 (curLoc 기준 상대 위치)
        const others = nearLocs.filter(l => l.id !== curLoc.id && !l._manualXY && (l.x === 0 && l.y === 0));
        const angleStep = (2 * Math.PI) / Math.max(others.length, 1);
        let angle = ((locs.length * 37 + 11) % 360) * Math.PI / 180;

        for (const loc of others) {
            const dist = dists.find(d =>
                (d.fromId === curLoc.id && d.toId === loc.id) ||
                (d.toId === curLoc.id && d.fromId === loc.id)
            );
            const px = levelToPx[dist?.level || 5] || 140;
            const rawX = curLoc.x + px * Math.cos(angle);
            const rawY = curLoc.y + px * Math.sin(angle);
            const snapped = this._snapToRoad(rawX, rawY);
            loc.x = Math.round(snapped.x);
            loc.y = Math.round(snapped.y);
            angle += angleStep;
        }

        // 겹침 방지 (_manualXY 보존)
        for (let iter = 0; iter < 3; iter++) {
            for (let i = 0; i < nearLocs.length; i++) for (let j = i + 1; j < nearLocs.length; j++) {
                const a = nearLocs[i], b = nearLocs[j];
                const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy);
                if (d < 70) {
                    const push = (70 - d) / 2, nx = dx / (d || 1), ny = dy / (d || 1);
                    if (a.id !== curLoc.id && !a._manualXY) { a.x -= Math.round(push * nx); a.y -= Math.round(push * ny); }
                    if (b.id !== curLoc.id && !b._manualXY) { b.x += Math.round(push * nx); b.y += Math.round(push * ny); }
                }
            }
        }

        for (const loc of nearLocs) this.lm.updateLocation(loc.id, { x: loc.x, y: loc.y });
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
    //  TOUCH / MOUSE (기존 유지)
    // ================================================================
    _touchStart(e){if(e.touches.length===2){e.preventDefault();this._pinch=this._pinchDist(e);this._pan=null;this._longPress=null;return;}if(e.touches.length===1){const t=e.touches[0],pt=this._svgPt(t),hitId=this._hitTest(pt);this._touchInfo={x:t.clientX,y:t.clientY,time:Date.now(),nodeId:hitId,pt};this._wasDrag=false;if(hitId&&!this._movingNodeId){e.preventDefault();this._longPress=setTimeout(()=>{this._movingNodeId=hitId;const loc=this.lm.locations.find(l=>l.id===hitId);if(loc&&this.onMoveRequest)this.onMoveRequest(hitId,loc.name);this._longPress=null;},500);}else if(this._movingNodeId){e.preventDefault();const loc=this.lm.locations.find(l=>l.id===this._movingNodeId);if(loc){loc.x=Math.round(pt.x);loc.y=Math.round(pt.y);loc._manualXY=true;this.lm.updateLocation(loc.id,{x:loc.x,y:loc.y,_manualXY:true});this._vbManual=true;this._skipLayout=true;this.render();}this._movingNodeId=null;}else{this._pan={sx:t.clientX,sy:t.clientY,vx:this.vb.x,vy:this.vb.y};}}}
    _touchMove(e){if(e.touches.length===2&&this._pinch){e.preventDefault();const d=this._pinchDist(e),s=this._pinch/d;const cxv=this.vb.x+this.vb.w/2,cyv=this.vb.y+this.vb.h/2;const nw=Math.max(200,Math.min(3000,this.vb.w*s));const nh=nw*(this.vb.h/this.vb.w);this.vb={x:cxv-nw/2,y:cyv-nh/2,w:nw,h:nh};this._applyVB();this._pinch=d;return;}if(e.touches.length===1){const t=e.touches[0];if(this._longPress&&this._touchInfo){if(Math.abs(t.clientX-this._touchInfo.x)>10||Math.abs(t.clientY-this._touchInfo.y)>10){clearTimeout(this._longPress);this._longPress=null;}}if(this._pan){e.preventDefault();const dx=(t.clientX-this._pan.sx)*(this.vb.w/this.svg.getBoundingClientRect().width);const dy=(t.clientY-this._pan.sy)*(this.vb.h/this.svg.getBoundingClientRect().height);this.vb.x=this._pan.vx-dx;this.vb.y=this._pan.vy-dy;this._applyVB();this._wasDrag=true;}}}
    _touchEnd(){clearTimeout(this._longPress);this._longPress=null;if(this._touchInfo&&!this._wasDrag&&this._touchInfo.nodeId&&!this._movingNodeId){if(Date.now()-this._touchInfo.time<400)this.onLocationClick?.(this._touchInfo.nodeId);}this._pinch=null;this._pan=null;this._touchInfo=null;}
    _onDown(e){const pt=this._svgPt(e),hitId=this._hitTest(pt);this._wasDrag=false;if(this._movingNodeId){e.preventDefault();const loc=this.lm.locations.find(l=>l.id===this._movingNodeId);if(loc){loc.x=Math.round(pt.x);loc.y=Math.round(pt.y);loc._manualXY=true;this.lm.updateLocation(loc.id,{x:loc.x,y:loc.y,_manualXY:true});this._vbManual=true;this._skipLayout=true;this.render();}this._movingNodeId=null;return;}if(hitId){e.preventDefault();this._mouseClickId=hitId;}if(!hitId){this._pan={sx:e.clientX,sy:e.clientY,vx:this.vb.x,vy:this.vb.y};}}
    _onMove(e){if(this._pan){const dx=(e.clientX-this._pan.sx)*(this.vb.w/this.svg.getBoundingClientRect().width);const dy=(e.clientY-this._pan.sy)*(this.vb.h/this.svg.getBoundingClientRect().height);this.vb.x=this._pan.vx-dx;this.vb.y=this._pan.vy-dy;this._applyVB();this._wasDrag=true;this._mouseClickId=null;}}
    _onUp(){this._pan=null;if(this._mouseClickId&&!this._wasDrag)this.onLocationClick?.(this._mouseClickId);this._mouseClickId=null;}
    _zoom(f,e){const r=this.svg.getBoundingClientRect();const mx=(e.clientX-r.left)/r.width,my=(e.clientY-r.top)/r.height;const nw=Math.max(200,Math.min(3000,this.vb.w*f));const nh=nw*(this.vb.h/this.vb.w);this.vb.x+=(this.vb.w-nw)*mx;this.vb.y+=(this.vb.h-nh)*my;this.vb.w=nw;this.vb.h=nh;this._applyVB();}
    _el(tag,attrs,text){const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs||{}))el.setAttribute(k,v);if(text!==undefined)el.textContent=text;return el;}
    _svgPt(e){const r=this.svg.getBoundingClientRect();return{x:this.vb.x+(e.clientX-r.left)/r.width*this.vb.w,y:this.vb.y+(e.clientY-r.top)/r.height*this.vb.h};}
    _hitTest(pt){for(const l of this.lm.locations){const dx=pt.x-l.x,dy=pt.y-l.y;if(Math.sqrt(dx*dx+dy*dy)<30)return l.id;}return null;}
    _pinchDist(e){const a=e.touches[0],b=e.touches[1];return Math.sqrt((a.clientX-b.clientX)**2+(a.clientY-b.clientY)**2);}
}
