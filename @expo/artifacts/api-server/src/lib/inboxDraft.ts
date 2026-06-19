import type { IStorage } from "../storage.js";

export type IssueType =
  | "game_credits"
  | "survey_credits"
  | "withdrawal"
  | "balance"
  | "login"
  | "general";

export type Lang = "en" | "es" | "fr";

export interface UserContext {
  username: string;
  balanceUsd: string;
  totalEarnedUsd: string;
  accountAgeDays: number;
  lastSeenDaysAgo: number | null;
  emailVerified: boolean;
  withdrawalCount: number;
  recentEarningType: string | null;
  recentEarningDaysAgo: number | null;
}

export interface DraftResult {
  draft: string;
  issueType: IssueType;
  lang: Lang;
  userFound: boolean;
  userContext: UserContext | null;
}

const ES_KEYWORDS = [
  "puntos","gané","ganó","retiro","cobrar","cobro","saldo","juego","jugando",
  "encuesta","no me","no aparece","no recibí","recibido","gracias","ayuda",
  "problema","cuenta","dinero","pago","hola","por favor","quisiera","ganan",
  "ganar","ganancias","aplicación","no puedo","tengo","quiero",
];

const FR_KEYWORDS = [
  "bonjour","bonsoir","merci","salut","paiement","retrait","solde","jeu","jouant",
  "sondage","je n'ai pas","pas reçu","reçu","problème","compte","argent","gagné",
  "gains","application","je ne peux pas","j'ai","je veux","cordialement","bien à vous",
  "svp","s'il vous plaît","n'arrive pas","monsieur","madame",
];

export function detectLang(text: string): Lang {
  const lower = text.toLowerCase();
  const frHits = FR_KEYWORDS.filter((k) => lower.includes(k)).length;
  if (frHits >= 2) return "fr";
  const esHits = ES_KEYWORDS.filter((k) => lower.includes(k)).length;
  return esHits >= 2 ? "es" : "en";
}

export function detectIssue(text: string): IssueType {
  const lower = text.toLowerCase();
  if (/game|gaming|playing|jugando|juego|played|play game|jeu|jouant|jouer/.test(lower))
    return "game_credits";
  if (/survey|encuesta|offer|oferta|task|tarea|sondage|questionnaire/.test(lower))
    return "survey_credits";
  if (
    /withdraw|withdrawal|paypal|retiro|cobrar|cobro|pago|cash.?out|payment|money|dinero|paiement|retrait|virement|argent|demande de/.test(
      lower,
    )
  )
    return "withdrawal";
  if (/balance|points|puntos|saldo|earning|ganancia|wallet|cartera|solde|gains|gagné/.test(lower))
    return "balance";
  if (/login|password|contraseña|forgot|sign.?in|cant.*log|access|acceso|mot de passe|connexion|connecter/.test(lower))
    return "login";
  return "general";
}

function fmtUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function daysSince(d: Date): number {
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

function fmtDaysAgo(n: number): string {
  if (n === 0) return "today";
  if (n === 1) return "yesterday";
  return `${n} days ago`;
}

function fmtDaysAgoEs(n: number): string {
  if (n === 0) return "hoy";
  if (n === 1) return "ayer";
  return `hace ${n} días`;
}

function fmtDaysAgoFr(n: number): string {
  if (n === 0) return "aujourd'hui";
  if (n === 1) return "hier";
  return `il y a ${n} jours`;
}

function buildDraftFr(issue: IssueType, ctx: UserContext | null): string {
  const greeting = ctx ? `Bonjour ${ctx.username},` : "Bonjour,";

  const accountLine = ctx
    ? `Nous avons trouvé votre compte (solde : ${ctx.balanceUsd}, total gagné : ${ctx.totalEarnedUsd}, membre depuis ${ctx.accountAgeDays} jour${ctx.accountAgeDays === 1 ? "" : "s"}).`
    : "";

  let body = "";

  switch (issue) {
    case "game_credits":
      body = [
        `Merci de contacter le support CashClip.`,
        accountLine,
        `Les points obtenus dans les jeux sont crédités côté serveur une fois la session entièrement vérifiée par notre système — cela prend généralement quelques minutes, mais peut parfois nécessiter jusqu'à 24 heures selon le jeu et votre connexion à ce moment-là.`,
        ctx?.recentEarningDaysAgo != null
          ? `Nous constatons que votre dernière activité de gains remonte à ${fmtDaysAgoFr(ctx.recentEarningDaysAgo)}. Si vous avez terminé une session de jeu et que les points n'apparaissent toujours pas après 24 heures, veuillez nous répondre en indiquant le nom du jeu et l'heure approximative à laquelle vous avez joué afin que nous puissions vérifier.`
          : `Si vous avez terminé une session de jeu et que les points n'apparaissent pas après 24 heures, veuillez nous répondre avec le nom du jeu et l'heure approximative pour que nous puissions enquêter.`,
        `Nous vous remercions de votre patience et souhaitons nous assurer que chaque session complétée soit correctement récompensée.`,
      ]
        .filter(Boolean)
        .join("\n\n");
      break;

    case "survey_credits":
      body = [
        `Merci de contacter CashClip.`,
        accountLine,
        `Les récompenses des sondages et offres sont émises par des prestataires tiers (CPX Research, BitLabs, etc.) et vérifiées par notre serveur avant d'être ajoutées à votre solde. Il arrive qu'une session soit soumise à un examen qualité du côté du prestataire, ce qui peut retarder ou bloquer le crédit.`,
        `Veuillez nous répondre en indiquant le nom du sondage ou de l'offre ainsi que la date et l'heure approximatives de complétion, et nous consulterons les enregistrements du prestataire de notre côté.`,
      ]
        .filter(Boolean)
        .join("\n\n");
      break;

    case "withdrawal":
      body = [
        `Merci de nous avoir contactés.`,
        accountLine,
        `Les retraits vers PayPal sont traités manuellement et prennent généralement 1 à 3 jours ouvrés après approbation. Les nouveaux comptes bénéficient également d'une courte période de rétention avant que le premier retrait ne soit disponible.`,
        ctx && ctx.withdrawalCount > 0
          ? `Nos enregistrements indiquent ${ctx.withdrawalCount} demande${ctx.withdrawalCount === 1 ? "" : "s"} de retrait sur votre compte. Si vous pensez qu'un retrait est bloqué ou manquant, veuillez nous répondre avec le montant et la date approximative de la demande et nous vérifierons son statut.`
          : `Si vous rencontrez des difficultés pour effectuer un retrait, veuillez nous répondre avec les détails et nous vous aiderons directement.`,
      ]
        .filter(Boolean)
        .join("\n\n");
      break;

    case "balance":
      body = [
        `Merci de nous avoir contactés.`,
        accountLine,
        ctx
          ? `Votre solde actuel est de ${ctx.balanceUsd} pour un total cumulé de ${ctx.totalEarnedUsd} gagné. Les points sont convertis en espèces une fois la session de gains entièrement vérifiée, ce qui prend généralement quelques minutes.`
          : `Votre solde reflète l'ensemble des gains vérifiés et convertis. Les points des sessions actives apparaissent une fois que la session est confirmée par notre système, ce qui prend généralement quelques minutes.`,
        `Si vous pensez qu'un gain spécifique est manquant, veuillez nous répondre en indiquant le type d'activité et l'heure approximative, et nous enquêterons.`,
      ]
        .filter(Boolean)
        .join("\n\n");
      break;

    case "login":
      body = [
        `Merci de nous avoir contactés.`,
        accountLine,
        `Si vous ne pouvez pas vous connecter, veuillez utiliser l'option « Mot de passe oublié » sur l'écran de connexion — entrez votre nom d'utilisateur et nous vous enverrons un code à usage unique à votre adresse e-mail enregistrée pour réinitialiser votre mot de passe.`,
        `Si vous n'avez plus accès à votre adresse e-mail enregistrée, veuillez nous répondre avec votre nom d'utilisateur et nous vous assisterons manuellement.`,
      ]
        .filter(Boolean)
        .join("\n\n");
      break;

    default:
      body = [
        `Merci de contacter le support CashClip.`,
        accountLine,
        `Nous avons bien reçu votre message et allons l'examiner. Pourriez-vous nous donner un peu plus de détails sur le problème que vous rencontrez ? Cela nous permettra de le résoudre le plus rapidement possible.`,
      ]
        .filter(Boolean)
        .join("\n\n");
  }

  return [
    greeting,
    "",
    body,
    "",
    "Cordialement,",
    "Équipe Support CashClip",
    "support@cash-clip.app",
  ].join("\n");
}

function buildDraftEn(issue: IssueType, ctx: UserContext | null): string {
  const greeting = ctx
    ? `Hi ${ctx.username},`
    : "Hi there,";

  const accountLine = ctx
    ? `We located your account (balance: ${ctx.balanceUsd}, total earned: ${ctx.totalEarnedUsd}, member for ${ctx.accountAgeDays} day${ctx.accountAgeDays === 1 ? "" : "s"}).`
    : "";

  let body = "";

  switch (issue) {
    case "game_credits":
      body = [
        `Thank you for reaching out to CashClip Support.`,
        accountLine,
        `Regarding game earnings: points from in-app games are credited server-side once the session is fully verified by our system — this typically completes within a few minutes but can occasionally take up to 24 hours depending on the game and your connection at the time.`,
        ctx?.recentEarningDaysAgo != null
          ? `We can see your most recent earning activity was ${fmtDaysAgo(ctx.recentEarningDaysAgo)}. If you completed a game session and points have still not appeared after 24 hours, please reply with the game name and the approximate time you played so we can look into it directly.`
          : `If you completed a game session and points have still not appeared after 24 hours, please reply with the game name and the approximate time you played so we can investigate.`,
        `We appreciate your patience and want to make sure every session you complete is properly rewarded.`,
      ]
        .filter(Boolean)
        .join("\n\n");
      break;

    case "survey_credits":
      body = [
        `Thank you for contacting CashClip Support.`,
        accountLine,
        `Survey and offer rewards are issued by third-party providers (CPX Research, BitLabs, and others) and then verified by our server before being added to your balance. Occasionally a session gets flagged for quality review on the provider's side, which can delay or withhold the credit — this is outside our direct control but we can look into it.`,
        `Please reply with the survey or offer name and the approximate date/time you completed it, and we will check the provider records on our end.`,
      ]
        .filter(Boolean)
        .join("\n\n");
      break;

    case "withdrawal":
      body = [
        `Thank you for getting in touch.`,
        accountLine,
        `Withdrawals to PayPal are processed manually and typically complete within 1–3 business days after approval. New accounts also have a brief holding period before the first withdrawal is available.`,
        ctx && ctx.withdrawalCount > 0
          ? `Our records show ${ctx.withdrawalCount} withdrawal request${ctx.withdrawalCount === 1 ? "" : "s"} on your account. If you believe a withdrawal is stuck or missing, please reply with the amount and approximate date requested and we will check on its status.`
          : `If you are having trouble requesting a withdrawal, please reply with the details and we will assist you directly.`,
      ]
        .filter(Boolean)
        .join("\n\n");
      break;

    case "balance":
      body = [
        `Thank you for reaching out.`,
        accountLine,
        ctx
          ? `Your current balance is ${ctx.balanceUsd} with a lifetime total of ${ctx.totalEarnedUsd} earned. Points convert to cash once a complete earning session is verified — typically within a few minutes.`
          : `Your balance reflects all verified and converted earnings. Points from active sessions appear once the session is fully confirmed by our system, which typically happens within a few minutes.`,
        `If you believe a specific earning is missing, please reply with the activity type and approximate time and we will investigate.`,
      ]
        .filter(Boolean)
        .join("\n\n");
      break;

    case "login":
      body = [
        `Thank you for contacting us.`,
        accountLine,
        `If you are unable to log in, please use the "Forgot Password" option on the login screen — enter your username and we will send a one-time code to your registered email address to reset your password.`,
        `If you no longer have access to your registered email, please reply here with your username and we will assist you manually.`,
      ]
        .filter(Boolean)
        .join("\n\n");
      break;

    default:
      body = [
        `Thank you for reaching out to CashClip Support.`,
        accountLine,
        `We have received your message and will look into it. Could you please provide a bit more detail about the issue you are experiencing? That will help us resolve it as quickly as possible.`,
      ]
        .filter(Boolean)
        .join("\n\n");
  }

  return [
    greeting,
    "",
    body,
    "",
    "Best regards,",
    "CashClip Support Team",
    "support@cash-clip.app",
  ].join("\n");
}

function buildDraftEs(issue: IssueType, ctx: UserContext | null): string {
  const greeting = ctx ? `Hola ${ctx.username},` : "Hola,";

  const accountLine = ctx
    ? `Encontramos tu cuenta (saldo: ${ctx.balanceUsd}, total ganado: ${ctx.totalEarnedUsd}, miembro desde hace ${ctx.accountAgeDays} día${ctx.accountAgeDays === 1 ? "" : "s"}).`
    : "";

  let body = "";

  switch (issue) {
    case "game_credits":
      body = [
        `Gracias por contactar al soporte de CashClip.`,
        accountLine,
        `Los puntos de los juegos se acreditan en el servidor una vez que la sesión es verificada por nuestro sistema — esto suele ocurrir en pocos minutos, aunque puede tardar hasta 24 horas dependiendo del juego y de la conexión en ese momento.`,
        ctx?.recentEarningDaysAgo != null
          ? `Vemos que tu última actividad de ganancias fue ${fmtDaysAgoEs(ctx.recentEarningDaysAgo)}. Si completaste una sesión de juego y los puntos no aparecen después de 24 horas, respóndenos con el nombre del juego y la hora aproximada en que jugaste para que podamos investigarlo.`
          : `Si completaste una sesión de juego y los puntos no han aparecido después de 24 horas, por favor respóndenos con el nombre del juego y la hora aproximada para que podamos investigar.`,
        `Apreciamos tu paciencia y queremos asegurarnos de que cada sesión completada sea debidamente recompensada.`,
      ]
        .filter(Boolean)
        .join("\n\n");
      break;

    case "survey_credits":
      body = [
        `Gracias por contactar a CashClip.`,
        accountLine,
        `Las recompensas de encuestas y ofertas son emitidas por proveedores externos y verificadas por nuestro servidor antes de agregarse a tu saldo. En ocasiones, una sesión puede estar bajo revisión en el lado del proveedor, lo que puede demorar o retener el crédito.`,
        `Por favor respóndenos con el nombre de la encuesta u oferta y la fecha/hora aproximada en que la completaste, y revisaremos los registros del proveedor.`,
      ]
        .filter(Boolean)
        .join("\n\n");
      break;

    case "withdrawal":
      body = [
        `Gracias por comunicarte con nosotros.`,
        accountLine,
        `Los retiros a PayPal se procesan manualmente y generalmente se completan en 1 a 3 días hábiles después de la aprobación. Las cuentas nuevas también tienen un período de espera antes de que el primer retiro esté disponible.`,
        ctx && ctx.withdrawalCount > 0
          ? `Nuestros registros muestran ${ctx.withdrawalCount} solicitud${ctx.withdrawalCount === 1 ? "" : "es"} de retiro en tu cuenta. Si crees que un retiro está pendiente o falta, respóndenos con el monto y la fecha aproximada para que revisemos el estado.`
          : `Si tienes problemas para solicitar un retiro, por favor respóndenos con los detalles y te ayudaremos directamente.`,
      ]
        .filter(Boolean)
        .join("\n\n");
      break;

    case "balance":
      body = [
        `Gracias por comunicarte.`,
        accountLine,
        ctx
          ? `Tu saldo actual es de ${ctx.balanceUsd} con un total acumulado de ${ctx.totalEarnedUsd}. Los puntos se convierten a efectivo una vez que la sesión de ganancias es verificada, lo cual suele ocurrir en pocos minutos.`
          : `Tu saldo refleja todas las ganancias verificadas y convertidas. Los puntos de sesiones activas aparecen una vez que el sistema confirma la sesión, lo cual generalmente toma unos minutos.`,
        `Si crees que falta alguna ganancia específica, respóndenos con el tipo de actividad y la hora aproximada para que investiguemos.`,
      ]
        .filter(Boolean)
        .join("\n\n");
      break;

    case "login":
      body = [
        `Gracias por contactarnos.`,
        accountLine,
        `Si no puedes iniciar sesión, usa la opción "¿Olvidaste tu contraseña?" en la pantalla de inicio de sesión — ingresa tu nombre de usuario y te enviaremos un código de un solo uso a tu correo registrado para restablecer tu contraseña.`,
        `Si ya no tienes acceso al correo registrado, respóndenos con tu nombre de usuario y te ayudaremos manualmente.`,
      ]
        .filter(Boolean)
        .join("\n\n");
      break;

    default:
      body = [
        `Gracias por contactar al soporte de CashClip.`,
        accountLine,
        `Recibimos tu mensaje y lo revisaremos. ¿Podrías darnos un poco más de detalle sobre el problema que estás experimentando? Eso nos ayudará a resolverlo lo antes posible.`,
      ]
        .filter(Boolean)
        .join("\n\n");
  }

  return [
    greeting,
    "",
    body,
    "",
    "Saludos,",
    "Equipo de Soporte CashClip",
    "support@cash-clip.app",
  ].join("\n");
}

function buildTemplateDraft(lang: Lang, issue: IssueType, ctx: UserContext | null): string {
  return lang === "fr"
    ? buildDraftFr(issue, ctx)
    : lang === "es"
      ? buildDraftEs(issue, ctx)
      : buildDraftEn(issue, ctx);
}

const GREETING_RE = /^(hi |hello |bonjour|bonsoir|hola,|hola |salut)/i;
const ACCOUNT_RE = /(we located your account|encontramos tu cuenta|nous avons trouvé votre compte|balance:|solde\s*:|saldo:)/i;
const CLOSING_RE = /^(best regards|saludos|cordialement|cashclip support team|équipe support|equipo de soporte|support@cash-clip\.app)/i;

function extractLearnedBody(body: string): string | null {
  const paragraphs = body.split("\n\n");
  const policy = paragraphs.filter((p) => {
    const first = p.split("\n")[0].trim();
    if (GREETING_RE.test(first)) return false;
    if (ACCOUNT_RE.test(p)) return false;
    if (CLOSING_RE.test(first)) return false;
    return p.trim().length > 0;
  });
  return policy.length > 0 ? policy.join("\n\n") : null;
}

function buildDraftFromLearned(
  lang: Lang,
  _issue: IssueType,
  ctx: UserContext | null,
  learnedBody: string,
): string {
  const greeting =
    lang === "fr" ? (ctx ? `Bonjour ${ctx.username},` : "Bonjour,")
    : lang === "es" ? (ctx ? `Hola ${ctx.username},` : "Hola,")
    : (ctx ? `Hi ${ctx.username},` : "Hi there,");

  const accountLine = ctx
    ? lang === "fr"
      ? `Nous avons trouvé votre compte (solde : ${ctx.balanceUsd}, total gagné : ${ctx.totalEarnedUsd}, membre depuis ${ctx.accountAgeDays} jour${ctx.accountAgeDays === 1 ? "" : "s"}).`
      : lang === "es"
        ? `Encontramos tu cuenta (saldo: ${ctx.balanceUsd}, total ganado: ${ctx.totalEarnedUsd}, miembro desde hace ${ctx.accountAgeDays} día${ctx.accountAgeDays === 1 ? "" : "s"}).`
        : `We located your account (balance: ${ctx.balanceUsd}, total earned: ${ctx.totalEarnedUsd}, member for ${ctx.accountAgeDays} day${ctx.accountAgeDays === 1 ? "" : "s"}).`
    : "";

  const closing =
    lang === "fr" ? ["Cordialement,", "Équipe Support CashClip", "support@cash-clip.app"]
    : lang === "es" ? ["Saludos,", "Equipo de Soporte CashClip", "support@cash-clip.app"]
    : ["Best regards,", "CashClip Support Team", "support@cash-clip.app"];

  return [
    greeting,
    "",
    ...(accountLine ? [accountLine, ""] : []),
    learnedBody,
    "",
    ...closing,
  ].join("\n");
}

export async function generateInboxDraft(
  fromEmail: string,
  subject: string,
  body: string,
  storage: IStorage,
): Promise<DraftResult> {
  const combined = `${subject} ${body}`;
  const lang = detectLang(combined);
  const issue = detectIssue(combined);

  let userCtx: UserContext | null = null;

  try {
    const user = await storage.getUserByEmail(fromEmail.trim().toLowerCase());
    if (user) {
      const { balance, totalEarned } = await storage.getUserBalance(user.id);
      const withdrawals = await storage.getUserWithdrawals(user.id);
      const ledger = await storage.getUserLedger(user.id, 10);

      const recentEntry = ledger[0] ?? null;

      userCtx = {
        username: user.username,
        balanceUsd: fmtUsd(balance),
        totalEarnedUsd: fmtUsd(totalEarned),
        accountAgeDays: daysSince(new Date(user.createdAt)),
        lastSeenDaysAgo: user.lastSeenAt
          ? daysSince(new Date(user.lastSeenAt))
          : null,
        emailVerified: !!user.emailVerified,
        withdrawalCount: withdrawals.length,
        recentEarningType: recentEntry?.type ?? null,
        recentEarningDaysAgo: recentEntry
          ? daysSince(new Date(recentEntry.createdAt))
          : null,
      };
    }
  } catch {
    // DB unavailable — generate draft without user context
  }

  let draft: string;
  try {
    const examples = await storage.getSupportRepliesByIssue(issue, lang, 3);
    const best = examples[0] ?? null;
    if (best) {
      const learned = extractLearnedBody(best.body);
      draft = learned
        ? buildDraftFromLearned(lang, issue, userCtx, learned)
        : buildTemplateDraft(lang, issue, userCtx);
    } else {
      draft = buildTemplateDraft(lang, issue, userCtx);
    }
  } catch {
    draft = buildTemplateDraft(lang, issue, userCtx);
  }

  return {
    draft,
    issueType: issue,
    lang,
    userFound: userCtx !== null,
    userContext: userCtx,
  };
}
