import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assessPlaceCandidate, DetectionCandidateManager, suspiciousLocationReason } from '../detection-candidates.js';
import { buildGoogleMapsUrl, isAllowedGoogleMapsUrl } from '../google-maps-links.js';
import { LocationDetector } from '../detector.js';
import { redactSecretFields } from '../db.js';

const locations = [
    { id: 'club', name: 'Club', aliases: [] },
    { id: 'home', name: 'Home', aliases: ['집'] },
    { id: 'won', name: '원', aliases: [] },
    { id: 'jeom', name: '점', aliases: [] },
    { id: 'bar', name: 'Bar', aliases: [] },
    { id: 'office', name: 'Office', aliases: [] },
    { id: 'nola', name: 'New Orleans', aliases: [] },
    { id: 'ko-club', name: '클럽', aliases: [] },
];

const normalized = value => String(value || '').normalize('NFKC').toLowerCase().trim();
const mockLm = {
    currentChatId: 'test-chat',
    locations,
    ignoredDetectedNames: [],
    findByNameExact(name) {
        const key = normalized(name);
        return this.locations.find(location => normalized(location.name) === key || (location.aliases || []).some(alias => normalized(alias) === key)) || null;
    },
    isDetectionIgnored(name) { return this.ignoredDetectedNames.includes(normalized(name)); },
    async ignoreDetectedName(name) { this.ignoredDetectedNames.push(normalized(name)); },
};

for (const falsePositive of [
    'look', 'see', 'you', 'authority', 'say thank you', 'Scanned room',
    'place, conventionally han', '약속 장소', '풍경', '원', '점',
    'he', 'she', 'they', 'someone', '당신', '그녀', '우리',
]) {
    const result = assessPlaceCandidate(falsePositive, { source: 'ai', locationManager: mockLm });
    assert.equal(result.accepted, false, `must reject: ${falsePositive}`);
}

const home = assessPlaceCandidate('Crawl home', { source: 'ai', locationManager: mockLm });
assert.equal(home.accepted, true);
assert.equal(home.name, 'Home');
assert.equal(home.existingId, 'home');

const relative = assessPlaceCandidate('Club 앞', { source: 'ai', locationManager: mockLm });
assert.equal(relative.accepted, true);
assert.equal(relative.kind, 'relative');
assert.equal(relative.existingId, 'club');

for (const generic of ['Club', 'diner']) {
    const result = assessPlaceCandidate(generic, { source: 'ai', confidence: 0.95, locationManager: { ...mockLm, findByNameExact: () => null } });
    assert.equal(result.accepted, true);
    assert.ok(result.confidence <= 0.64, `${generic} must remain a low-confidence confirmation candidate`);
}

for (const properPlace of ['New Orleans', 'AZURE PENTHOUSE', '오프캠퍼스 아파트']) {
    assert.equal(assessPlaceCandidate(properPlace, { source: 'meta', locationManager: { ...mockLm, findByNameExact: () => null } }).accepted, true);
}

const manager = new DetectionCandidateManager(mockLm);
const queued = manager.add('AZURE PENTHOUSE', { source: 'meta', snippet: '<b>Location:</b> AZURE PENTHOUSE' });
assert.equal(queued.queued, true);
assert.equal(manager.count(), 1);
assert.equal(manager.list()[0].snippet.includes('<'), false, 'ephemeral evidence must be plain text');
await manager.ignore(queued.candidate.id);
assert.equal(manager.count(), 0);
assert.equal(mockLm.isDetectionIgnored('AZURE PENTHOUSE'), true);
assert.equal(manager.add('AZURE PENTHOUSE', { source: 'meta' }).ignored, true);

assert.equal(suspiciousLocationReason({ name: 'say thank you' }), '시스템 문구·대명사·행동 조각');
assert.equal(suspiciousLocationReason({ name: 'Crawl home' }), '이동 문구 — 기존 Home 연결 검토');
assert.equal(suspiciousLocationReason({ name: 'Club 앞' }), '상대 위치 표현 — 기존 장소 연결 검토');
assert.equal(suspiciousLocationReason({ name: 'New Orleans' }), '');

const destination = { name: 'AZURE PENTHOUSE', address: '1 Example Street', lat: 29.95, lng: -90.07, verification: 'confirmed' };
const origin = { name: 'Home', address: '2 Example Street', lat: 29.96, lng: -90.08, verification: 'confirmed' };
for (const action of ['view', 'directions', 'streetview']) {
    const url = buildGoogleMapsUrl(action, destination, origin);
    assert.ok(url, `${action} URL should be built`);
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://www.google.com');
    assert.ok(parsed.pathname.startsWith('/maps/'));
    assert.equal(/key=|api_key|token|utm_/i.test(parsed.search), false);
}
const directions = new URL(buildGoogleMapsUrl('directions', destination, origin));
assert.ok(directions.searchParams.get('origin'));
assert.ok(directions.searchParams.get('destination'));
assert.equal(buildGoogleMapsUrl('directions', destination, null), null, 'never let Google substitute real device origin');
assert.equal(buildGoogleMapsUrl('streetview', { name: 'No coordinate', verification: 'confirmed' }), null);
assert.equal(isAllowedGoogleMapsUrl('https://evil.example/maps/search/?api=1&query=Home'), false);
assert.equal(isAllowedGoogleMapsUrl('https://www.google.com/maps/search/?api=1&query=Home&key=secret'), false);
assert.equal(isAllowedGoogleMapsUrl('https://www.google.com/maps/search/?query=Home'), false);
assert.equal(isAllowedGoogleMapsUrl('https://www.google.com/maps/dir/?api=1&destination=Club'), false);
assert.equal(isAllowedGoogleMapsUrl('https://www.google.com/maps/search/?api=1&query=Home&utm_source=PAW'), false);
assert.equal(isAllowedGoogleMapsUrl('https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=999,0'), false);
const secretLikeLocationUrl = new URL(buildGoogleMapsUrl('view', {
    name: 'Home', address: 'api_key=must-not-leave-the-extension', verification: 'confirmed',
}));
assert.equal(secretLikeLocationUrl.searchParams.get('query'), 'Home', 'secret-like stored text must never enter Google query');

