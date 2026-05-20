import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

const OUT_DIR = path.resolve("exports");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT_PATH = path.join(OUT_DIR, "CashClip-AppStore-ReviewPrep.pdf");

const doc = new PDFDocument({
  size: "LETTER",
  margins: { top: 60, bottom: 60, left: 64, right: 64 },
  info: {
    Title: "CashClip — App Store Review Preparation",
    Author: "Jorge Ballen, AB Sustainability Investments LLC",
    Subject: "Apple App Store Review Flag Defense Documentation",
  },
});

const stream = fs.createWriteStream(OUT_PATH);
doc.pipe(stream);

const PAGE_W = doc.page.width;
const MARGIN_L = 64;
const MARGIN_R = 64;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

const C = {
  black: "#0A0A0A",
  white: "#FFFFFF",
  green: "#00E676",
  greenDark: "#00C853",
  greenBg: "#F0FDF4",
  amber: "#F59E0B",
  amberBg: "#FFFBEB",
  blue: "#3B82F6",
  blueBg: "#EFF6FF",
  red: "#EF4444",
  redBg: "#FEF2F2",
  purple: "#7C3AED",
  purpleBg: "#F5F3FF",
  gray1: "#1A1A1A",
  gray2: "#2A2A2A",
  gray3: "#3A3A3A",
  grayText: "#6B7280",
  lightGray: "#F3F4F6",
  border: "#E5E7EB",
};

function hline(y?: number, color = C.border) {
  const yy = y ?? doc.y;
  doc.save().moveTo(MARGIN_L, yy).lineTo(MARGIN_L + CONTENT_W, yy)
    .strokeColor(color).lineWidth(0.75).stroke().restore();
}

function statusBadge(label: string, x: number, y: number, type: "ok" | "warn" | "fix" | "done") {
  const colors = {
    ok:   { bg: C.greenBg,  text: "#16A34A",  border: "#86EFAC" },
    warn: { bg: C.amberBg,  text: "#B45309",  border: "#FCD34D" },
    fix:  { bg: C.blueBg,   text: "#1D4ED8",  border: "#93C5FD" },
    done: { bg: C.lightGray, text: C.grayText, border: C.border },
  };
  const c = colors[type];
  const w = doc.widthOfString(label, { fontSize: 8 }) + 18;
  doc.save().roundedRect(x, y - 1, w, 16, 4)
    .fill(c.bg).restore();
  doc.save().roundedRect(x, y - 1, w, 16, 4)
    .stroke(c.border).lineWidth(0.5).restore();
  doc.save().fillColor(c.text).fontSize(8).font("Helvetica-Bold")
    .text(label, x + 9, y + 3, { lineBreak: false }).restore();
  return w + 8;
}

