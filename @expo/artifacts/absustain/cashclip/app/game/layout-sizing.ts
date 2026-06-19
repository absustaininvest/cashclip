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

// ── Coin Catcher ─────────────────────────────────────────────────────────────
/** px of game chrome above the play area (sits directly below the top safe-area inset) */
export const COIN_CATCHER_TOP_CHROME = 60;
/** Height of the draggable catcher bar */
export const COIN_CATCHER_CATCHER_HEIGHT = 40;
/** px of chrome below the play area: catcher height + bottom gap */
export const COIN_CATCHER_BOTTOM_CHROME = COIN_CATCHER_CATCHER_HEIGHT + 20;
/** Diameter of a falling coin/bomb item */
export const COIN_CATCHER_ITEM_SIZE = 36;

/**
 * Height of the Coin Catcher play area (the vertical span items fall through).
 * playAreaTop  = topInset + COIN_CATCHER_TOP_CHROME
 * playAreaBottom = screenHeight - bottomInset - COIN_CATCHER_BOTTOM_CHROME
 */
export function coinCatcherPlayAreaHeight(
  screenHeight: number,
  topInset: number,
  bottomInset: number,
): number {
  return (
    screenHeight -
    topInset -
    COIN_CATCHER_TOP_CHROME -
    bottomInset -
    COIN_CATCHER_BOTTOM_CHROME
  );
}

// ── Tap Frenzy ────────────────────────────────────────────────────────────────
/** px reserved at the top of the screen (header + timer bar) */
export const TAP_FRENZY_AREA_TOP = 120;
/** px reserved at the bottom of the screen (score / combo bar) */
export const TAP_FRENZY_AREA_BOTTOM = 100;
/** Diameter of a tap-frenzy coin target */
export const TAP_FRENZY_COIN_SIZE = 64;

/**
 * Height of the Tap Frenzy spawn area.
 * Mirrors: SCREEN_HEIGHT - PLAY_AREA_TOP - PLAY_AREA_BOTTOM - topInset - bottomInset
 */
export function tapFrenzyPlayAreaHeight(
  screenHeight: number,
  topInset: number,
  bottomInset: number,
): number {
  return (
    screenHeight -
    TAP_FRENZY_AREA_TOP -
    TAP_FRENZY_AREA_BOTTOM -
    topInset -
    bottomInset
  );
}

// ── Memory Match ──────────────────────────────────────────────────────────────
export const MEMORY_COLUMNS = 3;
export const MEMORY_ROWS = 4;
export const MEMORY_CARD_GAP = 12;
export const MEMORY_GRID_PADDING = 24;
/** Card height-to-width ratio */
export const MEMORY_CARD_ASPECT = 1.2;

/** Card width derived from screen width for the 3-column memory grid. */
export function memoryCardWidth(screenWidth: number): number {
  return (
    (screenWidth -
      MEMORY_GRID_PADDING * 2 -
      MEMORY_CARD_GAP * (MEMORY_COLUMNS - 1)) /
    MEMORY_COLUMNS
  );
}

/** Card height = card width × MEMORY_CARD_ASPECT. */
export function memoryCardHeight(screenWidth: number): number {
  return memoryCardWidth(screenWidth) * MEMORY_CARD_ASPECT;
}

/** Total grid height including all rows and gaps. */
export function memoryGridHeight(screenWidth: number): number {
  return (
    MEMORY_ROWS * memoryCardHeight(screenWidth) +
    (MEMORY_ROWS - 1) * MEMORY_CARD_GAP
  );
}

// ── Solitaire ─────────────────────────────────────────────────────────────────
/** Total horizontal padding subtracted before dividing card width across 7 columns */
export const SOLITAIRE_H_PADDING = 48;
export const SOLITAIRE_COLUMNS = 7;
/** Hard upper bound on card width to keep cards manageable on large screens */
export const SOLITAIRE_MAX_CARD_WIDTH = 50;
/** Minimum useful tap-target card width */
export const SOLITAIRE_MIN_CARD_WIDTH = 20;

/** Card width derived from screen width. Mirrors the source formula. */
export function solitaireCardWidth(screenWidth: number): number {
  return Math.min(
    Math.floor((screenWidth - SOLITAIRE_H_PADDING) / SOLITAIRE_COLUMNS),
    SOLITAIRE_MAX_CARD_WIDTH,
  );
}

// ── Dominoes ──────────────────────────────────────────────────────────────────
/** Total horizontal space consumed by padding/borders around the domino chain */
export const DOMINO_SIDE_PADDING = 100;
export const DOMINO_WIDTH_DIVISOR = 10;
/** Hard upper bound on piece size */
export const DOMINO_MAX_SIZE = 30;
/** Minimum useful tap-target piece size */
export const DOMINO_MIN_SIZE = 10;

/** Domino piece size derived from screen width. Mirrors the source formula. */
export function dominoPieceSize(screenWidth: number): number {
  return Math.min(
    DOMINO_MAX_SIZE,
    (screenWidth - DOMINO_SIDE_PADDING) / DOMINO_WIDTH_DIVISOR,
  );
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

// ── Scratch Card ─────────────────────────────────────────────────────────────
export const SCRATCH_GRID_COLS = 3;
export const SCRATCH_H_PAD = 80;
export const SCRATCH_MAX_CELL = 100;

/**
 * Cell size for Scratch Card's 3×3 grid.
 * Capped at SCRATCH_MAX_CELL so cells don't grow unwieldy on wide screens.
 */
export function computeScratchCellSize(screenWidth: number): number {
  return Math.min(
    (screenWidth - SCRATCH_H_PAD) / SCRATCH_GRID_COLS,
    SCRATCH_MAX_CELL,
  );
}