const redacted = redactSecretFields({
    memo: 'safe', apiKey: 'must-not-export',
    nested: { Authorization: 'Bearer secret', client_secret: 'must-not-export', name: 'Club' },
});
assert.deepEqual(redacted, { memo: 'safe', nested: { name: 'Club' } });

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const uiSource = fs.readFileSync(`${sourceRoot}/ui-manager.js`, 'utf8');
const locationSource = fs.readFileSync(`${sourceRoot}/location-manager.js`, 'utf8');
const indexSource = fs.readFileSync(`${sourceRoot}/index.js`, 'utf8');
const geoSource = fs.readFileSync(`${sourceRoot}/geo-service.js`, 'utf8');
assert.doesNotMatch(uiSource, /30\s*\+\s*Math\.random\(\)\s*\*\s*120/, 'one confirmed coordinate must not fabricate nearby pins');
assert.match(uiSource, /wt-cleanup-coordinate/, 'legacy clustered coordinates need an explicit per-place cleanup UI');
assert.match(uiSource, /lat:\s*null,\s*lng:\s*null,\s*address:\s*''[^\n]+_geocodeSuppressed:\s*true/, 'coordinate cleanup must clear only selected geocoding data and prevent silent re-creation');
assert.doesNotMatch(locationSource, /placeNearAnchor|111320/, 'location creation must never inherit or fabricate GPS');
assert.doesNotMatch(indexSource, /\blm\.addLocation\s*\(/, 'automatic scanners must queue candidates instead of storing places');
assert.doesNotMatch(geoSource, /searchParams\.set\(['"]lang['"],\s*['"]ko['"]\)/, 'Photon public API rejects lang=ko; local-language mode must omit it');
assert.match(geoSource, /mapSearchLanguage\s*===\s*['"]en['"][^\n]+searchParams\.set\(['"]lang['"],\s*['"]en['"]\)/, 'English output may explicitly request lang=en');
const manualLongPressBlock = uiSource.match(/onLongPress\s*=\s*async[\s\S]*?\n\s*};/)?.[0] || '';
assert.match(manualLongPressBlock, /reverseGeocode\(lat,\s*lng\)/, 'explicit map long-press must restore address lookup');
assert.doesNotMatch(manualLongPressBlock, /allowAutoGeocoding/, 'manual map gesture must not be confused with background chat-name geocoding');
assert.match(uiSource, /wt-cleanup-overlay[\s\S]{0,700}align-items:flex-end/, 'cleanup dialog must stay inside the mobile viewport from the bottom');

const detector = new LocationDetector(mockLm);
assert.equal(detector.detect('병원으로 향했다.'), null, 'one-character 원 must not match 병원');
assert.equal(detector.detect('상점으로 갔다.'), null, 'one-character 점 must not match 상점');
assert.equal(detector.detect('He reached for the bar of soap.'), null, 'Bar must not match bar of soap');
assert.equal(detector.detect('He went to the office chair and sat down.'), null, 'Office must not match office chair');
assert.equal(detector.detect('He reached for the club sandwich.'), null, 'Club must not match club sandwich');
assert.equal(detector.detect('She entered the club sandwich contest.'), null, 'Club compound noun must not become a destination');
assert.equal(detector.detect('He went to the bar counter.'), null, 'Bar compound object must not become a destination');
assert.equal(detector.detect('She arrived at the office party.'), null, 'Office event phrase must not become a destination');
assert.equal(detector.detect('She left Club.'), null, 'a named departure point must not become the destination');
assert.equal(detector.detect('클럽에서 나왔다.'), null, 'Korean departure point must not become the destination');
assert.equal(detector.detect('클럽에서 나와 집으로 갔다.')?.location?.id, 'home', 'destination after a departure must win');
const unknownDetector = new LocationDetector({ locations: [], findByNameExact: () => null });
assert.equal(unknownDetector.detectNewPlace('클럽에서 나왔다.', 'user'), null, 'unknown departure point must not be proposed as current');
assert.equal(unknownDetector.detectNewPlace('She entered the club sandwich contest.', 'ai'), null);
assert.equal(unknownDetector.detectNewPlace('She arrived at the office party.', 'ai'), null);
assert.equal(unknownDetector.detectNewPlace('He went to the bar counter.', 'ai'), null);
assert.equal(unknownDetector.detectNewPlace('He changed into a hospital gown.', 'ai'), null);
const strong = detector.detect('They arrived in New Orleans.');
assert.equal(strong?.location?.id, 'nola');
assert.ok(strong.confidence >= 0.9);

console.log('security regression tests passed');
