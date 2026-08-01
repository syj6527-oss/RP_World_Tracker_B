// PAW MAP — explicit, privacy-bounded LLM calls
// Connection-profile only: this extension never reads, accepts, or stores an API key.

import { getContext, extension_settings } from '../../../extensions.js';

const EXTENSION_NAME = 'rp-world-tracker';
let requestInFlight = false;

function settings() {
    return extension_settings?.[EXTENSION_NAME] || {};
}

function setStatus(status, error = '') {
    window._wtLastApiStatus = status;
    window._wtLastLLMError = error || null;
}

function safeError(error) {
    const message = String(error?.message || error || '');
    if (error?.name === 'AbortError' || /abort|timeout/i.test(message)) return '요청 시간 초과 또는 취소';
    if (/Connection Manager is not available|profile service unavailable/i.test(message)) return '연결 프로필 서비스를 사용할 수 없음';
    const status = message.match(/\b(?:4\d\d|5\d\d)\b/)?.[0];
    return status ? `연결 프로필 요청 실패 (HTTP ${status})` : '연결 프로필 요청 실패';
}

async function callViaConnectionProfile(profileId, prompt, requestedTokens = 2048, timeoutMs = 45000) {
    const context = getContext();
    let service = context?.ConnectionManagerRequestService;
    if (!service?.sendRequest) {
        try {
            const module = await import('../../shared.js');
            service = module.ConnectionManagerRequestService;
        } catch (_) {}
    }
    if (!service?.sendRequest) throw new Error('Connection profile service unavailable');
    const tokenLimit = Number(requestedTokens);
    const maxTokens = Math.max(256, Math.min(8192, Number.isFinite(tokenLimit) ? tokenLimit : 2048));
    const controller = new AbortController();
    const duration = Math.max(5000, Math.min(120000, Number(timeoutMs) || 45000));
    const timer = setTimeout(() => controller.abort(), duration);
    try {
        const response = await service.sendRequest(profileId, prompt, maxTokens, {
            stream: false,
            signal: controller.signal,
            extractData: true,
            includePreset: true,
            includeInstruct: true,
        });
        if (typeof response === 'string') return response;
        return response?.content || response?.text || response?.message?.content || response?.choices?.[0]?.message?.content || response?.choices?.[0]?.text || '';
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Perform exactly one configured model request.
 * Sensitive requests are blocked unless both external-AI and RP-data consent are on.
 */
export async function callLLM(prompt, options = {}) {
    const s = settings();
    const sensitive = options.sensitive !== false;

    if (s.externalAiEnabled !== true) {
        setStatus('External AI disabled', '외부 AI 기능이 꺼져 있음');
        return null;
    }
    if (sensitive && s.shareRpData !== true) {
        setStatus('RP data sharing blocked', 'RP 원문 공유 동의가 꺼져 있음');
        return null;
    }

    if (!s.selectedProfile) {
        setStatus('No connection profile', '선택된 연결 프로필이 없음');
        return null;
    }
    if (requestInFlight) {
        setStatus('Request skipped', '이미 확장 AI 요청이 진행 중');
        return null;
    }

    requestInFlight = true;
    try {
        // Exactly one request through the selected SillyTavern profile. No fallback.
        const result = await callViaConnectionProfile(s.selectedProfile, String(prompt || ''), options.maxTokens, options.timeoutMs);
        setStatus('Connection profile request completed');
        return result || null;
    } catch (error) {
        setStatus('Request failed', safeError(error));
        return null;
    } finally {
        requestInFlight = false;
    }
}

export function getRecentChatContext(maxChars = 2000) {
    if (settings().shareRpData !== true) return '';
    try {
        const chat = getContext()?.chat;
        if (!Array.isArray(chat) || !chat.length) return '';
        let result = '';
        for (let i = chat.length - 1; i >= 0 && result.length < maxChars; i--) {
            const message = chat[i];
            if (!message?.mes) continue;
            const clean = String(message.mes)
                .replace(/```[\s\S]*?```/g, '')
                .replace(/<memo>[\s\S]*?<\/memo>/gi, '')
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (clean.length < 10) continue;
            result = `${message.is_user ? 'USER' : 'CHARACTER'}: ${clean}\n---\n${result}`;
        }
        return result.substring(0, Math.max(0, Number(maxChars) || 2000)).trim();
    } catch (_) {
        return '';
    }
}

export function getRecentSpeakers(lookback = 8) {
    try {
        const chat = getContext()?.chat;
        if (!Array.isArray(chat) || !chat.length) return { recentSpeaker: null, allSpeakers: [] };
        const speakers = [];
        const seen = new Set();
        for (let i = chat.length - 1; i >= 0 && speakers.length < lookback; i--) {
            const message = chat[i];
            if (!message || message.is_user || message.is_system) continue;
            const name = message.name || message.original_name;
            if (!name || name === 'System' || seen.has(name)) continue;
            seen.add(name);
            speakers.push(name);
        }
        return { recentSpeaker: speakers[0] || null, allSpeakers: speakers };
    } catch (_) {
        return { recentSpeaker: null, allSpeakers: [] };
    }
}

export function parseLLMJson(raw) {
    if (!raw) return null;
    let text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').replace(/,\s*([}\]])/g, '$1');
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
        try { return JSON.parse(match[0]); } catch (_) {}
    }
    const start = text.indexOf('{');
    if (start < 0) return null;
    let repaired = text.substring(start).replace(/,\s*$/, '').replace(/"[^"\\]*$/g, '"').replace(/:\s*$/, ': null');
    const arrays = (repaired.match(/\[/g) || []).length - (repaired.match(/\]/g) || []).length;
    const objects = (repaired.match(/\{/g) || []).length - (repaired.match(/\}/g) || []).length;
    repaired += ']'.repeat(Math.max(0, arrays)) + '}'.repeat(Math.max(0, objects));
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(repaired); } catch (_) { return null; }
}
