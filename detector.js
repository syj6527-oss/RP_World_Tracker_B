// 🐶 World Tracker — detector.js (All Fixes + City Detection)

import { EXTENSION_NAME } from './index.js';

export class LocationDetector {
    constructor(lm) {
        this.lm = lm;

        this.suffixPat = [
            /(?:으로|로)\s*(?:향하|가|갔|걸어|이동|달려|뛰어|들어|나서|떠나|돌아|출발)/,
            /에\s*(?:도착|당도|다다|들어서|들어섰|왔다|갔다)/,
            /에서\s*(?:나와|나왔|나서|나섰|벗어나)/,
            /(?:을|를)\s*(?:나서|나섰|떠나|떠났|빠져나)/,
        ];
        this.presSuffix = [/에\s*(?:서 있|앉아|앉았|기대|서서)/, /에서\s*(?:앉|서|기다|머무)/];

        this.moveKw = [
            '향했','향해','걸어갔','걸어간','걸어가','성큼성큼','도착했','도착한','이동했',
            '들어갔','들어간','들어서','들어섰','나왔','나섰','떠났','돌아왔','돌아간','돌아오',
            '찾아갔','찾아왔','달려갔','뛰어갔','올라갔','내려갔','내려왔','건너갔',
            '문을 열','자리를 떠',
            '놀러갔','놀러가','놀러간','여행갔','여행간','여행을 떠',
            '출발했','출발한','다녀왔','다녀온','구경갔','구경하러',
            '데려갔','데려간','끌고 갔','끌려갔','이사했','이사한',
            'headed to','walked to','went to','arrived at','entered','moved to',
            'returned to','reached','walked into','headed home','went home','got home','came home',
            'drove to','ran to','rushed to','hurried to','traveled to','flew to',
        ];
        this.presKw = ['에서 앉','에서 서 있','에 앉아','에 서서','안에 있','안에서'];
        this.futureKw = ['갈래','갈까','가자','가볼까','어때','가고 싶','가보자','갈 거','갈게','shall we',"let's go",'want to go','how about'];

        // 경유지 (장소로 안 잡음)
        this.transitKo = ['복도','계단','통로','현관','로비','엘리베이터','에스컬레이터','출입구','입구','출구','문','문앞','문간','현관문','골목','길','건널목','횡단보도','주차장','차도'];
        this.transitEn = ['corridor','hallway','staircase','stairs','stairwell','elevator','escalator','passage','passageway','entrance','exit','doorway','door','gate','sidewalk','pathway','driveway'];

        this.skipKo = [
            ...this.transitKo,
            '그곳','여기','저기','거기','이곳','저곳','어디',
            '그녀','그는','그가','나는','우리','너는',
            '자신','상대','서로','모두','누군',
            '이쪽','저쪽','그쪽','앞쪽','뒤쪽','양쪽','한쪽',
            '바닥','천장','벽면','구석','가장','순간','갑자','아까','지금','오늘','내일',
            '이중문','출입문','철문','나무문','유리문',
            // 부사 오탐 방지
            '제멋대','마음대','맘대','억지','저절','함부','대충대',
            '뜻대','예정대','계획대','순서대','원래대','그대',
            '말대','생각대','소원대','자기대','자기멋대','눈대중',
            '되는대','닥치는대','시키는대','하는대','아무대',
            '엉뚱','느닷없','갑작스','황급','서둘',
            // 의류/소품
            '재킷','코트','외투','점퍼','셔츠','바지','치마','원피스','모자','장갑',
            '신발','구두','운동화','슬리퍼','부츠','가방','핸드백','배낭','지갑','목걸이',
            '귀걸이','반지','팔찌','넥타이','스카프','머플러','안경','선글라스',
            // 신체
            '어깨','허벅지','팔뚝','손목','발목','머리카락','뒷덜미','손가락','발가락',
            '이마','볼','턱','목','허리','가슴','등','배','무릎','팔','다리',
            '심장','입술','혀','뺨','눈썹','콧날','귓불',
            // 추상/일반
            '마음','기분','느낌','감정','표정','눈빛','시선','한숨','말투','목소리',
            '생각','기억','추억','습관','버릇','성격','태도','분위기','인상','냄새',
            '모습','모양','형태','크기','색깔','소리','맛','온기','냉기','향기',
            '체온','정적','숨결','속삭임','윙크','두근','설레임','떨림','긴장','흥분',
            '고요','침묵','적막','여운','감촉','촉감',
            // 가구/가전/생활용품
            '소파','의자','테이블','책상','침대','탁자','선반','서랍','거울','커튼',
            '카펫','러그','쿠션','이불','베개','장롱','옷장','냉장고','세탁기','건조기',
            '전자레인지','오븐','에어컨','히터','선풍기','청소기','다리미','식기','접시','컵',
            '수건','비누','칫솔','샴푸','화장품','휴지','쓰레기통','우산','열쇠','리모컨',
            // 음식/음료
            '커피','맥주','술','와인','주스','우유','빵','밥','국','찌개',
            '라면','피자','치킨','햄버거','케이크','과자','사탕','초콜릿','아이스크림',
            // 자연/일반 명사 오탐 방지
            '공기','물','불','바람','하늘','구름','비','눈','안개','햇빛','달빛','별빛',
            '시간','공간','세계','세상','현실','꿈','미래','과거','역사','사회',
            '사람','인간','동물','식물','나무','꽃','풀','돌','흙','모래',
            '전화','문자','편지','소식','연락','대화','약속','계약','거래','선물',
            '사진','그림','영화','음악','노래','춤','게임','운동','여행','산책',
            '옥정','문장','단어','글자','숫자','이름','제목','내용','의미','뜻',
        ];
        this.singleKo = ['집','방','숲','강','산','역','관','점','원','장'];

        // 영어 장소 단어 (경유지 제외, mart 추가!)
        this.placeWords = [
            'hall','room','house','home','office','station','tower','castle',
            'church','temple','school','academy','library','museum','hospital',
            'shop','store','market','mart','supermarket','grocery','convenience',
            'cafe','restaurant','bar','pub','tavern','inn','hotel',
            'park','garden','forest','beach','lake',
            'plaza','square','palace','manor','mansion','apartment','building',
            'kitchen','bedroom','bathroom','basement','attic','garage','living room',
            'gym','arena','stadium','court','field','ground',
            'base','camp','bunker','barracks','armory','quarters','dormitory','dorm',
            'lab','laboratory','workshop','warehouse','prison','dungeon','cave',
            'dock','port','harbor','airport','terminal',
            'lounge','lobby','chamber','cafeteria','canteen',
            'club','center','centre','studio','nursery','clinic','salon','theater','theatre',
        ];

        this.engMoveVerbs = [
            'headed to','walked to','went to','arrived at','moved to',
            'returned to','ran to','rushed to','hurried to',
            'entered','reached','left','marched to',
            'stepped into','burst into','stormed into',
            'headed home','went home','got home','came home',
            'drove to','traveled to','flew to','took a taxi to',
            'made it to','pulled up to','showed up at',
        ];

        this.skipMods = [
            'the','a','an','this','that','its','his','her','their','my','our',
            'old','new','big','small','dark','bright','lit','large','little',
            'metal','wooden','stone','steel','stainless','plastic','heavy',
            'entered','reached','left','to','at','into','from','of','in','on',
            'toward','towards','inside','through','open',
            // 시간/동작 수식어 (After returning home 오탐 방지)
            'after','before','while','during','upon','until','since',
            'returning','coming','going','leaving','heading','walking','running',
            'passing','following','approaching','entering','exiting',
            'back','just','then','still','already','finally','eventually',
            'nearby','near','around','along','across','over','under','behind',
            'quickly','slowly','suddenly','further','closer',
        ];

        // 인명 호칭 (bug 21)
        this.namePrefix = ['mr','mrs','ms','miss','dr','captain','colonel','sergeant','general','professor','officer','sir','madam','lady','lord'];

        // placeWord 뒤에 이게 오면 장소 아님 (bug 18: "apartment door lock")
        this.notPlaceSuffix = ['door','key','wall','window','floor','lock','roof','ceiling','gate','sign','number','building','complex'];

        // #36: 도시명 감지 — 주요 도시/지역명 (한/영)
        this.cityNames = [
            // 한국
            '서울','부산','대구','인천','광주','대전','울산','세종','수원','성남',
            '고양','용인','창원','청주','전주','천안','안산','남양주','화성','평택',
            '제주','포항','김해','파주','시흥','안양','군포','하남','양산','광명',
            '밀양','거제','통영','고성','사천',
            // 일본
            '도쿄','오사카','교토','요코하마','나고야','삿포로','후쿠오카','고베','히로시마','센다이','나라',
            // 중국
            '베이징','상하이','광저우','선전','항저우','난징','충칭','청두','시안','우한',
            // 영미
            'Seoul','Busan','Tokyo','Osaka','Kyoto','Beijing','Shanghai',
            'New York','Los Angeles','Chicago','London','Paris','Berlin','Rome',
            'Madrid','Barcelona','Amsterdam','Vienna','Moscow','Sydney','Toronto',
            'Vancouver','San Francisco','Seattle','Boston','Washington','Miami',
            'Las Vegas','Houston','Dallas','Atlanta','Denver','Phoenix','Portland',
            'Munich','Hamburg','Zurich','Geneva','Brussels','Prague','Warsaw',
            'Budapest','Stockholm','Oslo','Helsinki','Copenhagen','Dublin','Edinburgh',
            'Singapore','Bangkok','Manila','Jakarta','Hanoi','Taipei','Mumbai','Delhi',
            'Cairo','Dubai','Istanbul','Athens','Lisbon','Rio','São Paulo',
        ];
    }

