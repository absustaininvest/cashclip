import { describe, it, expect } from "vitest";
import {
  TETRIS_ROWS,
  TETRIS_OVERHEAD,
  TETRIS_MIN_CELL,
  BLOCK_GRID_SIZE,
  BLOCK_OVERHEAD,
  BLOCK_HEIGHT_DIVISOR,
  BLOCK_MIN_CELL,
  tetrisCellSizeByHeight,
  computeTetrisCellSize,
  blockCellSizeByHeight,
  computeBlockCellSize,
  COIN_CATCHER_TOP_CHROME,
  COIN_CATCHER_CATCHER_HEIGHT,
  COIN_CATCHER_BOTTOM_CHROME,
  COIN_CATCHER_ITEM_SIZE,
  coinCatcherPlayAreaHeight,
  TAP_FRENZY_AREA_TOP,
  TAP_FRENZY_AREA_BOTTOM,
  TAP_FRENZY_COIN_SIZE,
  tapFrenzyPlayAreaHeight,
  MEMORY_COLUMNS,
  MEMORY_ROWS,
  MEMORY_CARD_GAP,
  MEMORY_GRID_PADDING,
  memoryCardWidth,
  memoryCardHeight,
  memoryGridHeight,
  SOLITAIRE_MIN_CARD_WIDTH,
  solitaireCardWidth,
  DOMINO_MIN_SIZE,
  dominoPieceSize,
} from "./layout-sizing";

// Representative screen heights (portrait, logical points):
// 568 = iPhone SE 1st/2nd gen — smallest supported
// 667 = iPhone 8 / SE 3rd gen
// 812 = iPhone X / 11 Pro
// 926 = iPhone 13 Pro Max / 14 Plus
const SCREEN_HEIGHTS = [568, 667, 812, 926] as const;

// Widths at each height for a typical phone (used for integrated cell-size tests)
const SCREEN_DIMENSIONS: { w: number; h: number }[] = [
  { w: 320, h: 568 }, // SE 1st/2nd
  { w: 375, h: 667 }, // iPhone 8
  { w: 375, h: 812 }, // iPhone X
  { w: 428, h: 926 }, // iPhone 13 Pro Max
];

// ─────────────────────────────────────────────────────────────────────────────
// Tetris
// ─────────────────────────────────────────────────────────────────────────────

