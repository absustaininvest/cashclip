// @vitest-environment node
//
// Tests for the rotation / responsive-layout behaviour in both game screens.
//
// Coverage:
//  1. computeTetrisCellSize  — portrait, landscape, edge, width-tight, height-tight
//  2. computeBlockCellSize   — same axes
//  3. Component hook harness — simulates a Dimensions change event and asserts
//     that the cellSize derived state updates to match the new dimensions.
//
// The layout-sizing module deliberately has no React Native imports so sections
// 1–2 can run as pure-math unit tests in Node, without any native mocking.
// Section 3 uses a minimal Dimensions shim that captures "change" callbacks.

import { describe, it, expect, beforeEach, vi } from "vitest";
import React, { useState, useEffect } from "react";
import TestRenderer, { act } from "react-test-renderer";

import {
  TETRIS_MIN_CELL,
  TETRIS_MAX_CELL_BY_WIDTH,
  BLOCK_MIN_CELL,
  computeTetrisCellSize,
  computeBlockCellSize,
} from "./layout-sizing";

// ─────────────────────────────────────────────────────────────────────────────
// react-native Dimensions shim
//
// vi.mock is hoisted to the top of the file by Vitest so we store shared state
// on globalThis — the factory function runs lazily (first import), by which
// point globalThis has already been augmented.
// ─────────────────────────────────────────────────────────────────────────────

type DimWindow = { width: number; height: number };
type DimCallback = (e: { window: DimWindow }) => void;

vi.mock("react-native", () => {
  const cbs: DimCallback[] = [];
  (globalThis as any).__rnDimCbs = cbs;
  (globalThis as any).__rnDimWindow = { width: 375, height: 812 };

  return {
    Dimensions: {
      get: (_key: string) => (globalThis as any).__rnDimWindow as DimWindow,
      addEventListener: (_event: string, cb: DimCallback) => {
        cbs.push(cb);
        return {
          remove: () => {
            const i = cbs.indexOf(cb);
            if (i !== -1) cbs.splice(i, 1);
          },
        };
      },
    },
  };
});

import { Dimensions } from "react-native";

function setInitialDim(w: number, h: number) {
  (globalThis as any).__rnDimWindow = { width: w, height: h };
}

function fireDimensionChange(w: number, h: number) {
  const cbs: DimCallback[] = (globalThis as any).__rnDimCbs;
  for (const cb of [...cbs]) cb({ window: { width: w, height: h } });
}

function clearDimListeners() {
  ((globalThis as any).__rnDimCbs as DimCallback[]).length = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal test harness — mirrors the hook pattern in both game screens:
//
//   const [dimensions, setDimensions] = useState(() => Dimensions.get("window"));
//   const cellSize = computeXxxCellSize(dimensions.width, dimensions.height);
//   useEffect(() => {
//     const sub = Dimensions.addEventListener("change", ({ window }) => setDimensions(window));
//     return () => sub.remove();
//   }, []);
// ─────────────────────────────────────────────────────────────────────────────

function TetrisCellTracker() {
  const [dims, setDims] = useState<DimWindow>(() => Dimensions.get("window"));
  const cellSize = computeTetrisCellSize(dims.width, dims.height);
  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) =>
      setDims(window),
    );
    return () => sub.remove();
  }, []);
  return React.createElement("span", { "data-size": cellSize }, String(cellSize));
}

