/**
 * DIFP Full Network Scanner — scanner.js
 *
 * Scans the Nostr relay for ALL registered Kind-30420 components once on app
 * load, then exposes them through a simple store so the map can display pins
 * lazily (first 500 visible immediately, more revealed as the user pans/zooms).
 *
 * Usage:
 *   import { ComponentScanner } from './scanner.js';
 *
 *   const scanner = new ComponentScanner(nostrClient, {
 *     onProgress : (loaded, total)  => {},   // called during streaming
 *     onBatch    : (components)     => {},   // called with each batch of parsed comps
 *     onComplete : (allComponents)  => {},   // called once when EOSE arrives
 *     batchSize  : 50,                       // how many events to parse before firing onBatch
 *     limit      : 5000,                     // max events to request per relay sub
 *     lookbackDays: 30,                      // only events newer than N days (0 = all time)
 *   });
 *
 *   scanner.start();   // begins the scan
 *   scanner.stop();    // aborts mid-scan
 *
 * The map integration (in main.js) should call scanner.getVisible(bounds) to
 * retrieve only the components whose cellId falls inside the current viewport.
 */

import { cellToLatLng, cellToLobby, NUM_LOBBY_ROWS } from './geo.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const KIND_COMPONENT   = 30420;
const DEFAULT_BATCH    = 50;
const DEFAULT_LIMIT    = 5_000;
const DEFAULT_LOOKBACK = 30;   // days
const INITIAL_DISPLAY  = 500;  // pins shown on first load before user pans/zooms

// ─── ComponentScanner ─────────────────────────────────────────────────────────

export class ComponentScanner {
    /**
     * @param {import('./nostr.js').NostrClient} client
     * @param {object} opts
     */
    constructor(client, opts = {}) {
        this._client   = client;
        this._opts     = {
            onProgress   : opts.onProgress   || (() => {}),
            onBatch      : opts.onBatch      || (() => {}),
            onComplete   : opts.onComplete   || (() => {}),
            batchSize    : opts.batchSize    || DEFAULT_BATCH,
            limit        : opts.limit        || DEFAULT_LIMIT,
            lookbackDays : opts.lookbackDays ?? DEFAULT_LOOKBACK,
        };

        // Internal store: pubkey → component object
        this._store       = new Map();

        // Spatial index: lobbyId (string) → Set<pubkey>
        // Lets us quickly look up which components are in a given lobby
        this._lobbyIndex  = new Map();

        this._sub         = null;   // active subscription handle
        this._buffer      = [];     // accumulates events until next batch flush
        this._scanning    = false;
        this._done        = false;
        this._loadedCount = 0;
    }

    // ── Public API ──────────────────────────────────────────────────────────────

    /** Start the full-network scan. Safe to call multiple times (no-op if running). */
    start() {
        if (this._scanning) return;
        this._scanning = true;
        this._done     = false;
        this._subscribe();
    }

    /** Abort an in-progress scan. */
    stop() {
        if (this._sub) {
            this._sub.close();
            this._sub = null;
        }
        this._scanning = false;
        this._flushBuffer();   // surface whatever was buffered
    }

    /** True once the relay has sent EOSE. */
    get isDone() { return this._done; }

    /** Total components stored so far. */
    get count()  { return this._store.size; }

    /**
     * Return all components, or optionally filtered to those inside leaflet bounds.
     * @param {L.LatLngBounds|null} bounds  - if null, returns all
     * @param {number}              [max]   - optional hard cap on returned count
     * @returns {ComponentRecord[]}
     */
    getVisible(bounds = null, max = Infinity) {
        const result = [];
        for (const comp of this._store.values()) {
            if (result.length >= max) break;
            if (!bounds) {
                result.push(comp);
                continue;
            }
            // Lazy lat/lng derivation (stored on first access)
            if (!comp._latLng) {
                try { comp._latLng = cellToLatLng(comp.cellId); }
                catch { comp._latLng = null; }
            }
            if (comp._latLng && bounds.contains([comp._latLng.lat, comp._latLng.lng])) {
                result.push(comp);
            }
        }
        return result;
    }

    /**
     * Return the first N components (deterministic ordering based on insertion).
     * Used for the initial 500-pin render before the user has panned anywhere.
     * @param {number} n
     * @returns {ComponentRecord[]}
     */
    getInitial(n = INITIAL_DISPLAY) {
        return this.getVisible(null, n);
    }

    /** Retrieve a single component by pubkey. */
    get(pubkey) { return this._store.get(pubkey) || null; }

    /** Iterate over all stored components. */
    [Symbol.iterator]() { return this._store.values(); }

