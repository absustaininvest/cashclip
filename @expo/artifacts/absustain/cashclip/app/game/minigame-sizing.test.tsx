import { describe, it, expect } from "vitest";
import {
  MEMORY_COLUMNS,
  MEMORY_CARD_GAP,
  MEMORY_GRID_PADDING,
  memoryCardWidth,
  memoryCardHeight,
  SOLITAIRE_COLUMNS,
  SOLITAIRE_H_PADDING,
  SOLITAIRE_MAX_CARD_WIDTH,
  solitaireCardWidth,
  SCRATCH_GRID_COLS,
  SCRATCH_H_PAD,
  SCRATCH_MAX_CELL,
  computeScratchCellSize,
  DOMINO_MAX_SIZE,
  DOMINO_SIDE_PADDING,
  DOMINO_WIDTH_DIVISOR,
  dominoPieceSize,
  TAP_FRENZY_AREA_TOP,
  TAP_FRENZY_AREA_BOTTOM,
  tapFrenzyPlayAreaHeight,
  COIN_CATCHER_TOP_CHROME,
  COIN_CATCHER_CATCHER_HEIGHT,
  COIN_CATCHER_BOTTOM_CHROME,
  coinCatcherPlayAreaHeight,
} from "./layout-sizing";

// Representative portrait screen widths (logical points):
//   320 = iPhone SE 1st/2nd gen — narrowest supported
//   375 = iPhone 8 / SE 3rd gen / standard X-class
//   390 = iPhone 14 / 15
//   428 = iPhone 13 Pro Max / 14 Plus
const SCREEN_WIDTHS = [320, 375, 390, 428] as const;

// Representative portrait screen heights:
//   568 = iPhone SE 1st/2nd gen
//   667 = iPhone 8 / SE 3rd gen
//   812 = iPhone X / 11 Pro / 14
//   926 = iPhone 13 Pro Max / 14 Plus
const SCREEN_HEIGHTS = [568, 667, 812, 926] as const;

