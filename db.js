// 🐶 월드맵 — db.js

const DB_NAME = 'RPWorldTracker';
const DB_VERSION = 2;

export class WorldTrackerDB {
    constructor() { this.db = null; }

    async open() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('locations')) {
                    const s = db.createObjectStore('locations', { keyPath: 'id' });
                    s.createIndex('chatId', 'chatId', { unique: false });
                }
                if (!db.objectStoreNames.contains('movements')) {
                    const s = db.createObjectStore('movements', { keyPath: 'id', autoIncrement: true });
                    s.createIndex('chatId', 'chatId', { unique: false });
                }
                if (!db.objectStoreNames.contains('mapConfig'))
                    db.createObjectStore('mapConfig', { keyPath: 'chatId' });
                if (!db.objectStoreNames.contains('distances')) {
                    const s = db.createObjectStore('distances', { keyPath: 'id' });
                    s.createIndex('chatId', 'chatId', { unique: false });
                }
            };
            req.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
            req.onerror = (e) => reject(e.target.error);
        });
    }

    _tx(store, mode = 'readonly') { return this.db.transaction(store, mode).objectStore(store); }
    _p(req, val) { return new Promise((ok, no) => { req.onsuccess = () => ok(val); req.onerror = (e) => no(e.target.error); }); }
    _r(req) { return new Promise((ok, no) => { req.onsuccess = () => ok(req.result || null); req.onerror = (e) => no(e.target.error); }); }

    async putLocation(l) { return this._p(this._tx('locations', 'readwrite').put(l), l); }
    async getLocationsByChatId(id) { return this._r(this._tx('locations').index('chatId').getAll(id)); }
    async deleteLocation(id) { return this._p(this._tx('locations', 'readwrite').delete(id), true); }
    async addMovement(m) { return this._p(this._tx('movements', 'readwrite').add(m), m); }
    async getMovementsByChatId(id) { return this._r(this._tx('movements').index('chatId').getAll(id)); }
    async deleteMovement(id) { return this._p(this._tx('movements', 'readwrite').delete(id), true); }
    async getMapConfig(id) { return this._r(this._tx('mapConfig').get(id)); }
    async saveMapConfig(c) { return this._p(this._tx('mapConfig', 'readwrite').put(c), c); }
    async saveDistance(d) { return this._p(this._tx('distances', 'readwrite').put(d), d); }
    async getDistancesByChatId(id) { return this._r(this._tx('distances').index('chatId').getAll(id)); }
}
