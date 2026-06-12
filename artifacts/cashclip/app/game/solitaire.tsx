import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Dimensions,
  ScrollView,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/LanguageContext";
import { recordGamePlay, canPlayGame, formatPoints, dollarsToPoints } from "@/lib/storage";
import { solitaireCardWidth } from "./layout-sizing";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

type Suit = "spades" | "hearts" | "diamonds" | "clubs";
type Value = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";

interface Card {
  suit: Suit;
  value: Value;
  faceUp: boolean;
  id: string;
}

interface Selection {
  source: "tableau" | "waste" | "foundation";
  colIndex: number;
  cardIndex: number;
}

const SUITS: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
const VALUES: Value[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: "\u2660",
  hearts: "\u2665",
  diamonds: "\u2666",
  clubs: "\u2663",
};

const CARD_WIDTH = solitaireCardWidth(SCREEN_WIDTH);
const CARD_HEIGHT = Math.floor(CARD_WIDTH * 1.4);
const STACK_OFFSET_DOWN = 16;
const STACK_OFFSET_UP = 22;

function getValueIndex(v: Value): number {
  return VALUES.indexOf(v);
}

function isRed(suit: Suit): boolean {
  return suit === "hearts" || suit === "diamonds";
}

function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({ suit, value, faceUp: false, id: `${value}_${suit}` });
    }
  }
  return deck;
}

function shuffle(arr: Card[]): Card[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dealGame() {
  const deck = shuffle(createDeck());
  const tableau: Card[][] = [[], [], [], [], [], [], []];
  let idx = 0;
  for (let col = 0; col < 7; col++) {
    for (let row = 0; row <= col; row++) {
      const card = { ...deck[idx] };
      card.faceUp = row === col;
      tableau[col].push(card);
      idx++;
    }
  }
  const stock = deck.slice(idx).map((c) => ({ ...c, faceUp: false }));
  const foundations: Card[][] = [[], [], [], []];
  const waste: Card[] = [];
  return { tableau, stock, waste, foundations };
}

function canPlaceOnTableau(card: Card, column: Card[]): boolean {
  if (column.length === 0) return card.value === "K";
  const top = column[column.length - 1];
  if (!top.faceUp) return false;
  return isRed(card.suit) !== isRed(top.suit) && getValueIndex(card.value) === getValueIndex(top.value) - 1;
}

function canPlaceOnFoundation(card: Card, foundation: Card[]): boolean {
  if (foundation.length === 0) return card.value === "A";
  const top = foundation[foundation.length - 1];
  return card.suit === top.suit && getValueIndex(card.value) === getValueIndex(top.value) + 1;
}

function CardView({
  card,
  onPress,
  selected,
  testID,
}: {
  card: Card;
  onPress?: () => void;
  selected?: boolean;
  testID?: string;
}) {
  if (!card.faceUp) {
    return (
      <TouchableOpacity
        testID={testID}
        onPress={onPress}
        activeOpacity={0.7}
        style={[styles.card, styles.cardBack]}
      >
        <View style={styles.cardBackOuter}>
          <View style={styles.cardBackDiamond} />
          <View style={styles.cardBackDiamond2} />
          <View style={styles.cardBackCenter} />
        </View>
      </TouchableOpacity>
    );
  }

  const red = isRed(card.suit);
  const color = red ? "#FF5252" : "#FFFFFF";
  const suitSymbol = SUIT_SYMBOLS[card.suit];
  const displayValue = card.value === "10" ? "10" : card.value;
  const isFace = card.value === "J" || card.value === "Q" || card.value === "K";
  const faceLabel = card.value === "J" ? "J" : card.value === "Q" ? "Q" : card.value === "K" ? "K" : "";
  const centerCount = getCenterPipCount(card.value);

  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.card, styles.cardFront, selected && styles.cardSelected]}
    >
      <View style={styles.cornerTopLeft}>
        <Text style={[styles.cornerValue, { color }]}>{displayValue}</Text>
        <Text style={[styles.cornerSuit, { color }]}>{suitSymbol}</Text>
      </View>
      <View style={styles.cornerBottomRight}>
        <Text style={[styles.cornerValue, { color, transform: [{ rotate: "180deg" }] }]}>{displayValue}</Text>
        <Text style={[styles.cornerSuit, { color, transform: [{ rotate: "180deg" }] }]}>{suitSymbol}</Text>
      </View>
      <View style={styles.cardCenter}>
        {isFace ? (
          <View style={[styles.faceIcon, { borderColor: color }]}>
            <Text style={[styles.faceLetter, { color }]}>{faceLabel}</Text>
            <Text style={[styles.faceSuit, { color }]}>{suitSymbol}</Text>
          </View>
        ) : card.value === "A" ? (
          <Text style={[styles.aceSuit, { color }]}>{suitSymbol}</Text>
        ) : (
          <View style={styles.pipGrid}>
            {Array.from({ length: centerCount }).map((_, i) => (
              <Text key={i} style={[styles.pip, { color }]}>{suitSymbol}</Text>
            ))}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

function getCenterPipCount(value: Value): number {
  const counts: Record<string, number> = {
    "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
  };
  return counts[value] || 0;
}

function EmptySlot({ onPress, testID, label }: { onPress?: () => void; testID?: string; label?: string }) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.card, styles.emptySlot]}
    >
      {label ? <Text style={styles.emptyLabel}>{label}</Text> : null}
    </TouchableOpacity>
  );
}

