import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  RefreshControl,
  Modal,
  ActivityIndicator,
  Linking,
  TextInput,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import type { DimensionValue } from "react-native";

type FeatherIconName = ComponentProps<typeof Feather>["name"];
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useFonts, Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/LanguageContext";
import { useAuth } from "@/lib/AuthContext";
import { getApiUrl } from "@/lib/query-client";

interface KeyValidation {
  supported: boolean;
  ok: boolean;
  authRejected?: boolean;
  status?: number;
  latencyMs?: number;
  error?: string;
  reason?: string;
}

interface IntegrationStatus {
  id: string;
  name: string;
  category: string;
  priority: string;
  connected: boolean;
  connectionState?: "connected" | "pending" | "key_rejected" | "unreachable";
  verification?: {
    kind: "ok" | "failed" | "unsupported";
    status?: number;
    latencyMs?: number;
    error?: string;
    reason?: string;
    checkedAt: number;
  };
  envKey: string;
  signupUrl: string;
  description: string;
  revenueShare: string;
  setupSteps: string[];
}

interface SaveKeyResponse {
  ok?: boolean;
  error?: string;
  persisted?: boolean;
  validation?: KeyValidation;
  integration?: IntegrationStatus;
  note?: string;
}

interface IntegrationSummary {
  total: number;
  connected: number;
  pending: number;
  readyToEarn: boolean;
  startHereComplete: string;
}

interface HealthResult {
  id: string;
  name: string;
  category: string;
  reachable: boolean;
  httpStatus: number | undefined;
  latencyMs: number;
  error: string | undefined;
}

interface StatusResponse {
  summary: IntegrationSummary;
  nextStep: { message: string; platforms: IntegrationStatus[] };
  integrations: {
    startHere: IntegrationStatus[];
    recommended: IntegrationStatus[];
    optional: IntegrationStatus[];
  };
}

interface KeyHealthFailure {
  envKey: string;
  integrationId: string | null;
  integrationName: string | null;
}

interface KeyHealthResponse {
  checkedAt: string | null;
  secretMissing: boolean;
  decryptionFailures: KeyHealthFailure[];
}

const CATEGORY_META: Record<string, { icon: FeatherIconName; color: string; label: string; labelEs: string }> = {
  ads: { icon: "play-circle", color: "#4ECDC4", label: "Ads", labelEs: "Anuncios" },
  surveys: { icon: "clipboard", color: "#FFD600", label: "Surveys", labelEs: "Encuestas" },
  affiliates: { icon: "link", color: "#FF7043", label: "Affiliates", labelEs: "Afiliados" },
  payments: { icon: "credit-card", color: "#42A5F5", label: "Payments", labelEs: "Pagos" },
};
const CATEGORY_META_FALLBACK = { icon: "grid" as FeatherIconName, color: "#888888", label: "Other", labelEs: "Otro" };

const PRIORITY_META: Record<string, { label: string; labelEs: string; color: string }> = {
  "start-here": { label: "Start Here", labelEs: "Empieza Aqui", color: Colors.primary },
  recommended: { label: "Recommended", labelEs: "Recomendado", color: "#42A5F5" },
  optional: { label: "Optional", labelEs: "Opcional", color: Colors.textMuted },
};
const PRIORITY_META_FALLBACK = { label: "Optional", labelEs: "Opcional", color: Colors.textMuted };

