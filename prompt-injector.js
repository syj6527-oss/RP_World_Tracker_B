// 🐶 월드맵 — prompt-injector.js (Single Scene)

import { extension_settings } from '../../../extensions.js';
import { EXTENSION_NAME, PROMPT_KEY } from './index.js';

function getFn() {
    try { if (typeof window.setExtensionPrompt==='function') return window.setExtensionPrompt; } catch(_){}
    return null;
}

export class PromptInjector {
    constructor(lm) { this.lm = lm; }

    inject() {
        const t = this.generate(); const fn = getFn();
        try { if (fn) { fn(PROMPT_KEY, t||'', 1, 0); if (t) console.log(`[${EXTENSION_NAME}] Prompt (${t.length}c)`); } }
        catch(e) { console.warn(`[${EXTENSION_NAME}]`, e.message); }
    }
    clear() { const fn=getFn(); try{if(fn)fn(PROMPT_KEY,'',1,0)}catch(_){} }

    generate() {
        const s = extension_settings[EXTENSION_NAME];
        if (!s?.aiInjection || !this.lm.locations.length) return '';
        const cur = this.lm.locations.find(l => l.id === this.lm.currentLocationId);
        if (!cur) return '';

        const L = ['[🐶 World Tracker]'];
        L.push(`📍 Scene: ${cur.name}`);
        if (cur.status) L.push(`🌤️ ${cur.status}`);
        if (cur.visitCount > 0) L.push(`📊 ${cur.visitCount === 1 ? 'First visit' : `${cur.visitCount} visits`}`);
        if (cur.memo) L.push(`💭 ${this._mem(cur)}`);
        const last = this._last(); if (last) L.push(`🚶 ${last}`);
        const near = this._near(cur); if (near) L.push(`📌 ${near}`);
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

    _last() {
        if (!this.lm.movements.length) return null;
        const l = [...this.lm.movements].sort((a,b)=>b.timestamp-a.timestamp)[0];
        const f=this.lm.locations.find(x=>x.id===l.fromId), t=this.lm.locations.find(x=>x.id===l.toId);
        if (!f||!t) return null;
        let r=`${f.name} → ${t.name}`; if(l.distance)r+=` (${l.distance})`; return r;
    }

    _near(cur) {
        const n=[];
        for(const d of this.lm.distances||[]){
            let o=d.fromId===cur.id?d.toId:d.toId===cur.id?d.fromId:null;
            if(!o)continue; const loc=this.lm.locations.find(l=>l.id===o);
            if(loc)n.push(`${loc.name}(${d.distanceText})`);
        }
        return n.length?n.slice(0,3).join(', '):null;
    }
}
