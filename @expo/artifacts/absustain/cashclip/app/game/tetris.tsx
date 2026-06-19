import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Dimensions,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/LanguageContext";
import { recordGamePlay, canPlayGame, formatPoints } from "@/lib/storage";
import { useGameEarn } from "@/lib/use-game-earn";

import {
  TETRIS_COLS,
  TETRIS_ROWS,
  computeTetrisCellSize,
} from "./layout-sizing";

const COLS = TETRIS_COLS;
const ROWS = TETRIS_ROWS;

function computeCellSize(w: number, h: number): number {
  return computeTetrisCellSize(w, h);
}

type Grid = (string | null)[][];

interface Position {
  row: number;
  col: number;
}

interface Piece {
  shape: number[][];
  color: string;
  type: string;
}

const TETROMINOES: Record<string, { shape: number[][]; color: string }> = {
  I: { shape: [[1, 1, 1, 1]], color: "#00BCD4" },
  O: { shape: [[1, 1], [1, 1]], color: "#FFD600" },
  T: { shape: [[0, 1, 0], [1, 1, 1]], color: "#9C27B0" },
  S: { shape: [[0, 1, 1], [1, 1, 0]], color: "#00E676" },
  Z: { shape: [[1, 1, 0], [0, 1, 1]], color: "#FF5252" },
  J: { shape: [[1, 0, 0], [1, 1, 1]], color: "#448AFF" },
  L: { shape: [[0, 0, 1], [1, 1, 1]], color: "#FF9100" },
};

const PIECE_TYPES = ["I", "O", "T", "S", "Z", "J", "L"];

function createEmptyGrid(): Grid {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function randomPiece(): Piece {
  const type = PIECE_TYPES[Math.floor(Math.random() * PIECE_TYPES.length)];
  const t = TETROMINOES[type];
  return { shape: t.shape.map((r) => [...r]), color: t.color, type };
}

function rotateShape(shape: number[][]): number[][] {
  const rows = shape.length;
  const cols = shape[0].length;
  const rotated: number[][] = Array.from({ length: cols }, () => Array(rows).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      rotated[c][rows - 1 - r] = shape[r][c];
    }
  }
  return rotated;
}

function isValidPosition(grid: Grid, shape: number[][], pos: Position): boolean {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c]) {
        const nr = pos.row + r;
        const nc = pos.col + c;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return false;
        if (grid[nr][nc] !== null) return false;
      }
    }
  }
  return true;
}

function placePiece(grid: Grid, shape: number[][], pos: Position, color: string): Grid {
  const newGrid = grid.map((row) => [...row]);
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c]) {
        newGrid[pos.row + r][pos.col + c] = color;
      }
    }
  }
  return newGrid;
}

function clearLines(grid: Grid): { newGrid: Grid; cleared: number } {
  const newGrid = grid.filter((row) => row.some((cell) => cell === null));
  const cleared = ROWS - newGrid.length;
  while (newGrid.length < ROWS) {
    newGrid.unshift(Array(COLS).fill(null));
  }
  return { newGrid, cleared };
}

function getDropSpeed(lvl: number): number {
  return Math.max(100, 800 - (lvl - 1) * 50);
}