    // ========== 등록된 장소 감지 (case-insensitive!) ==========
    detect(text) {
        if (!text || this.lm.locations.length === 0) return null;
        const clean = this._strip(text).toLowerCase();
        const hasFut = this.futureKw.some(k => clean.includes(k));
        let best = null;

        for (const loc of this.lm.locations) {
            for (const name of [loc.name, ...(loc.aliases || [])]) {
                if (!name || name.length < 1) continue;
                const nameLo = name.toLowerCase();
                for (const idx of this._findAll(clean, nameLo)) {
                    const inDlg = this._inDlg(clean, idx);
                    const after = clean.substring(idx + nameLo.length, idx + nameLo.length + 40);
                    const para = this._para(clean, idx);

                    // 같은 confidence면 뒤쪽 위치 우선 (최종 목적지)
                    const better = (c, i) => !best || c > best.confidence || (c === best.confidence && i > best.pos);

                    if (!inDlg && this.suffixPat.some(p => p.test(after)) && !hasFut) {
                        const c = 0.95; if (better(c, idx)) best = { location: loc, type: 'move', confidence: c, pos: idx }; continue;
                    }
                    if (!inDlg && this.presSuffix.some(p => p.test(after))) {
                        const c = 0.7; if (better(c, idx)) best = { location: loc, type: 'present', confidence: c, pos: idx }; continue;
                    }
                    if (this.moveKw.some(k => para.includes(k)) && !hasFut) {
                        const c = inDlg ? 0.6 : 0.85; if (better(c, idx)) best = { location: loc, type: 'move', confidence: c, pos: idx }; continue;
                    }
                    if (this.presKw.some(k => para.includes(k))) {
                        const c = inDlg ? 0.4 : 0.6; if (better(c, idx)) best = { location: loc, type: 'present', confidence: c, pos: idx }; continue;
                    }
                    if (inDlg) {
                        const dl = this._getDlg(clean, idx);
                        if (dl && dl.trim().length < nameLo.length + 15 && !hasFut) {
                            const c = 0.55; if (better(c, idx)) best = { location: loc, type: 'move', confidence: c, pos: idx };
                        }
                    }
                }
            }
        }
        return (best && (best.type === 'move' || best.type === 'present')) ? best : null;
    }

