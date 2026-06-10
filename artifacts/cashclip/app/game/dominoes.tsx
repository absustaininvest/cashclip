import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  Dimensions,
  Animated,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/LanguageContext";
import { recordGamePlay, canPlayGame, formatPoints } from "@/lib/storage";
import { beginGame, completeGame } from "@/lib/earn-client";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface Domino {
  id: number;
  top: number;
  bottom: number;
}

type ChainEnd = "left" | "right";

interface PlacedDomino {
  domino: Domino;
  leftVal: number;
  rightVal: number;
}

function createFullSet(): Domino[] {
  const set: Domino[] = [];
  let id = 0;
  for (let i = 0; i <= 6; i++) {
    for (let j = i; j <= 6; j++) {
      set.push({ id: id++, top: i, bottom: j });
    }
  }
  return set;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pipCount(hand: Domino[]): number {
  return hand.reduce((sum, d) => sum + d.top + d.bottom, 0);
}

function canPlace(domino: Domino, val: number): boolean {
  return domino.top === val || domino.bottom === val;
}

function orientDomino(domino: Domino, matchVal: number, side: ChainEnd): PlacedDomino {
  if (side === "left") {
    if (domino.bottom === matchVal) {
      return { domino, leftVal: domino.top, rightVal: domino.bottom };
    }
    return { domino, leftVal: domino.bottom, rightVal: domino.top };
  } else {
    if (domino.top === matchVal) {
      return { domino, leftVal: domino.top, rightVal: domino.bottom };
    }
    return { domino, leftVal: domino.bottom, rightVal: domino.top };
  }
}

const DOT_POSITIONS: Record<number, { x: number; y: number }[]> = {
  0: [],
  1: [{ x: 0.5, y: 0.5 }],
  2: [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }],
  3: [{ x: 0.25, y: 0.25 }, { x: 0.5, y: 0.5 }, { x: 0.75, y: 0.75 }],
  4: [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 }, { x: 0.25, y: 0.75 }, { x: 0.75, y: 0.75 }],
  5: [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 }, { x: 0.5, y: 0.5 }, { x: 0.25, y: 0.75 }, { x: 0.75, y: 0.75 }],
  6: [{ x: 0.25, y: 0.2 }, { x: 0.75, y: 0.2 }, { x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }, { x: 0.25, y: 0.8 }, { x: 0.75, y: 0.8 }],
};

function DotPattern({ value, size }: { value: number; size: number }) {
  const dots = DOT_POSITIONS[value] || [];
  const dotSize = Math.max(6, Math.min(8, size * 0.22));
  return (
    <View style={{ width: size, height: size, position: "relative" }}>
      {dots.map((pos, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            left: pos.x * size - dotSize / 2,
            top: pos.y * size - dotSize / 2,
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: "#FFFFFF",
          }}
        />
      ))}
    </View>
  );
}