function flagCard(opts: {
  num: string;
  title: string;
  guideline: string;
  risk: "LOW" | "MEDIUM" | "LOW-MEDIUM";
  riskColor: string;
  concern: string;
  defense: string[];
  verdict: string;
  verdictType: "ok" | "warn" | "fix";
  y: number;
}) {
  const cardH = 195;
  const { y } = opts;

  doc.save().roundedRect(MARGIN_L, y, CONTENT_W, cardH, 10)
    .fill(C.lightGray).restore();

  const riskColors: Record<string, string> = {
    LOW: C.green, MEDIUM: C.amber, "LOW-MEDIUM": C.blue,
  };
  doc.save().rect(MARGIN_L, y, 4, cardH).fill(riskColors[opts.risk] ?? C.green).restore();

  doc.save().fillColor(C.grayText).fontSize(8).font("Helvetica-Bold")
    .text(`FLAG ${opts.num}`, MARGIN_L + 14, y + 14).restore();
  doc.save().fillColor(C.black).fontSize(13).font("Helvetica-Bold")
    .text(opts.title, MARGIN_L + 14, y + 26, { width: CONTENT_W - 120 }).restore();
  doc.save().fillColor(C.grayText).fontSize(8).font("Helvetica")
    .text(`Guideline: ${opts.guideline}`, MARGIN_L + 14, y + 44).restore();

  const riskX = MARGIN_L + CONTENT_W - 75;
  doc.save().roundedRect(riskX, y + 14, 62, 18, 4)
    .fill(riskColors[opts.risk] + "22").restore();
  doc.save().fillColor(riskColors[opts.risk]).fontSize(8).font("Helvetica-Bold")
    .text(`${opts.risk} RISK`, riskX + 6, y + 20).restore();

  hline(y + 56, C.border);

  doc.save().fillColor(C.grayText).fontSize(8).font("Helvetica-Bold")
    .text("APPLE'S CONCERN", MARGIN_L + 14, y + 64).restore();
  doc.save().fillColor(C.black).fontSize(9.5).font("Helvetica")
    .text(opts.concern, MARGIN_L + 14, y + 76, { width: CONTENT_W - 28, lineGap: 2 }).restore();

  doc.save().fillColor(C.green).fontSize(8).font("Helvetica-Bold")
    .text("OUR POSITION", MARGIN_L + 14, y + 110).restore();

  opts.defense.forEach((line, i) => {
    const dy = y + 122 + i * 16;
    doc.save().circle(MARGIN_L + 20, dy + 5, 2.5).fill(C.green).restore();
    doc.save().fillColor(C.black).fontSize(9.5).font("Helvetica")
      .text(line, MARGIN_L + 28, dy, { width: CONTENT_W - 42, lineBreak: false }).restore();
  });

  hline(y + cardH - 26, C.border);
  doc.save().fillColor(C.grayText).fontSize(8).font("Helvetica-Bold")
    .text("VERDICT: ", MARGIN_L + 14, y + cardH - 18, { continued: true })
    .fillColor(C.black).font("Helvetica").text(opts.verdict, { lineBreak: false }).restore();
  statusBadge(
    opts.verdictType === "ok" ? "✓ DEFENSIBLE" : opts.verdictType === "fix" ? "→ NEEDS FIX" : "! MONITOR",
    MARGIN_L + CONTENT_W - 108, y + cardH - 21, opts.verdictType
  );
}

// ─── COVER ───────────────────────────────────────────────────────────────────
doc.save().rect(0, 0, PAGE_W, doc.page.height).fill(C.black).restore();
doc.save().rect(0, 0, PAGE_W, 6).fill(C.green).restore();
doc.save().circle(PAGE_W - 60, 200, 200).fillOpacity(0.03).fill(C.green).restore();

doc.save().roundedRect(MARGIN_L, 30, 130, 20, 4)
  .fill("rgba(239,68,68,0.15)").restore();
doc.save().fillColor("#EF4444").fontSize(8).font("Helvetica-Bold")
  .text("INTERNAL USE — DO NOT DISTRIBUTE", MARGIN_L + 8, 36, { lineBreak: false }).restore();

doc.save().fillColor(C.green).fontSize(11).font("Helvetica-Bold")
  .text("AB SUSTAINABILITY INVESTMENTS LLC  ·  CASHCLIP", MARGIN_L, 80).restore();

doc.save().fillColor(C.white).fontSize(36).font("Helvetica-Bold")
  .text("App Store Review", MARGIN_L, 118, { lineGap: 4 }).restore();
doc.save().fillColor(C.green).fontSize(36).font("Helvetica-Bold")
  .text("Preparation Guide.", MARGIN_L, 160).restore();

doc.save().fillColor(C.grayText).fontSize(12).font("Helvetica")
  .text("A factual, documented response to every potential Apple review flag.", MARGIN_L, 214, { width: CONTENT_W }).restore();

hline(240, C.gray2);

doc.save().fillColor(C.white).fontSize(11).font("Helvetica-Bold")
  .text("What this document is:", MARGIN_L, 256).restore();
doc.save().fillColor(C.grayText).fontSize(10).font("Helvetica")
  .text(
    "CashClip is a legitimate rewards application that complies with Apple App Store guidelines. This document addresses potential areas of review scrutiny — not because we have violated any guideline, but because prepared founders win faster. Every flag listed here has a clear, honest defense rooted in how the app actually works.",
    MARGIN_L, 274, { width: CONTENT_W, lineGap: 3 }
  ).restore();