function NextPiecePreview({ piece }: { piece: Piece }) {
  const previewSize = 14;
  const shape = piece.shape;
  const maxRows = 4;
  const maxCols = 4;

  return (
    <View style={styles.nextBox}>
      <Text style={styles.nextLabel}>Next</Text>
      <View style={styles.nextGrid}>
        {Array.from({ length: maxRows }).map((_, r) => (
          <View key={r} style={styles.nextRow}>
            {Array.from({ length: maxCols }).map((_, c) => {
              const filled = r < shape.length && c < shape[0].length && shape[r][c];
              return (
                <View
                  key={c}
                  style={{
                    width: previewSize,
                    height: previewSize,
                    backgroundColor: filled ? piece.color : "transparent",
                    borderRadius: 2,
                    margin: 1,
                  }}
                />
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

export default function TetrisGame() {
  const { claimGameReward } = useGameEarn();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();

  const [dimensions, setDimensions] = useState(() => Dimensions.get("window"));
  const cellSize = computeCellSize(dimensions.width, dimensions.height);

  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => {
      setDimensions(window);
    });
    return () => sub.remove();
  }, []);

  const [grid, setGrid] = useState<Grid>(createEmptyGrid);
  const [currentPiece, setCurrentPiece] = useState<Piece>(randomPiece);
  const [nextPiece, setNextPiece] = useState<Piece>(randomPiece);
  const [position, setPosition] = useState<Position>({ row: 0, col: 3 });
  const [score, setScore] = useState(0);
  const [earnedPts, setEarnedPts] = useState(0);
  const [lines, setLines] = useState(0);
  const [level, setLevel] = useState(1);
  const [gameState, setGameState] = useState<"playing" | "over" | "cooldown">("playing");
  const [canPlay, setCanPlay] = useState(true);
  const gridRef = useRef(grid);
  const pieceRef = useRef(currentPiece);
  const nextPieceRef = useRef(nextPiece);
  const posRef = useRef(position);
  const gameStateRef = useRef(gameState);
  const linesRef = useRef(lines);
  const scoreRef = useRef(score);
  const levelRef = useRef(level);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rewardRecorded = useRef(false);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  gridRef.current = grid;
  pieceRef.current = currentPiece;
  nextPieceRef.current = nextPiece;
  posRef.current = position;
  gameStateRef.current = gameState;
  linesRef.current = lines;
  scoreRef.current = score;
  levelRef.current = level;

  useEffect(() => {
    canPlayGame("tetris").then((available) => {
      if (!available) {
        setCanPlay(false);
        setGameState("cooldown");
      }
    });
  }, []);

  const endGame = useCallback(() => {
    if (rewardRecorded.current) return;
    rewardRecorded.current = true;
    setGameState("over");
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    const totalLines = linesRef.current;
    claimGameReward("tetris", `Tetris: ${totalLines} lines, score ${scoreRef.current}`).then(setEarnedPts);
  }, []);

  const spawnNewPiece = useCallback(() => {
    const next = nextPieceRef.current;
    const startPos: Position = { row: 0, col: Math.floor((COLS - next.shape[0].length) / 2) };
    if (!isValidPosition(gridRef.current, next.shape, startPos)) {
      endGame();
      return;
    }
    setCurrentPiece(next);
    setPosition(startPos);
    const upcoming = randomPiece();
    setNextPiece(upcoming);
  }, [endGame]);

  const lockPiece = useCallback(() => {
    const g = gridRef.current;
    const p = pieceRef.current;
    const pos = posRef.current;
    const newGrid = placePiece(g, p.shape, pos, p.color);
    const { newGrid: clearedGrid, cleared } = clearLines(newGrid);
    setGrid(clearedGrid);
    if (cleared > 0) {
      const lineScores = [0, 100, 300, 500, 800];
      const pts = (lineScores[cleared] || 800) * levelRef.current;
      const newLines = linesRef.current + cleared;
      const newLevel = Math.floor(newLines / 10) + 1;
      setScore((s) => s + pts);
      setLines(newLines);
      setLevel(newLevel);
    }
    setTimeout(() => spawnNewPiece(), 50);
  }, [spawnNewPiece]);

  const tick = useCallback(() => {
    if (gameStateRef.current !== "playing") return;
    const newPos = { row: posRef.current.row + 1, col: posRef.current.col };
    if (isValidPosition(gridRef.current, pieceRef.current.shape, newPos)) {
      setPosition(newPos);
    } else {
      lockPiece();
    }
  }, [lockPiece]);

  useEffect(() => {
    if (gameState !== "playing") return;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(tick, getDropSpeed(level));
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [gameState, level, tick]);

  const moveLeft = useCallback(() => {
    if (gameStateRef.current !== "playing") return;
    const newPos = { row: posRef.current.row, col: posRef.current.col - 1 };
    if (isValidPosition(gridRef.current, pieceRef.current.shape, newPos)) {
      setPosition(newPos);
    }
  }, []);

  const moveRight = useCallback(() => {
    if (gameStateRef.current !== "playing") return;
    const newPos = { row: posRef.current.row, col: posRef.current.col + 1 };
    if (isValidPosition(gridRef.current, pieceRef.current.shape, newPos)) {
      setPosition(newPos);
    }
  }, []);

  const softDrop = useCallback(() => {
    if (gameStateRef.current !== "playing") return;
    const newPos = { row: posRef.current.row + 1, col: posRef.current.col };
    if (isValidPosition(gridRef.current, pieceRef.current.shape, newPos)) {
      setPosition(newPos);
    }
  }, []);

  const rotate = useCallback(() => {
    if (gameStateRef.current !== "playing") return;
    const rotated = rotateShape(pieceRef.current.shape);
    if (isValidPosition(gridRef.current, rotated, posRef.current)) {
      setCurrentPiece((prev) => ({ ...prev, shape: rotated }));
    } else {
      const kicks = [
        { row: 0, col: -1 },
        { row: 0, col: 1 },
        { row: 0, col: -2 },
        { row: 0, col: 2 },
        { row: -1, col: 0 },
      ];
      for (const kick of kicks) {
        const kickPos = { row: posRef.current.row + kick.row, col: posRef.current.col + kick.col };
        if (isValidPosition(gridRef.current, rotated, kickPos)) {
          setCurrentPiece((prev) => ({ ...prev, shape: rotated }));
          setPosition(kickPos);
          return;
        }
      }
    }
  }, []);

  const hardDrop = useCallback(() => {
    if (gameStateRef.current !== "playing") return;
    let dropRow = posRef.current.row;
    while (isValidPosition(gridRef.current, pieceRef.current.shape, { row: dropRow + 1, col: posRef.current.col })) {
      dropRow++;
    }
    setPosition({ row: dropRow, col: posRef.current.col });
    setTimeout(() => lockPiece(), 30);
  }, [lockPiece]);

  const handleNewGame = useCallback(() => {
    setGrid(createEmptyGrid());
    setScore(0);
    setLines(0);
    setLevel(1);
    rewardRecorded.current = false;
    const p = randomPiece();
    const np = randomPiece();
    setCurrentPiece(p);
    setNextPiece(np);
    setPosition({ row: 0, col: Math.floor((COLS - p.shape[0].length) / 2) });
    setGameState("cooldown");
    setCanPlay(false);
  }, []);

  const renderGrid = () => {
    const displayGrid = grid.map((row) => [...row]);
    if (gameState === "playing") {
      for (let r = 0; r < currentPiece.shape.length; r++) {
        for (let c = 0; c < currentPiece.shape[r].length; c++) {
          if (currentPiece.shape[r][c]) {
            const dr = position.row + r;
            const dc = position.col + c;
            if (dr >= 0 && dr < ROWS && dc >= 0 && dc < COLS) {
              displayGrid[dr][dc] = currentPiece.color;
            }
          }
        }
      }
    }

    return (
      <View style={styles.gridContainer}>
        {displayGrid.map((row, ri) => (
          <View key={ri} style={styles.gridRow}>
            {row.map((cell, ci) => (
              <View
                key={ci}
                style={[
                  styles.cell,
                  {
                    width: cellSize,
                    height: cellSize,
                    backgroundColor: cell || Colors.background,
                    borderColor: cell ? "rgba(255,255,255,0.15)" : Colors.border,
                  },
                ]}
              />
            ))}
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <View style={styles.header}>
        <TouchableOpacity testID="back-button" onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t.games.tetris}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>{t.games.score}</Text>
            <Text style={styles.statValue}>{score}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>{t.games.level}</Text>
            <Text style={styles.statValue}>{level}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>{t.games.lines}</Text>
            <Text style={styles.statValue}>{lines}</Text>
          </View>
          <NextPiecePreview piece={nextPiece} />
        </View>

        {gameState === "cooldown" && !canPlay ? (
          <View style={styles.cooldownContainer}>
            <Ionicons name="time-outline" size={64} color={Colors.textMuted} />
            <Text style={styles.cooldownTitle}>{t.games.comeBackTomorrow}</Text>
            <Text style={styles.cooldownSubtitle}>{t.games.dailyPlaysLeft}: 0</Text>
          </View>
        ) : (
          <>
            <View style={styles.gameArea}>
              {renderGrid()}
            </View>

            {gameState === "playing" && (
              <View style={styles.controlsWrapper}>
                <View style={styles.controlsTopRow}>
                  <TouchableOpacity testID="hard-drop" onPress={hardDrop} style={styles.controlBtnAccent}>
                    <Ionicons name="arrow-down" size={28} color={Colors.background} />
                  </TouchableOpacity>
                </View>
                <View style={styles.controlsBottomRow}>
                  <TouchableOpacity testID="move-left" onPress={moveLeft} style={styles.controlBtn}>
                    <Ionicons name="chevron-back" size={28} color={Colors.text} />
                  </TouchableOpacity>
                  <TouchableOpacity testID="soft-drop" onPress={softDrop} style={styles.controlBtn}>
                    <Ionicons name="chevron-down" size={28} color={Colors.text} />
                  </TouchableOpacity>
                  <TouchableOpacity testID="rotate" onPress={rotate} style={styles.controlBtn}>
                    <Ionicons name="refresh" size={24} color={Colors.text} />
                  </TouchableOpacity>
                  <TouchableOpacity testID="move-right" onPress={moveRight} style={styles.controlBtn}>
                    <Ionicons name="chevron-forward" size={28} color={Colors.text} />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {gameState === "over" && (
        <View style={styles.gameOverOverlay}>
          <View style={[styles.gameOverCard, { width: dimensions.width - 64 }]}>
            <Ionicons name="game-controller" size={48} color={Colors.primary} />
            <Text style={styles.gameOverTitle}>{t.games.gameOver}</Text>
            <Text style={styles.gameOverScore}>{t.games.score}: {score}</Text>
            <Text style={styles.gameOverLines}>{t.games.lines}: {lines} | {t.games.level}: {level}</Text>
            <Text style={styles.gameOverReward}>🎉 Check your Wallet!</Text>
            <Text style={styles.gameOverRewardLabel}>{t.games.earned}</Text>

            <TouchableOpacity testID="play-again-button" style={styles.playAgainBtn} onPress={handleNewGame}>
              <Text style={styles.playAgainText}>{t.games.playAgain}</Text>
            </TouchableOpacity>

            <TouchableOpacity testID="back-to-games-button" style={styles.backToGamesBtn} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={18} color={Colors.textSecondary} />
              <Text style={styles.backToGamesText}>{t.games.title}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700" as const,
    color: Colors.text,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 8,
    gap: 8,
  },
  statBox: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 70,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: "600" as const,
    textTransform: "uppercase" as const,
  },
  statValue: {
    fontSize: 18,
    fontWeight: "800" as const,
    color: Colors.text,
    marginTop: 2,
  },
  nextBox: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  nextLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: "600" as const,
    textTransform: "uppercase" as const,
    marginBottom: 4,
  },
  nextGrid: {
    alignItems: "center",
  },
  nextRow: {
    flexDirection: "row",
  },
  gameArea: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  gridContainer: {
    borderWidth: 2,
    borderColor: Colors.border,
    borderRadius: 4,
    overflow: "hidden",
  },
  gridRow: {
    flexDirection: "row",
  },
  cell: {
    borderWidth: 0.5,
  },
  controlsWrapper: {
    alignItems: "center",
    paddingBottom: 8,
  },
  controlsTopRow: {
    marginBottom: 10,
  },
  controlsBottomRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
  },
  controlBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.surfaceLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  controlBtnAccent: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  cooldownContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cooldownTitle: {
    fontSize: 22,
    fontWeight: "700" as const,
    color: Colors.text,
    marginTop: 16,
  },
  cooldownSubtitle: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 8,
  },
  gameOverOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  gameOverCard: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 32,
    alignItems: "center",
    maxWidth: 340,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  gameOverTitle: {
    fontSize: 28,
    fontWeight: "800" as const,
    color: Colors.text,
    marginTop: 12,
    marginBottom: 8,
  },
  gameOverScore: {
    fontSize: 18,
    fontWeight: "700" as const,
    color: Colors.textSecondary,
  },
  gameOverLines: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 4,
    marginBottom: 16,
  },
  gameOverReward: {
    fontSize: 36,
    fontWeight: "800" as const,
    color: Colors.primary,
  },
  gameOverRewardLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 24,
  },
  playAgainBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 12,
  },
  playAgainText: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: Colors.background,
  },
  backToGamesBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
  },
  backToGamesText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
});