describe("Tetris CELL_SIZE_BY_HEIGHT — board fits without scrolling", () => {
  for (const h of SCREEN_HEIGHTS) {
    it(`board height ≤ available height at ${h}pt`, () => {
      // When height is the bottleneck (width sentinel = large number), the cell
      // size equals tetrisCellSizeByHeight(h) and board = cellSize × ROWS must
      // fit within the space left after the overhead chrome.
      const cellSize = computeTetrisCellSize(9999, h);
      const boardHeight = cellSize * TETRIS_ROWS;
      const available = h - TETRIS_OVERHEAD;
      expect(boardHeight).toBeLessThanOrEqual(available);
    });
  }

  for (const { w, h } of SCREEN_DIMENSIONS) {
    it(`board fits at realistic dimensions ${w}×${h}`, () => {
      const cellSize = computeTetrisCellSize(w, h);
      const boardHeight = cellSize * TETRIS_ROWS;
      const available = h - TETRIS_OVERHEAD;
      expect(boardHeight).toBeLessThanOrEqual(available);
    });
  }

  it("height-based cell size is not clamped to the floor at 568pt (iPhone SE)", () => {
    // If tetrisCellSizeByHeight(568) < TETRIS_MIN_CELL the minimum clamp fires
    // and the board overflows by (TETRIS_MIN_CELL - byHeight) × ROWS pixels.
    // Regression sentinel: catching an increase in TETRIS_OVERHEAD that pushes
    // SE below the playability floor.
    expect(tetrisCellSizeByHeight(568)).toBeGreaterThanOrEqual(TETRIS_MIN_CELL);
  });

  it("cell size stays at or above the minimum on every supported screen", () => {
    for (const h of SCREEN_HEIGHTS) {
      expect(computeTetrisCellSize(9999, h)).toBeGreaterThanOrEqual(
        TETRIS_MIN_CELL,
      );
    }
  });

  it("cell size grows as screen height grows", () => {
    const sizes = SCREEN_HEIGHTS.map((h) => tetrisCellSizeByHeight(h));
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Block Blitz
// ─────────────────────────────────────────────────────────────────────────────

describe("Block Blitz CELL_SIZE_BY_HEIGHT — board + tray fit without scrolling", () => {
  for (const h of SCREEN_HEIGHTS) {
    it(`layout height (board + tray) ≤ available height at ${h}pt`, () => {
      // CELL_SIZE × BLOCK_HEIGHT_DIVISOR covers the grid rows (BLOCK_GRID_SIZE=8)
      // plus the piece-tray factor. The formula uses divisor 10 so that
      // floor((h - OVERHEAD) / 10) × 10 ≤ h - OVERHEAD by definition.
      const cellSize = computeBlockCellSize(9999, h);
      const layoutHeight = cellSize * BLOCK_HEIGHT_DIVISOR;
      const available = h - BLOCK_OVERHEAD;
      expect(layoutHeight).toBeLessThanOrEqual(available);
    });
  }

  for (const { w, h } of SCREEN_DIMENSIONS) {
    it(`board fits at realistic dimensions ${w}×${h}`, () => {
      const cellSize = computeBlockCellSize(w, h);
      const layoutHeight = cellSize * BLOCK_HEIGHT_DIVISOR;
      const available = h - BLOCK_OVERHEAD;
      expect(layoutHeight).toBeLessThanOrEqual(available);
    });
  }

  it("height-based cell size exceeds the minimum at 568pt (iPhone SE)", () => {
    // If blockCellSizeByHeight(568) < BLOCK_MIN_CELL the tap-target floor fires
    // and the layout overflows. Sentinel: any increase to BLOCK_OVERHEAD must
    // keep (568 - BLOCK_OVERHEAD) / BLOCK_HEIGHT_DIVISOR ≥ BLOCK_MIN_CELL.
    expect(blockCellSizeByHeight(568)).toBeGreaterThanOrEqual(BLOCK_MIN_CELL);
  });

  it("cell size stays at or above the minimum on every supported screen", () => {
    for (const h of SCREEN_HEIGHTS) {
      expect(computeBlockCellSize(9999, h)).toBeGreaterThanOrEqual(
        BLOCK_MIN_CELL,
      );
    }
  });

  it("cell size grows as screen height grows", () => {
    const sizes = SCREEN_HEIGHTS.map((h) => blockCellSizeByHeight(h));
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
    }
  });

  it("BLOCK_GRID_SIZE constant is 8 (sanity-check against source)", () => {
    expect(BLOCK_GRID_SIZE).toBe(8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Coin Catcher
// ─────────────────────────────────────────────────────────────────────────────

describe("Coin Catcher play area — items fall without leaving the screen", () => {
  // The play area is bounded by: playAreaTop = topInset + TOP_CHROME (60 px)
  // and playAreaBottom = screenHeight - bottomInset - BOTTOM_CHROME (60 px).
  // If the play area height collapses to ≤ 0 the catcher sits above or at the
  // spawn point, making the game unplayable.

  it("chrome constants match expected source values (sanity-check)", () => {
    expect(COIN_CATCHER_TOP_CHROME).toBe(60);
    expect(COIN_CATCHER_CATCHER_HEIGHT).toBe(40);
    expect(COIN_CATCHER_BOTTOM_CHROME).toBe(COIN_CATCHER_CATCHER_HEIGHT + 20);
    expect(COIN_CATCHER_BOTTOM_CHROME).toBe(60);
  });

  it("play area height > ITEM_SIZE on iPhone SE (web insets 67/34)", () => {
    const h = coinCatcherPlayAreaHeight(568, 67, 34);
    expect(h).toBeGreaterThan(COIN_CATCHER_ITEM_SIZE);
  });

  it("play area height > ITEM_SIZE on iPhone SE with zero safe-area insets", () => {
    const h = coinCatcherPlayAreaHeight(568, 0, 0);
    expect(h).toBeGreaterThan(COIN_CATCHER_ITEM_SIZE);
  });

  it("play area height > ITEM_SIZE on iPhone SE with typical native insets (44/34)", () => {
    const h = coinCatcherPlayAreaHeight(568, 44, 34);
    expect(h).toBeGreaterThan(COIN_CATCHER_ITEM_SIZE);
  });

  it("play area height grows as screen height grows", () => {
    const heights = SCREEN_HEIGHTS.map((h) =>
      coinCatcherPlayAreaHeight(h, 44, 34),
    );
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeGreaterThan(heights[i - 1]);
    }
  });

  it("play area is positive on every supported screen (web insets)", () => {
    for (const h of SCREEN_HEIGHTS) {
      expect(coinCatcherPlayAreaHeight(h, 67, 34)).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tap Frenzy
// ─────────────────────────────────────────────────────────────────────────────

describe("Tap Frenzy spawn area — at least one coin fits vertically", () => {
  // Coins spawn at a random y within [0, playAreaHeight - COIN_SIZE].
  // If playAreaHeight < COIN_SIZE the y-range collapses and coins are never
  // placed inside the visible bounds.

  it("chrome constants match expected source values (sanity-check)", () => {
    expect(TAP_FRENZY_AREA_TOP).toBe(120);
    expect(TAP_FRENZY_AREA_BOTTOM).toBe(100);
    expect(TAP_FRENZY_COIN_SIZE).toBe(64);
  });

  it("play area height ≥ COIN_SIZE on iPhone SE (web insets 67/34)", () => {
    const h = tapFrenzyPlayAreaHeight(568, 67, 34);
    expect(h).toBeGreaterThanOrEqual(TAP_FRENZY_COIN_SIZE);
  });

  it("play area height ≥ COIN_SIZE on iPhone SE with zero safe-area insets", () => {
    const h = tapFrenzyPlayAreaHeight(568, 0, 0);
    expect(h).toBeGreaterThanOrEqual(TAP_FRENZY_COIN_SIZE);
  });

  it("play area height ≥ COIN_SIZE on iPhone SE with typical native insets (44/34)", () => {
    const h = tapFrenzyPlayAreaHeight(568, 44, 34);
    expect(h).toBeGreaterThanOrEqual(TAP_FRENZY_COIN_SIZE);
  });

  it("play area height grows as screen height grows", () => {
    const heights = SCREEN_HEIGHTS.map((h) =>
      tapFrenzyPlayAreaHeight(h, 44, 34),
    );
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeGreaterThan(heights[i - 1]);
    }
  });

  it("play area is positive on every supported screen (web insets)", () => {
    for (const h of SCREEN_HEIGHTS) {
      expect(tapFrenzyPlayAreaHeight(h, 67, 34)).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Memory Match
// ─────────────────────────────────────────────────────────────────────────────

describe("Memory Match card sizing — grid is usable on narrow screens", () => {
  // Memory Match derives card width from screen width, not height; the grid
  // sits inside a ScrollView. These tests guard against a future COLUMNS or
  // PADDING change that squashes cards to zero (un-tappable) on a 320 pt SE.

  it("card width is positive on iPhone SE width (320 pt)", () => {
    expect(memoryCardWidth(320)).toBeGreaterThan(0);
  });

  it("card height is positive on iPhone SE width (320 pt)", () => {
    expect(memoryCardHeight(320)).toBeGreaterThan(0);
  });

  it("card width is at least 60 pt on iPhone SE (minimum tap target)", () => {
    // 3 columns in 320 pt minus padding/gaps ≈ 82 pt; sentinel catches any
    // increase to COLUMNS, GRID_PADDING, or CARD_GAP that shrinks cards below
    // a comfortable tap target.
    expect(memoryCardWidth(320)).toBeGreaterThanOrEqual(60);
  });

  it("grid height is positive on iPhone SE width (320 pt)", () => {
    expect(memoryGridHeight(320)).toBeGreaterThan(0);
  });

  it("MEMORY_COLUMNS × MEMORY_ROWS equals TOTAL_CARDS (12)", () => {
    expect(MEMORY_COLUMNS * MEMORY_ROWS).toBe(12);
  });

  it("card gap and padding constants match source values", () => {
    expect(MEMORY_CARD_GAP).toBe(12);
    expect(MEMORY_GRID_PADDING).toBe(24);
  });

  it("card width grows as screen width grows", () => {
    const widths = [320, 375, 414, 428].map(memoryCardWidth);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Solitaire
// ─────────────────────────────────────────────────────────────────────────────

describe("Solitaire card sizing — 7-column tableau fits on narrow screens", () => {
  // Solitaire packs 7 tableau columns across the full screen width. If the
  // padding constant grows or a margin is added, card width can drop below a
  // usable tap target. Tests guard against that regression.

  it("card width is at least SOLITAIRE_MIN_CARD_WIDTH on iPhone SE (320 pt)", () => {
    expect(solitaireCardWidth(320)).toBeGreaterThanOrEqual(
      SOLITAIRE_MIN_CARD_WIDTH,
    );
  });

  it("card width is positive on iPhone SE (320 pt)", () => {
    expect(solitaireCardWidth(320)).toBeGreaterThan(0);
  });

  it("card width is capped at 50 pt on large screens", () => {
    // On a wide tablet the formula would produce > 50; the cap keeps cards
    // from becoming oversized.
    expect(solitaireCardWidth(1024)).toBe(50);
  });

  it("card width grows with screen width up to the cap", () => {
    const narrow = solitaireCardWidth(320);
    const medium = solitaireCardWidth(375);
    expect(medium).toBeGreaterThanOrEqual(narrow);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dominoes
// ─────────────────────────────────────────────────────────────────────────────

describe("Dominoes piece sizing — tiles are tappable on narrow screens", () => {
  // Domino piece size is computed from screen width with a hard cap of 30 pt.
  // On a 320 pt SE the formula gives 22 pt; if DOMINO_SIDE_PADDING grows
  // beyond (320 - DOMINO_MIN_SIZE × DOMINO_WIDTH_DIVISOR) the tile collapses.

  it("piece size is at least DOMINO_MIN_SIZE on iPhone SE (320 pt)", () => {
    expect(dominoPieceSize(320)).toBeGreaterThanOrEqual(DOMINO_MIN_SIZE);
  });

  it("piece size is positive on iPhone SE (320 pt)", () => {
    expect(dominoPieceSize(320)).toBeGreaterThan(0);
  });

  it("piece size is capped at 30 pt on large screens", () => {
    expect(dominoPieceSize(1024)).toBe(30);
  });

  it("piece size grows with screen width up to the cap", () => {
    const narrow = dominoPieceSize(320);
    const medium = dominoPieceSize(375);
    expect(medium).toBeGreaterThanOrEqual(narrow);
  });
});
