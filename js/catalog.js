/**
 * DIFP Catalog Module — Encoder / Decoder
 *
 * Implements DIFP compact format (§6):
 * - Listing:           "id:price_cents;id:price_cents;..."
 * - Ask / Donation:    "id;id;id;..."
 *
 * Zero external dependencies.
 */

export class DifpError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DifpError';
    this.code = code;
  }
}

// ── Decoding ──────────────────────────────────────────────────────────────────

/**
 * Decode a listing payload string into CatalogEntry[].
 * All decoded entries are marked available=true (presence = availability).
 *
 * @param payload - Raw DIFP listing string, e.g. "1:4000;2:15000"
 * @returns Array of { productId, price, available }
 */
export function decodeListing(payload) {
  if (!payload || payload.trim() === '') return [];
  const entries = [];
  for (const part of payload.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      throw new DifpError('INVALID_PAYLOAD', `Invalid listing entry: "${trimmed}"`);
    }
    const productId = parseInt(trimmed.slice(0, colonIdx), 10);
    const price = parseInt(trimmed.slice(colonIdx + 1), 10);
    if (isNaN(productId) || isNaN(price)) {
      throw new DifpError('INVALID_PAYLOAD', `Non-numeric listing entry: "${trimmed}"`);
    }
    entries.push({ productId, price, available: true });
  }
  return entries;
}

/**
 * Decode an ask or donation payload string into an array of product IDs.
 *
 * @param payload - Raw DIFP id-list string, e.g. "3;7;44;101"
 * @returns number[]
 */
export function decodeIdList(payload) {
  if (!payload || payload.trim() === '') return [];
  const ids = [];
  for (const part of payload.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const id = parseInt(trimmed, 10);
    if (isNaN(id)) {
      throw new DifpError('INVALID_PAYLOAD', `Non-numeric id-list entry: "${trimmed}"`);
    }
    ids.push(id);
  }
  return ids;
}

// ── Encoding ──────────────────────────────────────────────────────────────────

/**
 * Encode a listing map to DIFP compact format.
 * Only available products are included (presence = availability).
 *
 * @param items - Map<productId, { price, available }>
 * @returns string, e.g. "1:4000;2:15000"
 */
export function encodeListing(items) {
  const parts = [];
  for (const [productId, entry] of items) {
    if (entry.available) {
      parts.push(`${productId}:${entry.price}`);
    }
  }
  return parts.join(';');
}

/**
 * Encode an ask or donation set to DIFP compact format.
 * Only active IDs are included.
 *
 * @param ids - Map<productId, active>
 * @returns string, e.g. "3;7;44"
 */
export function encodeIdList(ids) {
  const parts = [];
  for (const [productId, active] of ids) {
    if (active) {
      parts.push(String(productId));
    }
  }
  return parts.join(';');
}

// ── Price helpers ────────────────────────────────────────────────────────────

/** Convert a USD float (e.g. 40.0) to integer cents (4000) for wire encoding */
export function usdToCents(usd) {
  return Math.round((Number(usd) || 0) * 100);
}

/** Convert integer cents (4000) back to a USD float (40.0) for display */
export function centsToUsd(cents) {
  return (Number(cents) || 0) / 100;
}
