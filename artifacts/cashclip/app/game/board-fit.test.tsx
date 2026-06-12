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