export default function SolitaireGame() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();

  const [tableau, setTableau] = useState<Card[][]>([]);
  const [stock, setStock] = useState<Card[]>([]);
  const [waste, setWaste] = useState<Card[]>([]);
  const [foundations, setFoundations] = useState<Card[][]>([[], [], [], []]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [moves, setMoves] = useState(0);
  const [timer, setTimer] = useState(0);
  const [gameState, setGameState] = useState<"playing" | "won" | "cooldown">("playing");
  const [canPlay, setCanPlay] = useState(true);
  const [gameStarted, setGameStarted] = useState(false);
  const rewardRecorded = useRef(false);
  const resultOpacity = useRef(new Animated.Value(0)).current;
  const resultScale = useRef(new Animated.Value(0.5)).current;

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    canPlayGame("solitaire").then((available) => {
      if (!available) {
        setCanPlay(false);
        setGameState("cooldown");
      } else {
        const deal = dealGame();
        setTableau(deal.tableau);
        setStock(deal.stock);
        setWaste(deal.waste);
        setFoundations(deal.foundations);
        setGameStarted(true);
      }
    });
  }, []);

  useEffect(() => {
    if (gameState !== "playing" || !gameStarted) return;
    const interval = setInterval(() => setTimer((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [gameState, gameStarted]);

  const checkWin = useCallback((founds: Card[][]) => {
    return founds.every((f) => f.length === 13);
  }, []);

  const showResult = useCallback(() => {
    Animated.parallel([
      Animated.timing(resultOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(resultScale, { toValue: 1, friction: 5, useNativeDriver: true }),
    ]).start();
  }, []);

  const bankedRef = useRef(false);

  const bankReward = useCallback(async (won: boolean, desc: string) => {
    if (bankedRef.current) return;
    bankedRef.current = true;
    const pts = won ? dollarsToPoints(0.25) : 0;
    await recordGamePlay("solitaire", pts, desc);
  }, []);

  const flipTopCard = (cols: Card[][]) => {
    for (const col of cols) {
      if (col.length > 0 && !col[col.length - 1].faceUp) {
        col[col.length - 1] = { ...col[col.length - 1], faceUp: true };
      }
    }
  };

  const handleStockTap = useCallback(() => {
    if (gameState !== "playing") return;
    if (stock.length === 0) {
      setStock(waste.reverse().map((c) => ({ ...c, faceUp: false })));
      setWaste([]);
    } else {
      const newStock = [...stock];
      const card = { ...newStock.pop()!, faceUp: true };
      setStock(newStock);
      setWaste([...waste, card]);
    }
    setSelection(null);
  }, [stock, waste, gameState]);

  const tryAutoFoundation = useCallback(
    (card: Card, newTableau: Card[][], newWaste: Card[], sourceType: "tableau" | "waste", colIdx: number) => {
      const newFoundations = foundations.map((f) => [...f]);
      for (let fi = 0; fi < 4; fi++) {
        if (canPlaceOnFoundation(card, newFoundations[fi])) {
          newFoundations[fi].push(card);
          if (sourceType === "tableau") {
            newTableau[colIdx] = newTableau[colIdx].slice(0, -1);
            flipTopCard(newTableau);
          } else {
            newWaste.pop();
          }
          setTableau(newTableau);
          setWaste(newWaste);
          setFoundations(newFoundations);
          setMoves((m) => m + 1);
          setSelection(null);
          if (checkWin(newFoundations)) {
            setGameState("won");
            if (!rewardRecorded.current) {
              rewardRecorded.current = true;
              void bankReward(true, "Solitaire: Won the game!");
            }
            setTimeout(showResult, 500);
          }
          return true;
        }
      }
      return false;
    },
    [foundations, checkWin, showResult, bankReward]
  );

  const handleTableauTap = useCallback(
    (colIndex: number, cardIndex: number) => {
      if (gameState !== "playing") return;
      const col = tableau[colIndex];
      if (cardIndex < col.length && !col[cardIndex].faceUp) return;

      if (!selection) {
        if (cardIndex === col.length - 1 && col.length > 0) {
          const card = col[cardIndex];
          const newTableau = tableau.map((c) => [...c]);
          const newWaste = [...waste];
          if (tryAutoFoundation(card, newTableau, newWaste, "tableau", colIndex)) return;
        }
        if (col.length > 0 && cardIndex < col.length) {
          setSelection({ source: "tableau", colIndex, cardIndex });
        }
        return;
      }

      const newTableau = tableau.map((c) => [...c]);
      const newWaste = [...waste];
      const newFoundations = foundations.map((f) => [...f]);

      let cardsToMove: Card[] = [];
      if (selection.source === "tableau") {
        const srcCol = newTableau[selection.colIndex];
        cardsToMove = srcCol.slice(selection.cardIndex);
      } else if (selection.source === "waste") {
        if (newWaste.length > 0) {
          cardsToMove = [newWaste[newWaste.length - 1]];
        }
      }

      if (cardsToMove.length === 0) {
        setSelection(null);
        return;
      }

      if (canPlaceOnTableau(cardsToMove[0], newTableau[colIndex])) {
        if (selection.source === "tableau") {
          newTableau[selection.colIndex] = newTableau[selection.colIndex].slice(0, selection.cardIndex);
        } else {
          newWaste.pop();
        }
        newTableau[colIndex] = [...newTableau[colIndex], ...cardsToMove];
        flipTopCard(newTableau);
        setTableau(newTableau);
        setWaste(newWaste);
        setMoves((m) => m + 1);
      }

      setSelection(null);
    },
    [tableau, waste, foundations, selection, gameState, tryAutoFoundation]
  );

  const handleEmptyTableauTap = useCallback(
    (colIndex: number) => {
      if (gameState !== "playing" || !selection) return;

      const newTableau = tableau.map((c) => [...c]);
      const newWaste = [...waste];

      let cardsToMove: Card[] = [];
      if (selection.source === "tableau") {
        cardsToMove = newTableau[selection.colIndex].slice(selection.cardIndex);
      } else if (selection.source === "waste" && newWaste.length > 0) {
        cardsToMove = [newWaste[newWaste.length - 1]];
      }

      if (cardsToMove.length > 0 && cardsToMove[0].value === "K") {
        if (selection.source === "tableau") {
          newTableau[selection.colIndex] = newTableau[selection.colIndex].slice(0, selection.cardIndex);
        } else {
          newWaste.pop();
        }
        newTableau[colIndex] = cardsToMove;
        flipTopCard(newTableau);
        setTableau(newTableau);
        setWaste(newWaste);
        setMoves((m) => m + 1);
      }

      setSelection(null);
    },
    [tableau, waste, selection, gameState]
  );

  const handleWasteTap = useCallback(() => {
    if (gameState !== "playing") return;
    if (waste.length === 0) return;

    if (selection && selection.source === "waste") {
      setSelection(null);
      return;
    }

    const card = waste[waste.length - 1];
    const newTableau = tableau.map((c) => [...c]);
    const newWaste = [...waste];
    if (tryAutoFoundation(card, newTableau, newWaste, "waste", 0)) return;

    setSelection({ source: "waste", colIndex: 0, cardIndex: waste.length - 1 });
  }, [waste, selection, gameState, tableau, tryAutoFoundation]);

  const handleFoundationTap = useCallback(
    (fIndex: number) => {
      if (gameState !== "playing" || !selection) return;

      const newTableau = tableau.map((c) => [...c]);
      const newWaste = [...waste];
      const newFoundations = foundations.map((f) => [...f]);

      let card: Card | null = null;
      if (selection.source === "tableau") {
        const col = newTableau[selection.colIndex];
        if (selection.cardIndex === col.length - 1) {
          card = col[col.length - 1];
        }
      } else if (selection.source === "waste" && newWaste.length > 0) {
        card = newWaste[newWaste.length - 1];
      }

      if (card && canPlaceOnFoundation(card, newFoundations[fIndex])) {
        newFoundations[fIndex].push(card);
        if (selection.source === "tableau") {
          newTableau[selection.colIndex].pop();
          flipTopCard(newTableau);
        } else {
          newWaste.pop();
        }
        setTableau(newTableau);
        setWaste(newWaste);
        setFoundations(newFoundations);
        setMoves((m) => m + 1);
        if (checkWin(newFoundations)) {
          setGameState("won");
          if (!rewardRecorded.current) {
            rewardRecorded.current = true;
            void bankReward(true, "Solitaire: Won the game!");
          }
          setTimeout(showResult, 500);
        }
      }

      setSelection(null);
    },
    [tableau, waste, foundations, selection, gameState, checkWin, showResult, bankReward]
  );

  const handleGiveUp = useCallback(() => {
    if (!rewardRecorded.current) {
      rewardRecorded.current = true;
      void bankReward(false, "Solitaire: Played but did not win");
    }
    setGameState("won");
    setTimeout(showResult, 100);
  }, [showResult, bankReward]);

  const handleNewGame = useCallback(() => {
    resultOpacity.setValue(0);
    resultScale.setValue(0.5);
    setGameState("cooldown");
    setCanPlay(false);
    bankedRef.current = false;
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const isSelected = (source: string, colIndex: number, cardIndex: number) => {
    if (!selection) return false;
    if (selection.source !== source) return false;
    if (source === "waste") return true;
    return selection.colIndex === colIndex && selection.cardIndex <= cardIndex;
  };

  const wonGame = gameState === "won";
  const totalFoundation = foundations.reduce((s, f) => s + f.length, 0);

  return (
    <View style={[styles.container, { paddingTop: topInset, paddingBottom: bottomInset }]}>
      <View style={styles.header}>
        <TouchableOpacity testID="back-button" onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerStats}>
          <View style={styles.statItem}>
            <Ionicons name="time-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.statText}>{formatTime(timer)}</Text>
          </View>
          <View style={styles.statItem}>
            <Ionicons name="swap-horizontal" size={16} color={Colors.textSecondary} />
            <Text style={styles.statText}>{moves}</Text>
          </View>
        </View>
        <TouchableOpacity testID="give-up-button" onPress={handleGiveUp} style={styles.backButton}>
          <Ionicons name="flag-outline" size={22} color={Colors.error} />
        </TouchableOpacity>
      </View>

      {gameState === "cooldown" && !canPlay ? (
        <View style={styles.cooldownContainer}>
          <Ionicons name="time-outline" size={64} color={Colors.textMuted} />
          <Text style={styles.cooldownTitle}>{t.games.comeBackTomorrow}</Text>
          <Text style={styles.cooldownSubtitle}>{t.games.dailyPlaysLeft}: 0</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.gameArea}
          contentContainerStyle={styles.gameContent}
          bounces={false}
        >
          <View style={styles.topRow}>
            <View style={styles.stockWaste}>
              {stock.length > 0 ? (
                <TouchableOpacity testID="stock-pile" onPress={handleStockTap} activeOpacity={0.7}>
                  <View style={[styles.card, styles.cardBack]}>
                    <View style={styles.cardBackOuter}>
                      <View style={styles.cardBackCenter} />
                    </View>
                    <View style={styles.stockCount}>
                      <Text style={styles.stockCountText}>{stock.length}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ) : (
                <EmptySlot testID="stock-empty" onPress={handleStockTap} />
              )}
              {waste.length > 0 ? (
                <CardView
                  card={waste[waste.length - 1]}
                  onPress={handleWasteTap}
                  selected={isSelected("waste", 0, 0)}
                  testID="waste-top"
                />
              ) : (
                <EmptySlot testID="waste-empty" />
              )}
            </View>
            <View style={styles.foundationRow}>
              {foundations.map((f, fi) => (
                <View key={fi}>
                  {f.length > 0 ? (
                    <CardView
                      card={f[f.length - 1]}
                      onPress={() => handleFoundationTap(fi)}
                      testID={`foundation-${fi}`}
                    />
                  ) : (
                    <EmptySlot
                      onPress={() => handleFoundationTap(fi)}
                      testID={`foundation-empty-${fi}`}
                      label={SUIT_SYMBOLS[SUITS[fi]]}
                    />
                  )}
                </View>
              ))}
            </View>
          </View>

          <View style={styles.tableauRow}>
            {tableau.map((col, ci) => (
              <View key={ci} style={[styles.tableauColumn, { minHeight: CARD_HEIGHT + 100 }]}>
                {col.length === 0 ? (
                  <EmptySlot
                    onPress={() => handleEmptyTableauTap(ci)}
                    testID={`tableau-empty-${ci}`}
                  />
                ) : (
                  col.map((card, cardIdx) => (
                    <View
                      key={card.id}
                      style={[
                        styles.stackedCard,
                        {
                          top: cardIdx * (card.faceUp ? STACK_OFFSET_UP : STACK_OFFSET_DOWN),
                          zIndex: cardIdx,
                        },
                      ]}
                    >
                      <CardView
                        card={card}
                        onPress={() => handleTableauTap(ci, cardIdx)}
                        selected={isSelected("tableau", ci, cardIdx)}
                        testID={`tableau-${ci}-${cardIdx}`}
                      />
                    </View>
                  ))
                )}
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      {wonGame && (
        <Animated.View style={[styles.resultOverlay, { opacity: resultOpacity }]}>
          <Animated.View style={[styles.resultCard, { transform: [{ scale: resultScale }] }]}>
            <View style={styles.resultIconWin}>
              <Ionicons name="trophy" size={48} color={Colors.accent} />
            </View>
            <Text style={styles.resultTitle}>
              {totalFoundation === 52 ? t.games.youWon : t.games.gameOver}
            </Text>
            {totalFoundation === 52 && (
              <Text style={styles.resultReward}>{formatPoints(dollarsToPoints(0.25))}</Text>
            )}
            <Text style={styles.resultSubtext}>
              {moves} {t.games.moves} | {formatTime(timer)}
            </Text>

            <TouchableOpacity testID="play-again-button" style={styles.resultButton} onPress={handleNewGame}>
              <Text style={styles.resultButtonText}>{t.games.playAgain}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="back-to-games-button"
              style={styles.resultButtonSecondary}
              onPress={() => router.back()}
            >
              <Ionicons name="arrow-back" size={18} color={Colors.textSecondary} />
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerStats: {
    flexDirection: "row",
    gap: 16,
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statText: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: Colors.text,
  },
  gameArea: {
    flex: 1,
  },
  gameContent: {
    paddingHorizontal: 6,
    paddingBottom: 40,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  stockWaste: {
    flexDirection: "row",
    gap: 6,
  },
  foundationRow: {
    flexDirection: "row",
    gap: 4,
  },
  tableauRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 4,
  },
  tableauColumn: {
    flex: 1,
    position: "relative",
  },
  stackedCard: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 5,
    overflow: "hidden",
  },
  cardFront: {
    backgroundColor: Colors.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.border,
    position: "relative" as const,
  },
  cardBack: {
    backgroundColor: "#1565C0",
    borderWidth: 1,
    borderColor: "#0D47A1",
    alignItems: "center",
    justifyContent: "center",
  },
  cardBackOuter: {
    width: CARD_WIDTH - 6,
    height: CARD_HEIGHT - 6,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: "#FFFFFF40",
    backgroundColor: "#1255A0",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  cardBackDiamond: {
    position: "absolute" as const,
    width: CARD_WIDTH * 0.5,
    height: CARD_WIDTH * 0.5,
    backgroundColor: "#1976D2",
    transform: [{ rotate: "45deg" }],
    top: CARD_HEIGHT * 0.15,
  },
  cardBackDiamond2: {
    position: "absolute" as const,
    width: CARD_WIDTH * 0.4,
    height: CARD_WIDTH * 0.4,
    backgroundColor: "#1E88E5",
    transform: [{ rotate: "45deg" }],
    bottom: CARD_HEIGHT * 0.15,
  },
  cardBackCenter: {
    width: CARD_WIDTH * 0.25,
    height: CARD_WIDTH * 0.25,
    borderRadius: CARD_WIDTH * 0.125,
    backgroundColor: "#FFD60020",
    borderWidth: 1,
    borderColor: "#FFD60040",
  },
  cardSelected: {
    borderColor: "#FFD600",
    borderWidth: 2,
    shadowColor: "#FFD600",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 6,
  },
  cornerTopLeft: {
    position: "absolute" as const,
    top: 1,
    left: 2,
    alignItems: "center",
  },
  cornerBottomRight: {
    position: "absolute" as const,
    bottom: 1,
    right: 2,
    alignItems: "center",
  },
  cornerValue: {
    fontSize: Math.max(8, CARD_WIDTH * 0.2),
    fontWeight: "800" as const,
    lineHeight: Math.max(10, CARD_WIDTH * 0.24),
  },
  cornerSuit: {
    fontSize: Math.max(6, CARD_WIDTH * 0.16),
    lineHeight: Math.max(8, CARD_WIDTH * 0.18),
    marginTop: -1,
  },
  cardCenter: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  faceIcon: {
    width: CARD_WIDTH * 0.5,
    height: CARD_WIDTH * 0.55,
    borderRadius: 3,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surfaceHighlight,
  },
  faceLetter: {
    fontSize: Math.max(10, CARD_WIDTH * 0.28),
    fontWeight: "900" as const,
    lineHeight: Math.max(12, CARD_WIDTH * 0.32),
  },
  faceSuit: {
    fontSize: Math.max(6, CARD_WIDTH * 0.14),
    marginTop: -1,
  },
  aceSuit: {
    fontSize: Math.max(18, CARD_WIDTH * 0.48),
  },
  pipGrid: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    justifyContent: "center",
    alignItems: "center",
    width: CARD_WIDTH * 0.6,
    gap: 0,
  },
  pip: {
    fontSize: Math.max(6, CARD_WIDTH * 0.14),
    lineHeight: Math.max(8, CARD_WIDTH * 0.17),
    textAlign: "center" as const,
    width: CARD_WIDTH * 0.2,
  },
  emptySlot: {
    backgroundColor: "rgba(42, 42, 61, 0.4)",
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyLabel: {
    fontSize: 18,
    color: Colors.textMuted,
    opacity: 0.5,
  },
  stockCount: {
    position: "absolute",
    bottom: 2,
    right: 3,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 6,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
  stockCountText: {
    fontSize: 9,
    color: Colors.textMuted,
    fontWeight: "700" as const,
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
    width: SCREEN_WIDTH - 64,
    maxWidth: 340,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  resultIconWin: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255, 214, 0, 0.15)",
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
