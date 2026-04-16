// 🐶 World Tracker — llm-helper.js (Direct LLM Call)
// generateQuietPrompt 우회 — 채팅 컨텍스트 없이 직접 API 호출

import { getContext, extension_settings } from '../../../extensions.js';
import { EXTENSION_NAME } from './index.js';

const dbg = (...a) => console.log(`[${EXTENSION_NAME}]`, ...a);

// ========== ST API 설정 읽기 ==========
function _getApiConfig() {
    try {
        // ★ 1순위: 우리 확장 설정에 저장된 API 키
        const s = extension_settings?.[EXTENSION_NAME];
        if (s?.llmApiKey) {
            const provider = s.llmProvider || 'google';
            const model = s.llmModel || (provider === 'google' ? 'gemini-2.0-flash' : provider === 'openai' ? 'gpt-4o-mini' : '');
            let type = provider, url = null;
            if (provider === 'openrouter') { type = 'openai'; url = 'https://openrouter.ai/api/v1'; }
            else if (provider === 'openai') { url = 'https://api.openai.com/v1'; }
            dbg('🔧 LLM using extension key:', provider, model);
            return { type, key: s.llmApiKey, model, url };
        }

        let type = null, key = null, model = null, url = null;

        // ★ 여러 경로에서 API 키 탐색 (window.oai 등 안전 접근)
        const _oai = (typeof window !== 'undefined' && window.oai) || {};
        const _chatCompletion = (typeof window !== 'undefined' && window.chat_completion_source) || (typeof window !== 'undefined' && window.chatCompletion) || null;
        const _mainApi = (typeof window !== 'undefined' && window.main_api) || null;

        // Google (Gemini)
        const gKey = _oai.api_key_makersuite
            || (typeof window !== 'undefined' && window.api_key_makersuite)
            || document.getElementById('api_key_makersuite')?.value
            || '';
        const gModel = _oai.google_model
            || (typeof window !== 'undefined' && window.google_model)
            || document.getElementById('model_google_select')?.value
            || 'gemini-2.0-flash';

        // OpenAI
        const oKey = _oai.api_key_openai
            || (typeof window !== 'undefined' && window.api_key_openai)
            || document.getElementById('api_key_openai')?.value
            || '';

        // OpenRouter
        const orKey = _oai.api_key_openrouter
            || (typeof window !== 'undefined' && window.api_key_openrouter)
            || document.getElementById('api_key_openrouter')?.value
            || '';

        dbg('🔧 LLM keys found:', {
            google: gKey ? '✅ (' + gKey.substring(0, 8) + '...)' : '❌',
            openai: oKey ? '✅' : '❌',
            openrouter: orKey ? '✅' : '❌',
            gModel,
        });

        // Google 우선 (유저가 Gemini 사용)
        if (gKey && (_chatCompletion === 'makersuite' || _mainApi === 'openai')) {
            type = 'google'; key = gKey; model = gModel;
        }
        // 명시적 Google 체크 (chatCompletion 없어도)
        else if (gKey) {
            type = 'google'; key = gKey; model = gModel;
        }
        // OpenAI
        else if (oKey && (_chatCompletion === 'openai' || !_chatCompletion)) {
            type = 'openai'; key = oKey;
            model = _oai.openai_model || 'gpt-4o-mini';
            url = _oai.openai_reverse_proxy || 'https://api.openai.com/v1';
        }
        // OpenRouter
        else if (orKey) {
            type = 'openai'; key = orKey;
            model = _oai.openrouter_model || '';
            url = 'https://openrouter.ai/api/v1';
        }

        if (!type || !key) {
            dbg('⚠️ LLM: no API key found, fallback');
            return null;
        }
        dbg('🔧 LLM selected:', type, model);
        return { type, key, model, url };
    } catch(e) {
        dbg('⚠️ LLM config error:', e.message);
        return null;
    }
}