function DominoPiece({
  domino,
  size = 32,
  selected,
  onPress,
  horizontal,
  testID,
}: {
  domino: { top: number; bottom: number };
  size?: number;
  selected?: boolean;
  onPress?: () => void;
  horizontal?: boolean;
  testID?: string;
}) {
  const halfSize = size;
  const totalW = horizontal ? halfSize * 2 + 2 : halfSize;
  const totalH = horizontal ? halfSize : halfSize * 2 + 2;

  const content = (
    <View
      style={[
        {
          width: totalW,
          height: totalH,
          borderRadius: 6,
          backgroundColor: selected ? Colors.primaryDark : Colors.surfaceLight,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? Colors.primary : Colors.border,
          flexDirection: horizontal ? "row" : "column",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        },
      ]}
    >
      <DotPattern value={domino.top} size={halfSize} />
      <View
        style={{
          width: horizontal ? 1 : halfSize * 0.7,
          height: horizontal ? halfSize * 0.7 : 1,
          backgroundColor: Colors.textMuted,
        }}
      />
      <DotPattern value={domino.bottom} size={halfSize} />
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity testID={testID} onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
}

function ChainDominoPiece({ placed, size }: { placed: PlacedDomino; size: number }) {
  return (
    <DominoPiece
      domino={{ top: placed.leftVal, bottom: placed.rightVal }}
      size={size}
      horizontal
    />
  );
}

export default function DominoesGame() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();

  const [playerHand, setPlayerHand] = useState<Domino[]>([]);
  const [aiHand, setAiHand] = useState<Domino[]>([]);
  const [boneyard, setBoneyard] = useState<Domino[]>([]);
  const [chain, setChain] = useState<PlacedDomino[]>([]);
  const [selectedDomino, setSelectedDomino] = useState<Domino | null>(null);
  const [gameState, setGameState] = useState<"playing" | "won" | "lost" | "draw" | "cooldown">("playing");
  const [isPlayerTurn, setIsPlayerTurn] = useState(true);
  const [canPlay, setCanPlay] = useState(true);
  const [message, setMessage] = useState("");
  const [serverPoints, setServerPoints] = useState<number | null>(null);
  const [bankFailed, setBankFailed] = useState(false);

  const rewardRecorded = useRef(false);
  const challengeTokenRef = useRef<string | null>(null);
  const resultOpacity = useRef(new Animated.Value(0)).current;
  const resultScale = useRef(new Animated.Value(0.5)).current;
  const chainScrollRef = useRef<ScrollView>(null);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    canPlayGame("dominoes").then((available) => {
      if (!available) {
        setCanPlay(false);
        setGameState("cooldown");
      } else {
        initGame();
        // Game earn endpoints are currently disabled server-side (410).
        // beginGame() will return { ok: false }; bankReward handles this
        // gracefully — the player still gets the win UI but no server reward.
        void beginGame().then((r) => {
          if (r.ok) challengeTokenRef.current = r.challengeToken;
        });
      }
    });
  }, []);

  const initGame = useCallback(() => {
    const fullSet = shuffle(createFullSet());
    const pHand = fullSet.slice(0, 7);
    const aHand = fullSet.slice(7, 14);
    const yard = fullSet.slice(14);
    setPlayerHand(pHand);
    setAiHand(aHand);
    setBoneyard(yard);
    setChain([]);
    setSelectedDomino(null);
    setIsPlayerTurn(true);
    setGameState("playing");
    setMessage("");
    setServerPoints(null);
    setBankFailed(false);
    rewardRecorded.current = false;
    resultOpacity.setValue(0);
    resultScale.setValue(0.5);
  }, []);

  const getChainEnds = useCallback((): { left: number; right: number } | null => {
    if (chain.length === 0) return null;
    return {
      left: chain[0].leftVal,
      right: chain[chain.length - 1].rightVal,
    };
  }, [chain]);

  const hasValidMove = useCallback(
    (hand: Domino[]): boolean => {
      const ends = getChainEnds();
      if (!ends) return true;
      return hand.some((d) => canPlace(d, ends.left) || canPlace(d, ends.right));
    },
    [getChainEnds]
  );

  const showResult = useCallback(() => {
    Animated.parallel([
      Animated.timing(resultOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.spring(resultScale, {
        toValue: 1,
        friction: 5,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Server-authoritative reward: the challenge was issued at game start so the
  // server can verify a real session elapsed (GAME_CHALLENGE_MIN_MS). The SERVER
  // decides the prize (from its GAME_POOL) and drops it into the pending wallet —
  // the on-screen outcome is cosmetic. We mark the play locally WITHOUT crediting
  // a phantom balance (creditLocally:false).
  const bankReward = useCallback(async (desc: string) => {
    const token = challengeTokenRef.current;
    if (!token) {
      // begin never succeeded (network error at game start); skip server reward
      setBankFailed(true);
      return;
    }
    const result = await completeGame(token, desc);
    if (result.ok) {
      setServerPoints(result.token.points);
      await recordGamePlay("dominoes", result.token.points, desc, { creditLocally: false });
    } else {
      setBankFailed(true);
    }
  }, []);

  const endGame = useCallback(
    (result: "won" | "lost" | "draw") => {
      if (rewardRecorded.current) return;
      rewardRecorded.current = true;
      setGameState(result);
      const desc =
        result === "won"
          ? "Dominoes: Won the game!"
          : result === "draw"
          ? "Dominoes: Draw"
          : "Dominoes: Lost";
      void bankReward(desc);
      setTimeout(showResult, 500);
    },
    [showResult, bankReward]
  );

  const checkStuck = useCallback(
    (
      pHand: Domino[],
      aHand: Domino[],
      yard: Domino[],
      currentChain: PlacedDomino[]
    ): "won" | "lost" | "draw" | null => {
      if (pHand.length === 0) return "won";
      if (aHand.length === 0) return "lost";

      if (yard.length > 0) return null;

      const ends = currentChain.length === 0
        ? null
        : {
            left: currentChain[0].leftVal,
            right: currentChain[currentChain.length - 1].rightVal,
          };

      if (!ends) return null;

      const playerCanPlay = pHand.some(
        (d) => canPlace(d, ends.left) || canPlace(d, ends.right)
      );
      const aiCanPlay = aHand.some(
        (d) => canPlace(d, ends.left) || canPlace(d, ends.right)
      );

      if (!playerCanPlay && !aiCanPlay) {
        const pPips = pipCount(pHand);
        const aPips = pipCount(aHand);
        if (pPips < aPips) return "won";
        if (aPips < pPips) return "lost";
        return "draw";
      }

      return null;
    },
    []
  );

  const placeDomino = useCallback(
    (domino: Domino, side: ChainEnd, currentChain: PlacedDomino[]): PlacedDomino[] => {
      const ends =
        currentChain.length === 0
          ? null
          : {
              left: currentChain[0].leftVal,
              right: currentChain[currentChain.length - 1].rightVal,
            };

      if (!ends) {
        const placed: PlacedDomino = {
          domino,
          leftVal: domino.top,
          rightVal: domino.bottom,
        };
        return [placed];
      }

      const matchVal = side === "left" ? ends.left : ends.right;
      const placed = orientDomino(domino, matchVal, side);

      if (side === "left") {
        return [placed, ...currentChain];
      } else {
        return [...currentChain, placed];
      }
    },
    []
  );

  const handleSelectDomino = useCallback(
    (domino: Domino) => {
      if (!isPlayerTurn || gameState !== "playing") return;

      if (selectedDomino?.id === domino.id) {
        setSelectedDomino(null);
        return;
      }

      setSelectedDomino(domino);

      if (chain.length === 0) {
        const newChain = placeDomino(domino, "right", chain);
        setChain(newChain);
        const newHand = playerHand.filter((d) => d.id !== domino.id);
        setPlayerHand(newHand);
        setSelectedDomino(null);
        setMessage("");

        const stuck = checkStuck(newHand, aiHand, boneyard, newChain);
        if (stuck) {
          endGame(stuck);
          return;
        }

        setIsPlayerTurn(false);
        return;
      }

      const ends = {
        left: chain[0].leftVal,
        right: chain[chain.length - 1].rightVal,
      };

      const canLeft = canPlace(domino, ends.left);
      const canRight = canPlace(domino, ends.right);

      if (!canLeft && !canRight) {
        setMessage(t.games.noMatch || "No valid placement");
        setSelectedDomino(null);
        return;
      }

      if (canLeft && canRight && ends.left !== ends.right) {
        setSelectedDomino(domino);
        return;
      }

      const side: ChainEnd = canLeft ? "left" : "right";
      const newChain = placeDomino(domino, side, chain);
      setChain(newChain);
      const newHand = playerHand.filter((d) => d.id !== domino.id);
      setPlayerHand(newHand);
      setSelectedDomino(null);
      setMessage("");

      const stuck = checkStuck(newHand, aiHand, boneyard, newChain);
      if (stuck) {
        endGame(stuck);
        return;
      }

      setIsPlayerTurn(false);
    },
    [isPlayerTurn, gameState, selectedDomino, chain, playerHand, aiHand, boneyard, placeDomino, checkStuck, endGame, t]
  );

  const handlePlaceOnEnd = useCallback(
    (side: ChainEnd) => {
      if (!selectedDomino || !isPlayerTurn || gameState !== "playing") return;

      const ends = getChainEnds();
      if (!ends) return;

      const matchVal = side === "left" ? ends.left : ends.right;
      if (!canPlace(selectedDomino, matchVal)) {
        setMessage(t.games.noMatch || "Cannot place here");
        return;
      }

      const newChain = placeDomino(selectedDomino, side, chain);
      setChain(newChain);
      const newHand = playerHand.filter((d) => d.id !== selectedDomino.id);
      setPlayerHand(newHand);
      setSelectedDomino(null);
      setMessage("");

      const stuck = checkStuck(newHand, aiHand, boneyard, newChain);
      if (stuck) {
        endGame(stuck);
        return;
      }

      setIsPlayerTurn(false);
    },
    [selectedDomino, isPlayerTurn, gameState, chain, playerHand, aiHand, boneyard, getChainEnds, placeDomino, checkStuck, endGame, t]
  );

  const handleDrawFromBoneyard = useCallback(() => {
    if (!isPlayerTurn || gameState !== "playing" || boneyard.length === 0) return;

    if (hasValidMove(playerHand)) {
      setMessage(t.games.yourTurn || "You have a valid move");
      return;
    }

    const drawn = boneyard[0];
    const newYard = boneyard.slice(1);
    const newHand = [...playerHand, drawn];
    setBoneyard(newYard);
    setPlayerHand(newHand);
    setSelectedDomino(null);

    if (!hasValidMoveWithState(newHand, chain)) {
      const stuck = checkStuck(newHand, aiHand, newYard, chain);
      if (stuck) {
        endGame(stuck);
        return;
      }
      if (newYard.length === 0) {
        setIsPlayerTurn(false);
      }
    }
  }, [isPlayerTurn, gameState, boneyard, playerHand, aiHand, chain, hasValidMove, checkStuck, endGame, t]);

  function hasValidMoveWithState(hand: Domino[], currentChain: PlacedDomino[]): boolean {
    if (currentChain.length === 0) return true;
    const ends = {
      left: currentChain[0].leftVal,
      right: currentChain[currentChain.length - 1].rightVal,
    };
    return hand.some((d) => canPlace(d, ends.left) || canPlace(d, ends.right));
  }

  useEffect(() => {
    if (isPlayerTurn || gameState !== "playing") return;

    const timer = setTimeout(() => {
      let currentAiHand = [...aiHand];
      let currentBoneyard = [...boneyard];
      let currentChain = [...chain];

      const ends =
        currentChain.length === 0
          ? null
          : {
              left: currentChain[0].leftVal,
              right: currentChain[currentChain.length - 1].rightVal,
            };

      if (!ends) {
        if (currentAiHand.length > 0) {
          const highest = currentAiHand.reduce((best, d) =>
            d.top + d.bottom > best.top + best.bottom ? d : best
          );
          currentChain = placeDomino(highest, "right", currentChain);
          currentAiHand = currentAiHand.filter((d) => d.id !== highest.id);
        }
      } else {
        const validMoves: { domino: Domino; side: ChainEnd }[] = [];
        for (const d of currentAiHand) {
          if (canPlace(d, ends.left)) validMoves.push({ domino: d, side: "left" });
          if (canPlace(d, ends.right)) validMoves.push({ domino: d, side: "right" });
        }

        if (validMoves.length > 0) {
          const best = validMoves.reduce((a, b) =>
            a.domino.top + a.domino.bottom >= b.domino.top + b.domino.bottom ? a : b
          );
          currentChain = placeDomino(best.domino, best.side, currentChain);
          currentAiHand = currentAiHand.filter((d) => d.id !== best.domino.id);
        } else {
          let drew = false;
          while (currentBoneyard.length > 0) {
            const drawn = currentBoneyard[0];
            currentBoneyard = currentBoneyard.slice(1);
            currentAiHand = [...currentAiHand, drawn];
            if (canPlace(drawn, ends.left) || canPlace(drawn, ends.right)) {
              const side: ChainEnd = canPlace(drawn, ends.right) ? "right" : "left";
              currentChain = placeDomino(drawn, side, currentChain);
              currentAiHand = currentAiHand.filter((d) => d.id !== drawn.id);
              drew = true;
              break;
            }
          }
          if (!drew) {
          }
        }
      }

      setAiHand(currentAiHand);
      setBoneyard(currentBoneyard);
      setChain(currentChain);

      const stuck = checkStuck(playerHand, currentAiHand, currentBoneyard, currentChain);
      if (stuck) {
        endGame(stuck);
        return;
      }

      setIsPlayerTurn(true);
    }, 800);

    return () => clearTimeout(timer);
  }, [isPlayerTurn, gameState]);

  useEffect(() => {
    if (chainScrollRef.current && chain.length > 0) {
      setTimeout(() => {
        chainScrollRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [chain.length]);

  const ends = getChainEnds();
  const showEndButtons = selectedDomino && ends && chain.length > 0;
  const canLeftPlace = selectedDomino && ends ? canPlace(selectedDomino, ends.left) : false;
  const canRightPlace = selectedDomino && ends ? canPlace(selectedDomino, ends.right) : false;
  const bothEndsAvailable = canLeftPlace && canRightPlace && ends && ends.left !== ends.right;

  const rewardDisplay = bankFailed ? (
    <Text style={styles.resultSubtext}>
      We couldn&apos;t add your reward right now. Please try again later.
    </Text>
  ) : serverPoints === null ? (
    <>
      <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 8 }} />
      <Text style={styles.resultSubtext}>Adding your reward…</Text>
    </>
  ) : (
    <Text style={styles.resultReward}>{formatPoints(serverPoints)}</Text>
  );

  const dominoSize = Math.min(30, (SCREEN_WIDTH - 100) / 10);

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <View style={styles.header}>
        <TouchableOpacity testID="back-button" onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t.games.dominoes}</Text>
        <View style={styles.headerStats}>
          <Text style={styles.statText}>{playerHand.length} / AI: {aiHand.length}</Text>
          <Text style={styles.statText}>
            {isPlayerTurn && gameState === "playing" ? t.games.yourTurn : !isPlayerTurn && gameState === "playing" ? t.games.aiTurn : ""}
          </Text>
        </View>
      </View>

      {gameState === "cooldown" && !canPlay ? (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.cooldownContainer, { paddingBottom: bottomInset + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          <Ionicons name="time-outline" size={64} color={Colors.textMuted} />
          <Text style={styles.cooldownTitle}>{t.games.comeBackTomorrow}</Text>
          <Text style={styles.cooldownSubtitle}>{t.games.dailyPlaysLeft}: 0</Text>
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.gameArea, { paddingBottom: bottomInset + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.aiSection}>
            <Text style={styles.sectionLabel}>
              {isPlayerTurn ? "" : t.games.aiTurn + "..."}
            </Text>
            <View style={styles.aiHandRow}>
              {aiHand.map((_, i) => (
                <View key={i} style={styles.aiDomino}>
                  <View style={styles.aiDominoInner} />
                </View>
              ))}
            </View>
            <Text style={styles.aiCount}>{aiHand.length}</Text>
          </View>

          <View style={styles.chainContainer}>
            {chain.length === 0 ? (
              <Text style={styles.chainPlaceholder}>
                {isPlayerTurn ? t.games.yourTurn : t.games.aiTurn}
              </Text>
            ) : (
              <ScrollView
                ref={chainScrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chainScroll}
              >
                {bothEndsAvailable && (
                  <TouchableOpacity
                    testID="place-left-end"
                    style={styles.endButton}
                    onPress={() => handlePlaceOnEnd("left")}
                  >
                    <Ionicons name="arrow-back-circle" size={28} color={Colors.primary} />
                  </TouchableOpacity>
                )}
                {chain.map((placed, i) => (
                  <View key={placed.domino.id} style={styles.chainPiece}>
                    <ChainDominoPiece placed={placed} size={dominoSize} />
                  </View>
                ))}
                {bothEndsAvailable && (
                  <TouchableOpacity
                    testID="place-right-end"
                    style={styles.endButton}
                    onPress={() => handlePlaceOnEnd("right")}
                  >
                    <Ionicons name="arrow-forward-circle" size={28} color={Colors.primary} />
                  </TouchableOpacity>
                )}
              </ScrollView>
            )}
          </View>

          {message ? (
            <Text style={styles.messageText}>{message}</Text>
          ) : null}

          <View style={styles.actionsRow}>
            {boneyard.length > 0 && isPlayerTurn && !hasValidMove(playerHand) && (
              <TouchableOpacity
                testID="draw-boneyard"
                style={styles.drawButton}
                onPress={handleDrawFromBoneyard}
              >
                <Ionicons name="add-circle" size={20} color={Colors.background} />
                <Text style={styles.drawButtonText}>Draw ({boneyard.length})</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.playerSection}>
            <Text style={styles.sectionLabel}>
              {isPlayerTurn ? t.games.yourTurn : ""}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.playerHandScroll}
            >
              {playerHand.map((domino) => (
                <View key={domino.id} style={styles.handPiece}>
                  <DominoPiece
                    domino={{ top: domino.top, bottom: domino.bottom }}
                    size={30}
                    selected={selectedDomino?.id === domino.id}
                    onPress={() => handleSelectDomino(domino)}
                    testID={`player-domino-${domino.id}`}
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        </ScrollView>
      )}

      {(gameState === "won" || gameState === "lost" || gameState === "draw") && (
        <Animated.View
          style={[styles.resultOverlay, { opacity: resultOpacity }]}
        >
          <Animated.View style={[styles.resultCard, { transform: [{ scale: resultScale }] }]}>
            {gameState === "won" ? (
              <>
                <View style={styles.resultIconWin}>
                  <Ionicons name="trophy" size={48} color={Colors.accent} />
                </View>
                <Text style={styles.resultTitle}>{t.games.youWon}</Text>
                {rewardDisplay}
              </>
            ) : gameState === "draw" ? (
              <>
                <View style={styles.resultIconDraw}>
                  <Ionicons name="remove-circle" size={48} color={Colors.warning} />
                </View>
                <Text style={styles.resultTitle}>{t.games.draw}</Text>
                {rewardDisplay}
              </>
            ) : (
              <>
                <View style={styles.resultIconLose}>
                  <Ionicons name="close-circle" size={48} color={Colors.error} />
                </View>
                <Text style={styles.resultTitle}>{t.games.youLose}</Text>
                {rewardDisplay}
              </>
            )}

            <TouchableOpacity
              testID="play-again-button"
              style={styles.resultButton}
              onPress={initGame}
            >
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
  headerStats: {
    alignItems: "flex-end",
  },
  statText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  scrollView: {
    flex: 1,
  },
  cooldownContainer: {
    flexGrow: 1,
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
  gameArea: {
    flexGrow: 1,
    justifyContent: "space-between",
  },
  aiSection: {
    alignItems: "center",
    paddingVertical: 8,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: Colors.primary,
    marginBottom: 6,
    height: 20,
  },
  aiHandRow: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 3,
    paddingHorizontal: 16,
  },
  aiDomino: {
    width: 16,
    height: 28,
    borderRadius: 4,
    backgroundColor: Colors.surfaceHighlight,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  aiDominoInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.textMuted,
  },
  aiCount: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 4,
  },
  chainContainer: {
    justifyContent: "center",
    alignItems: "center",
    minHeight: 120,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    marginHorizontal: 8,
    borderRadius: 12,
    backgroundColor: Colors.surface,
  },
  chainPlaceholder: {
    fontSize: 16,
    color: Colors.textMuted,
  },
  chainScroll: {
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  chainPiece: {
    marginHorizontal: 1,
  },
  endButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 4,
  },
  messageText: {
    textAlign: "center",
    fontSize: 13,
    color: Colors.warning,
    paddingVertical: 4,
  },
  actionsRow: {
    flexDirection: "row",
    justifyContent: "center",
    paddingVertical: 6,
    minHeight: 40,
  },
  drawButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  drawButtonText: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: Colors.background,
  },
  playerSection: {
    alignItems: "center",
    paddingBottom: 12,
  },
  playerHandScroll: {
    paddingHorizontal: 16,
    gap: 6,
    alignItems: "center",
  },
  handPiece: {
    marginHorizontal: 2,
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
  resultIconDraw: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255, 214, 0, 0.10)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  resultIconLose: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255, 82, 82, 0.15)",
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
    marginBottom: 24,
  },
  resultSubtext: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
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
