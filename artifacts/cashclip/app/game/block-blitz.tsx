import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Dimensions,
  Animated,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/LanguageContext";
import { recordGamePlay, canPlayGame, formatPoints, dollarsToPoints } from "@/lib/storage";
import { useGameEarn } from "@/lib/use-game-earn";

import {
  BLOCK_GRID_SIZE,
  BLOCK_GRID_PAD,
  computeBlockCellSize,
} from "./layout-sizing";

const GRID_SIZE = BLOCK_GRID_SIZE;
const GRID_PAD = BLOCK_GRID_PAD;

function computeCellSize(w: number, h: number): number {
  return computeBlockCellSize(w, h);
}

const PIECE_COLORS = [
  "#FF5252",
  "#448AFF",
  "#FFD600",
  "#00E676",
  "#E040FB",
  "#FF9100",
  "#00BCD4",
  "#FF6D00",
];

type Grid = number[][];
type Shape = number[][];

interface Piece {
  shape: Shape;
  color: string;
  id: string;
}

const SHAPES: Shape[] = [
  [[1]],
  [[1, 1]],
  [[1], [1]],
  [[1, 1, 1]],
  [[1], [1], [1]],
  [[1, 1], [1, 1]],
  [[1, 1, 1, 1]],
  [[1], [1], [1], [1]],
  [[1, 1], [1, 0]],
  [[1, 1], [0, 1]],
  [[0, 1], [1, 1]],
  [[1, 0], [1, 1]],
  [[1, 1, 1], [1, 0, 0]],
  [[1, 1, 1], [0, 0, 1]],
  [[1, 0, 0], [1, 1, 1]],
  [[0, 0, 1], [1, 1, 1]],
  [[1, 1, 1], [0, 1, 0]],
  [[0, 1], [1, 1], [0, 1]],
  [[1, 1, 1], [1, 0, 0], [1, 0, 0]],
  [[1, 1, 1], [0, 0, 1], [0, 0, 1]],
  [[1, 0], [1, 0], [1, 1]],
  [[0, 1], [0, 1], [1, 1]],
  [[1, 1, 1, 1, 1]],
  [[1], [1], [1], [1], [1]],
  [[1, 1, 1], [1, 1, 1], [1, 1, 1]],
];

function createEmptyGrid(): Grid {
  return Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));
}

function generatePiece(): Piece {
  const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
  const color = PIECE_COLORS[Math.floor(Math.random() * PIECE_COLORS.length)];
  const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
  return { shape, color, id };
}

function generatePieceSet(): Piece[] {
  return [generatePiece(), generatePiece(), generatePiece()];
}

function getPieceAnchor(piece: Piece): { row: number; col: number } {
  for (let r = 0; r < piece.shape.length; r++) {
    for (let c = 0; c < piece.shape[r].length; c++) {
      if (piece.shape[r][c] === 1) return { row: r, col: c };
    }
  }
  return { row: 0, col: 0 };
}

function canPlacePiece(grid: Grid, piece: Piece, row: number, col: number): boolean {
  for (let r = 0; r < piece.shape.length; r++) {
    for (let c = 0; c < piece.shape[r].length; c++) {
      if (piece.shape[r][c] === 1) {
        const gr = row + r;
        const gc = col + c;
        if (gr < 0 || gr >= GRID_SIZE || gc < 0 || gc >= GRID_SIZE) return false;
        if (grid[gr][gc] !== 0) return false;
      }
    }
  }
  return true;
}

function placePiece(grid: Grid, piece: Piece, row: number, col: number, colorIndex: number): Grid {
  const newGrid = grid.map((r) => [...r]);
  for (let r = 0; r < piece.shape.length; r++) {
    for (let c = 0; c < piece.shape[r].length; c++) {
      if (piece.shape[r][c] === 1) {
        newGrid[row + r][col + c] = colorIndex;
      }
    }
  }
  return newGrid;
}

function clearLines(grid: Grid): { newGrid: Grid; cleared: number } {
  const rowsToClear: number[] = [];
  const colsToClear: number[] = [];

  for (let r = 0; r < GRID_SIZE; r++) {
    if (grid[r].every((cell) => cell !== 0)) rowsToClear.push(r);
  }
  for (let c = 0; c < GRID_SIZE; c++) {
    if (grid.every((row) => row[c] !== 0)) colsToClear.push(c);
  }

  if (rowsToClear.length === 0 && colsToClear.length === 0) {
    return { newGrid: grid, cleared: 0 };
  }

  const newGrid = grid.map((r) => [...r]);
  for (const r of rowsToClear) {
    for (let c = 0; c < GRID_SIZE; c++) newGrid[r][c] = 0;
  }
  for (const c of colsToClear) {
    for (let r = 0; r < GRID_SIZE; r++) newGrid[r][c] = 0;
  }

  const uniqueLines = new Set([...rowsToClear, ...colsToClear.map((c) => c + GRID_SIZE)]);
  return { newGrid, cleared: uniqueLines.size };
}

