import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Platform,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/LanguageContext";
import { recordGamePlay, canPlayGame, dollarsToPoints, formatPoints } from "@/lib/storage";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface Question {
  question: string;
  options: string[];
  correctIndex: number;
}

const QUESTION_BANK: Question[] = [
  { question: "What planet is known as the Red Planet?", options: ["Venus", "Mars", "Jupiter", "Saturn"], correctIndex: 1 },
  { question: "What is the largest ocean on Earth?", options: ["Atlantic", "Indian", "Arctic", "Pacific"], correctIndex: 3 },
  { question: "How many continents are there?", options: ["5", "6", "7", "8"], correctIndex: 2 },
  { question: "What gas do plants absorb from the atmosphere?", options: ["Oxygen", "Nitrogen", "Carbon Dioxide", "Hydrogen"], correctIndex: 2 },
  { question: "What is the capital of Japan?", options: ["Seoul", "Beijing", "Tokyo", "Bangkok"], correctIndex: 2 },
  { question: "Which element has the chemical symbol 'O'?", options: ["Gold", "Osmium", "Oxygen", "Oganesson"], correctIndex: 2 },
  { question: "What year did the Titanic sink?", options: ["1905", "1912", "1920", "1898"], correctIndex: 1 },
  { question: "What is the smallest country in the world?", options: ["Monaco", "Vatican City", "San Marino", "Liechtenstein"], correctIndex: 1 },
  { question: "How many sides does a hexagon have?", options: ["5", "6", "7", "8"], correctIndex: 1 },
  { question: "What is the hardest natural substance?", options: ["Gold", "Iron", "Diamond", "Platinum"], correctIndex: 2 },
  { question: "Which planet is closest to the Sun?", options: ["Venus", "Earth", "Mercury", "Mars"], correctIndex: 2 },
  { question: "What is the largest mammal?", options: ["Elephant", "Blue Whale", "Giraffe", "Hippopotamus"], correctIndex: 1 },
  { question: "In what year did World War II end?", options: ["1943", "1944", "1945", "1946"], correctIndex: 2 },
  { question: "What is the chemical formula for water?", options: ["CO2", "H2O", "NaCl", "O2"], correctIndex: 1 },
  { question: "Which country has the most population?", options: ["USA", "India", "China", "Indonesia"], correctIndex: 1 },
  { question: "What is the speed of light approximately?", options: ["300,000 km/s", "150,000 km/s", "500,000 km/s", "100,000 km/s"], correctIndex: 0 },
  { question: "Who painted the Mona Lisa?", options: ["Michelangelo", "Raphael", "Da Vinci", "Botticelli"], correctIndex: 2 },
  { question: "What is the currency of the United Kingdom?", options: ["Euro", "Dollar", "Pound", "Franc"], correctIndex: 2 },
  { question: "How many bones are in the adult human body?", options: ["186", "206", "226", "256"], correctIndex: 1 },
  { question: "What is the largest desert in the world?", options: ["Sahara", "Gobi", "Antarctic", "Arabian"], correctIndex: 2 },
  { question: "Which blood type is a universal donor?", options: ["A", "B", "AB", "O"], correctIndex: 3 },
  { question: "What is the tallest mountain in the world?", options: ["K2", "Kangchenjunga", "Everest", "Lhotse"], correctIndex: 2 },
  { question: "How many players are on a soccer team?", options: ["9", "10", "11", "12"], correctIndex: 2 },
  { question: "What is the main ingredient in guacamole?", options: ["Tomato", "Avocado", "Pepper", "Onion"], correctIndex: 1 },
  { question: "Which organ pumps blood through the body?", options: ["Liver", "Lungs", "Brain", "Heart"], correctIndex: 3 },
  { question: "What is the freezing point of water in Celsius?", options: ["-10", "0", "10", "32"], correctIndex: 1 },
  { question: "Which animal is known as the King of the Jungle?", options: ["Tiger", "Elephant", "Lion", "Bear"], correctIndex: 2 },
  { question: "What language has the most native speakers?", options: ["English", "Spanish", "Hindi", "Mandarin"], correctIndex: 3 },
  { question: "How many strings does a standard guitar have?", options: ["4", "5", "6", "7"], correctIndex: 2 },
  { question: "What is the largest planet in our solar system?", options: ["Saturn", "Jupiter", "Neptune", "Uranus"], correctIndex: 1 },
  { question: "Which vitamin does sunlight help produce?", options: ["Vitamin A", "Vitamin B", "Vitamin C", "Vitamin D"], correctIndex: 3 },
  { question: "What is the boiling point of water in Fahrenheit?", options: ["100", "180", "200", "212"], correctIndex: 3 },
];