function BlockCellTracker() {
  const [dims, setDims] = useState<DimWindow>(() => Dimensions.get("window"));
  const cellSize = computeBlockCellSize(dims.width, dims.height);
  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) =>
      setDims(window),
    );
    return () => sub.remove();
  }, []);
  return React.createElement("span", { "data-size": cellSize }, String(cellSize));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. computeTetrisCellSize unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe("computeTetrisCellSize", () => {
  describe("portrait dimensions", () => {
    it("returns a positive integer for a typical portrait phone (375×812)", () => {
      const cs = computeTetrisCellSize(375, 812);
      expect(cs).toBeGreaterThan(0);
      expect(Number.isInteger(cs)).toBe(true);
    });

    it("is height-tight on 375×812 — byHeight (26) beats byWidth (28)", () => {
      // byWidth = min(floor((375-32)/10), 28) = min(34, 28) = 28
      // byHeight = floor((812-290)/20) = floor(522/20) = 26
      // result = max(min(28, 26), 12) = 26
      expect(computeTetrisCellSize(375, 812)).toBe(26);
    });

    it("is height-tight on SE-class screen (320×568)", () => {
      // byWidth = min(floor(288/10), 28) = 28
      // byHeight = floor(278/20) = 13
      // result = max(min(28, 13), 12) = 13
      expect(computeTetrisCellSize(320, 568)).toBe(13);
    });
  });

  describe("landscape dimensions", () => {
    it("returns a smaller cell size in landscape than portrait", () => {
      const portrait = computeTetrisCellSize(375, 812);
      const landscape = computeTetrisCellSize(812, 375);
      expect(landscape).toBeLessThan(portrait);
    });

    it("hits the minimum clamp on a typical landscape phone (812×375)", () => {
      // byHeight = floor((375-290)/20) = floor(85/20) = 4 — below TETRIS_MIN_CELL
      expect(computeTetrisCellSize(812, 375)).toBe(TETRIS_MIN_CELL);
    });

    it("hits the minimum clamp on a wider landscape phone (926×428)", () => {
      // byHeight = floor((428-290)/20) = floor(138/20) = 6 — still below min
      expect(computeTetrisCellSize(926, 428)).toBe(TETRIS_MIN_CELL);
    });
  });

  describe("width-tight case", () => {
    it("returns byWidth when the screen is very tall (430×932)", () => {
      // byWidth = min(floor((430-32)/10), 28) = min(39, 28) = 28
      // byHeight = floor((932-290)/20) = floor(642/20) = 32  > 28
      // result = max(min(28, 32), 12) = 28
      expect(computeTetrisCellSize(430, 932)).toBe(TETRIS_MAX_CELL_BY_WIDTH);
    });

    it("returns byWidth when the screen is narrow (200×900)", () => {
      // byWidth = min(floor((200-32)/10), 28) = min(16, 28) = 16
      // byHeight = floor((900-290)/20) = 30 — larger than byWidth
      // result = max(min(16, 30), 12) = 16
      expect(computeTetrisCellSize(200, 900)).toBe(16);
    });
  });

  describe("minimum clamp edge values", () => {
    it("never returns below TETRIS_MIN_CELL regardless of screen height", () => {
      // extreme: only 100 px of height available
      expect(computeTetrisCellSize(375, 100)).toBe(TETRIS_MIN_CELL);
    });

    it("never returns below TETRIS_MIN_CELL for a 1×1 screen", () => {
      expect(computeTetrisCellSize(1, 1)).toBe(TETRIS_MIN_CELL);
    });

    it("crosses the clamp boundary exactly at the transition height", () => {
      // TETRIS_MIN_CELL = 12; clamp fires when byHeight < 12
      // byHeight = floor((h - 290) / 20) = 12  →  h = 290 + 240 = 530
      // At h = 530: byHeight = 12 → no clamp
      // At h = 529: byHeight = 11 → clamp
      const atBoundary = computeTetrisCellSize(9999, 530);
      const justBelow = computeTetrisCellSize(9999, 529);
      expect(atBoundary).toBeGreaterThanOrEqual(TETRIS_MIN_CELL);
      expect(justBelow).toBe(TETRIS_MIN_CELL);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. computeBlockCellSize unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe("computeBlockCellSize", () => {
  describe("portrait dimensions", () => {
    it("returns a positive integer for a typical portrait phone (375×812)", () => {
      const cs = computeBlockCellSize(375, 812);
      expect(cs).toBeGreaterThan(0);
      expect(Number.isInteger(cs)).toBe(true);
    });

    it("is width-tight on 375×812 — byWidth (41) beats byHeight (55)", () => {
      // byWidth = floor((min(375,420)-32-8)/8) = floor(335/8) = 41
      // byHeight = floor((812-260)/10) = floor(552/10) = 55
      // result = max(min(41, 55), 22) = 41
      expect(computeBlockCellSize(375, 812)).toBe(41);
    });

    it("is width-tight on a narrow portrait (320×812)", () => {
      // byWidth = floor((320-40)/8) = floor(280/8) = 35
      // byHeight = 55
      // result = max(min(35, 55), 22) = 35
      expect(computeBlockCellSize(320, 812)).toBe(35);
    });
  });

  describe("landscape dimensions", () => {
    it("returns a smaller cell size in landscape than portrait", () => {
      const portrait = computeBlockCellSize(375, 812);
      const landscape = computeBlockCellSize(812, 375);
      expect(landscape).toBeLessThan(portrait);
    });

    it("hits the minimum clamp on a typical landscape phone (812×375)", () => {
      // byWidth = floor((min(812,420)-40)/8) = floor(380/8) = 47
      // byHeight = floor((375-260)/10) = floor(115/10) = 11 — below BLOCK_MIN_CELL
      expect(computeBlockCellSize(812, 375)).toBe(BLOCK_MIN_CELL);
    });

    it("hits the minimum clamp on a wider landscape phone (926×428)", () => {
      // byHeight = floor((428-260)/10) = floor(168/10) = 16 — below BLOCK_MIN_CELL(22)
      expect(computeBlockCellSize(926, 428)).toBe(BLOCK_MIN_CELL);
    });
  });

  describe("minimum clamp edge values", () => {
    it("never returns below BLOCK_MIN_CELL regardless of screen height", () => {
      expect(computeBlockCellSize(375, 100)).toBe(BLOCK_MIN_CELL);
    });

    it("never returns below BLOCK_MIN_CELL for a 1×1 screen", () => {
      expect(computeBlockCellSize(1, 1)).toBe(BLOCK_MIN_CELL);
    });

    it("crosses the clamp boundary exactly at the transition height", () => {
      // BLOCK_MIN_CELL = 22; clamp fires when byHeight < 22
      // byHeight = floor((h - 260) / 10) = 22  →  h = 260 + 220 = 480
      // At h = 480: byHeight = 22 → no clamp
      // At h = 479: byHeight = 21 → clamp
      const atBoundary = computeBlockCellSize(9999, 480);
      const justBelow = computeBlockCellSize(9999, 479);
      expect(atBoundary).toBeGreaterThanOrEqual(BLOCK_MIN_CELL);
      expect(justBelow).toBe(BLOCK_MIN_CELL);
    });
  });

  describe("width cap at 420 px logical", () => {
    it("wide screens (> 420 px) produce the same byWidth as exactly 420 px screens", () => {
      // The formula clamps screenWidth at 420 before computing byWidth.
      const at420 = computeBlockCellSize(420, 812);
      const wider = computeBlockCellSize(768, 812);
      expect(wider).toBe(at420);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Dimensions.addEventListener listener — cellSize updates on rotation
//
// Each test:
//  • mounts the harness component at portrait dimensions
//  • reads the initial cellSize from the rendered output
//  • fires a synthetic Dimensions "change" event with landscape dimensions
//  • asserts the rendered cellSize now matches the landscape value
// ─────────────────────────────────────────────────────────────────────────────

describe("Dimensions listener — Tetris cellSize updates on rotation", () => {
  beforeEach(() => {
    setInitialDim(375, 812);
    clearDimListeners();
  });

  it("fires the change callback and reduces cellSize when rotating to landscape", () => {
    const portraitSize = computeTetrisCellSize(375, 812);
    const landscapeSize = computeTetrisCellSize(812, 375);

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(TetrisCellTracker));
    });

    expect(renderer.toJSON()).toMatchObject({
      props: { "data-size": portraitSize },
    });

    act(() => fireDimensionChange(812, 375));

    expect(renderer.toJSON()).toMatchObject({
      props: { "data-size": landscapeSize },
    });
    expect(landscapeSize).toBeLessThan(portraitSize);

    renderer.unmount();
  });

  it("returns to portrait size when rotating back", () => {
    const portraitSize = computeTetrisCellSize(375, 812);
    const landscapeSize = computeTetrisCellSize(812, 375);

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(TetrisCellTracker));
    });

    act(() => fireDimensionChange(812, 375));
    expect(renderer.toJSON()).toMatchObject({ props: { "data-size": landscapeSize } });

    act(() => fireDimensionChange(375, 812));
    expect(renderer.toJSON()).toMatchObject({ props: { "data-size": portraitSize } });

    renderer.unmount();
  });

  it("removes the listener on unmount so no further updates occur", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(TetrisCellTracker));
    });

    act(() => renderer.unmount());

    const listenerCount = ((globalThis as any).__rnDimCbs as DimCallback[]).length;
    expect(listenerCount).toBe(0);
  });
});

describe("Dimensions listener — Block Blitz cellSize updates on rotation", () => {
  beforeEach(() => {
    setInitialDim(375, 812);
    clearDimListeners();
  });

  it("fires the change callback and reduces cellSize when rotating to landscape", () => {
    const portraitSize = computeBlockCellSize(375, 812);
    const landscapeSize = computeBlockCellSize(812, 375);

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(BlockCellTracker));
    });

    expect(renderer.toJSON()).toMatchObject({
      props: { "data-size": portraitSize },
    });

    act(() => fireDimensionChange(812, 375));

    expect(renderer.toJSON()).toMatchObject({
      props: { "data-size": landscapeSize },
    });
    expect(landscapeSize).toBeLessThan(portraitSize);

    renderer.unmount();
  });

  it("returns to portrait size when rotating back", () => {
    const portraitSize = computeBlockCellSize(375, 812);
    const landscapeSize = computeBlockCellSize(812, 375);

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(BlockCellTracker));
    });

    act(() => fireDimensionChange(812, 375));
    expect(renderer.toJSON()).toMatchObject({ props: { "data-size": landscapeSize } });

    act(() => fireDimensionChange(375, 812));
    expect(renderer.toJSON()).toMatchObject({ props: { "data-size": portraitSize } });

    renderer.unmount();
  });

  it("removes the listener on unmount so no further updates occur", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(BlockCellTracker));
    });

    act(() => renderer.unmount());

    const listenerCount = ((globalThis as any).__rnDimCbs as DimCallback[]).length;
    expect(listenerCount).toBe(0);
  });
});