// Paired dimensions for full device tests
const SCREEN_DIMENSIONS: { w: number; h: number }[] = [
  { w: 320, h: 568 },
  { w: 375, h: 667 },
  { w: 375, h: 812 },
  { w: 428, h: 926 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Memory Match
// Sizing: 3-column grid; cards fill (screenWidth - padding×2 - gap×2) / 3.
// No Math.floor — the division is exact.  Overflow risk: if padding/gap grows,
// the card width on narrow screens can shrink to zero or go negative.
// ─────────────────────────────────────────────────────────────────────────────

describe("Memory Match — memoryCardWidth", () => {
  it("card width is positive on the narrowest supported phone (320 pt)", () => {
    expect(memoryCardWidth(320)).toBeGreaterThan(0);
  });

  for (const w of SCREEN_WIDTHS) {
    it(`three cards + gaps + padding = screenWidth at ${w} pt`, () => {
      const cardWidth = memoryCardWidth(w);
      const consumed =
        cardWidth * MEMORY_COLUMNS +
        MEMORY_CARD_GAP * (MEMORY_COLUMNS - 1) +
        MEMORY_GRID_PADDING * 2;
      expect(consumed).toBeCloseTo(w, 5);
    });

    it(`card width is positive at ${w} pt`, () => {
      expect(memoryCardWidth(w)).toBeGreaterThan(0);
    });
  }

  it("card height is card width × 1.2 (aspect ratio preserved)", () => {
    for (const w of SCREEN_WIDTHS) {
      expect(memoryCardHeight(w)).toBeCloseTo(memoryCardWidth(w) * 1.2, 5);
    }
  });

  it("card width grows as screen width grows", () => {
    const widths = SCREEN_WIDTHS.map(memoryCardWidth);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    }
  });

  it("MEMORY_COLUMNS constant is 3 (sanity-check against source)", () => {
    expect(MEMORY_COLUMNS).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Solitaire
// Sizing: 7-column tableau; card = floor((screenWidth - 48) / 7), capped at 50.
// Math.floor guarantees the 7 cards + padding never exceed the screen width.
// ─────────────────────────────────────────────────────────────────────────────

describe("Solitaire — solitaireCardWidth", () => {
  for (const w of SCREEN_WIDTHS) {
    it(`7 cards + horizontal padding fit within screen at ${w} pt`, () => {
      const cardWidth = solitaireCardWidth(w);
      const consumed = cardWidth * SOLITAIRE_COLUMNS + SOLITAIRE_H_PADDING;
      expect(consumed).toBeLessThanOrEqual(w);
    });

    it(`card width is positive at ${w} pt`, () => {
      expect(solitaireCardWidth(w)).toBeGreaterThan(0);
    });
  }

  it("card width is capped at SOLITAIRE_MAX_CARD_WIDTH on wide screens", () => {
    const cardWidth = solitaireCardWidth(768);
    expect(cardWidth).toBe(SOLITAIRE_MAX_CARD_WIDTH);
  });

  it("card width never exceeds the cap on any supported width", () => {
    for (const w of SCREEN_WIDTHS) {
      expect(solitaireCardWidth(w)).toBeLessThanOrEqual(SOLITAIRE_MAX_CARD_WIDTH);
    }
  });

  it("card width grows (or stays constant at the cap) as screen width grows", () => {
    const widths = SCREEN_WIDTHS.map(solitaireCardWidth);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]);
    }
  });

  it("SOLITAIRE_COLUMNS constant is 7 (sanity-check against source)", () => {
    expect(SOLITAIRE_COLUMNS).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scratch Card
// Sizing: 3×3 grid; cell = min((screenWidth - 80) / 3, 100).
// Cap of 100 fires when screenWidth ≥ 380.  No Math.floor — division is exact.
// ─────────────────────────────────────────────────────────────────────────────

describe("Scratch Card — computeScratchCellSize", () => {
  for (const w of SCREEN_WIDTHS) {
    it(`3 cells + padding fit within screen at ${w} pt (uncapped path)`, () => {
      const cellSize = computeScratchCellSize(w);
      if (cellSize < SCRATCH_MAX_CELL) {
        const consumed = cellSize * SCRATCH_GRID_COLS + SCRATCH_H_PAD;
        expect(consumed).toBeCloseTo(w, 5);
      }
    });

    it(`cell size is positive at ${w} pt`, () => {
      expect(computeScratchCellSize(w)).toBeGreaterThan(0);
    });
  }

  it("cell size is capped at SCRATCH_MAX_CELL on wide screens", () => {
    expect(computeScratchCellSize(768)).toBe(SCRATCH_MAX_CELL);
  });

  it("cell size never exceeds SCRATCH_MAX_CELL on any screen width", () => {
    for (const w of SCREEN_WIDTHS) {
      expect(computeScratchCellSize(w)).toBeLessThanOrEqual(SCRATCH_MAX_CELL);
    }
  });

  it("cell size grows (or stays at cap) as screen width grows", () => {
    const sizes = SCREEN_WIDTHS.map(computeScratchCellSize);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
    }
  });

  it("SCRATCH_GRID_COLS constant is 3 (sanity-check against source)", () => {
    expect(SCRATCH_GRID_COLS).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dominoes
// Sizing: domino pip square = min(30, (screenWidth - 100) / 10).
// On supported phones (≥320 pt) the expression is always positive.
// Cap of 30 fires when screenWidth ≥ 400.
// ─────────────────────────────────────────────────────────────────────────────

describe("Dominoes — dominoPieceSize", () => {
  it("domino size is positive on the narrowest supported phone (320 pt)", () => {
    // (320 - 100) / 10 = 22 → min(30, 22) = 22
    expect(dominoPieceSize(320)).toBeGreaterThan(0);
  });

  it("returns 22 on a 320 pt screen (hand-verified value)", () => {
    expect(dominoPieceSize(320)).toBe(22);
  });

  for (const w of SCREEN_WIDTHS) {
    it(`domino size is positive at ${w} pt`, () => {
      expect(dominoPieceSize(w)).toBeGreaterThan(0);
    });
  }

  it("domino size is capped at DOMINO_MAX_SIZE on wide screens", () => {
    // (400 - 100) / 10 = 30 → cap fires at exactly 400 pt
    expect(dominoPieceSize(400)).toBe(DOMINO_MAX_SIZE);
    expect(dominoPieceSize(768)).toBe(DOMINO_MAX_SIZE);
  });

  it("domino size never exceeds DOMINO_MAX_SIZE on any screen width", () => {
    for (const w of SCREEN_WIDTHS) {
      expect(dominoPieceSize(w)).toBeLessThanOrEqual(DOMINO_MAX_SIZE);
    }
  });

  it("domino size grows (or stays at cap) as screen width grows", () => {
    const sizes = SCREEN_WIDTHS.map(dominoPieceSize);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
    }
  });

  it("DOMINO_MAX_SIZE is 30 and DOMINO_WIDTH_DIVISOR is 10 (sanity-check against source)", () => {
    expect(DOMINO_MAX_SIZE).toBe(30);
    expect(DOMINO_WIDTH_DIVISOR).toBe(10);
    expect(DOMINO_SIDE_PADDING).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tap Frenzy
// Sizing: playAreaHeight = screenHeight - 120 (top chrome) - 100 (bottom) - insets.
// Overflow risk: if overhead constants grow, play area becomes zero or negative
// on small phones, causing coins to spawn at clamped zero height with no room.
// ─────────────────────────────────────────────────────────────────────────────

describe("Tap Frenzy — tapFrenzyPlayAreaHeight", () => {
  it("play area is positive on the smallest phone with zero insets (568 pt)", () => {
    // 568 - 120 - 100 = 348
    expect(tapFrenzyPlayAreaHeight(568, 0, 0)).toBeGreaterThan(0);
  });

  it("returns 348 on 568 pt with zero insets (hand-verified)", () => {
    expect(tapFrenzyPlayAreaHeight(568, 0, 0)).toBe(348);
  });

  for (const h of SCREEN_HEIGHTS) {
    it(`play area is positive on ${h} pt screen with zero insets`, () => {
      expect(tapFrenzyPlayAreaHeight(h, 0, 0)).toBeGreaterThan(0);
    });
  }

  it("play area is positive with typical safe-area insets on an iPhone SE (568 pt)", () => {
    // topInset ≈ 20 (SE has no notch), bottomInset ≈ 0 on SE
    expect(tapFrenzyPlayAreaHeight(568, 20, 0)).toBeGreaterThan(0);
  });

  it("play area is positive with generous insets on a tall notched phone (812 pt)", () => {
    // topInset = 44 (notch), bottomInset = 34 (home indicator)
    expect(tapFrenzyPlayAreaHeight(812, 44, 34)).toBeGreaterThan(0);
  });

  it("play area shrinks as topInset grows", () => {
    const noInset = tapFrenzyPlayAreaHeight(812, 0, 0);
    const withInset = tapFrenzyPlayAreaHeight(812, 44, 0);
    expect(withInset).toBeLessThan(noInset);
  });

  it("play area grows as screen height grows (zero insets)", () => {
    const sizes = SCREEN_HEIGHTS.map((h) => tapFrenzyPlayAreaHeight(h, 0, 0));
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
    }
  });

  it("TAP_FRENZY_AREA_TOP is 120 and TAP_FRENZY_AREA_BOTTOM is 100 (sanity-check against source)", () => {
    expect(TAP_FRENZY_AREA_TOP).toBe(120);
    expect(TAP_FRENZY_AREA_BOTTOM).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Coin Catcher
// Sizing: playAreaTop = topInset + 60; playAreaBottom = h - bottomInset - 60 (40+20).
// Overflow risk: if catcher height or top chrome grows, the two boundaries
// could cross — items would spawn below the catcher, making the game unplayable.
// ─────────────────────────────────────────────────────────────────────────────

describe("Coin Catcher — coinCatcherPlayAreaHeight", () => {
  it("play area height is positive on smallest phone with zero insets (568 pt)", () => {
    // 568 - 60 (top) - 60 (bottom: 40+20) = 448
    expect(coinCatcherPlayAreaHeight(568, 0, 0)).toBeGreaterThan(0);
  });

  it("returns 448 on 568 pt with zero insets (hand-verified)", () => {
    // height = 568 - 0 - 60 - 0 - 60 = 448
    expect(coinCatcherPlayAreaHeight(568, 0, 0)).toBe(448);
  });

  for (const { h } of SCREEN_DIMENSIONS) {
    it(`play area height is positive on ${h} pt screen with zero insets`, () => {
      expect(coinCatcherPlayAreaHeight(h, 0, 0)).toBeGreaterThan(0);
    });
  }

  it("play area height is positive with typical safe-area insets on notched phone (812 pt)", () => {
    // topInset = 44, bottomInset = 34
    expect(coinCatcherPlayAreaHeight(812, 44, 34)).toBeGreaterThan(0);
  });

  it("play area height shrinks as topInset grows", () => {
    const noInset = coinCatcherPlayAreaHeight(812, 0, 0);
    const withInset = coinCatcherPlayAreaHeight(812, 44, 0);
    expect(withInset).toBeLessThan(noInset);
  });

  it("play area height shrinks as bottomInset grows", () => {
    const noInset = coinCatcherPlayAreaHeight(812, 0, 0);
    const withInset = coinCatcherPlayAreaHeight(812, 0, 34);
    expect(withInset).toBeLessThan(noInset);
  });

  it("play area height grows as screen height grows (zero insets)", () => {
    const heights = SCREEN_HEIGHTS.map((h) => coinCatcherPlayAreaHeight(h, 0, 0));
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeGreaterThan(heights[i - 1]);
    }
  });

  it("COIN_CATCHER_CATCHER_HEIGHT is 40 and top chrome is 60 (sanity-check against source)", () => {
    expect(COIN_CATCHER_CATCHER_HEIGHT).toBe(40);
    expect(COIN_CATCHER_TOP_CHROME).toBe(60);
    expect(COIN_CATCHER_BOTTOM_CHROME).toBe(60); // 40 + 20
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Trivia — intentionally out of scope
//
// trivia.tsx imports SCREEN_WIDTH but uses it only for standard flex/text layout
// (progress bar widths, padding).  There is no grid-cell or board-dimension
// computation that could silently produce an overflow on a phone resize.
// ─────────────────────────────────────────────────────────────────────────────