const summaryY = 338;
doc.save().roundedRect(MARGIN_L, summaryY, CONTENT_W, 80, 10)
  .fill(C.gray1).restore();
doc.save().rect(MARGIN_L, summaryY, 4, 80).fill(C.green).restore();
const summaryItems = [
  { label: "Flags Reviewed", val: "5" },
  { label: "Defensible", val: "4" },
  { label: "Needs Fix", val: "1" },
  { label: "Showstoppers", val: "0" },
];
const sw = CONTENT_W / 4;
summaryItems.forEach((s, i) => {
  const sx = MARGIN_L + 4 + i * sw;
  doc.save().fillColor(C.green).fontSize(22).font("Helvetica-Bold")
    .text(s.val, sx, summaryY + 16, { width: sw, align: "center" }).restore();
  doc.save().fillColor(C.grayText).fontSize(9).font("Helvetica")
    .text(s.label, sx, summaryY + 46, { width: sw, align: "center" }).restore();
});

doc.save().fillColor(C.white).fontSize(13).font("Helvetica-Bold")
  .text("Bottom Line", MARGIN_L, 440).restore();
doc.save().fillColor(C.grayText).fontSize(10).font("Helvetica")
  .text(
    "There is no structural reason for Apple to permanently reject CashClip. The one technical fix (code signature) is resolvable. All content flags are defensible with the factual explanations documented on the following pages.",
    MARGIN_L, 458, { width: CONTENT_W, lineGap: 3 }
  ).restore();

