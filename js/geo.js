/**
 * MinMax99 spatial grid — pure math, zero dependencies.
 * Identical to the @djowda/difp npm implementation.
 */

export const EARTH_W   = 40_075_000;
export const EARTH_H   = 20_000_000;
export const CELL_SIZE = 500;
export const NUM_ROWS  = 42_000;
export const NUM_COLS  = 82_000;

export const LOBBY_SIZE      = 41;
export const NUM_LOBBY_COLS  = Math.floor(NUM_COLS / LOBBY_SIZE); // 2000
export const NUM_LOBBY_ROWS  = Math.ceil(NUM_ROWS  / LOBBY_SIZE); // 1025

/** lat/lng → cellId (BigInt) */
export function geoToCell(lat, lng) {
  const x = (lng + 180) * (EARTH_W / 360);
  const y = EARTH_H / 2 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
            * (EARTH_H / (2 * Math.PI));
  const xCell = Math.max(0, Math.min(Math.floor(x / CELL_SIZE), NUM_COLS - 1));
  const yCell = Math.max(0, Math.min(Math.floor(y / CELL_SIZE), NUM_ROWS - 1));
  return BigInt(xCell) * BigInt(NUM_ROWS) + BigInt(yCell);
}

/** cellId → [xCell, yCell] */
export function cellToXY(cellId) {
  return [Number(cellId / BigInt(NUM_ROWS)), Number(cellId % BigInt(NUM_ROWS))];
}

/** cellId → lat/lng center */
export function cellToLatLng(cellId) {
  const [xCell, yCell] = cellToXY(cellId);
  const x = (xCell + 0.5) * CELL_SIZE;
  const y = (yCell + 0.5) * CELL_SIZE;
  const lng = (x / EARTH_W) * 360 - 180;
  const latRad = 2 * Math.atan(Math.exp((EARTH_H / 2 - y) * 2 * Math.PI / EARTH_H)) - Math.PI / 2;
  return { lat: latRad * 180 / Math.PI, lng };
}

/** cellId → lobbyId (BigInt) */
export function cellToLobby(cellId) {
  const [xCell, yCell] = cellToXY(cellId);
  const lx = Math.floor(xCell / LOBBY_SIZE);
  const ly = Math.floor(yCell / LOBBY_SIZE);
  return BigInt(lx) * BigInt(NUM_LOBBY_ROWS) + BigInt(ly);
}

/** lobbyId → [lobbyX, lobbyY] */
export function lobbyToXY(lobbyId) {
  return [Number(lobbyId / BigInt(NUM_LOBBY_ROWS)), Number(lobbyId % BigInt(NUM_LOBBY_ROWS))];
}

/** Get nearby lobbies in square range */
export function getNearbyLobbies(centerCellId, range = 5) {
  const baseLobby = cellToLobby(centerCellId);
  const [blx, bly] = lobbyToXY(baseLobby);
  const result = [];
  for (let dx = -range; dx <= range; dx++) {
    for (let dy = -range; dy <= range; dy++) {
      const lx = blx + dx, ly = bly + dy;
      if (lx >= 0 && lx < NUM_LOBBY_COLS && ly >= 0 && ly < NUM_LOBBY_ROWS) {
        result.push(BigInt(lx) * BigInt(NUM_LOBBY_ROWS) + BigInt(ly));
      }
    }
  }
  return result;
}

/** Convert map bounds to lobby IDs covering the visible area */
export function boundsToLobbies(north, south, east, west) {
  const points = [
    [north, west], [north, east], [south, west], [south, east],
    [(north + south) / 2, (east + west) / 2],
  ];
  const seen = new Set();
  for (const [lat, lng] of points) {
    try {
      const cellId   = geoToCell(lat, lng);
      const lobbyId  = cellToLobby(cellId);
      const [lx, ly] = lobbyToXY(lobbyId);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nx = lx + dx, ny = ly + dy;
          if (nx >= 0 && nx < NUM_LOBBY_COLS && ny >= 0 && ny < NUM_LOBBY_ROWS) {
            seen.add(String(BigInt(nx) * BigInt(NUM_LOBBY_ROWS) + BigInt(ny)));
          }
        }
      }
    } catch { /* clamp errors at poles */ }
  }
  return [...seen].map(s => BigInt(s));
}