// ========== Google Gemini 직접 호출 ==========
async function _callGoogle(key, model, prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const _fetch = (body) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20000); // 20초 타임아웃
        return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal }).finally(() => clearTimeout(timer));
    };

    // ★ 1차 시도: JSON 강제 모드
    try {
        const res = await _fetch({
            systemInstruction: { parts: [{ text: 'You are a JSON-only assistant. Respond with valid JSON only.' }] },
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 4096, responseMimeType: 'application/json' },
        });
        if (res.ok) {
            const data = await res.json();
            dbg('🔧 Google raw:', JSON.stringify(data).substring(0, 300));
            const parts = data?.candidates?.[0]?.content?.parts || [];
            // ★ JSON으로 시작하는 part 우선 선택 (RP 텍스트 part 거부)
            for (const part of parts) {
                if (part.text && part.text.trim().startsWith('{')) {
                    dbg(`🔧 Google OK (JSON mode, ${part.text.length}c, starts with {)`);
                    return part.text;
                }
            }
            // JSON으로 시작하는 게 없으면 { 포함하는 걸로 fallback
            for (const part of parts) {
                if (part.text && part.text.includes('{')) {
                    const jsonStart = part.text.indexOf('{');
                    dbg(`🔧 Google OK (JSON mode, ${part.text.length}c, { at ${jsonStart})`);
                    return part.text.substring(jsonStart);
                }
            }
            dbg(`⚠️ Google JSON mode: no JSON found in ${parts.length} parts`);
        } else {
            const errBody = await res.text().catch(() => '');
            dbg(`⚠️ Google JSON mode: ${res.status} ${errBody.substring(0, 200)}`);
        }
    } catch(e) {
        dbg(`⚠️ Google JSON mode error: ${e.message}`);
    }

    // ★ 2차 시도: JSON 강제 없이
    try {
        const res2 = await _fetch({
            contents: [{ parts: [{ text: prompt + '\n\nCRITICAL: Respond with ONLY valid JSON. Start with { and end with }. No markdown, no explanation.' }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
        });
        if (!res2.ok) throw new Error(`Google API ${res2.status}: ${res2.statusText}`);
        const data2 = await res2.json();
        const parts2 = data2?.candidates?.[0]?.content?.parts || [];
        // ★ JSON으로 시작하는 part 우선
        for (const part of parts2) {
            if (part.text && part.text.trim().startsWith('{')) {
                dbg(`🔧 Google API OK (fallback, ${part.text.length}c)`);
                return part.text;
            }
        }
        for (const part of parts2) {
            if (part.text && part.text.includes('{')) {
                const jsonStart = part.text.indexOf('{');
                dbg(`🔧 Google API OK (fallback, { at ${jsonStart})`);
                return part.text.substring(jsonStart);
            }
        }
        dbg(`⚠️ Google fallback: no JSON in parts either`);
        return parts2[0]?.text || '';
    } catch(e) {
        throw new Error(`Google API both attempts failed: ${e.message}`);
    }
}

// ========== OpenAI / OpenRouter 직접 호출 ==========
async function _callOpenAI(key, model, prompt, url) {
    const endpoint = `${url}/chat/completions`;
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 4096,
        }),
    });
    if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${res.statusText}`);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || '';
}

// ========== Claude 직접 호출 ==========
async function _callClaude(key, model, prompt, url) {
    const endpoint = `${url}/messages`;
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 4096,
        }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${res.statusText}`);
    const data = await res.json();
    return data?.content?.[0]?.text || '';
}

// r27: Google API 503/과부하 때 다른 Gemini 모델로 자동 폴백
async function _callGoogleWithFallback(key, primaryModel, prompt) {
    try {
        return await _callGoogle(key, primaryModel, prompt);
    } catch(e) {
        const msg = e?.message || '';
        // 서버 과부하/타임아웃 계열 에러만 모델 폴백 시도
        if (/\b(503|429|500|502|504)\b|AbortError|timeout|overload/i.test(msg)) {
            const fallbacks = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash']
                .filter(m => m !== primaryModel);
            for (const fm of fallbacks) {
                try {
                    dbg(`🔁 ${primaryModel} 과부하 → ${fm} 시도`);
                    const r = await _callGoogle(key, fm, prompt);
                    if (r) { dbg(`✅ ${fm} 성공!`); return r; }
                } catch(e2) {
                    dbg(`⚠️ ${fm} 도 실패: ${e2.message?.substring(0, 60)}`);
                    continue;
                }
            }
            throw new Error(`Google 서버 과부하 — 모든 Gemini 모델 폴백 실패. 1~2분 후 다시 시도해주세요. (마지막: ${msg.substring(0, 80)})`);
        }
        throw e;
    }
}