function canAnyPieceFit(grid: Grid, pieces: Piece[]): boolean {
  for (const piece of pieces) {
    for (let r = 0; r <= GRID_SIZE - piece.shape.length; r++) {
      for (let c = 0; c <= GRID_SIZE - piece.shape[0].length; c++) {
        if (canPlacePiece(grid, piece, r, c)) return true;
      }
    }
  }
  return false;
}

const CELL_COLORS: Record<number, string> = {
  1: "#FF5252",
  2: "#448AFF",
  3: "#FFD600",
  4: "#00E676",
  5: "#E040FB",
  6: "#FF9100",
  7: "#00BCD4",
  8: "#FF6D00",
};

function getColorIndex(color: string): number {
  const idx = PIECE_COLORS.indexOf(color);
  return idx >= 0 ? idx + 1 : 1;
}

export default function BlockBlitzGame() {
  const { claimGameReward } = useGameEarn();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();

  const [dimensions, setDimensions] = useState(() => Dimensions.get("window"));
  const cellSize = computeCellSize(dimensions.width, dimensions.height);
  const miniCell = Math.floor(cellSize * 0.55);

  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => {
      setDimensions(window);
    });
    return () => sub.remove();
  }, []);

  const [grid, setGrid] = useState<Grid>(createEmptyGrid());
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [selectedPiece, setSelectedPiece] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [linesCleared, setLinesCleared] = useState(0);
  const [combo, setCombo] = useState(0);
  const [gameState, setGameState] = useState<"playing" | "over" | "cooldown">("playing");
  const [canPlay, setCanPlay] = useState(true);
  const [highlightCells, setHighlightCells] = useState<Set<string>>(new Set());
  const resultOpacity = useRef(new Animated.Value(0)).current;
  const resultScale = useRef(new Animated.Value(0.5)).current;

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    canPlayGame("block-blitz").then((available) => {
      if (!available) {
        setCanPlay(false);
        setGameState("cooldown");
      } else {
        setPieces(generatePieceSet());
      }
    });
  }, []);

  const showResult = useCallback(() => {
    resultOpacity.setValue(0);
    resultScale.setValue(0.5);
    Animated.parallel([
      Animated.timing(resultOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.spring(resultScale, { toValue: 1, useNativeDriver: true }),
    ]).start();
  }, []);

  const bankedRef = useRef(false);

  const endGame = useCallback(async () => {
    setGameState("over");
    showResult();
    if (!bankedRef.current) {
      bankedRef.current = true;
      await claimGameReward("block-blitz", dollarsToPoints(0.05), `Block Blitz: ${score} pts, ${linesCleared} lines`);
    }
  }, [score, linesCleared, showResult]);

  const handleCellPress = useCallback(
    (row: number, col: number) => {
      if (gameState !== "playing" || selectedPiece === null) return;
      const piece = pieces[selectedPiece];
      if (!piece) return;

      const anchor = getPieceAnchor(piece);
      const placeRow = row - anchor.row;
      const placeCol = col - anchor.col;

      if (!canPlacePiece(grid, piece, placeRow, placeCol)) return;

      const colorIdx = getColorIndex(piece.color);
      let newGrid = placePiece(grid, piece, placeRow, placeCol, colorIdx);
      const { newGrid: clearedGrid, cleared } = clearLines(newGrid);

      let addScore = 0;
      for (let r = 0; r < piece.shape.length; r++) {
        for (let c = 0; c < piece.shape[r].length; c++) {
          if (piece.shape[r][c] === 1) addScore += 1;
        }
      }

      let newCombo = combo;
      if (cleared > 0) {
        newCombo = combo + 1;
        addScore += cleared * 10 * newCombo;
        setCombo(newCombo);
        setLinesCleared((prev) => prev + cleared);
      } else {
        newCombo = 0;
        setCombo(0);
      }

      setGrid(clearedGrid);
      setScore((prev) => prev + addScore);
      setSelectedPiece(null);
      setHighlightCells(new Set());

      const newPieces = [...pieces];
      newPieces[selectedPiece] = null as any;
      const remaining = newPieces.filter((p) => p !== null);

      if (remaining.length === 0) {
        const nextSet = generatePieceSet();
        setPieces(nextSet);
        if (!canAnyPieceFit(clearedGrid, nextSet)) {
          setTimeout(() => endGame(), 300);
        }
      } else {
        setPieces(newPieces);
        if (!canAnyPieceFit(clearedGrid, remaining)) {
          setTimeout(() => endGame(), 300);
        }
      }
    },
    [grid, pieces, selectedPiece, gameState, combo, endGame]
  );

  const handlePieceSelect = useCallback(
    (index: number) => {
      if (gameState !== "playing") return;
      if (!pieces[index]) return;
      setSelectedPiece(selectedPiece === index ? null : index);
      setHighlightCells(new Set());
    },
    [selectedPiece, gameState, pieces]
  );

  const handleCellHover = useCallback(
    (row: number, col: number) => {
      if (selectedPiece === null || !pieces[selectedPiece]) return;
      const piece = pieces[selectedPiece];
      const anchor = getPieceAnchor(piece);
      const placeRow = row - anchor.row;
      const placeCol = col - anchor.col;
      if (canPlacePiece(grid, piece, placeRow, placeCol)) {
        const cells = new Set<string>();
        for (let r = 0; r < piece.shape.length; r++) {
          for (let c = 0; c < piece.shape[r].length; c++) {
            if (piece.shape[r][c] === 1) {
              cells.add(`${placeRow + r}-${placeCol + c}`);
            }
          }
        }
        setHighlightCells(cells);
      } else {
        setHighlightCells(new Set());
      }
    },
    [selectedPiece, pieces, grid]
  );

  const resetGame = useCallback(() => {
    setGrid(createEmptyGrid());
    setScore(0);
    setLinesCleared(0);
    setCombo(0);
    setSelectedPiece(null);
    setHighlightCells(new Set());
    setPieces(generatePieceSet());
    bankedRef.current = false;
    setGameState("playing");
  }, []);

  if (gameState === "cooldown") {
    return (
      <View style={[styles.container, { paddingTop: topInset, paddingBottom: bottomInset }]}>
        <View style={styles.header}>
          <TouchableOpacity testID="back-button" onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Block Blitz</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.cooldownContainer}>
          <Ionicons name="time-outline" size={48} color={Colors.accent} />
          <Text style={styles.cooldownTitle}>{t.games.comeBackTomorrow}</Text>
          <Text style={styles.cooldownSubtitle}>{t.games.dailyPlaysLeft}: 0</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <View style={styles.header}>
        <TouchableOpacity testID="back-button" onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Block Blitz</Text>
        <TouchableOpacity testID="give-up-button" onPress={endGame} hitSlop={12}>
          <Ionicons name="flag-outline" size={22} color={Colors.textMuted} />
        </TouchableOpacity>
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
            <Text style={styles.statLabel}>{t.games.lines}</Text>
            <Text style={styles.statValue}>{linesCleared}</Text>
          </View>
          {combo > 0 && (
            <View style={[styles.statBox, styles.comboBox]}>
              <Text style={styles.statLabel}>{t.games.combo}</Text>
              <Text style={[styles.statValue, styles.comboValue]}>x{combo}</Text>
            </View>
          )}
        </View>

        <View style={styles.gridContainer}>
          {grid.map((row, r) => (
            <View key={r} style={styles.gridRow}>
              {row.map((cell, c) => {
                const isHighlighted = highlightCells.has(`${r}-${c}`);
                const cellColor = cell !== 0 ? CELL_COLORS[cell] || "#666" : undefined;
                return (
                  <TouchableOpacity
                    key={c}
                    testID={`cell-${r}-${c}`}
                    activeOpacity={0.7}
                    onPress={() => handleCellPress(r, c)}
                    onPressIn={() => handleCellHover(r, c)}
                    style={[
                      styles.cell,
                      { width: cellSize, height: cellSize },
                      cell !== 0 && { backgroundColor: cellColor },
                      cell !== 0 && styles.filledCell,
                      isHighlighted && styles.highlightCell,
                    ]}
                  >
                    {cell !== 0 && <View style={[styles.cellShine, { backgroundColor: cellColor }]} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>

        <View style={styles.pieceTray}>
          {pieces.map((piece, index) => {
            if (!piece) return <View key={index} style={styles.pieceSlotEmpty} />;
            const isSelected = selectedPiece === index;
            return (
              <TouchableOpacity
                key={piece.id}
                testID={`piece-${index}`}
                activeOpacity={0.7}
                onPress={() => handlePieceSelect(index)}
                style={[styles.pieceSlot, isSelected && styles.pieceSlotSelected]}
              >
                {piece.shape.map((row, r) => (
                  <View key={r} style={styles.miniRow}>
                    {row.map((cell, c) => (
                      <View
                        key={c}
                        style={[
                          styles.miniCell,
                          { width: miniCell, height: miniCell },
                          cell === 1 && { backgroundColor: piece.color },
                          cell === 1 && styles.miniCellFilled,
                        ]}
                      />
                    ))}
                  </View>
                ))}
              </TouchableOpacity>
            );
          })}
        </View>

        {selectedPiece !== null && (
          <Text style={styles.hintText}>Tap a cell on the grid to place the block</Text>
        )}
      </ScrollView>

      {gameState === "over" && (
        <Animated.View
          style={[
            styles.resultOverlay,
            { opacity: resultOpacity },
          ]}
        >
          <Animated.View
            style={[
              styles.resultCard,
              { width: dimensions.width - 64, transform: [{ scale: resultScale }] },
            ]}
          >
            <View style={styles.resultIcon}>
              <Ionicons name="cube" size={40} color="#FF6D00" />
            </View>
            <Text style={styles.resultTitle}>{t.games.gameOver}</Text>
            <Text style={styles.resultReward}>{formatPoints(dollarsToPoints(0.05))}</Text>
            <Text style={styles.resultSubtext}>
              {score} {t.games.score} • {linesCleared} {t.games.lines}
            </Text>
            <TouchableOpacity testID="play-again-button" style={styles.resultButton} onPress={resetGame}>
              <Text style={styles.resultButtonText}>{t.games.playAgain}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="back-to-games"
              style={styles.resultButtonSecondary}
              onPress={() => router.back()}
            >
              <Ionicons name="arrow-back" size={16} color={Colors.textSecondary} />
              <Text style={styles.resultButtonSecondaryText}>{t.games.title}</Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
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
  headerTitle: {
    fontSize: 20,
    fontWeight: "700" as const,
    color: Colors.text,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  statBox: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  comboBox: {
    borderColor: "#FFD600",
    backgroundColor: "rgba(255, 214, 0, 0.08)",
  },
  statLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: "600" as const,
    textTransform: "uppercase" as const,
  },
  statValue: {
    fontSize: 22,
    fontWeight: "800" as const,
    color: Colors.text,
  },
  comboValue: {
    color: "#FFD600",
  },
  gridContainer: {
    alignSelf: "center",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  gridRow: {
    flexDirection: "row",
  },
  cell: {
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(255,255,255,0.02)",
    borderRadius: 3,
    margin: 0.5,
    overflow: "hidden",
  },
  filledCell: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 4,
  },
  cellShine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "40%",
    opacity: 0.25,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  highlightCell: {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    borderColor: "rgba(255, 255, 255, 0.3)",
    borderWidth: 1,
  },
  pieceTray: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 16,
    marginTop: 20,
  },
  pieceSlot: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    minWidth: 70,
    minHeight: 70,
  },
  pieceSlotEmpty: {
    width: 70,
    height: 70,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.02)",
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: "dashed",
  },
  pieceSlotSelected: {
    borderColor: "#FFD600",
    borderWidth: 2,
    shadowColor: "#FFD600",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  miniRow: {
    flexDirection: "row",
  },
  miniCell: {
    margin: 1,
    borderRadius: 2,
    backgroundColor: "transparent",
  },
  miniCellFilled: {
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.2)",
  },
  hintText: {
    textAlign: "center",
    color: Colors.textMuted,
    fontSize: 13,
    marginTop: 12,
  },
  cooldownContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
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
  resultOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  resultCard: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 32,
    alignItems: "center",
    maxWidth: 340,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  resultIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255, 109, 0, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  resultTitle: {
    fontSize: 28,
    fontWeight: "800" as const,
    color: Colors.text,
    marginBottom: 8,
  },
  resultReward: {
    fontSize: 36,
    fontWeight: "800" as const,
    color: Colors.primary,
    marginBottom: 4,
  },
  resultSubtext: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 24,
  },
  resultButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 12,
  },
  resultButtonText: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: Colors.background,
  },
  resultButtonSecondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
  },
  resultButtonSecondaryText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
});
