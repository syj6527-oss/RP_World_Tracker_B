// 🐶 World Tracker — llm-helper.js (Direct LLM Call)
// generateQuietPrompt 우회 — 채팅 컨텍스트 없이 직접 API 호출

import { getContext } from '../../../extensions.js';
import { EXTENSION_NAME } from './index.js';

const dbg = (...a) => console.log(`[${EXTENSION_NAME}]`, ...a);

// ========== ST API 설정 읽기 ==========
function _getApiConfig() {
    try {
        // ST 전역 변수에서 API 정보 읽기
        const mainApi = window.main_api;
        const oai = window.oai_settings;
        const chatCompletion = oai?.chat_completion_source;

        dbg('🔧 LLM detect:', { mainApi, chatCompletion, hasOai: !!oai });
        dbg('🔧 LLM keys:', {
            makersuite: oai?.api_key_makersuite ? '✅' : '❌',
            openai: oai?.api_key_openai ? '✅' : '❌',
            openrouter: oai?.api_key_openrouter ? '✅' : '❌',
            claude: oai?.api_key_claude ? '✅' : '❌',
            google_model: oai?.google_model,
            openai_model: oai?.openai_model,
        });

        let type = null, key = null, model = null, url = null;

        // Google (Gemini / MakerSuite)
        if (chatCompletion === 'makersuite' || mainApi === 'openai' && chatCompletion === 'makersuite') {
            type = 'google';
            key = window.oai_settings?.api_key_makersuite || '';
            model = window.oai_settings?.google_model || 'gemini-2.0-flash';
            dbg('🔧 LLM config: Google', model);
        }
        // OpenAI
        else if (chatCompletion === 'openai' || mainApi === 'openai' && !chatCompletion) {
            type = 'openai';
            key = window.oai_settings?.api_key_openai || '';
            model = window.oai_settings?.openai_model || 'gpt-4o-mini';
            url = window.oai_settings?.openai_reverse_proxy || 'https://api.openai.com/v1';
            dbg('🔧 LLM config: OpenAI', model);
        }
        // OpenRouter
        else if (chatCompletion === 'openrouter') {
            type = 'openai'; // OpenRouter uses OpenAI format
            key = window.oai_settings?.api_key_openrouter || '';
            model = window.oai_settings?.openrouter_model || '';
            url = 'https://openrouter.ai/api/v1';
            dbg('🔧 LLM config: OpenRouter', model);
        }
        // Claude
        else if (chatCompletion === 'claude') {
            type = 'claude';
            key = window.oai_settings?.api_key_claude || '';
            model = window.oai_settings?.claude_model || 'claude-sonnet-4-20250514';
            url = window.oai_settings?.claude_reverse_proxy || 'https://api.anthropic.com/v1';
            dbg('🔧 LLM config: Claude', model);
        }

        if (!type || !key) {
            dbg('⚠️ LLM config: no API key found, fallback to generateQuietPrompt');
            return null;
        }
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
    const cfg = _getApiConfig();

    // 직접 호출 시도
    if (cfg) {
        try {
            let result = '';
            if (cfg.type === 'google') result = await _callGoogle(cfg.key, cfg.model, prompt);
            else if (cfg.type === 'openai') result = await _callOpenAI(cfg.key, cfg.model, prompt, cfg.url);
            else if (cfg.type === 'claude') result = await _callClaude(cfg.key, cfg.model, prompt, cfg.url);

            if (result) {
                dbg(`🔧 LLM direct call OK (${result.length}c)`);
                return result;
            }
        } catch(e) {
            dbg('⚠️ LLM direct call failed:', e.message, '→ fallback');
        }
    }

    // Fallback: generateQuietPrompt (기존 방식)
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