// ========== 메인 호출 함수 ==========
export async function callLLM(prompt) {
    // ★ 마지막 에러 저장 (디버깅용)
    window._wtLastLLMError = null;

    // ★ 방법 1: 직접 API 호출 (확장 설정 키 또는 ST 변수)
    const cfg = _getApiConfig();
    if (cfg) {
        try {
            dbg(`🔧 LLM calling ${cfg.type} (${cfg.model}), prompt ${prompt.length}c`);
            let result = '';
            if (cfg.type === 'google') result = await _callGoogleWithFallback(cfg.key, cfg.model, prompt);
            else if (cfg.type === 'openai') result = await _callOpenAI(cfg.key, cfg.model, prompt, cfg.url);
            else if (cfg.type === 'claude') result = await _callClaude(cfg.key, cfg.model, prompt, cfg.url);

            if (result) {
                dbg(`🔧 LLM direct OK (${result.length}c)`);
                return result;
            }
            window._wtLastLLMError = 'LLM returned empty result';
            dbg('⚠️ LLM direct returned empty');
        } catch(e) {
            window._wtLastLLMError = e.message;
            dbg('⚠️ LLM direct failed:', e.message);
        }
    } else {
        window._wtLastLLMError = 'No API config (key missing?)';
    }

    // ★ 방법 2: Fallback — generateQuietPrompt (본체 모델, 컨텍스트 포함)
    try {
        const ctx = getContext();
        const gen = ctx?.generateQuietPrompt;
        if (gen) {
            const { runWithoutAutoDetect } = await import('./index.js');
            const result = await runWithoutAutoDetect(() => gen({ prompt }), 2500);
            if (result) {
                if (result.includes('{') && result.includes('}')) {
                    dbg('🔧 LLM fallback (generateQuietPrompt) OK');
                    return result;
                } else {
                    window._wtLastLLMError = 'Fallback returned non-JSON';
                    dbg('⚠️ LLM fallback returned non-JSON (RP continuation?), rejecting');
                    return null;
                }
            }
            window._wtLastLLMError = 'Fallback returned null';
        }
    } catch(e) {
        window._wtLastLLMError = 'Fallback: ' + e.message;
        dbg('⚠️ LLM fallback failed:', e.message);
    }

    return null;
}

// ========== 최근 채팅 맥락 추출 ==========
export function getRecentChatContext(maxChars = 2000) {
    try {
        const ctx = getContext();
        const chat = ctx?.chat;
        if (!Array.isArray(chat) || !chat.length) return '';
        let result = '';
        // 최근 메시지부터 역순으로 모아서 maxChars까지
        for (let i = chat.length - 1; i >= 0 && result.length < maxChars; i--) {
            const msg = chat[i];
            if (!msg?.mes) continue;
            // HTML 태그 + 메타데이터 + 코드블록 제거
            const clean = msg.mes
                .replace(/<[^>]*>/g, '')
                .replace(/```[\s\S]*?```/g, '')
                .replace(/<memo>[\s\S]*?<\/memo>/g, '')
                .trim();
            if (!clean || clean.length < 10) continue;
            const role = msg.is_user ? '👤' : '🤖';
            const line = `${role} ${clean}\n---\n`;
            result = line + result;
        }
        const trimmed = result.substring(0, maxChars).trim();
        if (trimmed) dbg(`📋 Chat context: ${trimmed.length}c from recent messages`);
        return trimmed;
    } catch(e) {
        dbg('⚠️ getRecentChatContext error:', e.message);
        return '';
    }
}

// ========== JSON 파싱 헬퍼 ==========
export function parseLLMJson(raw) {
    if (!raw) return null;
    let text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    // 마크다운 코드블록 제거
    text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
    // 트레일링 콤마 제거
    text = text.replace(/,\s*([}\]])/g, '$1');

    // ★ 1차: 완전한 JSON 매칭
    let match = text.match(/\{[\s\S]*\}/);
    if (match) {
        try { return JSON.parse(match[0]); } catch(e) { /* fall through to repair */ }
    }

    // ★ 2차: 잘린 JSON 복구 (닫는 } 없는 경우 포함)
    const startIdx = text.indexOf('{');
    if (startIdx < 0) return null;
    let json = text.substring(startIdx);

    // 잘린 문자열/값 정리
    json = json
        .replace(/,\s*$/, '')           // 끝 콤마 제거
        .replace(/"[^"]*$/g, '"')       // 잘린 문자열 닫기
        .replace(/:\s*$/, ': null');     // 잘린 값 → null

    // 열린 괄호 수만큼 닫기
    const opens = (json.match(/\[/g) || []).length - (json.match(/\]/g) || []).length;
    const braces = (json.match(/\{/g) || []).length - (json.match(/\}/g) || []).length;
    for (let i = 0; i < opens; i++) json += ']';
    for (let i = 0; i < braces; i++) json += '}';

    // 닫기 전 마지막 쉼표 정리
    json = json.replace(/,\s*([}\]])/g, '$1');

    try {
        const parsed = JSON.parse(json);
        dbg('🔧 JSON repaired successfully');
        return parsed;
    } catch(e) {
        dbg('⚠️ JSON parse fail (repair failed):', e.message, '\nRaw:', json.substring(0, 200));
        return null;
    }
}