export default function SetupWizardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { lang } = useLanguage();
  const { isAdmin, isLoading: authLoading, token } = useAuth();
  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold });

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusData, setStatusData] = useState<StatusResponse | null>(null);
  const [healthResults, setHealthResults] = useState<HealthResult[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthCheckedAt, setHealthCheckedAt] = useState<string | null>(null);
  const [keyHealth, setKeyHealth] = useState<KeyHealthResponse | null>(null);
  const [selectedIntegration, setSelectedIntegration] = useState<IntegrationStatus | null>(null);
  const [activeFilter, setActiveFilter] = useState<"all" | "connected" | "pending">("all");
  const [keyInput, setKeyInput] = useState("");
  const [keySaving, setKeySaving] = useState(false);
  const [keyClearing, setKeyClearing] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keySavedAt, setKeySavedAt] = useState<number | null>(null);
  const [keySavedPersisted, setKeySavedPersisted] = useState<boolean>(false);
  const [keyClearedAt, setKeyClearedAt] = useState<number | null>(null);
  const [keyValidation, setKeyValidation] = useState<KeyValidation | null>(null);
  const [rotateModalOpen, setRotateModalOpen] = useState(false);
  const [rotateOldSecret, setRotateOldSecret] = useState("");
  const [rotateLoading, setRotateLoading] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [rotateResult, setRotateResult] = useState<{ rotated: number; failed: string[]; note: string } | null>(null);
  const [secretsPassphrase, setSecretsPassphrase] = useState("");
  const [passphraseError, setPassphraseError] = useState<string | null>(null);

  useEffect(() => {
    if (!rotateModalOpen) {
      setRotateOldSecret("");
      setRotateError(null);
      setRotateResult(null);
      setRotateLoading(false);
    }
  }, [rotateModalOpen]);

  useEffect(() => {
    setKeyInput("");
    setKeyError(null);
    setKeySavedAt(null);
    setKeySavedPersisted(false);
    setKeyClearedAt(null);
    setKeyValidation(null);
  }, [selectedIntegration?.id]);

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.back();
    }
  }, [isAdmin, authLoading]);

  const loadStatus = useCallback(async () => {
    try {
      const baseUrl = getApiUrl();
      const res = await globalThis.fetch(new URL("/api/integrations/status", baseUrl).toString());
      if (!res.ok) throw new Error(`${res.status}`);
      const data: StatusResponse = await res.json();
      setStatusData(data);
    } catch (err) {
      console.error("Failed to load integration status:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadKeyHealth = useCallback(async () => {
    if (!token) return;
    try {
      const baseUrl = getApiUrl();
      const res = await globalThis.fetch(
        new URL("/api/admin/integrations/key-health", baseUrl).toString(),
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const data: KeyHealthResponse = await res.json();
      setKeyHealth(data);
    } catch (err) {
      console.error("Failed to load key health:", err);
    }
  }, [token]);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const baseUrl = getApiUrl();
      const res = await globalThis.fetch(new URL("/api/integrations/health", baseUrl).toString());
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setHealthResults(data.results || []);
      setHealthCheckedAt(data.checkedAt || null);
    } catch (err) {
      console.error("Failed to load health:", err);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadHealth();
    loadKeyHealth();
  }, [loadKeyHealth]);

  const saveApiKey = useCallback(async (integration: IntegrationStatus) => {
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setKeyError(lang === "es" ? "Ingresa una clave API" : "Enter an API key");
      return;
    }
    setKeySaving(true);
    setKeyError(null);
    try {
      const baseUrl = getApiUrl();
      const res = await globalThis.fetch(
        new URL(`/api/admin/integrations/${integration.id}/key`, baseUrl).toString(),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(secretsPassphrase ? { "X-Secrets-Passphrase": secretsPassphrase } : {}),
          },
          body: JSON.stringify({ value: trimmed }),
        },
      );
      const data: SaveKeyResponse & { code?: string } = await res.json().catch((): SaveKeyResponse => ({}));
      if (!res.ok) {
        setKeyValidation(data.validation ?? null);
        if (data.code && data.code.startsWith("SECRETS_PASSPHRASE_")) {
          setSecretsPassphrase("");
          setPassphraseError(data.error || "Secrets passphrase required.");
          setKeyError(data.error || "Secrets passphrase required.");
        } else {
          setKeyError(data.error || `Save failed (HTTP ${res.status})`);
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setKeyInput("");
      setKeySavedAt(Date.now());
      setKeySavedPersisted(!!data.persisted);
      setKeyValidation(data.validation ?? null);
      const updated: IntegrationStatus | undefined = data.integration;
      if (updated) {
        setSelectedIntegration(updated);
      }
      await Promise.all([loadStatus(), loadHealth(), loadKeyHealth()]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save key";
      setKeyError(message);
      setKeyValidation(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setKeySaving(false);
    }
  }, [keyInput, lang, token, secretsPassphrase, loadStatus, loadHealth, loadKeyHealth]);

  const performClearApiKey = useCallback(async (integration: IntegrationStatus) => {
    setKeyClearing(true);
    setKeyError(null);
    try {
      const baseUrl = getApiUrl();
      const res = await globalThis.fetch(
        new URL(`/api/admin/integrations/${integration.id}/key`, baseUrl).toString(),
        {
          method: "DELETE",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(secretsPassphrase ? { "X-Secrets-Passphrase": secretsPassphrase } : {}),
          },
        },
      );
      const data = await res.json().catch(() => ({} as { error?: string; code?: string }));
      if (!res.ok) {
        if (data?.code && typeof data.code === "string" && data.code.startsWith("SECRETS_PASSPHRASE_")) {
          setSecretsPassphrase("");
          setPassphraseError(data.error || "Secrets passphrase required.");
        }
        throw new Error(data?.error || `${res.status}`);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setKeyInput("");
      setKeySavedAt(null);
      setKeyClearedAt(Date.now());
      const updated: IntegrationStatus | undefined = data?.integration;
      if (updated) {
        setSelectedIntegration(updated);
      }
      await Promise.all([loadStatus(), loadHealth(), loadKeyHealth()]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to clear key";
      setKeyError(message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setKeyClearing(false);
    }
  }, [token, secretsPassphrase, loadStatus, loadHealth, loadKeyHealth]);

  const rotateSecret = useCallback(async () => {
    const trimmed = rotateOldSecret.trim();
    if (trimmed.length < 8) {
      setRotateError(lang === "es"
        ? "El secreto anterior debe tener al menos 8 caracteres"
        : "Old secret must be at least 8 characters");
      return;
    }
    setRotateLoading(true);
    setRotateError(null);
    setRotateResult(null);
    try {
      const baseUrl = getApiUrl();
      const res = await globalThis.fetch(
        new URL("/api/admin/integrations/rotate-secret", baseUrl).toString(),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(secretsPassphrase ? { "X-Secrets-Passphrase": secretsPassphrase } : {}),
          },
          body: JSON.stringify({ oldSecret: trimmed }),
        },
      );
      const data = await res.json().catch(() => ({} as { error?: string; code?: string; rotated?: number; failed?: string[]; note?: string }));
      if (!res.ok) {
        if (data?.code && data.code.startsWith("SECRETS_PASSPHRASE_")) {
          setSecretsPassphrase("");
          setPassphraseError(data.error || "Secrets passphrase required.");
        }
        setRotateError(data?.error || `Rotation failed (HTTP ${res.status})`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      setRotateResult({
        rotated: typeof data.rotated === "number" ? data.rotated : 0,
        failed: Array.isArray(data.failed) ? data.failed : [],
        note: typeof data.note === "string" ? data.note : "",
      });
      setRotateOldSecret("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await Promise.all([loadStatus(), loadHealth(), loadKeyHealth()]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Rotation failed";
      setRotateError(message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setRotateLoading(false);
    }
  }, [rotateOldSecret, lang, token, secretsPassphrase, loadStatus, loadHealth, loadKeyHealth]);

  const clearApiKey = useCallback((integration: IntegrationStatus) => {
    const title = lang === "es" ? "Quitar clave guardada" : "Remove saved key";
    const message = lang === "es"
      ? `Esto desconectara ${integration.name} y borrara la clave guardada del servidor.`
      : `This will disconnect ${integration.name} and delete the saved key from the server.`;
    const cancelLabel = lang === "es" ? "Cancelar" : "Cancel";
    const confirmLabel = lang === "es" ? "Quitar" : "Remove";

    if (Platform.OS === "web") {
      const ok = typeof globalThis.confirm === "function"
        ? globalThis.confirm(`${title}\n\n${message}`)
        : true;
      if (ok) performClearApiKey(integration);
      return;
    }

    Alert.alert(title, message, [
      { text: cancelLabel, style: "cancel" },
      { text: confirmLabel, style: "destructive", onPress: () => performClearApiKey(integration) },
    ]);
  }, [lang, performClearApiKey]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadStatus(), loadHealth(), loadKeyHealth()]);
    setRefreshing(false);
  }, [loadStatus, loadHealth, loadKeyHealth]);

  if (!fontsLoaded) return null;

  const webTopPad = Platform.OS === "web" ? 67 : 0;
  const isEs = lang === "es";

  const allIntegrations: IntegrationStatus[] = statusData
    ? [
        ...statusData.integrations.startHere,
        ...statusData.integrations.recommended,
        ...statusData.integrations.optional,
      ]
    : [];

  const filteredIntegrations = allIntegrations.filter((i) => {
    if (activeFilter === "connected") return i.connected;
    if (activeFilter === "pending") return !i.connected;
    return true;
  });

  const connectedCount = statusData?.summary.connected ?? 0;
  const totalCount = statusData?.summary.total ?? 0;
  const progressPercent = totalCount > 0 ? Math.round((connectedCount / totalCount) * 100) : 0;

  function getHealthForIntegration(id: string): HealthResult | undefined {
    return healthResults.find((h) => h.id === id);
  }

  function getHealthTitle(health: HealthResult | undefined, connected: boolean): string {
    if (!connected || !health) {
      return isEs ? "Servicio Sin Configurar" : "Service Unavailable";
    }
    if (health.reachable) {
      return isEs ? "Servicio Listo" : "Service Ready";
    }
    return isEs ? "Servicio con Error" : "Service Error";
  }

  function isKeyDecryptionFailed(integration: IntegrationStatus): boolean {
    if (!keyHealth) return false;
    return keyHealth.decryptionFailures.some((f) => f.envKey === integration.envKey);
  }

  function renderKeyHealthBanner() {
    if (!keyHealth) return null;
    const failures = keyHealth.decryptionFailures;
    if (failures.length === 0) return null;
    return (
      <Pressable
        testID="key-health-banner"
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setRotateModalOpen(true);
        }}
        style={s.keyHealthBanner}
      >
        <View style={s.keyHealthIconBg}>
          <Feather name="alert-triangle" size={18} color="#FFD600" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.keyHealthTitle}>
            {isEs
              ? `${failures.length} clave(s) no se pudieron descifrar`
              : `${failures.length} saved key(s) couldn't be loaded`}
          </Text>
          <Text style={s.keyHealthSub}>
            {isEs
              ? "Posiblemente JWT_SECRET fue rotado. Vuelve a ingresar las claves o rota el secreto del almacen."
              : "JWT_SECRET may have been rotated. Re-enter the affected keys or rotate the encryption secret."}
          </Text>
          <View style={s.keyHealthChips}>
            {failures.slice(0, 4).map((f) => (
              <View key={f.envKey} style={s.keyHealthChip}>
                <Text style={s.keyHealthChipText}>
                  {f.integrationName ?? f.envKey}
                </Text>
              </View>
            ))}
            {failures.length > 4 && (
              <Text style={s.keyHealthMore}>+{failures.length - 4}</Text>
            )}
          </View>
        </View>
        <Feather name="chevron-right" size={16} color={Colors.textMuted} />
      </Pressable>
    );
  }

  function renderPassphraseGate() {
    return (
      <View style={s.keyHealthBanner}>
        <View style={s.keyHealthIconBg}>
          <Feather name="lock" size={18} color={Colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.keyHealthTitle}>
            {isEs ? "Frase de acceso a Secretos" : "Secrets Passphrase"}
          </Text>
          <Text style={s.keyHealthSub}>
            {isEs
              ? "Requerida para guardar, borrar o rotar claves de proveedores. Configura SECRETS_PASSPHRASE en los Secrets del proyecto."
              : "Required to save, delete, or rotate provider keys. Set SECRETS_PASSPHRASE in your project Secrets."}
          </Text>
          <TextInput
            testID="secrets-passphrase-input"
            style={[s.keyInput, { width: "100%", marginTop: 8 }]}
            placeholder={isEs ? "Ingresa la frase de acceso" : "Enter passphrase"}
            placeholderTextColor={Colors.textMuted}
            value={secretsPassphrase}
            onChangeText={(v) => {
              setSecretsPassphrase(v);
              if (passphraseError) setPassphraseError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          {passphraseError && (
            <Text style={[s.keyErrorText, { marginTop: 6 }]}>{passphraseError}</Text>
          )}
        </View>
      </View>
    );
  }

  function renderProgressHeader() {
    if (!statusData) return null;
    const { summary } = statusData;
    return (
      <LinearGradient colors={["#0D2818", "#0A1A12"]} style={s.progressCard}>
        <View style={s.progressHeaderRow}>
          <View>
            <Text style={s.progressTitle}>
              {isEs ? "Progreso de Configuracion" : "Setup Progress"}
            </Text>
            <Text style={s.progressSub}>
              {connectedCount}/{totalCount} {isEs ? "proveedores conectados" : "providers connected"}
            </Text>
          </View>
          <View style={[s.progressBadge, summary.readyToEarn ? s.badgeReady : s.badgeNotReady]}>
            <Ionicons
              name={summary.readyToEarn ? "checkmark-circle" : "alert-circle"}
              size={14}
              color={summary.readyToEarn ? Colors.primary : Colors.accent}
            />
            <Text style={[s.progressBadgeText, { color: summary.readyToEarn ? Colors.primary : Colors.accent }]}>
              {summary.readyToEarn
                ? (isEs ? "Listo" : "Ready")
                : (isEs ? "Configurar" : "Setup Needed")}
            </Text>
          </View>
        </View>

        <View style={s.progressBarOuter}>
          <View style={[s.progressBarInner, { width: `${progressPercent}%` }]} />
        </View>
        <Text style={s.progressPercent}>{progressPercent}%</Text>

        {statusData.nextStep.platforms.length > 0 && (
          <View style={s.nextStepBox}>
            <Feather name="arrow-right-circle" size={14} color={Colors.primary} />
            <Text style={s.nextStepText}>{statusData.nextStep.message}</Text>
          </View>
        )}
      </LinearGradient>
    );
  }

  function renderCategorySummary() {
    if (!statusData) return null;
    const categories = ["ads", "surveys", "affiliates", "payments"];
    return (
      <View style={s.categoryGrid}>
        {categories.map((cat) => {
          const items = allIntegrations.filter((i) => i.category === cat);
          const connected = items.filter((i) => i.connected).length;
          const meta = CATEGORY_META[cat] ?? CATEGORY_META_FALLBACK;
          return (
            <View key={cat} style={s.categoryCard}>
              <View style={[s.categoryIconBg, { backgroundColor: meta.color + "18" }]}>
                <Feather name={meta.icon} size={18} color={meta.color} />
              </View>
              <Text style={s.categoryLabel}>{isEs ? meta.labelEs : meta.label}</Text>
              <Text style={s.categoryCount}>
                {connected}/{items.length}
              </Text>
            </View>
          );
        })}
      </View>
    );
  }

  function renderIntegrationRow(integration: IntegrationStatus, index: number, arr: IntegrationStatus[]) {
    const catMeta = CATEGORY_META[integration.category] ?? CATEGORY_META_FALLBACK;
    const priMeta = PRIORITY_META[integration.priority] ?? PRIORITY_META_FALLBACK;
    const health = getHealthForIntegration(integration.id);
    const keyFailed = isKeyDecryptionFailed(integration);

    return (
      <Pressable
        key={integration.id}
        testID={`integration-${integration.id}`}
        style={[s.integRow, index < arr.length - 1 && s.integRowBorder]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setSelectedIntegration(integration);
        }}
      >
        <View style={s.integLeft}>
          <View style={[s.integIconBg, { backgroundColor: catMeta.color + "18" }]}>
            <Feather name={catMeta.icon} size={16} color={catMeta.color} />
          </View>
          <View style={s.integInfo}>
            <Text style={s.integName}>{integration.name}</Text>
            <View style={s.integMeta}>
              <View style={[s.priorityBadge, { backgroundColor: priMeta.color + "18" }]}>
                <Text style={[s.priorityText, { color: priMeta.color }]}>
                  {isEs ? priMeta.labelEs : priMeta.label}
                </Text>
              </View>
              {integration.connected && health && (
                <View style={s.healthDot}>
                  <View style={[s.dot, { backgroundColor: health.reachable ? Colors.primary : "#FF5252" }]} />
                  <Text style={[s.healthLatency, { color: health.reachable ? Colors.textMuted : "#FF5252" }]}>
                    {health.reachable ? `${health.latencyMs}ms` : (isEs ? "Error" : "Error")}
                  </Text>
                </View>
              )}
              {keyFailed && (
                <View style={s.keyFailBadge} testID={`key-fail-badge-${integration.id}`}>
                  <Feather name="alert-triangle" size={10} color="#FFD600" />
                  <Text style={s.keyFailBadgeText}>
                    {isEs ? "Reingresar clave" : "Re-enter key"}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
        <View style={s.integRight}>
          <View style={[s.statusChip, integration.connected ? s.statusConnected : s.statusPending]}>
            <Feather
              name={integration.connected ? "check-circle" : "circle"}
              size={12}
              color={integration.connected ? Colors.primary : Colors.accent}
            />
            <Text
              style={[s.statusChipText, { color: integration.connected ? Colors.primary : Colors.accent }]}
            >
              {integration.connected ? (isEs ? "Conectado" : "Connected") : (isEs ? "Pendiente" : "Pending")}
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color={Colors.textMuted} />
        </View>
      </Pressable>
    );
  }

  function renderRotateSecretCard() {
    return (
      <Pressable
        testID="open-rotate-secret"
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setRotateModalOpen(true);
        }}
        style={s.rotateCard}
      >
        <View style={s.rotateIconBg}>
          <Feather name="key" size={18} color={Colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.rotateTitle}>
            {isEs ? "Rotar Secreto de Encriptacion" : "Rotate Encryption Secret"}
          </Text>
          <Text style={s.rotateSub}>
            {isEs
              ? "Usar despues de cambiar JWT_SECRET para re-encriptar las claves guardadas."
              : "Use after changing JWT_SECRET to re-encrypt saved provider keys."}
          </Text>
        </View>
        <Feather name="chevron-right" size={16} color={Colors.textMuted} />
      </Pressable>
    );
  }

  function renderRotateSecretModal() {
    if (!rotateModalOpen) return null;
    return (
      <Modal
        visible={rotateModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => !rotateLoading && setRotateModalOpen(false)}
      >
        <Pressable
          style={s.modalOverlay}
          onPress={() => !rotateLoading && setRotateModalOpen(false)}
        >
          <Pressable style={s.modalCard} onPress={() => {}}>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 500 }}>
              <View style={s.modalHeader}>
                <View style={[s.modalIconBg, { backgroundColor: "rgba(0,230,118,0.12)" }]}>
                  <Feather name="key" size={24} color={Colors.primary} />
                </View>
                <Text style={s.modalTitle}>
                  {isEs ? "Rotar Secreto" : "Rotate Encryption Secret"}
                </Text>
              </View>

              <View style={s.rotateWarnBox}>
                <Feather name="alert-triangle" size={14} color={Colors.accent} />
                <Text style={s.rotateWarnText}>
                  {isEs
                    ? "Solo usa esto despues de rotar JWT_SECRET en los Secrets del proyecto. Ingresa el valor anterior de JWT_SECRET para que el servidor pueda re-encriptar las claves guardadas con el nuevo secreto."
                    : "Only use this after rotating JWT_SECRET in your project Secrets. Enter the previous JWT_SECRET value so the server can re-encrypt saved provider keys with the new secret."}
                </Text>
              </View>

              <Text style={s.rotateLabel}>
                {isEs ? "JWT_SECRET anterior" : "Previous JWT_SECRET"}
              </Text>
              <TextInput
                testID="rotate-old-secret-input"
                style={[s.keyInput, { width: "100%", marginBottom: 8 }]}
                placeholder={isEs ? "Pega el secreto anterior" : "Paste previous secret"}
                placeholderTextColor={Colors.textMuted}
                value={rotateOldSecret}
                onChangeText={(t) => {
                  setRotateOldSecret(t);
                  if (rotateError) setRotateError(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                editable={!rotateLoading}
              />

              {rotateError && (
                <Text style={s.keyErrorText}>{rotateError}</Text>
              )}

              {rotateResult && (
                <View style={s.rotateResultBox}>
                  <View style={s.keySuccessRow}>
                    <Feather name="check-circle" size={14} color={Colors.primary} />
                    <Text style={s.keySuccessText}>
                      {isEs
                        ? `${rotateResult.rotated} clave(s) re-encriptadas.`
                        : `${rotateResult.rotated} key(s) re-encrypted.`}
                    </Text>
                  </View>
                  {rotateResult.failed.length > 0 && (
                    <>
                      <View style={[s.keySuccessRow, { marginTop: 6 }]}>
                        <Feather name="alert-triangle" size={14} color="#FF5252" />
                        <Text style={[s.keySuccessText, { color: "#FF5252", flex: 1 }]}>
                          {isEs
                            ? `${rotateResult.failed.length} clave(s) deben volver a ingresarse:`
                            : `${rotateResult.failed.length} key(s) must be re-entered:`}
                        </Text>
                      </View>
                      {rotateResult.failed.map((id) => (
                        <Text key={id} style={s.rotateFailedItem}>• {id}</Text>
                      ))}
                    </>
                  )}
                  {rotateResult.note && (
                    <Text style={s.rotateNote}>{rotateResult.note}</Text>
                  )}
                </View>
              )}

              <View style={s.modalActions}>
                <Pressable
                  style={s.modalSecondaryBtn}
                  disabled={rotateLoading}
                  onPress={() => setRotateModalOpen(false)}
                >
                  <Text style={s.modalSecondaryText}>
                    {rotateResult ? (isEs ? "Cerrar" : "Close") : (isEs ? "Cancelar" : "Cancel")}
                  </Text>
                </Pressable>
                {!rotateResult && (
                  <Pressable
                    testID="confirm-rotate-secret"
                    style={[s.modalPrimaryBtn, (rotateLoading || rotateOldSecret.trim().length < 8) && s.keySaveBtnDisabled]}
                    disabled={rotateLoading || rotateOldSecret.trim().length < 8}
                    onPress={rotateSecret}
                  >
                    {rotateLoading ? (
                      <ActivityIndicator size="small" color={Colors.background} />
                    ) : (
                      <>
                        <Feather name="refresh-cw" size={14} color={Colors.background} />
                        <Text style={s.modalPrimaryText}>
                          {isEs ? "Rotar" : "Rotate"}
                        </Text>
                      </>
                    )}
                  </Pressable>
                )}
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  function renderDetailModal() {
    if (!selectedIntegration) return null;
    const integration = selectedIntegration;
    const catMeta = CATEGORY_META[integration.category] ?? CATEGORY_META_FALLBACK;
    const priMeta = PRIORITY_META[integration.priority] ?? PRIORITY_META_FALLBACK;
    const health = getHealthForIntegration(integration.id);

    return (
      <Modal
        visible={!!selectedIntegration}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedIntegration(null)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setSelectedIntegration(null)}>
          <Pressable style={s.modalCard} onPress={() => {}}>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 500 }}>
              <View style={s.modalHeader}>
                <View style={[s.modalIconBg, { backgroundColor: catMeta.color + "18" }]}>
                  <Feather name={catMeta.icon} size={24} color={catMeta.color} />
                </View>
                <Text style={s.modalTitle}>{integration.name}</Text>
                <View style={[s.statusChip, integration.connected ? s.statusConnected : s.statusPending, { alignSelf: "center" }]}>
                  <Feather
                    name={integration.connected ? "check-circle" : "circle"}
                    size={12}
                    color={integration.connected ? Colors.primary : Colors.accent}
                  />
                  <Text style={[s.statusChipText, { color: integration.connected ? Colors.primary : Colors.accent }]}>
                    {integration.connected ? (isEs ? "Conectado" : "Connected") : (isEs ? "Pendiente" : "Pending")}
                  </Text>
                </View>
              </View>

              <Text style={s.modalDesc}>{integration.description}</Text>

              {isKeyDecryptionFailed(integration) && (
                <View style={s.modalKeyFailBox} testID={`modal-key-fail-${integration.id}`}>
                  <View style={s.keyHealthIconBg}>
                    <Feather name="alert-triangle" size={16} color="#FFD600" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.keyHealthTitle}>
                      {isEs ? "Clave guardada ilegible" : "Saved key couldn't be decrypted"}
                    </Text>
                    <Text style={s.keyHealthSub}>
                      {isEs
                        ? "El servidor no pudo descifrar la clave guardada al iniciar (probablemente JWT_SECRET cambio). Pega la clave abajo o usa Rotar Secreto si aun tienes el JWT_SECRET anterior."
                        : "The server couldn't decrypt the saved key at startup (JWT_SECRET likely changed). Re-enter the key below, or use Rotate Encryption Secret if you still have the previous JWT_SECRET."}
                    </Text>
                    <Pressable
                      testID={`modal-rotate-link-${integration.id}`}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSelectedIntegration(null);
                        setRotateModalOpen(true);
                      }}
                      style={s.keyHealthLink}
                    >
                      <Feather name="key" size={12} color={Colors.primary} />
                      <Text style={s.keyHealthLinkText}>
                        {isEs ? "Rotar Secreto de Encriptacion" : "Rotate Encryption Secret"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}

              <View style={s.modalInfoRow}>
                <Text style={s.modalInfoLabel}>{isEs ? "Categoria" : "Category"}</Text>
                <View style={s.modalInfoValue}>
                  <Feather name={catMeta.icon} size={12} color={catMeta.color} />
                  <Text style={[s.modalInfoValueText, { color: catMeta.color }]}>
                    {isEs ? catMeta.labelEs : catMeta.label}
                  </Text>
                </View>
              </View>

              <View style={s.modalInfoRow}>
                <Text style={s.modalInfoLabel}>{isEs ? "Prioridad" : "Priority"}</Text>
                <View style={[s.priorityBadge, { backgroundColor: priMeta.color + "18" }]}>
                  <Text style={[s.priorityText, { color: priMeta.color }]}>
                    {isEs ? priMeta.labelEs : priMeta.label}
                  </Text>
                </View>
              </View>

              <View style={s.modalInfoRow}>
                <Text style={s.modalInfoLabel}>{isEs ? "Ingresos" : "Revenue"}</Text>
                <Text style={s.modalInfoValueText}>{integration.revenueShare}</Text>
              </View>

              <View style={s.modalInfoRow}>
                <Text style={s.modalInfoLabel}>{isEs ? "Variable" : "Env Key"}</Text>
                <Text style={[s.modalInfoValueText, { fontFamily: "Outfit_600SemiBold", fontSize: 12 }]}>
                  {integration.envKey}
                </Text>
              </View>

              {integration.connected && health && (
                <View style={[s.healthBox, { borderColor: health.reachable ? "rgba(0,230,118,0.2)" : "rgba(255,82,82,0.2)" }]}>
                  <View style={s.healthBoxHeader}>
                    <Feather
                      name={health.reachable ? "check-circle" : "alert-triangle"}
                      size={14}
                      color={health.reachable ? Colors.primary : "#FF5252"}
                    />
                    <Text style={[s.healthBoxTitle, { color: health.reachable ? Colors.primary : "#FF5252" }]}>
                      {getHealthTitle(health, integration.connected)}
                    </Text>
                  </View>
                  <View style={s.healthBoxDetails}>
                    <Text style={s.healthBoxDetail}>
                      {isEs ? "Latencia" : "Latency"}: {health.latencyMs}ms
                    </Text>
                    {health.httpStatus !== undefined && (
                      <Text style={s.healthBoxDetail}>HTTP: {health.httpStatus}</Text>
                    )}
                    {health.error && (
                      <Text style={[s.healthBoxDetail, { color: "#FF5252" }]}>{health.error}</Text>
                    )}
                  </View>
                </View>
              )}

              <Text style={s.stepsTitle}>
                {isEs ? "Pasos de Configuracion" : "Setup Steps"}
              </Text>
              {integration.setupSteps.map((step, i) => (
                <View key={i} style={s.stepRow}>
                  <View style={s.stepNumber}>
                    <Text style={s.stepNumberText}>{i + 1}</Text>
                  </View>
                  <Text style={s.stepText}>{step}</Text>
                </View>
              ))}

              <View style={s.keyBox}>
                <Text style={s.keyBoxTitle}>
                  {integration.connected
                    ? (isEs ? "Reemplazar Clave API" : "Replace API Key")
                    : (isEs ? "Pegar Clave API" : "Paste API Key")}
                </Text>
                <Text style={s.keyBoxHint}>
                  {isEs
                    ? `Se guarda como ${integration.envKey} y persiste despues de reiniciar el servidor.`
                    : `Saved as ${integration.envKey} and persists across server restarts.`}
                </Text>
                <View style={s.keyInputRow}>
                  <TextInput
                    testID={`api-key-input-${integration.id}`}
                    style={s.keyInput}
                    placeholder={integration.envKey}
                    placeholderTextColor={Colors.textMuted}
                    value={keyInput}
                    onChangeText={(t) => {
                      setKeyInput(t);
                      if (keyError) setKeyError(null);
                      if (keySavedAt) setKeySavedAt(null);
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                    editable={!keySaving}
                  />
                  <Pressable
                    testID={`save-api-key-${integration.id}`}
                    style={[s.keySaveBtn, (keySaving || keyInput.trim().length === 0) && s.keySaveBtnDisabled]}
                    disabled={keySaving || keyInput.trim().length === 0}
                    onPress={() => saveApiKey(integration)}
                  >
                    {keySaving ? (
                      <ActivityIndicator size="small" color={Colors.background} />
                    ) : (
                      <>
                        <Feather name="save" size={14} color={Colors.background} />
                        <Text style={s.keySaveBtnText}>{isEs ? "Guardar" : "Save"}</Text>
                      </>
                    )}
                  </Pressable>
                </View>
                {keyError && (
                  <Text style={s.keyErrorText}>{keyError}</Text>
                )}
                {keyValidation && (() => {
                  const v = keyValidation;
                  if (!v.supported) {
                    return (
                      <View style={s.keySuccessRow}>
                        <Feather name="info" size={12} color={Colors.textMuted} />
                        <Text style={[s.keySuccessText, { color: Colors.textMuted }]}>
                          {v.reason ?? (isEs
                            ? "Guardado. No se pudo verificar automaticamente."
                            : "Saved. Could not auto-verify this provider.")}
                        </Text>
                      </View>
                    );
                  }
                  if (v.ok) {
                    return (
                      <View style={s.keySuccessRow}>
                        <Feather name="check-circle" size={12} color={Colors.primary} />
                        <Text style={s.keySuccessText}>
                          {isEs
                            ? `Verificado con ${integration.name} (HTTP ${v.status ?? "?"}, ${v.latencyMs ?? 0}ms).`
                            : `Verified with ${integration.name} (HTTP ${v.status ?? "?"}, ${v.latencyMs ?? 0}ms).`}
                        </Text>
                      </View>
                    );
                  }
                  return (
                    <View style={s.keySuccessRow}>
                      <Feather name="alert-triangle" size={12} color="#FF5252" />
                      <Text style={[s.keySuccessText, { color: "#FF5252" }]}>
                        {v.error ?? (isEs
                          ? "El proveedor rechazo la clave."
                          : "Provider rejected the key.")}
                      </Text>
                    </View>
                  );
                })()}
                {keySavedAt && !keyError && (
                  <View style={s.keySuccessRow}>
                    <Feather
                      name={keySavedPersisted ? "check-circle" : "alert-circle"}
                      size={12}
                      color={keySavedPersisted ? Colors.primary : Colors.accent}
                    />
                    <Text
                      style={[
                        s.keySuccessText,
                        { color: keySavedPersisted ? Colors.primary : Colors.accent },
                      ]}
                    >
                      {keySavedPersisted
                        ? (isEs
                          ? "Clave guardada. Persistira despues de reiniciar."
                          : "Key saved. Will persist across restarts.")
                        : (isEs
                          ? "Guardada solo en memoria. Configura JWT_SECRET o agrega la clave a Secrets para que persista."
                          : "Saved in-memory only. Set JWT_SECRET or add the key to project Secrets to make it persist.")}
                    </Text>
                  </View>
                )}
                {keyClearedAt && !keyError && (
                  <View style={s.keySuccessRow}>
                    <Feather name="check-circle" size={12} color={Colors.primary} />
                    <Text style={s.keySuccessText}>
                      {isEs ? "Clave eliminada del servidor." : "Key removed from server."}
                    </Text>
                  </View>
                )}
                {integration.connected && (
                  <Pressable
                    testID={`clear-api-key-${integration.id}`}
                    style={[s.keyClearBtn, keyClearing && s.keySaveBtnDisabled]}
                    disabled={keyClearing || keySaving}
                    onPress={() => clearApiKey(integration)}
                  >
                    {keyClearing ? (
                      <ActivityIndicator size="small" color="#FF5252" />
                    ) : (
                      <>
                        <Feather name="trash-2" size={13} color="#FF5252" />
                        <Text style={s.keyClearBtnText}>
                          {isEs ? "Quitar Clave Guardada" : "Remove Saved Key"}
                        </Text>
                      </>
                    )}
                  </Pressable>
                )}
              </View>

              <View style={s.modalActions}>
                <Pressable
                  style={s.modalSecondaryBtn}
                  onPress={() => setSelectedIntegration(null)}
                >
                  <Text style={s.modalSecondaryText}>{isEs ? "Cerrar" : "Close"}</Text>
                </Pressable>
                <Pressable
                  testID={`open-signup-${integration.id}`}
                  style={s.modalPrimaryBtn}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    Linking.openURL(integration.signupUrl);
                  }}
                >
                  <Feather name="external-link" size={14} color={Colors.background} />
                  <Text style={s.modalPrimaryText}>
                    {integration.connected
                      ? (isEs ? "Abrir Dashboard" : "Open Dashboard")
                      : (isEs ? "Registrarse" : "Sign Up")}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  return (
    <ScrollView
      style={[s.container, { paddingTop: webTopPad + insets.top }]}
      contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 : 32 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
    >
      <View style={s.content}>
        <View style={s.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
            <Feather name="arrow-left" size={22} color={Colors.text} />
          </Pressable>
          <Text style={s.title}>{isEs ? "Configuracion" : "Setup Wizard"}</Text>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onRefresh();
            }}
            hitSlop={12}
            style={s.backBtn}
          >
            <Feather name="refresh-cw" size={18} color={Colors.text} />
          </Pressable>
        </View>

        {loading ? (
          <View style={{ padding: 64, alignItems: "center" }}>
            <ActivityIndicator color={Colors.primary} size="large" />
            <Text style={[s.loadingText, { marginTop: 12 }]}>
              {isEs ? "Cargando integraciones..." : "Loading integrations..."}
            </Text>
          </View>
        ) : (
          <>
            {renderPassphraseGate()}

            {renderKeyHealthBanner()}

            {renderProgressHeader()}

            {renderCategorySummary()}

            {renderRotateSecretCard()}

            {healthCheckedAt && (
              <View style={s.healthTimeRow}>
                <Feather name="activity" size={12} color={Colors.textMuted} />
                <Text style={s.healthTimeText}>
                  {isEs ? "Ultimo chequeo" : "Last health check"}: {new Date(healthCheckedAt).toLocaleTimeString()}
                </Text>
                {healthLoading && <ActivityIndicator size="small" color={Colors.primary} />}
              </View>
            )}

            <View style={s.filterRow}>
              {(["all", "connected", "pending"] as const).map((f) => {
                const label = f === "all"
                  ? (isEs ? "Todos" : "All")
                  : f === "connected"
                    ? (isEs ? "Conectados" : "Connected")
                    : (isEs ? "Pendientes" : "Pending");
                const count = f === "all"
                  ? totalCount
                  : f === "connected"
                    ? connectedCount
                    : totalCount - connectedCount;
                return (
                  <Pressable
                    key={f}
                    onPress={() => setActiveFilter(f)}
                    style={[s.filterChip, activeFilter === f && s.filterChipActive]}
                  >
                    <Text style={[s.filterChipText, activeFilter === f && s.filterChipTextActive]}>
                      {label} ({count})
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {["start-here", "recommended", "optional"].map((priority) => {
              const items = filteredIntegrations.filter((i) => i.priority === priority);
              if (items.length === 0) return null;
              const priMeta = PRIORITY_META[priority] ?? PRIORITY_META_FALLBACK;
              return (
                <View key={priority}>
                  <View style={s.groupHeader}>
                    <View style={[s.groupDot, { backgroundColor: priMeta.color }]} />
                    <Text style={s.groupTitle}>{isEs ? priMeta.labelEs : priMeta.label}</Text>
                    <Text style={s.groupCount}>{items.length}</Text>
                  </View>
                  <View style={s.integCard}>
                    {items.map((item, i) => renderIntegrationRow(item, i, items))}
                  </View>
                </View>
              );
            })}
          </>
        )}
      </View>

      {renderDetailModal()}
      {renderRotateSecretModal()}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.surface, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: "Outfit_700Bold", fontSize: 22, color: Colors.text },
  loadingText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.textMuted },

  progressCard: { borderRadius: 16, padding: 18, borderWidth: 1, borderColor: "rgba(0,230,118,0.15)", marginBottom: 16 },
  progressHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  progressTitle: { fontFamily: "Outfit_700Bold", fontSize: 17, color: Colors.text },
  progressSub: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  progressBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeReady: { backgroundColor: "rgba(0,230,118,0.12)" },
  badgeNotReady: { backgroundColor: "rgba(255,214,0,0.12)" },
  progressBadgeText: { fontFamily: "Outfit_600SemiBold", fontSize: 12 },
  progressBarOuter: { height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden" },
  progressBarInner: { height: 8, borderRadius: 4, backgroundColor: Colors.primary },
  progressPercent: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: Colors.textMuted, marginTop: 6, textAlign: "right" },
  nextStepBox: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, backgroundColor: "rgba(0,230,118,0.06)", borderRadius: 10, padding: 10 },
  nextStepText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textSecondary, flex: 1 },

  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  categoryCard: { width: "47%" as DimensionValue, flexGrow: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border, alignItems: "center", gap: 6 },
  categoryIconBg: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  categoryLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: Colors.text },
  categoryCount: { fontFamily: "Outfit_700Bold", fontSize: 16, color: Colors.primary },

  healthTimeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  healthTimeText: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted },

  filterRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  filterChipActive: { backgroundColor: "rgba(0,230,118,0.12)", borderColor: Colors.primary },
  filterChipText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: Colors.textMuted },
  filterChipTextActive: { color: Colors.primary },

  groupHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10, marginTop: 4 },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  groupTitle: { fontFamily: "Outfit_700Bold", fontSize: 15, color: Colors.text },
  groupCount: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted, backgroundColor: Colors.surfaceHighlight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: "hidden" },

  integCard: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, overflow: "hidden", marginBottom: 12 },
  integRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14 },
  integRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  integLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  integIconBg: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  integInfo: { flex: 1 },
  integName: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: Colors.text },
  integMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 3 },
  integRight: { flexDirection: "row", alignItems: "center", gap: 6 },

  priorityBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  priorityText: { fontFamily: "Outfit_600SemiBold", fontSize: 10 },

  healthDot: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  healthLatency: { fontFamily: "Outfit_400Regular", fontSize: 10 },

  statusChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusConnected: { backgroundColor: "rgba(0,230,118,0.12)" },
  statusPending: { backgroundColor: "rgba(255,214,0,0.12)" },
  statusChipText: { fontFamily: "Outfit_600SemiBold", fontSize: 11 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  modalCard: { backgroundColor: Colors.surface, borderRadius: 20, padding: 24, width: "90%" as DimensionValue, maxWidth: 400, borderWidth: 1, borderColor: Colors.border },
  modalHeader: { alignItems: "center", gap: 8, marginBottom: 16 },
  modalIconBg: { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  modalTitle: { fontFamily: "Outfit_700Bold", fontSize: 20, color: Colors.text },
  modalDesc: { fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.textSecondary, lineHeight: 20, marginBottom: 16 },

  modalInfoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalInfoLabel: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textMuted },
  modalInfoValue: { flexDirection: "row", alignItems: "center", gap: 4 },
  modalInfoValueText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.text, maxWidth: 200, textAlign: "right" },

  healthBox: { marginTop: 12, borderRadius: 12, borderWidth: 1, padding: 12 },
  healthBoxHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  healthBoxTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 13 },
  healthBoxDetails: { gap: 2, paddingLeft: 20 },
  healthBoxDetail: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted },

  stepsTitle: { fontFamily: "Outfit_700Bold", fontSize: 15, color: Colors.text, marginTop: 16, marginBottom: 10 },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 10 },
  stepNumber: { width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(0,230,118,0.12)", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  stepNumberText: { fontFamily: "Outfit_700Bold", fontSize: 12, color: Colors.primary },
  stepText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textSecondary, flex: 1, lineHeight: 19 },

  keyBox: { marginTop: 18, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceHighlight },
  keyBoxTitle: { fontFamily: "Outfit_700Bold", fontSize: 13, color: Colors.text },
  keyBoxHint: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted, marginTop: 2, marginBottom: 10 },
  keyInputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  keyInput: { flex: 1, height: 40, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.background, color: Colors.text, fontFamily: "Outfit_400Regular", fontSize: 13 },
  keySaveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 14, height: 40, borderRadius: 8, backgroundColor: Colors.primary, minWidth: 84 },
  keySaveBtnDisabled: { opacity: 0.5 },
  keySaveBtnText: { fontFamily: "Outfit_700Bold", fontSize: 13, color: Colors.background },
  keyErrorText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: "#FF5252", marginTop: 8 },
  keyClearBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 10, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,82,82,0.4)", backgroundColor: "rgba(255,82,82,0.08)" },
  keyClearBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: "#FF5252" },
  keySuccessRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  keySuccessText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: Colors.primary },

  rotateCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: "rgba(0,230,118,0.25)", backgroundColor: "rgba(0,230,118,0.06)", marginBottom: 16 },
  rotateIconBg: { width: 38, height: 38, borderRadius: 10, backgroundColor: "rgba(0,230,118,0.12)", alignItems: "center", justifyContent: "center" },
  rotateTitle: { fontFamily: "Outfit_700Bold", fontSize: 14, color: Colors.text },
  rotateSub: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  rotateWarnBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,214,0,0.3)", backgroundColor: "rgba(255,214,0,0.08)", marginBottom: 14 },
  rotateWarnText: { flex: 1, fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  rotateLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: Colors.textMuted, marginBottom: 6 },
  rotateResultBox: { marginTop: 12, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceHighlight },
  rotateFailedItem: { fontFamily: "Outfit_400Regular", fontSize: 12, color: "#FF5252", marginLeft: 20, marginTop: 2 },
  rotateNote: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted, marginTop: 8, lineHeight: 15 },

  keyHealthBanner: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,214,0,0.35)", backgroundColor: "rgba(255,214,0,0.08)", marginBottom: 16 },
  keyHealthIconBg: { width: 32, height: 32, borderRadius: 8, backgroundColor: "rgba(255,214,0,0.15)", alignItems: "center", justifyContent: "center" },
  keyHealthTitle: { fontFamily: "Outfit_700Bold", fontSize: 13, color: Colors.text },
  keyHealthSub: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textSecondary, marginTop: 4, lineHeight: 17 },
  keyHealthChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8, alignItems: "center" },
  keyHealthChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: "rgba(255,214,0,0.15)" },
  keyHealthChipText: { fontFamily: "Outfit_600SemiBold", fontSize: 11, color: "#FFD600" },
  keyHealthMore: { fontFamily: "Outfit_600SemiBold", fontSize: 11, color: Colors.textMuted },
  keyHealthLink: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  keyHealthLinkText: { fontFamily: "Outfit_700Bold", fontSize: 12, color: Colors.primary },
  keyFailBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: "rgba(255,214,0,0.15)" },
  keyFailBadgeText: { fontFamily: "Outfit_600SemiBold", fontSize: 10, color: "#FFD600" },
  modalKeyFailBox: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,214,0,0.35)", backgroundColor: "rgba(255,214,0,0.08)", marginBottom: 14 },

  modalActions: { flexDirection: "row", gap: 10, marginTop: 20 },
  modalSecondaryBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.border },
  modalSecondaryText: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: Colors.textSecondary },
  modalPrimaryBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.primary },
  modalPrimaryText: { fontFamily: "Outfit_700Bold", fontSize: 14, color: Colors.background },
});