    // ========== 미등록 장소 발견 (mode: 'user'=높은감도, 'ai'=엄격) ==========
    // 여러 장소 언급 시 마지막 장소 반환 (최종 목적지)
    detectNewPlace(text, mode = 'user') {
        if (!text) return null;
        const clean = this._strip(text);
        if (this.futureKw.some(k => clean.toLowerCase().includes(k))) return null;
        const nar = clean.replace(/"[^"]*"/g,' ').replace(/「[^」]*」/g,' ').replace(/"[^"]*"/g,' ');
        let lastFound = null;

        // 한국어 방법 1: 조사 패턴 — USER만
        if (mode === 'user') {
            const pPat = /([가-힣]{1,8}?)(?:으로|에서|에|의|로)\s/g;
            const moveRx = /걸어[가간갔]|돌아[가간왔옴]|들어[가간서섰]|나[서섰왔]|향[하해했]/;
            for (const para of nar.split(/\n+/)) {
                const hasM = this.moveKw.some(k => para.includes(k)) || moveRx.test(para);
                if (!hasM) continue;
                pPat.lastIndex = 0; let m;
                while ((m = pPat.exec(para)) !== null) {
                    let c = m[1].trim().replace(/으$/, '');
                    if (this._validKo(c)) { lastFound = c; }
                }
            }
        }

        // 한국어 방법 2: 직접 패턴 — USER/AI 모두
        const dPat = [
            /([가-힣]{1,8}?)(?:으로|로)\s*(?:향하|가|갔|간다|걸어|이동|달려|돌아|출발)/g,
            /([가-힣]{1,8}?)에\s*(?:도착|당도|들어서|들어섰|왔다|갔다|간다)/g,
            /([가-힣]{1,8}?)(?:을|를)\s*(?:나서|나섰|떠나|떠났)/g,
        ];
        for (const p of dPat) {
            p.lastIndex=0; let m;
            while ((m = p.exec(nar)) !== null) {
                if (m[1]) {
                    let c = m[1].trim().replace(/으$/, '');
                    if (this._validKo(c)) { lastFound = c; }
                }
            }
        }

        if (lastFound) { console.log(`[${EXTENSION_NAME}] 🆕 (ko): "${lastFound}"`); return lastFound; }

        // 영어: "headed home" 특수 처리
        if (/\b(?:headed|went|got|came|arrived|returned|returning)\s+home\b/i.test(nar)) {
            if (!this.lm.findByName('Home')) { console.log(`[${EXTENSION_NAME}] 🆕 (home)`); return 'Home'; }
        }

        // 영어 방법 3: 이동 동사 + 장소 단어
        const lo = nar.toLowerCase();
        if (this.engMoveVerbs.some(v => lo.includes(v)) || /\b(?:into|inside|toward|towards)\b/.test(lo)) {
            const r = this._engDet(nar, true); if (r) return r;
        }

        // 영어 방법 4: 존재/묘사 — USER만
        if (mode === 'user') {
            const r2 = this._engDet(nar, false); if (r2) return r2;
        }

        // 도시명 감지 — USER/AI 모두
        const cityResult = this._detectCity(nar);
        if (cityResult) return cityResult;

        return null;
    }

