// 🐶 World Tracker — prompt-injector.js (v0.3.0 Enhanced)

import { extension_settings, getContext } from '../../../extensions.js';
import { setExtensionPrompt } from '../../../../script.js';
import { EXTENSION_NAME, PROMPT_KEY } from './index.js';

function getFn() {
    try {
        // 방법 1: script.js에서 직접 import (최신 SillyTavern)
        if (typeof setExtensionPrompt === 'function') { console.log(`[${EXTENSION_NAME}] 🔧 getFn: found via import`); return setExtensionPrompt; }
        // 방법 2: getContext()
        const ctx = getContext();
        if (typeof ctx?.setExtensionPrompt === 'function') { console.log(`[${EXTENSION_NAME}] 🔧 getFn: found via getContext`); return ctx.setExtensionPrompt; }
        // 방법 3: window 전역 (구버전)
        if (typeof window.setExtensionPrompt === 'function') { console.log(`[${EXTENSION_NAME}] 🔧 getFn: found via window`); return window.setExtensionPrompt; }
    } catch(e) { console.warn(`[${EXTENSION_NAME}] 🔧 getFn error:`, e.message); }
    return null;
}

// 장소 타입 자동 감지
function _detectLocType(name) {
    const lo = (name || '').toLowerCase();
    if (/마트|mart|편의|convenience|가게|shop|store|grocery|supermarket/i.test(lo)) return 'shop/mart';
    if (/카페|cafe|coffee|커피/i.test(lo)) return 'cafe';
    if (/집|home|house|숙소|기숙|dorm|quarters/i.test(lo)) return 'home/quarters';
    if (/학교|school|학원|academy/i.test(lo)) return 'school';
    if (/체육|gym|운동|fitness|arena|훈련|사격|range|training/i.test(lo)) return 'training facility';
    if (/공원|park|정원|garden|광장/i.test(lo)) return 'park/outdoor';
    if (/술집|bar|pub|tavern|주점/i.test(lo)) return 'bar/pub';
    if (/식당|restaurant|음식|레스토랑/i.test(lo)) return 'restaurant';
    if (/병원|hospital|의원|clinic|medical/i.test(lo)) return 'medical';
    if (/도서|library|서점|서재/i.test(lo)) return 'library';
    if (/역|station|지하철|버스|bus/i.test(lo)) return 'transit';
    if (/성|castle|궁|palace|요새|fortress|base|막사|barracks/i.test(lo)) return 'military/base';
    if (/숲|forest|산|mountain/i.test(lo)) return 'nature';
    if (/해변|beach|바다|sea|강|river|호수|lake/i.test(lo)) return 'waterfront';
    if (/사무|office|본부|hq|headquarter/i.test(lo)) return 'office/HQ';
    if (/골목|거리|길|street|alley|road/i.test(lo)) return 'street';
    return null;
}

export class PromptInjector {
    constructor(lm) { this.lm = lm; }

    inject() {
        const t = this.generate(); const fn = getFn();
        console.log(`[${EXTENSION_NAME}] 🔧 inject(): fn=${!!fn}, text=${t ? t.length + 'c' : 'empty'}`);
        try {
            if (fn) {
                fn(PROMPT_KEY, t||'', 1, 0);
                if (t) {
                    console.log(`[${EXTENSION_NAME}] ✅ Prompt injected (${t.length}c):\n${t}`);
                    console.log(`[${EXTENSION_NAME}] 🔧 Prompt key: "${PROMPT_KEY}"`);
                }
            } else {
                console.warn(`[${EXTENSION_NAME}] ❌ setExtensionPrompt not found!`);
            }
        }
        catch(e) { console.warn(`[${EXTENSION_NAME}] inject error:`, e.message); }
    }
    clear() { const fn=getFn(); try{if(fn)fn(PROMPT_KEY,'',1,0)}catch(_){} }

    generate() {
        const s = extension_settings[EXTENSION_NAME];
        console.log(`[${EXTENSION_NAME}] 🔧 generate(): aiInjection=${s?.aiInjection}, locs=${this.lm.locations.length}, curId=${this.lm.currentLocationId}`);
        if (!s?.aiInjection || !this.lm.locations.length) return '';
        const cur = this.lm.locations.find(l => l.id === this.lm.currentLocationId);
        if (!cur) { console.log(`[${EXTENSION_NAME}] 🔧 generate(): cur not found for id=${this.lm.currentLocationId}`); return ''; }

        const L = ['[🐶 World Tracker]'];
        L.push('⚙️ Use this location data to maintain spatial consistency and reference past events naturally in your narration.');

        // 1. 장소 이름
        L.push(`📍 Scene: ${cur.name}`);

        // 2. 주소
        if (cur.address) L.push(`📍 Address: ${cur.address}`);

        // 3. 장소 타입
        const locType = _detectLocType(cur.name);
        if (locType) L.push(`🏷️ Type: ${locType}`);

        // 4. 방문 통계 + 첫 방문일
        if (cur.visitCount > 0) {
            let visitStr = cur.visitCount === 1 ? 'First visit' : `Visit #${cur.visitCount}`;
            if (cur.rpFirstVisited) visitStr += ` (since ${cur.rpFirstVisited})`;
            else if (cur.firstVisited) {
                const d = new Date(cur.firstVisited);
                visitStr += ` (since ${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()})`;
            }
            L.push(`📊 ${visitStr}`);
        }

        // 5. 상태
        if (cur.status) L.push(`🌤️ Status: ${cur.status}`);

        // 6. 메모
        if (cur.memo) L.push(`💭 ${this._mem(cur)}`);

        // 7. 특이사항 (AI 전용)
        if (cur.aiNotes) L.push(`📋 AI Notes: ${cur.aiNotes}`);

        // 8. 이벤트 (최근 5개 + 날짜)
        const evs = this._events(cur);
        if (evs) L.push(`📝 Memories at this place:\n${evs}`);

        // 9. 마지막 이동
        const last = this._last(); if (last) L.push(`🚶 Last move: ${last}`);

        // 10. 주변 장소 (주소 포함)
        const near = this._near(cur);
        if (near) L.push(`📌 Nearby:\n${near}`);

        // 11. 세계관 지역 요약
        const totalLocs = this.lm.locations.length;
        if (totalLocs > 1) {
            const region = this._guessRegion();
            if (region) L.push(`🌍 World: ${totalLocs} places around ${region}`);
        }

        L.push('[/World Tracker]');
        return L.join('\n');
    }

