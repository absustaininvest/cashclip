import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

const OUT_DIR = path.resolve("exports");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT_PATH = path.join(OUT_DIR, "CashClip-PowerOfThePenny-InvestorDraft.pdf");

const doc = new PDFDocument({
  size: "LETTER",
  margins: { top: 60, bottom: 60, left: 64, right: 64 },
  info: {
    Title: "Power of the Penny — Investor Prospecting Draft",
    Author: "Jorge Ballen, AB Sustainability Investments LLC",
    Subject: "CashClip Mass Micro-Investment Partnership Prospectus",
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
  purple: "#7C3AED",
  purpleLight: "#A78BFA",
  gold: "#FFD600",
  gray1: "#1A1A1A",
  gray2: "#2A2A2A",
  gray3: "#3A3A3A",
  grayText: "#6B7280",
  lightGray: "#F3F4F6",
  acornsGreen: "#3D9970",
  stashPurple: "#4F46E5",
};

function hline(y?: number, color = C.gray2, w = CONTENT_W) {
  const yy = y ?? doc.y;
  doc.save().moveTo(MARGIN_L, yy).lineTo(MARGIN_L + w, yy).strokeColor(color).lineWidth(1).stroke().restore();
}

function chip(label: string, x: number, y: number, bg: string, fg: string) {
  const pad = 8;
  const w = doc.widthOfString(label) + pad * 2;
  doc.save().roundedRect(x, y - 2, w, 18, 4).fill(bg).restore();
  doc.save().fillColor(fg).fontSize(8).font("Helvetica-Bold").text(label, x + pad, y + 1, { lineBreak: false }).restore();
  return w + 6;
}

// ─── COVER PAGE ───────────────────────────────────────────────────────────────
doc.save().rect(0, 0, PAGE_W, doc.page.height).fill(C.black).restore();

// Green accent stripe top
doc.save().rect(0, 0, PAGE_W, 6).fill(C.green).restore();

// Watermark circle
doc.save().circle(PAGE_W - 60, 120, 180).fillOpacity(0.04).fill(C.green).restore();
doc.save().circle(60, doc.page.height - 80, 120).fillOpacity(0.04).fill(C.purple).restore();

// CONFIDENTIAL badge
doc.save()
  .roundedRect(MARGIN_L, 30, 110, 20, 4)
  .fill("rgba(255,214,0,0.15)")
  .restore();
doc.save()
  .fillColor(C.gold)
  .fontSize(8)
  .font("Helvetica-Bold")
  .text("DRAFT — CONFIDENTIAL", MARGIN_L + 8, 36, { lineBreak: false })
  .restore();

// Logo / Company
doc.save()
  .fillColor(C.green)
  .fontSize(11)
  .font("Helvetica-Bold")
  .text("AB SUSTAINABILITY INVESTMENTS LLC", MARGIN_L, 80)
  .restore();
doc.save()
  .fillColor(C.grayText)
  .fontSize(9)
  .font("Helvetica")
  .text("absustaininvest.com  ·  cash-clip.app", MARGIN_L, 95)
  .restore();

hline(116, C.gray2);

// Title block
doc.save()
  .fillColor(C.white)
  .fontSize(44)
  .font("Helvetica-Bold")
  .text("Power of", MARGIN_L, 140)
  .restore();
doc.save()
  .fillColor(C.green)
  .fontSize(44)
  .font("Helvetica-Bold")
  .text("the Penny.", MARGIN_L, 190)
  .restore();

doc.save()
  .fillColor(C.grayText)
  .fontSize(14)
  .font("Helvetica")
  .text("Mass Moved Micro-Investments —", MARGIN_L, 252)
  .restore();
doc.save()
  .fillColor(C.white)
  .fontSize(14)
  .font("Helvetica-Bold")
  .text("How CashClip Turns Everyday Earners into First-Time Investors", MARGIN_L, 272, { width: CONTENT_W - 40 })
  .restore();

// Philosophy quote block
doc.save()
  .roundedRect(MARGIN_L, 330, CONTENT_W, 80, 10)
  .fill(C.gray2)
  .restore();
doc.save()
  .fillColor(C.purpleLight)
  .fontSize(28)
  .font("Helvetica-Bold")
  .text('"', MARGIN_L + 14, 336, { lineBreak: false })
  .restore();
doc.save()
  .fillColor(C.white)
  .fontSize(13)
  .font("Helvetica-Oblique")
  .text("Don't you ever underestimate the power of the penny.", MARGIN_L + 36, 344, { width: CONTENT_W - 60, lineBreak: false })
  .restore();
doc.save()
  .fillColor(C.purpleLight)
  .fontSize(9)
  .font("Helvetica-Bold")
  .text("— Jorge Ballen, Founder & CEO", MARGIN_L + 36, 368)
  .restore();

// Key metrics row
const metricY = 435;
const metricW = (CONTENT_W - 16) / 3;
const metrics = [
  { val: "0¢", label: "Required to Start\nInvesting" },
  { val: "2", label: "Top-Tier Investment\nPartners Competing" },
  { val: "∞", label: "Earning Potential\nfor Users" },
];
metrics.forEach((m, i) => {
  const x = MARGIN_L + i * (metricW + 8);
  doc.save().roundedRect(x, metricY, metricW, 80, 8).fill(C.gray1).restore();
  doc.save()
    .fillColor(C.green)
    .fontSize(28)
    .font("Helvetica-Bold")
    .text(m.val, x, metricY + 14, { width: metricW, align: "center" })
    .restore();
  doc.save()
    .fillColor(C.grayText)
    .fontSize(9)
    .font("Helvetica")
    .text(m.label, x, metricY + 50, { width: metricW, align: "center" })
    .restore();
});

// Prepared for
doc.save()
  .fillColor(C.grayText)
  .fontSize(9)
  .font("Helvetica")
  .text("Prepared for Investment Partners & Prospective Collaborators", MARGIN_L, 540)
  .restore();
doc.save()
  .fillColor(C.white)
  .fontSize(10)
  .font("Helvetica-Bold")
  .text("Jorge Ballen  ·  jorge.ballen@cash-clip.app", MARGIN_L, 554)
  .restore();
doc.save()
  .fillColor(C.grayText)
  .fontSize(9)
  .font("Helvetica")
  .text(`Draft  ·  ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, MARGIN_L, 568)
  .restore();

// Green bottom stripe
doc.save().rect(0, doc.page.height - 6, PAGE_W, 6).fill(C.green).restore();


// ─── PAGE 2: EXECUTIVE SUMMARY ────────────────────────────────────────────────
doc.addPage({ size: "LETTER", margins: { top: 60, bottom: 60, left: 64, right: 64 } });
doc.save().rect(0, 0, PAGE_W, 6).fill(C.green).restore();

// Section header
doc.save().fillColor(C.green).fontSize(9).font("Helvetica-Bold").text("01  /  EXECUTIVE SUMMARY", MARGIN_L, 28).restore();
hline(44, C.lightGray);

doc.save().fillColor(C.black).fontSize(28).font("Helvetica-Bold").text("The Opportunity", MARGIN_L, 56).restore();
doc.save()
  .fillColor(C.grayText)
  .fontSize(12)
  .font("Helvetica")
  .text(
    "CashClip is a mobile rewards platform that pays users real cash for completing surveys, watching videos, playing games, and engaging with offers. We are now building the bridge from earning to investing — enabling first-time investors to put their CashClip earnings directly into the market with zero money down and zero risk to their own capital.",
    MARGIN_L, 96, { width: CONTENT_W, lineGap: 4 }
  )
  .restore();

doc.save().fillColor(C.black).fontSize(13).font("Helvetica-Bold").text("The Core Equation", MARGIN_L, 178).restore();

// Equation visual
const eqY = 198;
doc.save().roundedRect(MARGIN_L, eqY, CONTENT_W, 52, 8).fill("#F0FDF4").restore();
doc.save().rect(MARGIN_L, eqY, 4, 52).fill(C.green).restore();
doc.save()
  .fillColor(C.greenDark)
  .fontSize(16)
  .font("Helvetica-Bold")
  .text("Earn (CashClip)   +   Invest (Acorns / Stash)   =   Mass Micro-Investment Movement", MARGIN_L + 16, eqY + 16, { width: CONTENT_W - 20 })
  .restore();

doc.save()
  .fillColor(C.grayText)
  .fontSize(11)
  .font("Helvetica")
  .text(
    "Each individual earning may be small — a few cents here, a dollar there. But at scale, millions of CashClip users moving micro-investments into the market represents significant aggregate capital flow. This is the economic principle Jorge Ballen calls the Power of the Penny: small amounts, moved by many, become something powerful.",
    MARGIN_L, 268, { width: CONTENT_W, lineGap: 4 }
  )
  .restore();

// Three pillars
const pillars = [
  { icon: "①", title: "Earn", color: C.green, body: "Users earn real cash through surveys, videos, games, and offers on the CashClip app. No purchase required. No risk to the user's own money." },
  { icon: "②", title: "Invest", color: C.purple, body: "With one tap, users redirect their CashClip earnings into Acorns or Stash. First investment account opened. Zero dollars of their own capital at risk." },
  { icon: "③", title: "Grow", color: C.gold, body: "Micro-investments compound over time. Users who started with earnings become habitual investors. The platform partner gains a loyal, long-term account." },
];

const pillarY = 360;
const pillarW = (CONTENT_W - 16) / 3;
pillars.forEach((p, i) => {
  const x = MARGIN_L + i * (pillarW + 8);
  doc.save().roundedRect(x, pillarY, pillarW, 130, 8).fill(C.lightGray).restore();
  doc.save().rect(x, pillarY, pillarW, 4).fill(p.color).restore();
  doc.save().fillColor(p.color).fontSize(18).font("Helvetica-Bold").text(p.icon, x + 12, pillarY + 14, { lineBreak: false }).restore();
  doc.save().fillColor(C.black).fontSize(13).font("Helvetica-Bold").text(p.title, x + 32, pillarY + 15, { lineBreak: false }).restore();
  doc.save().fillColor(C.grayText).fontSize(9.5).font("Helvetica").text(p.body, x + 12, pillarY + 42, { width: pillarW - 24, lineGap: 2 }).restore();
});

doc.save()
  .fillColor(C.grayText)
  .fontSize(10)
  .font("Helvetica-Oblique")
  .text(
    "This is not a charity or a gimmick. This is a systematic acquisition channel for investment platforms — a pipeline of first-time investors who arrive pre-motivated, pre-funded by CashClip earnings, and pre-qualified by behavioral engagement.",
    MARGIN_L, 508, { width: CONTENT_W, lineGap: 3 }
  )
  .restore();

doc.save().rect(0, doc.page.height - 6, PAGE_W, 6).fill(C.green).restore();
doc.save().fillColor(C.grayText).fontSize(8).font("Helvetica").text("2", PAGE_W / 2, doc.page.height - 24, { align: "center", lineBreak: false }).restore();


// ─── PAGE 3: PLATFORM & MARKET ────────────────────────────────────────────────
doc.addPage({ size: "LETTER", margins: { top: 60, bottom: 60, left: 64, right: 64 } });
doc.save().rect(0, 0, PAGE_W, 6).fill(C.green).restore();

doc.save().fillColor(C.green).fontSize(9).font("Helvetica-Bold").text("02  /  PLATFORM OVERVIEW", MARGIN_L, 28).restore();
hline(44, C.lightGray);

doc.save().fillColor(C.black).fontSize(28).font("Helvetica-Bold").text("CashClip at a Glance", MARGIN_L, 56).restore();

// Two-column layout
const colW = (CONTENT_W - 20) / 2;
const col2X = MARGIN_L + colW + 20;

// Left col
doc.save().fillColor(C.black).fontSize(12).font("Helvetica-Bold").text("What CashClip Is", MARGIN_L, 96).restore();
const appDesc = [
  "Native iOS & Android app (Expo)",
  "Real cash rewards — not points, not gift cards",
  "Earn via: surveys, rewarded video ads, games, offers, referrals",
  "Powered by: AdMob, Unity Ads, CPX Research, BitLabs",
  "PayPal payouts with tiered withdrawal bonuses",
  "\"Zero money down, zero risk\" investing via earnings",
];
appDesc.forEach((line, i) => {
  doc.save().circle(MARGIN_L + 5, 118 + i * 22, 3).fill(C.green).restore();
  doc.save().fillColor(C.grayText).fontSize(10).font("Helvetica").text(line, MARGIN_L + 14, 112 + i * 22, { width: colW - 14 }).restore();
});

// Right col
doc.save().fillColor(C.black).fontSize(12).font("Helvetica-Bold").text("Revenue Streams", col2X, 96).restore();
const revStreams = [
  { label: "Rewarded Video Ads", pct: "Primary" },
  { label: "Survey Completions", pct: "High CPM" },
  { label: "Offerwall Engagements", pct: "Affiliate" },
  { label: "Investment Referrals", pct: "$5–$15 ea." },
  { label: "Game Engagements", pct: "Growing" },
  { label: "Affiliate Partnerships", pct: "Recurring" },
];
revStreams.forEach((r, i) => {
  const ry = 116 + i * 24;
  doc.save().roundedRect(col2X, ry, colW, 20, 4).fill(C.lightGray).restore();
  doc.save().fillColor(C.black).fontSize(9.5).font("Helvetica-Bold").text(r.label, col2X + 8, ry + 5, { lineBreak: false }).restore();
  doc.save().fillColor(C.green).fontSize(9).font("Helvetica-Bold").text(r.pct, col2X + colW - 50, ry + 5, { lineBreak: false }).restore();
});

hline(276, C.lightGray);

// Partner ecosystem
doc.save().fillColor(C.black).fontSize(14).font("Helvetica-Bold").text("Active Integration Partners", MARGIN_L, 290).restore();
doc.save().fillColor(C.grayText).fontSize(10).font("Helvetica").text("CashClip integrates with best-in-class partners across ads, surveys, and gaming:", MARGIN_L, 308).restore();

const partners = [
  { name: "Google AdMob", cat: "Ads" },
  { name: "Unity Ads", cat: "Ads / Gaming" },
  { name: "TheoremReach", cat: "Surveys" },
  { name: "CPX Research", cat: "Surveys" },
  { name: "BitLabs", cat: "Surveys" },
  { name: "AdGem", cat: "Offerwalls" },
  { name: "PayPal", cat: "Payouts" },
  { name: "Acorns*", cat: "Investments" },
  { name: "Stash*", cat: "Investments" },
];

const partnerY = 328;
let px = MARGIN_L;
let py = partnerY;
partners.forEach((p) => {
  const pw = doc.widthOfString(p.name, { fontSize: 9 }) + 24;
  if (px + pw > MARGIN_L + CONTENT_W) { px = MARGIN_L; py += 28; }
  doc.save().roundedRect(px, py, pw, 22, 5).fill(C.gray1).restore();
  doc.save().fillColor(C.white).fontSize(9).font("Helvetica-Bold").text(p.name, px + 8, py + 6, { lineBreak: false }).restore();
  px += pw + 8;
});

doc.save().fillColor(C.grayText).fontSize(8).font("Helvetica-Oblique").text("* Partnership pending affiliate program enrollment", MARGIN_L, py + 30).restore();

hline(py + 48, C.lightGray);

// Market context
doc.save().fillColor(C.black).fontSize(14).font("Helvetica-Bold").text("Market Context", MARGIN_L, py + 62).restore();
const mktStats = [
  { stat: "$6.2B", label: "Global gig economy rewards app market by 2026" },
  { stat: "72M+", label: "Americans have never invested in the stock market" },
  { stat: "$1", label: "Average first Acorns investment — CashClip covers it entirely" },
];
mktStats.forEach((s, i) => {
  const sx = MARGIN_L + i * (CONTENT_W / 3);
  doc.save().fillColor(C.green).fontSize(20).font("Helvetica-Bold").text(s.stat, sx, py + 82).restore();
  doc.save().fillColor(C.grayText).fontSize(9).font("Helvetica").text(s.label, sx, py + 108, { width: CONTENT_W / 3 - 8 }).restore();
});

doc.save().rect(0, doc.page.height - 6, PAGE_W, 6).fill(C.green).restore();
doc.save().fillColor(C.grayText).fontSize(8).font("Helvetica").text("3", PAGE_W / 2, doc.page.height - 24, { align: "center", lineBreak: false }).restore();


// ─── PAGE 4: THE SHOWDOWN ─────────────────────────────────────────────────────
doc.addPage({ size: "LETTER", margins: { top: 60, bottom: 60, left: 64, right: 64 } });
doc.save().rect(0, 0, PAGE_W, 6).fill(C.green).restore();

doc.save().fillColor(C.green).fontSize(9).font("Helvetica-Bold").text("03  /  PARTNER OPPORTUNITY", MARGIN_L, 28).restore();
hline(44, C.lightGray);

doc.save().fillColor(C.black).fontSize(28).font("Helvetica-Bold").text("The Investment Showdown", MARGIN_L, 56).restore();
doc.save()
  .fillColor(C.grayText)
  .fontSize(11)
  .font("Helvetica")
  .text("CashClip is creating a competitive environment between investment platforms — giving users genuine choice and giving partners a direct, motivated acquisition channel. We call it loyalty carnage: two great platforms competing for the loyalty of millions of first-time investors.", MARGIN_L, 92, { width: CONTENT_W, lineGap: 3 })
  .restore();

// VS cards
const cardY = 160;
const cardW = (CONTENT_W - 24) / 2;

// Acorns card
doc.save().roundedRect(MARGIN_L, cardY, cardW, 220, 10).fill("#F0FDF4").restore();
doc.save().rect(MARGIN_L, cardY, cardW, 4).fill(C.acornsGreen).restore();
doc.save().fillColor(C.acornsGreen).fontSize(20).font("Helvetica-Bold").text("🌱  Acorns", MARGIN_L + 14, cardY + 16).restore();
doc.save().fillColor(C.grayText).fontSize(9).font("Helvetica-Oblique").text("Micro-investing, automatically", MARGIN_L + 14, cardY + 40).restore();

const acornPerks = [
  "Round-up investing on everyday spending",
  "Diversified, managed portfolios",
  "Perfect for total beginners",
  "Referral bonus: $5–$10 per new account",
  "Passive — no decisions required",
];
acornPerks.forEach((p, i) => {
  doc.save().circle(MARGIN_L + 18, cardY + 68 + i * 22, 3).fill(C.acornsGreen).restore();
  doc.save().fillColor(C.black).fontSize(9.5).font("Helvetica").text(p, MARGIN_L + 28, cardY + 62 + i * 22, { width: cardW - 36 }).restore();
});

doc.save().roundedRect(MARGIN_L + 12, cardY + 188, cardW - 24, 22, 5).fill(C.acornsGreen).restore();
doc.save().fillColor(C.white).fontSize(10).font("Helvetica-Bold").text("Invest with Acorns →", MARGIN_L + 12, cardY + 194, { width: cardW - 24, align: "center" }).restore();

// VS badge
const vsX = MARGIN_L + cardW + 12;
doc.save().circle(vsX, cardY + 110, 18).fill(C.black).restore();
doc.save().fillColor(C.gold).fontSize(10).font("Helvetica-Bold").text("VS", vsX - 8, cardY + 105, { lineBreak: false }).restore();

// Stash card
const s2X = MARGIN_L + cardW + 24;
doc.save().roundedRect(s2X, cardY, cardW, 220, 10).fill("#F5F3FF").restore();
doc.save().rect(s2X, cardY, cardW, 4).fill(C.stashPurple).restore();
doc.save().fillColor(C.stashPurple).fontSize(20).font("Helvetica-Bold").text("📈  Stash", s2X + 14, cardY + 16).restore();
doc.save().fillColor(C.grayText).fontSize(9).font("Helvetica-Oblique").text("Invest in what you believe in", s2X + 14, cardY + 40).restore();

const stashPerks = [
  "Choose your own stocks and ETFs",
  "Fractional shares starting at $1",
  "Hands-on, personalized investing",
  "Referral bonus: $5–$15 per new account",
  "Builds investing confidence & habit",
];
stashPerks.forEach((p, i) => {
  doc.save().circle(s2X + 18, cardY + 68 + i * 22, 3).fill(C.stashPurple).restore();
  doc.save().fillColor(C.black).fontSize(9.5).font("Helvetica").text(p, s2X + 28, cardY + 62 + i * 22, { width: cardW - 36 }).restore();
});

doc.save().roundedRect(s2X + 12, cardY + 188, cardW - 24, 22, 5).fill(C.stashPurple).restore();
doc.save().fillColor(C.white).fontSize(10).font("Helvetica-Bold").text("Invest with Stash →", s2X + 12, cardY + 194, { width: cardW - 24, align: "center" }).restore();

// Why this model wins
const winY = cardY + 240;
doc.save().fillColor(C.black).fontSize(14).font("Helvetica-Bold").text("Why This Model Wins for Partners", MARGIN_L, winY).restore();

const wins = [
  { ico: "→", title: "Pre-qualified, motivated users", body: "CashClip users have already demonstrated financial engagement. They earn, they track, they care about money." },
  { ico: "→", title: "Zero acquisition friction", body: "Users arrive with CashClip earnings ready to invest. No credit card required. No barrier to first deposit." },
  { ico: "→", title: "Mass movement at scale", body: "One penny invested by one user is nothing. One million pennies moved daily by CashClip users is a river of capital — and a river of new accounts." },
  { ico: "→", title: "Competitive dynamic drives quality", body: "Both platforms compete on perks and referral bonuses. Users get the best deal. Partners get the best outcomes." },
];

wins.forEach((w, i) => {
  const wy = winY + 26 + i * 52;
  doc.save().fillColor(C.green).fontSize(13).font("Helvetica-Bold").text(w.ico, MARGIN_L, wy, { lineBreak: false }).restore();
  doc.save().fillColor(C.black).fontSize(11).font("Helvetica-Bold").text(w.title, MARGIN_L + 16, wy, { lineBreak: false }).restore();
  doc.save().fillColor(C.grayText).fontSize(9.5).font("Helvetica").text(w.body, MARGIN_L + 16, wy + 16, { width: CONTENT_W - 16, lineGap: 2 }).restore();
});

doc.save().rect(0, doc.page.height - 6, PAGE_W, 6).fill(C.green).restore();
doc.save().fillColor(C.grayText).fontSize(8).font("Helvetica").text("4", PAGE_W / 2, doc.page.height - 24, { align: "center", lineBreak: false }).restore();


// ─── PAGE 5: REVENUE & THE ASK ───────────────────────────────────────────────
doc.addPage({ size: "LETTER", margins: { top: 60, bottom: 60, left: 64, right: 64 } });
doc.save().rect(0, 0, PAGE_W, 6).fill(C.green).restore();

doc.save().fillColor(C.green).fontSize(9).font("Helvetica-Bold").text("04  /  REFERRAL MODEL & THE ASK", MARGIN_L, 28).restore();
hline(44, C.lightGray);

doc.save().fillColor(C.black).fontSize(28).font("Helvetica-Bold").text("Revenue & Partnership Model", MARGIN_L, 56).restore();

// Referral math box
doc.save().roundedRect(MARGIN_L, 96, CONTENT_W, 90, 10).fill(C.black).restore();
doc.save().rect(MARGIN_L, 96, 4, 90).fill(C.green).restore();
doc.save().fillColor(C.green).fontSize(12).font("Helvetica-Bold").text("The Math of Mass Micro-Investment", MARGIN_L + 16, 108).restore();
doc.save().fillColor(C.white).fontSize(10).font("Helvetica").text(
  "If CashClip drives 10,000 new investment account openings per month:\n" +
  "   •  At $7 average referral commission  =  $70,000/month in referral revenue\n" +
  "   •  At $10 average referral commission  =  $100,000/month in referral revenue\n" +
  "   •  These users invest an avg $1–$5 each from CashClip earnings → zero churn risk",
  MARGIN_L + 16, 126, { width: CONTENT_W - 32, lineGap: 3 }
).restore();

doc.save().fillColor(C.black).fontSize(14).font("Helvetica-Bold").text("Partnership Tiers We're Proposing", MARGIN_L, 206).restore();

const tiers = [
  { name: "Standard Affiliate", color: C.grayText, items: ["Public referral link", "$5–$10 per new funded account", "Banner placement in CashClip app", "Included in platform listings"] },
  { name: "Preferred Partner", color: C.acornsGreen, items: ["Custom co-branded landing page", "$10–$15 per new funded account", "Featured 'Champion' placement in battle UI", "Monthly co-marketing content", "Priority user targeting"] },
  { name: "Strategic Partner", color: C.purple, items: ["Custom earnings-to-investment flow", "Revenue share negotiation", "Joint press releases", "Early access to new CashClip features", "Investor & advisor consideration"] },
];

const tierW = (CONTENT_W - 16) / 3;
tiers.forEach((tier, i) => {
  const tx = MARGIN_L + i * (tierW + 8);
  const ty = 228;
  doc.save().roundedRect(tx, ty, tierW, 190, 8).fill(C.lightGray).restore();
  doc.save().rect(tx, ty, tierW, 4).fill(tier.color).restore();
  doc.save().fillColor(tier.color).fontSize(10).font("Helvetica-Bold").text(tier.name, tx + 10, ty + 14, { width: tierW - 20 }).restore();
  tier.items.forEach((item, j) => {
    doc.save().circle(tx + 14, ty + 44 + j * 28, 3).fill(tier.color).restore();
    doc.save().fillColor(C.black).fontSize(8.5).font("Helvetica").text(item, tx + 22, ty + 38 + j * 28, { width: tierW - 30 }).restore();
  });
});

// The Ask
const askY = 440;
doc.save().fillColor(C.black).fontSize(14).font("Helvetica-Bold").text("What We're Looking For", MARGIN_L, askY).restore();

const asks = [
  "Acorns or Stash affiliate/partner program approval (fast-track preferred)",
  "Referral commission structure discussion — standard or enhanced for scale",
  "Co-marketing budget allocation for CashClip launch campaign",
  "Optional: Strategic advisory or equity partnership conversation",
];
asks.forEach((a, i) => {
  const ay = askY + 26 + i * 30;
  doc.save().roundedRect(MARGIN_L, ay, CONTENT_W, 26, 5).fill(i % 2 === 0 ? C.lightGray : "#FFF").restore();
  chip(`0${i + 1}`, MARGIN_L + 8, ay + 4, C.green, C.black);
  doc.save().fillColor(C.black).fontSize(10).font("Helvetica").text(a, MARGIN_L + 44, ay + 7, { lineBreak: false }).restore();
});

// Closing quote
const closeY = askY + 168;
doc.save().roundedRect(MARGIN_L, closeY, CONTENT_W, 60, 10).fill(C.black).restore();
doc.save().fillColor(C.purpleLight).fontSize(22).font("Helvetica-Bold").text('"', MARGIN_L + 14, closeY + 8, { lineBreak: false }).restore();
doc.save().fillColor(C.white).fontSize(11).font("Helvetica-Oblique").text(
  "This is the power of the penny. Small. Consistent. Unstoppable at scale.",
  MARGIN_L + 34, closeY + 14, { width: CONTENT_W - 50, lineBreak: false }
).restore();
doc.save().fillColor(C.purpleLight).fontSize(8).font("Helvetica-Bold").text("— Jorge Ballen", MARGIN_L + 34, closeY + 40).restore();

doc.save().rect(0, doc.page.height - 6, PAGE_W, 6).fill(C.green).restore();
doc.save().fillColor(C.grayText).fontSize(8).font("Helvetica").text("5", PAGE_W / 2, doc.page.height - 24, { align: "center", lineBreak: false }).restore();


// ─── PAGE 6: CONTACT ─────────────────────────────────────────────────────────
doc.addPage({ size: "LETTER", margins: { top: 60, bottom: 60, left: 64, right: 64 } });
doc.save().rect(0, 0, PAGE_W, doc.page.height).fill(C.black).restore();
doc.save().rect(0, 0, PAGE_W, 6).fill(C.green).restore();
doc.save().circle(PAGE_W - 40, doc.page.height / 2, 200).fillOpacity(0.04).fill(C.green).restore();

doc.save().fillColor(C.green).fontSize(9).font("Helvetica-Bold").text("05  /  CONTACT & NEXT STEPS", MARGIN_L, 28).restore();

doc.save().fillColor(C.white).fontSize(36).font("Helvetica-Bold").text("Let's Build This\nTogether.", MARGIN_L, 100, { lineGap: 6 }).restore();
doc.save().fillColor(C.grayText).fontSize(12).font("Helvetica").text(
  "We're ready to move fast. The platform is live, the users are engaged,\nand the model is proven. We just need the right partners in the arena.",
  MARGIN_L, 196, { lineGap: 4 }
).restore();

hline(244, C.gray3);

// Contact cards
const contacts = [
  { role: "Founder & CEO", name: "Jorge Ballen", email: "jorge.ballen@absustaininvest.com" },
  { role: "Operations", name: "Ashley Turner", email: "ashley.turner@absustaininvest.com" },
  { role: "General Support", name: "CashClip Team", email: "support@absustaininvest.com" },
  { role: "Press & PR Inquiries", name: "CashClip PR", email: "supportpr@absustain.com" },
];
contacts.forEach((c, i) => {
  const cy = 264 + i * 64;
  doc.save().roundedRect(MARGIN_L, cy, CONTENT_W, 56, 8).fill(C.gray1).restore();
  doc.save().fillColor(C.green).fontSize(8).font("Helvetica-Bold").text(c.role.toUpperCase(), MARGIN_L + 16, cy + 12).restore();
  doc.save().fillColor(C.white).fontSize(14).font("Helvetica-Bold").text(c.name, MARGIN_L + 16, cy + 26).restore();
  doc.save().fillColor(C.grayText).fontSize(10).font("Helvetica").text(c.email, MARGIN_L + 16, cy + 44).restore();
});

// Web
doc.save().fillColor(C.grayText).fontSize(10).font("Helvetica").text("absustaininvest.com  ·  cash-clip.app", MARGIN_L, 490).restore();

hline(512, C.gray3);

// Disclaimer
doc.save()
  .fillColor(C.gray3)
  .fontSize(7.5)
  .font("Helvetica")
  .text(
    "This document is a confidential draft prepared for prospective business partners and investors of AB Sustainability Investments LLC. It contains forward-looking statements and projections that are subject to change. Investment in financial markets involves risk. CashClip does not provide investment advice. All partnership terms are subject to negotiation and formal agreement. © 2025 AB Sustainability Investments LLC. All rights reserved.",
    MARGIN_L, 524, { width: CONTENT_W, lineGap: 2 }
  )
  .restore();

doc.save().rect(0, doc.page.height - 6, PAGE_W, 6).fill(C.green).restore();
doc.save().fillColor(C.grayText).fontSize(8).font("Helvetica").text("6", PAGE_W / 2, doc.page.height - 24, { align: "center", lineBreak: false }).restore();

doc.end();

stream.on("finish", () => {
  console.log(`✅ PDF written to: ${OUT_PATH}`);
});
stream.on("error", (err) => {
  console.error("❌ Stream error:", err);
  process.exit(1);
});
