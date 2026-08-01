// PAW MAP — privacy-bounded geocoding helpers
// Only explicit search text or RP-map coordinates are sent to Photon.

import { extension_settings } from '../../../extensions.js';

const EXTENSION_NAME = 'rp-world-tracker';
const PHOTON_BASE = 'https://photon.komoot.io';
const CACHE_LIMIT = 100;
const REQUEST_INTERVAL_MS = 1000;
const COORDINATE_PRECISION = 4;
const searchCache = new Map();
const reverseCache = new Map();
let lastRequestAt = 0;

function settings() {
    return extension_settings?.[EXTENSION_NAME] || {};
}

function cleanQuery(value) {
    return String(value || '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/[<>]/g, ' ')
        .replace(/"/g, '”')
        .replace(/'/g, '’')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
}

function finiteCoordinate(value, min, max) {
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function remember(cache, key, value) {
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(key, value);
    return value;
}

async function fairFetch(url, init = {}) {
    const wait = Math.max(0, REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastRequestAt = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal,
            headers: { Accept: 'application/json', ...(init.headers || {}) },
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
        });
    } finally {
        clearTimeout(timer);
    }
}

function resultLabel(properties) {
    const pieces = [
        properties?.name,
        properties?.street,
        properties?.district,
        properties?.city,
        properties?.state,
        properties?.country,
    ].map(cleanQuery).filter(Boolean);
    return [...new Set(pieces)].slice(0, 4).join(', ');
}

function normalizeFeature(feature) {
    const coordinates = feature?.geometry?.coordinates;
    const properties = feature?.properties || {};
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    const lng = finiteCoordinate(coordinates[0], -180, 180);
    const lat = finiteCoordinate(coordinates[1], -90, 90);
    if (lat == null || lng == null) return null;
    const name = cleanQuery(properties.name) || resultLabel(properties) || 'Unknown place';
    const fullName = resultLabel(properties) || name;
    return {
        name,
        fullName,
        display_name: fullName,
        lat,
        lng,
        lon: lng,
        type: cleanQuery(properties.type || properties.osm_value || ''),
        category: cleanQuery(properties.osm_key || ''),
        osmId: properties.osm_id || null,
    };
}

/**
 * Search OpenStreetMap place data through Photon.
 * `automatic: true` is blocked unless the user explicitly enables it.
 */
export async function searchPlaces(query, options = {}) {
    const automatic = options.automatic === true;
    if (automatic && settings().allowAutoGeocoding !== true) return [];

    const q = cleanQuery(query);
    if (q.length < 2) return [];
    const limit = Math.max(1, Math.min(5, Number(options.limit) || 5));
    const lat = finiteCoordinate(options.bias?.lat, -90, 90);
    const lng = finiteCoordinate(options.bias?.lng, -180, 180);
    const cacheKey = JSON.stringify([q.toLowerCase(), limit, lat, lng]);
    if (searchCache.has(cacheKey)) return searchCache.get(cacheKey);

    const url = new URL(`${PHOTON_BASE}/api/`);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('lang', settings().mapSearchLanguage === 'en' ? 'en' : 'ko');
    if (lat != null && lng != null) {
        url.searchParams.set('lat', lat.toFixed(COORDINATE_PRECISION));
        url.searchParams.set('lon', lng.toFixed(COORDINATE_PRECISION));
    }

    try {
        const response = await fairFetch(url.toString());
        if (!response.ok) return [];
        const data = await response.json();
        const results = (data?.features || []).map(normalizeFeature).filter(Boolean).slice(0, limit);
        return remember(searchCache, cacheKey, results);
    } catch (_) {
        return [];
    }
}

/** Reverse-geocode RP-map coordinates. No chat text or place name is sent. */
export async function reverseGeocode(latValue, lngValue) {
    const lat = finiteCoordinate(latValue, -90, 90);
    const lng = finiteCoordinate(lngValue, -180, 180);
    if (lat == null || lng == null) return null;
    const cacheKey = `${lat.toFixed(COORDINATE_PRECISION)},${lng.toFixed(COORDINATE_PRECISION)}`;
    if (reverseCache.has(cacheKey)) return reverseCache.get(cacheKey);

    const url = new URL(`${PHOTON_BASE}/reverse`);
    url.searchParams.set('lat', lat.toFixed(COORDINATE_PRECISION));
    url.searchParams.set('lon', lng.toFixed(COORDINATE_PRECISION));
    url.searchParams.set('lang', settings().mapSearchLanguage === 'en' ? 'en' : 'ko');

    try {
        const response = await fairFetch(url.toString());
        if (!response.ok) return null;
        const data = await response.json();
        const result = normalizeFeature(data?.features?.[0]);
        return remember(reverseCache, cacheKey, result);
    } catch (_) {
        return null;
    }
}

export function clearGeoCaches() {
    searchCache.clear();
    reverseCache.clear();
}