    // ── Internal ────────────────────────────────────────────────────────────────

    _subscribe() {
        const filter = { kinds: [KIND_COMPONENT], limit: this._opts.limit };
        if (this._opts.lookbackDays > 0) {
            filter.since = Math.floor(Date.now() / 1000) - this._opts.lookbackDays * 86_400;
        }

        this._sub = this._client.subscribe(
            filter,
            (event) => this._onEvent(event),
            ()      => this._onEose(),
        );
    }

    _onEvent(event) {
        if (!this._scanning) return;

        const comp = _parseEvent(event);
        if (!comp) return;

        // Deduplicate: newer event wins (relays may send duplicates or updates)
        const existing = this._store.get(comp.id);
        if (existing && existing.createdAt >= comp.createdAt) return;

        this._store.set(comp.id, comp);
        _indexByLobby(this._lobbyIndex, comp);

        this._buffer.push(comp);
        this._loadedCount++;
        this._opts.onProgress(this._loadedCount, this._store.size);

        if (this._buffer.length >= this._opts.batchSize) {
            this._flushBuffer();
        }
    }

    _onEose() {
        this._done     = true;
        this._scanning = false;
        this._flushBuffer();
        this._opts.onComplete([...this._store.values()]);
        if (this._sub) { this._sub.close(); this._sub = null; }
    }

    _flushBuffer() {
        if (!this._buffer.length) return;
        const batch = this._buffer.splice(0);
        this._opts.onBatch(batch);
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a raw Nostr event (kind 30420) into a ComponentRecord.
 * Returns null if the event is malformed or missing required fields.
 *
 * @typedef {{ id: string, name: string, type: string, avatarId: number,
 *             cellId: bigint, status: boolean, listedAsAsk: boolean,
 *             listedAsDonation: boolean, createdAt: number,
 *             phone: string, workTime: string, _latLng: {lat,lng}|null }} ComponentRecord
 *
 * @param {object} event
 * @returns {ComponentRecord|null}
 */
function _parseEvent(event) {
    try {
        const content = JSON.parse(event.content);
        const getTag  = (k) => event.tags.find(t => t[0] === k)?.[1] ?? '';
        const cellStr = getTag('cell');
        if (!cellStr) return null;

        const cellId = BigInt(cellStr);
        if (cellId <= 0n) return null;

        return {
            id               : event.pubkey,
            name             : content.n   || 'Unknown',
            phone            : content.pN  || '',
            type             : content.cT  || 's',
            avatarId         : content.aI  || 1,
            workTime         : content.wT  || '',
            cellId,
            status           : getTag('status') === '1',
            listedAsAsk      : event.tags.some(t => t[0] === 'listing' && t[1] === 'a'),
            listedAsDonation : event.tags.some(t => t[0] === 'listing' && t[1] === 'd'),
            createdAt        : event.created_at,
            _latLng          : null,   // lazily computed on first getVisible() call
        };
    } catch {
        return null;
    }
}

/**
 * Add a component to the lobby spatial index.
 * Lets the map quickly ask "which components are near lobby X?" without
 * iterating the whole store.
 */
function _indexByLobby(index, comp) {
    try {
        const lobbyId = String(cellToLobby(comp.cellId));
        if (!index.has(lobbyId)) index.set(lobbyId, new Set());
        index.get(lobbyId).add(comp.id);
    } catch {
        // cellId may be out of range for extreme edge cells — just skip indexing
    }
}

// ─── ViewportFilter (used by the map to decide which of the scanner's stored ─
// ─── components to render at any given moment) ────────────────────────────────

/**
 * Given a ComponentScanner and a Leaflet map instance, returns all components
 * whose lat/lng falls within the current viewport — up to `displayLimit`.
 *
 * Call this from the map's 'moveend' and 'zoomend' handlers.
 *
 * @param {ComponentScanner} scanner
 * @param {L.Map}            map
 * @param {number}           [displayLimit]  default 500
 * @returns {ComponentRecord[]}
 */
export function getVisibleComponents(scanner, map, displayLimit = INITIAL_DISPLAY) {
    const bounds = map.getBounds();
    return scanner.getVisible(bounds, displayLimit);
}

/**
 * Small helper: sort an array of ComponentRecords so that "online/open" ones
 * float to the top, then by most-recently-created.
 *
 * @param {ComponentRecord[]} components
 * @returns {ComponentRecord[]}
 */
export function prioritizeComponents(components) {
    return [...components].sort((a, b) => {
        if (a.status !== b.status) return a.status ? -1 : 1;   // online first
        return b.createdAt - a.createdAt;                       // newest first
    });
}

export { INITIAL_DISPLAY };