const QUESTIONS_PER_ROUND = 10;
const TIME_PER_QUESTION = 15;

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

type GameState = "loading" | "cooldown" | "ready" | "playing" | "feedback" | "finished";

export default function TriviaGame() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const [gameState, setGameState] = useState<GameState>("loading");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [timeLeft, setTimeLeft] = useState(TIME_PER_QUESTION);
  const [totalReward, setTotalReward] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    canPlayGame("trivia").then((canPlay) => {
      if (!canPlay) {
        setGameState("cooldown");
      } else {
        setGameState("ready");
      }
    });
  }, []);

  const startGame = useCallback(() => {
    const selected = shuffleArray(QUESTION_BANK).slice(0, QUESTIONS_PER_ROUND);
    setQuestions(selected);
    setCurrentIndex(0);
    setCorrectCount(0);
    setSelectedAnswer(null);
    setIsCorrect(null);
    setTotalReward(0);
    setTimeLeft(TIME_PER_QUESTION);
    setGameState("playing");

    progressAnim.setValue(1);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();

    startTimer();
  }, []);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    let t = TIME_PER_QUESTION;
    setTimeLeft(t);
    progressAnim.setValue(1);

    Animated.timing(progressAnim, {
      toValue: 0,
      duration: TIME_PER_QUESTION * 1000,
      useNativeDriver: false,
    }).start();

    timerRef.current = setInterval(() => {
      t -= 1;
      setTimeLeft(t);
      if (t <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        handleTimeout();
      }
    }, 1000);
  }, []);

  const handleTimeout = useCallback(() => {
    setSelectedAnswer(-1);
    setIsCorrect(false);
    setGameState("feedback");

    setTimeout(() => {
      advanceQuestion(false);
    }, 1500);
  }, []);

  const handleAnswer = useCallback((optionIndex: number) => {
    if (selectedAnswer !== null || gameState !== "playing") return;

    if (timerRef.current) clearInterval(timerRef.current);

    const correct = optionIndex === questions[currentIndex].correctIndex;
    setSelectedAnswer(optionIndex);
    setIsCorrect(correct);
    setGameState("feedback");

    if (correct) {
      setCorrectCount((prev) => prev + 1);
    }

    setTimeout(() => {
      advanceQuestion(correct);
    }, 1500);
  }, [selectedAnswer, gameState, questions, currentIndex]);

  const advanceQuestion = useCallback((wasCorrect: boolean) => {
    const nextIndex = currentIndex + 1;

    if (nextIndex >= QUESTIONS_PER_ROUND) {
      finishGame(wasCorrect);
      return;
    }

    setCurrentIndex(nextIndex);
    setSelectedAnswer(null);
    setIsCorrect(null);
    setTimeLeft(TIME_PER_QUESTION);
    setGameState("playing");

    fadeAnim.setValue(0);
    scaleAnim.setValue(0.9);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();

    startTimer();
  }, [currentIndex]);

  const finishGame = useCallback(async (lastWasCorrect: boolean) => {
    if (timerRef.current) clearInterval(timerRef.current);

    const finalCorrect = correctCount + (lastWasCorrect ? 1 : 0);
    let reward = finalCorrect * 0.01;
    if (finalCorrect >= 8) reward += 0.05;
    if (finalCorrect === 10) reward += 0.10;
    reward = parseFloat(reward.toFixed(2));

    setCorrectCount(finalCorrect);
    setTotalReward(reward);
    setGameState("finished");

    if (reward > 0) {
      await recordGamePlay("trivia", dollarsToPoints(reward), `Trivia Quiz: ${finalCorrect}/10 correct`);
    }
  }, [correctCount]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const getPerformanceLabel = () => {
    if (correctCount === 10) return t.games.perfect;
    if (correctCount >= 8) return t.games.great;
    if (correctCount >= 5) return t.games.good;
    return t.games.tryHarder;
  };

  const getOptionStyle = (index: number) => {
    if (selectedAnswer === null && gameState === "playing") return styles.optionDefault;
    if (index === questions[currentIndex]?.correctIndex) return styles.optionCorrect;
    if (index === selectedAnswer && !isCorrect) return styles.optionIncorrect;
    return styles.optionDefault;
  };

  const getOptionTextStyle = (index: number) => {
    if (selectedAnswer === null && gameState === "playing") return styles.optionTextDefault;
    if (index === questions[currentIndex]?.correctIndex) return styles.optionTextCorrect;
    if (index === selectedAnswer && !isCorrect) return styles.optionTextIncorrect;
    return styles.optionTextDefault;
  };

  const renderCooldown = () => (
    <View style={styles.centerContainer}>
      <Ionicons name="time-outline" size={64} color={Colors.textMuted} />
      <Text style={styles.cooldownTitle}>{t.games.comeBackTomorrow}</Text>
      <Text style={styles.cooldownSubtitle}>{t.games.triviaQuizDesc}</Text>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => router.back()}
        testID="trivia-back-cooldown"
      >
        <Ionicons name="arrow-back" size={24} color={Colors.text} />
      </TouchableOpacity>
    </View>
  );

  const renderReady = () => (
    <View style={styles.centerContainer}>
      <View style={styles.readyIconContainer}>
        <Ionicons name="help-circle" size={80} color={Colors.primary} />
      </View>
      <Text style={styles.readyTitle}>{t.games.triviaQuiz}</Text>
      <Text style={styles.readySubtitle}>{t.games.triviaQuizDesc}</Text>
      <View style={styles.rulesContainer}>
        <View style={styles.ruleRow}>
          <Ionicons name="help-circle-outline" size={20} color={Colors.accent} />
          <Text style={styles.ruleText}>10 {t.games.question}s</Text>
        </View>
        <View style={styles.ruleRow}>
          <Ionicons name="timer-outline" size={20} color={Colors.accent} />
          <Text style={styles.ruleText}>15s per {t.games.question.toLowerCase()}</Text>
        </View>
        <View style={styles.ruleRow}>
          <Ionicons name="cash-outline" size={20} color={Colors.accent} />
          <Text style={styles.ruleText}>$0.01 per {t.games.correct.toLowerCase()}, bonus for 8+</Text>
        </View>
      </View>
      <TouchableOpacity
        style={styles.playButton}
        onPress={startGame}
        testID="trivia-start"
      >
        <Ionicons name="play" size={24} color={Colors.background} />
        <Text style={styles.playButtonText}>{t.games.play}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderPlaying = () => {
    const question = questions[currentIndex];
    if (!question) return null;

    const progressWidth = progressAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ["0%", "100%"],
    });

    return (
      <Animated.View style={[styles.playingContainer, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
        <View style={styles.progressBarContainer}>
          <Animated.View
            style={[
              styles.progressBarFill,
              {
                width: progressWidth,
                backgroundColor: timeLeft <= 5 ? Colors.error : Colors.primary,
              },
            ]}
          />
        </View>

        <View style={styles.questionCard}>
          <Text style={styles.questionText}>{question.question}</Text>
        </View>

        <View style={styles.optionsContainer}>
          {question.options.map((option, index) => (
            <TouchableOpacity
              key={index}
              style={[styles.optionButton, getOptionStyle(index)]}
              onPress={() => handleAnswer(index)}
              disabled={selectedAnswer !== null}
              testID={`trivia-option-${index}`}
            >
              <View style={styles.optionLabelContainer}>
                <Text style={[styles.optionLabel, getOptionTextStyle(index)]}>
                  {String.fromCharCode(65 + index)}
                </Text>
              </View>
              <Text style={[styles.optionText, getOptionTextStyle(index)]}>{option}</Text>
              {selectedAnswer !== null && index === question.correctIndex && (
                <Ionicons name="checkmark-circle" size={22} color={Colors.success} style={styles.optionIcon} />
              )}
              {selectedAnswer === index && !isCorrect && (
                <Ionicons name="close-circle" size={22} color={Colors.error} style={styles.optionIcon} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      </Animated.View>
    );
  };

  const renderFinished = () => (
    <View style={styles.centerContainer}>
      <View style={styles.resultIconContainer}>
        <Ionicons
          name={correctCount >= 8 ? "trophy" : correctCount >= 5 ? "ribbon" : "sad-outline"}
          size={64}
          color={correctCount >= 8 ? Colors.accent : correctCount >= 5 ? Colors.primary : Colors.textMuted}
        />
      </View>
      <Text style={styles.resultLabel}>{getPerformanceLabel()}</Text>
      <Text style={styles.resultScore}>{correctCount}/{QUESTIONS_PER_ROUND}</Text>
      <Text style={styles.resultScoreLabel}>{t.games.correct}</Text>

      {totalReward > 0 && (
        <View style={styles.rewardBadge}>
          <Ionicons name="cash" size={20} color={Colors.background} />
          <Text style={styles.rewardBadgeText}>+{formatPoints(dollarsToPoints(totalReward))}</Text>
        </View>
      )}

      <View style={styles.finishedButtons}>
        <TouchableOpacity
          style={styles.finishedBackButton}
          onPress={() => router.back()}
          testID="trivia-back-finished"
        >
          <Ionicons name="arrow-back" size={22} color={Colors.text} />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: topInset, paddingBottom: bottomInset }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="trivia-back">
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t.games.triviaQuiz}</Text>
        {gameState === "playing" || gameState === "feedback" ? (
          <View style={styles.headerRight}>
            <View style={styles.headerStat}>
              <Ionicons name="timer-outline" size={16} color={timeLeft <= 5 ? Colors.error : Colors.textSecondary} />
              <Text style={[styles.headerStatText, timeLeft <= 5 && { color: Colors.error }]}>{timeLeft}s</Text>
            </View>
            <View style={styles.headerStat}>
              <Text style={styles.headerStatText}>
                {currentIndex + 1}/{QUESTIONS_PER_ROUND}
              </Text>
            </View>
            <View style={styles.headerStat}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
              <Text style={styles.headerStatText}>{correctCount}</Text>
            </View>
          </View>
        ) : (
          <View style={{ width: 24 }} />
        )}
      </View>

      {gameState === "loading" && (
        <View style={styles.centerContainer}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      )}
      {gameState === "cooldown" && renderCooldown()}
      {gameState === "ready" && renderReady()}
      {(gameState === "playing" || gameState === "feedback") && renderPlaying()}
      {gameState === "finished" && renderFinished()}
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
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700" as const,
    color: Colors.text,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerStat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  headerStatText: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: Colors.textSecondary,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: 16,
  },
  cooldownTitle: {
    fontSize: 22,
    fontWeight: "700" as const,
    color: Colors.text,
    marginTop: 20,
    textAlign: "center" as const,
  },
  cooldownSubtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginTop: 8,
    textAlign: "center" as const,
  },
  backButton: {
    marginTop: 32,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.surfaceLight,
    justifyContent: "center",
    alignItems: "center",
  },
  readyIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Colors.surface,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  readyTitle: {
    fontSize: 28,
    fontWeight: "800" as const,
    color: Colors.text,
    marginBottom: 8,
  },
  readySubtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: "center" as const,
    marginBottom: 32,
  },
  rulesContainer: {
    width: "100%",
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 32,
    gap: 14,
  },
  ruleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  ruleText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  playButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 28,
  },
  playButtonText: {
    fontSize: 18,
    fontWeight: "700" as const,
    color: Colors.background,
  },
  playingContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  progressBarContainer: {
    height: 6,
    backgroundColor: Colors.surface,
    borderRadius: 3,
    overflow: "hidden" as const,
    marginBottom: 24,
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 3,
  },
  questionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 28,
    marginBottom: 28,
    minHeight: 120,
    justifyContent: "center",
  },
  questionText: {
    fontSize: 20,
    fontWeight: "700" as const,
    color: Colors.text,
    textAlign: "center" as const,
    lineHeight: 28,
  },
  optionsContainer: {
    gap: 12,
  },
  optionButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 2,
  },
  optionDefault: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
  },
  optionCorrect: {
    backgroundColor: "rgba(0, 230, 118, 0.12)",
    borderColor: Colors.success,
  },
  optionIncorrect: {
    backgroundColor: "rgba(255, 82, 82, 0.12)",
    borderColor: Colors.error,
  },
  optionLabelContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.surfaceHighlight,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: "700" as const,
  },
  optionText: {
    fontSize: 16,
    fontWeight: "600" as const,
    flex: 1,
  },
  optionTextDefault: {
    color: Colors.text,
  },
  optionTextCorrect: {
    color: Colors.success,
  },
  optionTextIncorrect: {
    color: Colors.error,
  },
  optionIcon: {
    marginLeft: 8,
  },
  resultIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Colors.surface,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  resultLabel: {
    fontSize: 26,
    fontWeight: "800" as const,
    color: Colors.accent,
    marginBottom: 8,
  },
  resultScore: {
    fontSize: 48,
    fontWeight: "800" as const,
    color: Colors.text,
  },
  resultScoreLabel: {
    fontSize: 16,
    color: Colors.textSecondary,
    marginBottom: 20,
  },
  rewardBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 8,
    marginBottom: 24,
  },
  rewardBadgeText: {
    fontSize: 18,
    fontWeight: "700" as const,
    color: Colors.background,
  },
  finishedButtons: {
    flexDirection: "row",
    gap: 16,
    marginTop: 12,
  },
  finishedBackButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.surfaceLight,
    justifyContent: "center",
    alignItems: "center",
  },
});