doc.save().fillColor(C.grayText).fontSize(9).font("Helvetica")
  .text(
    `Prepared by: Jorge Ballen, Founder & CEO  ·  jorge.ballen@absustaininvest.com  ·  ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
    MARGIN_L, 530
  ).restore();

doc.save().rect(0, doc.page.height - 6, PAGE_W, 6).fill(C.green).restore();


// ─── PAGE 2: FLAGS 1 & 2 ─────────────────────────────────────────────────────
doc.addPage({ size: "LETTER", margins: { top: 60, bottom: 60, left: 64, right: 64 } });
doc.save().rect(0, 0, PAGE_W, 6).fill(C.green).restore();

doc.save().fillColor(C.green).fontSize(9).font("Helvetica-Bold")
  .text("REVIEW FLAGS  /  01 – 02", MARGIN_L, 28).restore();
hline(44, C.border);
doc.save().fillColor(C.black).fontSize(22).font("Helvetica-Bold")
  .text("Potential Review Flags", MARGIN_L, 56).restore();
doc.save().fillColor(C.grayText).fontSize(10).font("Helvetica")
  .text("Each flag is documented with Apple's likely concern and our factual, honest defense.", MARGIN_L, 82).restore();

flagCard({
  num: "01",
  title: "Spin Wheel Bonus Mechanic",
  guideline: "App Store Review Guideline 5.2.3 — Gambling, Games of Chance",
  risk: "LOW",
  riskColor: C.green,
  concern: "Apple may question whether the daily spin wheel constitutes a gambling or lottery mechanic, which requires special entitlements and is subject to geographic restrictions.",
  defense: [
    "Users spend zero dollars to spin — no purchase, no wager, no entry fee of any kind",
    "One spin per day, hard-coded — eliminates the 'chase' behavior associated with gambling",
    "The reward is a bonus on top of normal earnings, not a substitute for guaranteed income",
    "Functionally equivalent to a daily login bonus (used in thousands of approved apps)",
  ],
  verdict: "Free daily bonus with no monetary entry. Not gambling under any definition.",
  verdictType: "ok",
  y: 102,
});

flagCard({
  num: "02",
  title: "Real Cash Payouts via PayPal",
  guideline: "App Store Review Guideline 3.1.1 — In-App Purchase",
  risk: "LOW",
  riskColor: C.green,
  concern: "Apple requires that digital goods and services purchased inside apps use Apple's In-App Purchase system. Paying real money to users may raise questions about the payment flow.",
  defense: [
    "CashClip pays users, not the other way around — no user is purchasing anything inside the app",
    "IAP guidelines apply to purchases FROM users. PayPal payouts are disbursements TO users",
    "This model mirrors approved apps: Swagbucks, InboxDollars, Survey Junkie — all on App Store",
    "PayPal is used for the payout only; no financial transaction is initiated by the user in-app",
  ],
  verdict: "Paying users for engagement is explicitly permitted. IAP rules do not apply to outbound payouts.",
  verdictType: "ok",
  y: 320,
});

doc.save().rect(0, doc.page.height - 6, PAGE_W, 6).fill(C.green).restore();
doc.save().fillColor(C.grayText).fontSize(8).font("Helvetica").text("2", PAGE_W / 2, doc.page.height - 24, { align: "center", lineBreak: false }).restore();


// ─── PAGE 3: FLAGS 3, 4, 5 ────────────────────────────────────────────────────
doc.addPage({ size: "LETTER", margins: { top: 60, bottom: 60, left: 64, right: 64 } });
doc.save().rect(0, 0, PAGE_W, 6).fill(C.green).restore();

doc.save().fillColor(C.green).fontSize(9).font("Helvetica-Bold")
  .text("REVIEW FLAGS  /  03 – 05", MARGIN_L, 28).restore();
hline(44, C.border);

flagCard({
  num: "03",
  title: "Earnings Language in App Description",
  guideline: "App Store Review Guideline 4.1 — Copycats, and 2.3 — Accurate Metadata",
  risk: "LOW-MEDIUM",
  riskColor: C.blue,
  concern: "App Store metadata that implies guaranteed income or misleads users about earning potential may be flagged for inaccurate or deceptive claims.",
  defense: [
    "All copy uses 'earn up to' and 'may earn' — no guaranteed income claim anywhere",
    "Earnings are clearly tied to completing tasks — surveys, watching ads, completing offers",
    "Payouts are real and processed via PayPal, making the model transparent and verifiable",
    "Recommended fix: review every screenshot caption and description bullet before submission",
  ],
  verdict: "Defensible with careful wording. Use 'earn up to' consistently across all metadata.",
  verdictType: "warn",
  y: 56,
});

flagCard({
  num: "04",
  title: "User Data Collection via Survey Partners",
  guideline: "App Store Review Guideline 5.1.1 — Privacy — Data Collection and Storage",
  risk: "LOW",
  riskColor: C.green,
  concern: "CashClip integrates with third-party survey providers (CPX Research, BitLabs) who collect demographic and behavioral data from users.",
  defense: [
    "A clear, accessible Privacy Policy is linked in the app and on the App Store listing",
    "Users explicitly consent before entering any survey — opt-in, not opt-out",
    "Survey providers are established companies compliant with GDPR, CCPA, and COPPA",
    "CashClip itself does not store or transmit survey response data — providers handle this directly",
    "App Tracking Transparency (ATT) prompt is shown before any ad personalization occurs",
  ],
  verdict: "Standard industry practice for rewards apps. Privacy Policy and ATT prompt are the requirements.",
  verdictType: "ok",
  y: 268,
});

flagCard({
  num: "05",
  title: "Code Signing / Invalid Signature",
  guideline: "Technical Requirement — Binary Integrity",
  risk: "MEDIUM",
  riskColor: C.amber,
  concern: "A previous build was flagged for an invalid binary signature. Apple's automated pipeline rejects binaries that fail signature validation before human review begins.",
  defense: [
    "This is a build configuration issue, not a content or policy violation",
    "Fix: rebuild the app using EAS Build with a clean provisioning profile and certificate",
    "Ensure the correct Bundle ID (app.replit.cashclip) is consistently set in eas.json and app.json",
    "Use Xcode's 'Automatically manage signing' or EAS managed credentials — do not mix the two",
    "After rebuild, validate the .ipa with Apple's Transporter before resubmission",
  ],
  verdict: "Fully fixable. Rebuild via EAS Build with clean credentials. This is the #1 priority before resubmission.",
  verdictType: "fix",
  y: 480,
});

doc.save().rect(0, doc.page.height - 6, PAGE_W, 6).fill(C.green).restore();
doc.save().fillColor(C.grayText).fontSize(8).font("Helvetica").text("3", PAGE_W / 2, doc.page.height - 24, { align: "center", lineBreak: false }).restore();


// ─── PAGE 4: ACTION CHECKLIST + APPEAL SCRIPT ─────────────────────────────────
doc.addPage({ size: "LETTER", margins: { top: 60, bottom: 60, left: 64, right: 64 } });
doc.save().rect(0, 0, PAGE_W, 6).fill(C.green).restore();

doc.save().fillColor(C.green).fontSize(9).font("Helvetica-Bold")
  .text("ACTION PLAN  /  CHECKLIST & APPEAL", MARGIN_L, 28).restore();
hline(44, C.border);

doc.save().fillColor(C.black).fontSize(22).font("Helvetica-Bold")
  .text("Pre-Submission Checklist", MARGIN_L, 56).restore();

const checks = [
  { priority: "CRITICAL", color: C.red,   item: "Rebuild app using EAS Build with clean provisioning profile — resolves Invalid Signature" },
  { priority: "CRITICAL", color: C.red,   item: "Validate .ipa binary using Apple Transporter before uploading to App Store Connect" },
  { priority: "HIGH",     color: C.amber, item: "Audit all metadata: replace any 'earn money' with 'earn up to' or 'may earn'" },
  { priority: "HIGH",     color: C.amber, item: "Confirm Privacy Policy URL is live and linked in App Store Connect listing" },
  { priority: "HIGH",     color: C.amber, item: "Confirm App Tracking Transparency (ATT) prompt appears before any ad personalization" },
  { priority: "MEDIUM",   color: C.blue,  item: "Add subtitle to spin wheel screen: 'Free daily bonus — no purchase required'" },
  { priority: "MEDIUM",   color: C.blue,  item: "Confirm all screenshots accurately represent current app UI (no mocked data)" },
  { priority: "MEDIUM",   color: C.blue,  item: "Ensure age rating is correctly set (likely 4+ or 9+ — no mature content)" },
  { priority: "LOW",      color: C.green, item: "Confirm support URL and marketing URL are live and responsive before resubmission" },
];

checks.forEach((c, i) => {
  const cy = 90 + i * 38;
  doc.save().roundedRect(MARGIN_L, cy, CONTENT_W, 32, 6).fill(C.lightGray).restore();
  const pw = doc.widthOfString(c.priority, { fontSize: 7.5 }) + 14;
  doc.save().roundedRect(MARGIN_L + 8, cy + 8, pw, 16, 3).fill(c.color + "22").restore();
  doc.save().fillColor(c.color).fontSize(7.5).font("Helvetica-Bold")
    .text(c.priority, MARGIN_L + 15, cy + 13, { lineBreak: false }).restore();
  doc.save().fillColor(C.black).fontSize(9.5).font("Helvetica")
    .text(c.item, MARGIN_L + pw + 16, cy + 10, { width: CONTENT_W - pw - 28, lineBreak: false }).restore();
});

hline(452, C.border);

doc.save().fillColor(C.black).fontSize(14).font("Helvetica-Bold")
  .text("If Apple Asks — What to Say", MARGIN_L, 464).restore();
doc.save().fillColor(C.grayText).fontSize(10).font("Helvetica")
  .text("Use this language in your Resolution Center response:", MARGIN_L, 482).restore();

doc.save().roundedRect(MARGIN_L, 498, CONTENT_W, 108, 8).fill("#F8FAFC").restore();
doc.save().rect(MARGIN_L, 498, 3, 108).fill(C.blue).restore();
doc.save().fillColor(C.black).fontSize(9).font("Helvetica")
  .text(
    "CashClip is a rewards application that compensates users for completing surveys, watching rewarded video advertisements, and engaging with offers. No user pays to participate in any mechanic within the app.\n\n" +
    "The daily spin feature is a free bonus delivery mechanism — one spin per day at no cost. It is functionally equivalent to a daily login reward.\n\n" +
    "PayPal disbursements are outbound payments from our business to users, not in-app purchases from users. This model is consistent with other approved apps in the rewards category (Swagbucks, Survey Junkie, InboxDollars).\n\n" +
    "We are happy to provide any additional documentation or clarification.",
    MARGIN_L + 14, 506, { width: CONTENT_W - 24, lineGap: 3 }
  ).restore();

doc.save().rect(0, doc.page.height - 6, PAGE_W, 6).fill(C.green).restore();
doc.save().fillColor(C.grayText).fontSize(8).font("Helvetica").text("4", PAGE_W / 2, doc.page.height - 24, { align: "center", lineBreak: false }).restore();


// ─── PAGE 5: CLOSING ─────────────────────────────────────────────────────────
doc.addPage({ size: "LETTER", margins: { top: 60, bottom: 60, left: 64, right: 64 } });
doc.save().rect(0, 0, PAGE_W, doc.page.height).fill(C.black).restore();
doc.save().rect(0, 0, PAGE_W, 6).fill(C.green).restore();
doc.save().circle(PAGE_W - 40, doc.page.height / 2, 200).fillOpacity(0.04).fill(C.green).restore();

doc.save().fillColor(C.white).fontSize(32).font("Helvetica-Bold")
  .text("Built right.\nDocumented.\nReady.", MARGIN_L, 120, { lineGap: 8 }).restore();

doc.save().fillColor(C.grayText).fontSize(11).font("Helvetica")
  .text(
    "First-time App Store rejections are normal. Every major app has a review story.\nWhat separates founders is being prepared, documented, and unfazed.",
    MARGIN_L, 256, { width: CONTENT_W, lineGap: 4 }
  ).restore();

hline(310, C.gray2);

const closing = [
  { ico: "01", label: "Fix the signature", body: "Rebuild via EAS Build. Clean credentials. Submit clean." },
  { ico: "02", label: "Tune the metadata", body: "Swap any absolute earning claims for 'earn up to' language." },
  { ico: "03", label: "Submit with confidence", body: "This app is legitimate, compliant, and built on a proven model." },
  { ico: "04", label: "If rejected — use this doc", body: "The Resolution Center response on page 4 is your exact reply." },
];
closing.forEach((cl, i) => {
  const cy = 330 + i * 58;
  doc.save().fillColor(C.green).fontSize(10).font("Helvetica-Bold")
    .text(cl.ico, MARGIN_L, cy, { lineBreak: false }).restore();
  doc.save().fillColor(C.white).fontSize(12).font("Helvetica-Bold")
    .text(cl.label, MARGIN_L + 28, cy, { lineBreak: false }).restore();
  doc.save().fillColor(C.grayText).fontSize(10).font("Helvetica")
    .text(cl.body, MARGIN_L + 28, cy + 18, { width: CONTENT_W - 28 }).restore();
});

doc.save().fillColor(C.gray2).fontSize(8).font("Helvetica")
  .text(
    "This document is for internal use by AB Sustainability Investments LLC. It reflects the honest, factual position of CashClip as of the date of preparation. Nothing herein constitutes legal advice.",
    MARGIN_L, 580, { width: CONTENT_W, lineGap: 2 }
  ).restore();

doc.save().rect(0, doc.page.height - 6, PAGE_W, 6).fill(C.green).restore();
doc.save().fillColor(C.grayText).fontSize(8).font("Helvetica").text("5", PAGE_W / 2, doc.page.height - 24, { align: "center", lineBreak: false }).restore();

doc.end();
stream.on("finish", () => console.log(`✅ PDF written to: ${OUT_PATH}`));
stream.on("error", (err) => { console.error("❌", err); process.exit(1); });
