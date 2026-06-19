/**
 * Minimal Nostr client — NIP-01 + NIP-33
 * Uses @noble/curves (Schnorr) and @noble/hashes (SHA-256) — vendored locally.
 */

import { schnorr }    from './vendor/noble-curves-secp256k1.js';
import { sha256 }     from './vendor/noble-hashes-sha256.js';
import { bytesToHex, hexToBytes, randomBytes } from './vendor/noble-hashes-utils.js';

export { bytesToHex, hexToBytes };

const RELAY_URL = 'wss://relay.damus.io';

// ── Keypair ───────────────────────────────────────────────────────────────────

export function generateKeypair() {
  const privKey = schnorr.utils.randomPrivateKey();
  const pubKey  = schnorr.getPublicKey(privKey);
  return { privKey, pubKey, pubKeyHex: bytesToHex(pubKey) };
}

export function loadOrGenerateKeypair() {
  const stored = localStorage.getItem('difp_map_identity');
  if (stored) {
    try {
      const { privKeyHex, pubKeyHex } = JSON.parse(stored);
      const privKey = hexToBytes(privKeyHex);
      return { privKey, pubKeyHex };
    } catch { /* fall through */ }
  }
  const kp = generateKeypair();
  localStorage.setItem('difp_map_identity', JSON.stringify({
    privKeyHex: bytesToHex(kp.privKey),
    pubKeyHex:  kp.pubKeyHex,
  }));
  return kp;
}

// ── Signing ───────────────────────────────────────────────────────────────────

function computeEventId(pubkeyHex, createdAt, kind, tags, content) {
  const str   = JSON.stringify([0, pubkeyHex, createdAt, kind, tags, content]);
  const bytes = new TextEncoder().encode(str);
  return bytesToHex(sha256(bytes));
}

function signEvent(eventIdHex, privKey) {
  const msg = hexToBytes(eventIdHex);
  const aux = randomBytes(32);
  return bytesToHex(schnorr.sign(msg, privKey, aux));
}

function buildEvent(pubkeyHex, privKey, kind, tags, content) {
  const createdAt = Math.floor(Date.now() / 1000);
  const id        = computeEventId(pubkeyHex, createdAt, kind, tags, content);
  const sig       = signEvent(id, privKey);
  return { id, pubkey: pubkeyHex, created_at: createdAt, kind, tags, content, sig };
}

// ── Connection ────────────────────────────────────────────────────────────────

export class NostrClient {
  constructor(onStatusChange) {
    this.ws             = null;
    this.connected      = false;
    this.onStatusChange = onStatusChange || (() => {});
    this.handlers       = new Map();
    this.pendingQueue   = [];
    this._reconnDelay   = 3000;
    this._shouldReconn  = true;
  }

  connect() {
    this.onStatusChange('connecting');
    this.ws = new WebSocket(RELAY_URL);

    this.ws.onopen = () => {
      this.connected    = true;
      this._reconnDelay = 3000;
      this.onStatusChange('connected');
      this.pendingQueue.forEach(msg => this.ws.send(msg));
      this.pendingQueue = [];
    };

    this.ws.onmessage = (ev) => {
      try {
        const msg  = JSON.parse(ev.data);
        const type = msg[0];
        if (type === 'EVENT') {
          const sub = this.handlers.get(msg[1]);
          if (sub?.onEvent) sub.onEvent(msg[2]);
        } else if (type === 'EOSE') {
          const sub = this.handlers.get(msg[1]);
          if (sub?.onEose) sub.onEose();
        } else if (type === 'OK') {
          if (!msg[2]) console.warn('[DIFP] Relay rejected:', msg[3]);
          const sub = this.handlers.get(`ok-${msg[1]}`);
          if (sub?.onOk) sub.onOk(msg[2], msg[3]);
        }
      } catch { /* ignore parse errors */ }
    };

    this.ws.onerror = () => this.onStatusChange('error');
    this.ws.onclose = () => {
      this.connected = false;
      this.onStatusChange('disconnected');
      if (this._shouldReconn) {
        setTimeout(() => this.connect(), this._reconnDelay);
        this._reconnDelay = Math.min(this._reconnDelay * 1.5, 30_000);
      }
    };
  }