    _engDet(nar, moveOnly) {
        const sents = nar.split(/[.!?]+/).filter(s => s.trim());
        for (const sent of sents) {
            const lo = sent.toLowerCase();
            const hasM = this.engMoveVerbs.some(v => lo.includes(v)) || /\b(?:into|toward|towards)\b/.test(lo);
            if (moveOnly && !hasM) continue;
            if (!moveOnly && hasM) continue;
            if (!moveOnly && !/\b(?:in|inside|within|at|of|around)\s+(?:the|a|his|her|my|your|their|our)\b/.test(lo) && !/\bthe\s+/.test(lo) && !/\b(?:in|inside|at)\s+\w+'s\b/.test(lo)) continue;

            for (const pw of this.placeWords) {
                if (this.transitEn.includes(pw)) continue;
                const rx = new RegExp('\\b' + pw + '(?:s)?\\b', 'i');
                const m = lo.match(rx); if (!m) continue;
                const idx = m.index;

                // Bug 21: 인명 체크 — "Mrs. Park" 스킵
                const beforeFull = sent.substring(Math.max(0, idx - 15), idx).trim().toLowerCase();
                if (this.namePrefix.some(np => beforeFull.endsWith(np) || beforeFull.endsWith(np + '.'))) continue;

                // Bug 18: 뒤에 비장소 명사 오면 스킵 — "apartment door lock"
                const afterWord = lo.substring(idx + m[0].length).trim().split(/\s+/)[0] || '';
                if (this.notPlaceSuffix.includes(afterWord)) continue;

                const before = sent.substring(0, idx).trim().split(/\s+/).filter(Boolean);
                const actual = sent.substring(idx, idx + m[0].length).trim();
                let name = actual;
                const mods = before.slice(-2).filter(w => !this.skipMods.includes(w.toLowerCase()) && !w.includes('-') && w.length > 1);
                if (mods.length) name = mods.join(' ') + ' ' + actual;
                name = name.charAt(0).toUpperCase() + name.slice(1);
                if (name.length >= 3 && name.length <= 30 && !this.lm.findByName(name)) {
                    console.log(`[${EXTENSION_NAME}] 🆕 (en): "${name}"`); return name;
                }
            }
        }
        return null;
    }

    // #36: 도시명 감지
    // ========== 설명문에서 장소 추출 (이동 동사 없이) ==========
    detectFromDescription(text) {
        if (!text) return null;
        const clean = this._strip(text);
        const lo = clean.toLowerCase();

        // 1) 도시명 매칭 (Bug F: 영어는 단어 경계 체크)
        for (const city of this.cityNames) {
            if (this.lm.findByName(city)) continue;
            if (/[a-zA-Z]/.test(city)) {
                const rx = new RegExp('\\b' + city.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
                if (rx.test(clean)) { console.log(`[${EXTENSION_NAME}] 📋 desc city: "${city}"`); return city; }
            } else {
                if (lo.includes(city.toLowerCase())) { console.log(`[${EXTENSION_NAME}] 📋 desc city: "${city}"`); return city; }
            }
        }

        // 2) 영어 placeWord 매칭 ("SAS base", "royal palace")
        for (const pw of this.placeWords) {
            if (this.transitEn.includes(pw)) continue;
            const rx = new RegExp('\\b(\\w+\\s+)?' + pw + '(?:s)?\\b', 'i');
            const m = clean.match(rx);
            if (!m) continue;
            let name = m[0].trim();
            const words = name.split(/\s+/);
            if (words.length > 1 && this.skipMods.includes(words[0].toLowerCase())) name = words.slice(1).join(' ');
            name = name.charAt(0).toUpperCase() + name.slice(1);
            if (name.length >= 3 && name.length <= 30 && !this.lm.findByName(name)) {
                console.log(`[${EXTENSION_NAME}] 📋 desc place: "${name}"`);
                return name;
            }
        }

        // 3) 한국어 장소 키워드
        const koPlaces = /([가-힣]{2,6}(?:기지|부대|학교|마을|도시|왕국|성|궁|사원|신전|숲|섬|산|강|호수|바다))/g;
        let km;
        while ((km = koPlaces.exec(clean)) !== null) {
            const c = km[1];
            if (!this.skipKo.includes(c) && !this.lm.findByName(c)) {
                console.log(`[${EXTENSION_NAME}] 📋 desc ko: "${c}"`);
                return c;
            }
        }
        return null;
    }

    _detectCity(text) {
        const lo = text.toLowerCase();
        // 이동 맥락 확인
        const hasMove = this.moveKw.some(k => lo.includes(k)) ||
            /비행기|기차|KTX|버스|택시|배|여객선|페리/i.test(text) ||
            /\b(?:flight|train|bus|taxi|ferry)\b/i.test(text);
        if (!hasMove) return null;

        for (const city of this.cityNames) {
            const cityLo = city.toLowerCase();
            // Bug F: 단어 경계 체크 (영어) — "rio"가 "mario" 안에서 매칭 방지
            if (/[a-zA-Z]/.test(city)) {
                const rx = new RegExp('\\b' + cityLo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
                if (!rx.test(text)) continue;
            } else {
                if (!lo.includes(cityLo)) continue;
            }
            if (this.lm.findByName(city)) continue;
            const idx = lo.indexOf(cityLo);
            const before = text.substring(Math.max(0, idx - 20), idx).trim().toLowerCase();
            if (this.namePrefix.some(np => before.endsWith(np) || before.endsWith(np + '.'))) continue;
            console.log(`[${EXTENSION_NAME}] 🆕 (city): "${city}"`);
            return city;
        }
        return null;
    }

    _validKo(c) {
        if (!c) return false;
        if (c.length === 1) return this.singleKo.includes(c);
        if (c.length > 8) return false;
        if (this.lm.findByName(c)) return false;
        if (this.skipKo.includes(c)) return false;
        if (c.length === 2 && /[을를이가에]$/.test(c)) return false;
        return true;
    }

    _strip(t) { return t.replace(/<[^>]+>/g,'').replace(/\*{1,2}([^*]+)\*{1,2}/g,'$1').replace(/_{1,2}([^_]+)_{1,2}/g,'$1'); }
    _findAll(t,n) { const r=[]; let p=0; while(true){ const i=t.indexOf(n,p); if(i===-1)break; r.push(i); p=i+1; } return r; }
    _inDlg(t,pos) { const b=t.substring(0,pos); for(const[o,c]of[['"','"'],['"','"'],['「','」']]){const lo=b.lastIndexOf(o);if(lo>-1&&lo>b.lastIndexOf(c))return true;} return false; }
    _getDlg(t,pos) { for(const[o,c]of[['"','"'],['"','"'],['「','」']]){const s=t.lastIndexOf(o,pos);if(s===-1)continue;const e=t.indexOf(c,s+1);if(e>-1&&e>=pos)return t.substring(s+1,e);} return null; }
    _para(t,pos) { const b=t.substring(Math.max(0,pos-200),pos); const a=t.substring(pos,Math.min(t.length,pos+200)); return b.substring(Math.max(b.lastIndexOf('\n'),0))+(a.indexOf('\n')!==-1?a.substring(0,a.indexOf('\n')):a); }
}
