// 🐶 World Tracker — llm-helper.js (Direct LLM Call)
// generateQuietPrompt 우회 — 채팅 컨텍스트 없이 직접 API 호출

import { getContext } from '../../../extensions.js';
import { EXTENSION_NAME } from './index.js';

const dbg = (...a) => console.log(`[${EXTENSION_NAME}]`, ...a);

// ========== ST API 설정 읽기 ==========
function _getApiConfig() {
    try {
        const mainApi = window.main_api;
        const oai = window.oai_settings;
        const chatCompletion = oai?.chat_completion_source;

        dbg('🔧 LLM detect:', { mainApi, chatCompletion, hasOai: !!oai });

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
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 2000 },
        }),
    });
    if (!res.ok) throw new Error(`Google API ${res.status}: ${res.statusText}`);
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
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
    // ★ 방법 1: ST 서버 프록시 (API 키가 서버에 있으므로 가장 안정적)
    try {
        const result = await _callSTProxy(prompt);
        if (result) {
            dbg(`🔧 LLM ST-proxy OK (${result.length}c)`);
            return result;
        }
    } catch(e) {
        dbg('⚠️ LLM ST-proxy failed:', e.message);
    }

    // ★ 방법 2: 직접 API 호출 (API 키가 브라우저에 있는 경우)
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

    // ★ 방법 3: Fallback — generateQuietPrompt
    try {
        const ctx = getContext();
        const gen = ctx?.generateQuietPrompt;
        if (gen) {
            const { runWithoutAutoDetect } = await import('./index.js');
            const result = await runWithoutAutoDetect(() => gen({ prompt }), 2500);
            if (result) {
                dbg('🔧 LLM fallback (generateQuietPrompt) OK');
                return result;
            }
        }
    } catch(e) {
        dbg('⚠️ LLM fallback failed:', e.message);
    }

    return null;
}

// ========== ST 서버 프록시 호출 ==========
async function _callSTProxy(prompt) {
    // ST의 내부 generate 엔드포인트 사용 (채팅 컨텍스트 없이)
    const res = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '',
        },
        body: JSON.stringify({
            messages: [
                { role: 'system', content: 'You are a JSON data generator. Output ONLY valid JSON. Do NOT write stories, narratives, or roleplay.' },
                { role: 'user', content: prompt },
            ],
            // 채팅 컨텍스트 없이 프롬프트만!
        }),
    });
    if (!res.ok) throw new Error(`ST proxy ${res.status}`);
    const data = await res.json();
    // ST 응답 형식에 따라 파싱
    if (typeof data === 'string') return data;
    if (data?.choices?.[0]?.message?.content) return data.choices[0].message.content;
    if (data?.content) return typeof data.content === 'string' ? data.content : data.content[0]?.text || '';
    if (data?.response) return data.response;
    return JSON.stringify(data);
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