  _send(data) {
    const msg = JSON.stringify(data);
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    } else {
      this.pendingQueue.push(msg);
    }
  }

  publish(event, onOk) {
    if (onOk) {
      this.handlers.set(`ok-${event.id}`, { onOk: (ok, reason) => {
          this.handlers.delete(`ok-${event.id}`);
          onOk(ok, reason);
        }});
    }
    this._send(['EVENT', event]);
  }

  subscribe(filter, onEvent, onEose) {
    const subId = `difp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.handlers.set(subId, { onEvent, onEose });
    this._send(['REQ', subId, filter]);
    return { close: () => { this._send(['CLOSE', subId]); this.handlers.delete(subId); } };
  }

  disconnect() {
    this._shouldReconn = false;
    this.ws?.close(1000, 'bye');
  }
}

// ── DIFP event kinds ─────────────────────────────────────────────────────────

const KIND_COMPONENT = 30420;
const KIND_CATALOG   = 30421;

// ── Component (presence) events ─────────────────────────────────────────────

export function publishComponent(client, pubkeyHex, privKey, comp) {
  if (!comp.cellId || comp.cellId === 0n) throw new Error('CELL_NOT_SET');

  const { cellToLobby } = window._difpGeo;
  const lobbyId = cellToLobby(comp.cellId);

  const tags = [
    ['d',       'main'],
    ['t',       'difp'],
    ['t',       comp.type],
    ['cell',    String(comp.cellId)],
    ['lobby',   String(lobbyId)],
    ['t',       `lobby-${lobbyId}`],
    ['status',  comp.status === false ? '0' : '1'],
    ['listing', 'o'],
  ];

  if (comp.listedAsAsk)      tags.push(['listing', 'a']);
  if (comp.listedAsDonation) tags.push(['listing', 'd']);

  tags.push(['catalog', `${pubkeyHex}-l`]);
  if (comp.listedAsAsk)      tags.push(['catalog', `${pubkeyHex}-a`]);
  if (comp.listedAsDonation) tags.push(['catalog', `${pubkeyHex}-d`]);

  tags.push(['updated', String(Math.floor(Date.now() / 1000))]);

  const content = JSON.stringify({
    n:  comp.name,
    pN: comp.phone || '',
    cT: comp.type,
    aI: comp.avatarId,
    wT: comp.workTime || '08:00_20:00',
  });

  const event = buildEvent(pubkeyHex, privKey, KIND_COMPONENT, tags, content);
  client.publish(event);
  return event.id;
}

export function subscribeComponents(client, lobbyIds, onEvent, onEose) {
  const tTags  = lobbyIds.map(id => `lobby-${id}`);
  const filter = {
    kinds: [KIND_COMPONENT],
    '#t':  tTags,
    limit: 500,
    since: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30,
  };
  return client.subscribe(filter, onEvent, onEose);
}

export function parseComponentEvent(event) {
  try {
    const content = JSON.parse(event.content);
    const getTag  = (k) => event.tags.find(t => t[0] === k)?.[1] ?? '';
    const cellStr = getTag('cell');
    const cellId  = cellStr ? BigInt(cellStr) : 0n;
    return {
      id:               event.pubkey,
      name:             content.n  || 'Unknown',
      phone:            content.pN || '',
      type:             content.cT || 's',
      avatarId:         content.aI || 1,
      workTime:         content.wT || '',
      cellId,
      status:           getTag('status') === '1',
      listedAsAsk:      event.tags.some(t => t[0] === 'listing' && t[1] === 'a'),
      listedAsDonation: event.tags.some(t => t[0] === 'listing' && t[1] === 'd'),
      createdAt:        event.created_at,
    };
  } catch { return null; }
}

// ── Catalog events (kind:30421) ──────────────────────────────────────────────

let _catSubCounter = 0;
function newSubId(prefix) {
  return `difp-${prefix}-${Date.now().toString(36)}-${++_catSubCounter}`;
}

export function publishCatalog(client, pubkeyHex, privKey, type, payload) {
  const dTag      = `${pubkeyHex}-${type}`;
  const itemCount = payload === '' ? 0 : payload.split(';').filter(Boolean).length;

  const tags = [
    ['d',       dTag],
    ['type',    type],
    ['catalog', pubkeyHex],
    ['count',   String(itemCount)],
    ['updated', String(Math.floor(Date.now() / 1000))],
  ];

  const event = buildEvent(pubkeyHex, privKey, KIND_CATALOG, tags, payload);
  client.publish(event);
  return event.id;
}

export function fetchCatalog(client, componentId, type, onResult, onEose, timeoutMs = 10_000) {
  const subId = newSubId(`cat-${type}`);
  const dTag  = `${componentId}-${type}`;
  const filter = {
    kinds: [KIND_CATALOG],
    '#d':  [dTag],
    limit: 1,
  };

  let found = false;
  let timeoutHandle;

  const unsub = client.subscribe(
      filter,
      (event) => {
        if (event.kind === KIND_CATALOG) {
          found = true;
          onResult(event.content ?? '');
        }
      },
      () => {
        clearTimeout(timeoutHandle);
        unsub.close();
        if (!found) onResult('');
        onEose();
      },
  );

  timeoutHandle = setTimeout(() => {
    unsub.close();
    if (!found) onResult('');
    onEose();
  }, timeoutMs);

  return () => { clearTimeout(timeoutHandle); unsub.close(); };
}