    _mem(loc) {
        const s = extension_settings[EXTENSION_NAME]; const m = loc.memo||'';
        if (s.memoryMode==='perfect') return m;
        if (!loc.lastVisited) return m;
        const days = (Date.now()-loc.lastVisited)/86400000;
        if (days <= (s.memorySummaryDays||7)) return m;
        return m.length > 50 ? m.substring(0,50)+'... (faded)' : m+' (faded)';
    }

    _events(loc) {
        const evs = (loc.events || []).filter(e => e.source !== 'move');
        if (!evs.length) return null;
        const s = extension_settings[EXTENSION_NAME];
        const recent = evs.slice(-5);
        return recent.map(ev => {
            const mood = ev.mood || '📝';
            let text = ev.text || ev.title || '';
            let dateStr = '';
            if (ev.rpDate) {
                dateStr = ` [${ev.rpDate}]`;
            } else if (ev.timestamp) {
                const days = Math.floor((Date.now() - ev.timestamp) / 86400000);
                if (days === 0) dateStr = ' [today]';
                else if (days === 1) dateStr = ' [yesterday]';
                else if (days < 7) dateStr = ` [${days}d ago]`;
                else dateStr = ` [${Math.floor(days/7)}w ago]`;
            }
            if (s.memoryMode !== 'perfect' && ev.timestamp) {
                const days = (Date.now() - ev.timestamp) / 86400000;
                if (days > 30) text = ev.title ? `${ev.title}... (vague memory)` : text.substring(0, 30) + '... (faded)';
                else if (days > 7) text = ev.title ? `${ev.title} — ${text.substring(0, 40)}...` : text.substring(0, 50) + '...';
            }
            return `- ${mood} ${text}${dateStr}`;
        }).join('\n');
    }

    _last() {
        if (!this.lm.movements.length) return null;
        const l = [...this.lm.movements].sort((a,b)=>b.timestamp-a.timestamp)[0];
        const f=this.lm.locations.find(x=>x.id===l.fromId), t=this.lm.locations.find(x=>x.id===l.toId);
        if (!f||!t) return null;
        let r=`${f.name} → ${t.name}`;
        if(l.distance) r+=` (${l.distance})`;
        else {
            const dist = this.lm.getDistanceBetween(f.id, t.id);
            if (dist?.distanceText) r += ` (${dist.distanceText})`;
        }
        return r;
    }

    _near(cur) {
        const n=[];
        for(const d of this.lm.distances||[]){
            let o=d.fromId===cur.id?d.toId:d.toId===cur.id?d.fromId:null;
            if(!o)continue; const loc=this.lm.locations.find(l=>l.id===o);
            if(!loc) continue;
            let entry = `- ${loc.name} (${d.distanceText || this._levelLabel(d.level)})`;
            if (loc.address) {
                const short = loc.address.split(',').slice(0, 2).join(',').trim();
                entry += ` — ${short}`;
            }
            n.push(entry);
        }
        return n.length ? n.slice(0,5).join('\n') : null;
    }

    _guessRegion() {
        const addressed = this.lm.locations.filter(l => l.address);
        if (!addressed.length) return null;
        const parts = {};
        for (const loc of addressed) {
            const chunks = loc.address.split(',').map(s => s.trim()).filter(s => s.length > 2);
            for (const chunk of chunks.slice(-2)) {
                parts[chunk] = (parts[chunk] || 0) + 1;
            }
        }
        const sorted = Object.entries(parts).sort((a, b) => b[1] - a[1]);
        if (sorted.length && sorted[0][1] >= 2) return sorted[0][0];
        if (sorted.length) return sorted[0][0];
        return null;
    }

    _levelLabel(level) {
        const labels = {1:'바로 옆',2:'매우 가까움',3:'가까움',4:'도보 5분',5:'도보권',6:'도보 15분+',7:'대중교통',8:'차량 필요',9:'먼 거리',10:'다른 지역'};
        return labels[level] || '도보권';
    }
}
