// Pure-math sizing helpers shared between the game screens and their tests.
// No React Native imports — safe to import in vitest (node environment).

// ── Tetris ────────────────────────────────────────────────────────────────────
export const TETRIS_COLS = 10;
export const TETRIS_ROWS = 20;
/** px reserved for header, stats, controls, and safe-area padding */
export const TETRIS_OVERHEAD = 290;
export const TETRIS_MAX_CELL_BY_WIDTH = 28;
export const TETRIS_MIN_CELL = 12;

/**
 * Height-constrained cell size for Tetris.
 * Floors so the board (cellSize × ROWS) never exceeds the available height.
 */
export function tetrisCellSizeByHeight(screenHeight: number): number {
  return Math.floor((screenHeight - TETRIS_OVERHEAD) / TETRIS_ROWS);
}

/**
 * Final Tetris cell size: use the smaller of width- and height-derived sizes,
 * clamped at TETRIS_MIN_CELL for playability.
 */
export function computeTetrisCellSize(
  screenWidth: number,
  screenHeight: number,
): number {
  const byWidth = Math.min(
    Math.floor((screenWidth - 32) / TETRIS_COLS),
    TETRIS_MAX_CELL_BY_WIDTH,
  );
  const byHeight = tetrisCellSizeByHeight(screenHeight);
  return Math.max(Math.min(byWidth, byHeight), TETRIS_MIN_CELL);
}

// ── Block Blitz ───────────────────────────────────────────────────────────────
export const BLOCK_GRID_SIZE = 8;
export const BLOCK_GRID_PAD = 16;
/** px reserved for header, stats, piece tray, and safe-area padding */
export const BLOCK_OVERHEAD = 260;
/**
 * Height-based divisor used in the cell-size formula.
 * 10 = BLOCK_GRID_SIZE (8) + ~2 tray-row factor.
 * The full game-area height consumed in the layout is cellSize × BLOCK_HEIGHT_DIVISOR.
 */
export const BLOCK_HEIGHT_DIVISOR = 10;
export const BLOCK_MIN_CELL = 22;

/**
 * Height-constrained cell size for Block Blitz.
 * Floors so the board + tray never exceed the available height.
 */
export function blockCellSizeByHeight(screenHeight: number): number {
  return Math.floor((screenHeight - BLOCK_OVERHEAD) / BLOCK_HEIGHT_DIVISOR);
}

/**
 * Final Block Blitz cell size: use the smaller of width- and height-derived
 * sizes, clamped at BLOCK_MIN_CELL for tap-target accessibility.
 */
export function computeBlockCellSize(
  screenWidth: number,
  screenHeight: number,
): number {
  const byWidth = Math.floor(
    (Math.min(screenWidth, 420) - BLOCK_GRID_PAD * 2 - BLOCK_GRID_SIZE) /
      BLOCK_GRID_SIZE,
  );
  const byHeight = blockCellSizeByHeight(screenHeight);
  return Math.max(Math.min(byWidth, byHeight), BLOCK_MIN_CELL);
}
