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

        // ★ 여러 경로에서 API 키 탐색
        // Google (Gemini)
        const gKey = oai?.api_key_makersuite
            || window.api_key_makersuite
            || document.getElementById('api_key_makersuite')?.value
            || '';
        const gModel = oai?.google_model
            || window.google_model
            || document.getElementById('model_google_select')?.value
            || 'gemini-2.0-flash';

        // OpenAI
        const oKey = oai?.api_key_openai
            || window.api_key_openai
            || document.getElementById('api_key_openai')?.value
            || '';

        // OpenRouter
        const orKey = oai?.api_key_openrouter
            || window.api_key_openrouter
            || document.getElementById('api_key_openrouter')?.value
            || '';

        dbg('🔧 LLM keys found:', {
            google: gKey ? '✅ (' + gKey.substring(0, 8) + '...)' : '❌',
            openai: oKey ? '✅' : '❌',
            openrouter: orKey ? '✅' : '❌',
            gModel,
        });

        // Google 우선 (유저가 Gemini 사용)
        if (gKey && (chatCompletion === 'makersuite' || mainApi === 'openai')) {
            type = 'google'; key = gKey; model = gModel;
        }
        // 명시적 Google 체크 (chatCompletion 없어도)
        else if (gKey) {
            type = 'google'; key = gKey; model = gModel;
        }
        // OpenAI
        else if (oKey && (chatCompletion === 'openai' || !chatCompletion)) {
            type = 'openai'; key = oKey;
            model = oai?.openai_model || 'gpt-4o-mini';
            url = oai?.openai_reverse_proxy || 'https://api.openai.com/v1';
        }
        // OpenRouter
        else if (orKey) {
            type = 'openai'; key = orKey;
            model = oai?.openrouter_model || '';
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
            generationConfig: { temperature: 0.7, maxOutputTokens: 2000, responseMimeType: 'application/json' },
        });
        if (res.ok) {
            const data = await res.json();
            dbg('🔧 Google raw:', JSON.stringify(data).substring(0, 300));
            const parts = data?.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
                if (part.text && part.text.includes('{')) {
                    dbg(`🔧 Google OK (JSON mode, part ${parts.indexOf(part)}, ${part.text.length}c)`);
                    return part.text;
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
            generationConfig: { temperature: 0.7, maxOutputTokens: 2000 },
        });
        if (!res2.ok) throw new Error(`Google API ${res2.status}: ${res2.statusText}`);
        const data2 = await res2.json();
        const parts2 = data2?.candidates?.[0]?.content?.parts || [];
        for (const part of parts2) {
            if (part.text && part.text.includes('{')) {
                dbg(`🔧 Google API OK (fallback, ${part.text.length}c)`);
                return part.text;
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
            max_tokens: 2000,
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
            max_tokens: 2000,
        }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${res.statusText}`);
    const data = await res.json();
    return data?.content?.[0]?.text || '';
}

// ========== 메인 호출 함수 ==========
export async function callLLM(prompt) {
    // ★ 방법 1: 직접 API 호출 (확장 설정 키 또는 ST 변수)
    const cfg = _getApiConfig();
    if (cfg) {
        try {
            let result = '';
            if (cfg.type === 'google') result = await _callGoogle(cfg.key, cfg.model, prompt);
            else if (cfg.type === 'openai') result = await _callOpenAI(cfg.key, cfg.model, prompt, cfg.url);
            else if (cfg.type === 'claude') result = await _callClaude(cfg.key, cfg.model, prompt, cfg.url);

            if (result) {
                dbg(`🔧 LLM direct OK (${result.length}c)`);
                return result;
            }
        } catch(e) {
            dbg('⚠️ LLM direct failed:', e.message);
        }
    }

    // ★ 방법 2: Fallback — generateQuietPrompt (본체 모델, 컨텍스트 포함)
    // ⚠️ 주의: RP 컨텍스트 포함되므로 JSON 응답이 아니면 거부!
    try {
        const ctx = getContext();
        const gen = ctx?.generateQuietPrompt;
        if (gen) {
            const { runWithoutAutoDetect } = await import('./index.js');
            const result = await runWithoutAutoDetect(() => gen({ prompt }), 2500);
            if (result) {
                // ★ JSON 검증 — RP 이어쓰기 거부
                if (result.includes('{') && result.includes('}')) {
                    dbg('🔧 LLM fallback (generateQuietPrompt) OK');
                    return result;
                } else {
                    dbg('⚠️ LLM fallback returned non-JSON (RP continuation?), rejecting');
                    return null;
                }
            }
        }
    } catch(e) {
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
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); }
    catch(e) {
        dbg('⚠️ JSON parse fail:', e.message, '\nRaw:', match[0].substring(0, 200));
        return null;
    }
}
