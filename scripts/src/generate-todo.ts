import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

const OUT_DIR = path.resolve("exports");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT_PATH = path.join(OUT_DIR, "CashClip-TodoChecklist.pdf");

const doc = new PDFDocument({
  size: "LETTER",
  margins: { top: 60, bottom: 60, left: 64, right: 64 },
  info: { Title: "CashClip — My Checklist", Author: "Jorge Ballen" },
});

const stream = fs.createWriteStream(OUT_PATH);
doc.pipe(stream);

const PAGE_W = doc.page.width;
const ML = 64;
const MR = 64;
const CW = PAGE_W - ML - MR;
const GREEN = "#00A846";
const BLACK = "#0A0A0A";
const GRAY = "#6B7280";
const LIGHT = "#F3F4F6";
const BORDER = "#E5E7EB";

// ─── WHITE BG ────────────────────────────────────────────────────────────────
doc.save().rect(0, 0, PAGE_W, doc.page.height).fill("#FFFFFF").restore();

// ─── TOP BAR ─────────────────────────────────────────────────────────────────
doc.save().rect(0, 0, PAGE_W, 6).fill(GREEN).restore();

// ─── HEADER ──────────────────────────────────────────────────────────────────
doc.save().fillColor(GREEN).fontSize(8).font("Helvetica-Bold")
  .text("CASHCLIP  ·  AB SUSTAINABILITY INVESTMENTS LLC", ML, 24, { width: CW, align: "center", characterSpacing: 1.5 })
  .restore();

doc.save().fillColor(BLACK).fontSize(26).font("Helvetica-Bold")
  .text("My Checklist.", ML, 44, { width: CW })
  .restore();

doc.save().fillColor(GRAY).fontSize(11).font("Helvetica")
  .text("Every check mark is a step closer. Baby steps. One at a time.", ML, 76, { width: CW })
  .restore();

// ─── MOTTO STRIP ─────────────────────────────────────────────────────────────
const mottoY = 102;
doc.save().roundedRect(ML, mottoY, CW, 28, 6).fill(GREEN + "12").restore();
doc.save().rect(ML, mottoY, 3, 28).fill(GREEN).restore();
doc.save().fillColor(GREEN).fontSize(10).font("Helvetica-Bold")
  .text("BUILD  ·  GROW  ·  SUSTAIN  ·  SUCCEED", ML + 14, mottoY + 9, { width: CW - 14, characterSpacing: 1 })
  .restore();

// ─── DATE LINE ───────────────────────────────────────────────────────────────
const dateY = mottoY + 42;
doc.save().fillColor(GRAY).fontSize(9).font("Helvetica")
  .text(`Started: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, ML, dateY)
  .restore();
doc.save().fillColor(GRAY).fontSize(9).font("Helvetica")
  .text("Completed: ___________________________", ML + CW - 240, dateY)
  .restore();

// ─── DIVIDER ─────────────────────────────────────────────────────────────────
const divY = dateY + 18;
doc.save().moveTo(ML, divY).lineTo(ML + CW, divY).strokeColor(BORDER).lineWidth(1).stroke().restore();

// ─── SECTIONS & ITEMS ────────────────────────────────────────────────────────
type Item = { text: string; sub?: string; urgent?: boolean };
type Section = { title: string; emoji: string; color: string; items: Item[] };

const sections: Section[] = [
  {
    title: "BIG FISH — STARTING NOW",
    emoji: ">",
    color: "#2563EB",
    items: [
      {
        text: "Build the Hub on the website (/sc-portal) — THE BIG FISH",
        sub: "Real AdMob + Unity earnings and live integration status, all in one place. This is what we build first.",
        urgent: true,
      },
      {
        text: "OAuth 2.0 Playground — mint a fresh AdMob refresh token (right AFTER the Hub)",
        sub: "Google's Playground generates a new long-lived token so the Hub's revenue numbers actually load. Do this immediately after the Hub is built.",
      },
      {
        text: "Regenerate the AdMob reporting token + publish the Google OAuth consent screen",
        sub: "The current token dies every 7 days while the consent screen is in 'Testing'. Publishing it stops the expiry. Real ad money is unaffected — this only unblocks the website numbers.",
      },
    ],
  },
  {
    title: "MONEY DISPLAY FIXES",
    emoji: "$",
    color: "#EF4444",
    items: [
      {
        text: 'Ship the Home "fake $0.05" balance fix (OTA to live build 29)',
        sub: "Home credits $0.05 locally per ad watched, so it shows more than the real Wallet. Fix is built & tested.",
        urgent: true,
      },
      {
        text: 'Fix the cents for coins — Chipley\'s fake "+$0.05" popup',
        sub: "Chipley celebrates a made-up dollar amount when an ad finishes. Make him show the REAL server reward (or no number). Bundle this with the Home fix.",
        urgent: true,
      },
      {
        text: "Reseed Project + Customer Care — reset the fake numbers",
        sub: "Wipe the old local/fake balances so every user starts clean on real, server-tracked money.",
      },
    ],
  },
  {
    title: "WORKFLOWS / DASHBOARD",
    emoji: "+",
    color: "#7C3AED",
    items: [
      {
        text: "Production Hub",
        sub: "Operations dashboard for the live app.",
      },
      {
        text: "Integration status board: Expo·Unity / GitHub·Replit / Vexo·Sentry",
        sub: "One panel showing each integration's live connection state at a glance.",
      },
      {
        text: "Re-implement Chipley mascot — voice + more functionality",
        sub: "Needs a NEW App Store build (39+). Chipley's voice is a native module — it CANNOT ride an OTA onto build 29.",
      },
      {
        text: "Remove the 3-hour hold on earnings",
        sub: "Drop the wait before earned points become claimable.",
      },
      {
        text: "Ship small releases every ~2 hours (frequent OTA cadence)",
        sub: "Small, self-contained OTA update groups onto live build 29 — never big bundled packs.",
      },
    ],
  },
  {
    title: "AD PARTNERS — WIRE UP",
    emoji: "$",
    color: GREEN,
    items: [
      {
        text: 'Fix Unity\'s "wrong door" — rebuild the AdMob rewarded mediation group',
        sub: "Delete the dead duplicate group first, then point AdMob at Game ID 6110340 + placement Rewarded_IOs so Unity ads actually fill.",
        urgent: true,
      },
      { text: "TikTok ads", sub: "Add as an ad partner / mediation source." },
      { text: "YouTube", sub: "Add as an ad partner / channel." },
      { text: "Tapjoy", sub: "Offerwall — verify live wiring end-to-end." },
      { text: "ironSource", sub: "Add the AdMob mediation adapter (native — ships in build 39+)." },
      { text: "BitLabs", sub: "Survey partner — verify live wiring end-to-end." },
    ],
  },
  {
    title: "CRITICAL — Do First",
    emoji: "!",
    color: "#EF4444",
    items: [
      {
        text: "Rebuild CashClip via EAS Build with clean credentials",
        sub: "Fixes the Invalid Signature — #1 blocker before resubmitting to Apple",
        urgent: true,
      },
      {
        text: "Validate the new .ipa with Apple Transporter",
        sub: "Run before uploading to App Store Connect",
        urgent: true,
      },
      {
        text: "Audit App Store metadata — swap 'earn money' for 'earn up to'",
        sub: "Check all screenshot captions and description bullets",
        urgent: true,
      },
    ],
  },
  {
    title: "WAITING ON APPLE",
    emoji: "~",
    color: "#F59E0B",
    items: [
      {
        text: "Apple review decision received",
        sub: "Currently 'Waiting for Review' — use the App Store Prep PDF if rejected",
      },
      {
        text: "CashClip approved and live on the App Store",
        sub: "The big one.",
      },
    ],
  },
  {
    title: "REVENUE & PARTNERS",
    emoji: "$",
    color: GREEN,
    items: [
      {
        text: "Apply for Acorns affiliate program",
        sub: "Once approved, wire your affiliate ID into the Invest My Earnings wallet screen",
      },
      {
        text: "Apply for Stash affiliate program",
        sub: "Same integration — affiliate ID goes into wallet screen alongside Acorns",
      },
      {
        text: "Send iBoard partnership pitch to Uber",
        sub: "Point them to /ventures/iboard — the full deck is live",
      },
      {
        text: "Send iBoard partnership pitch to Lyft",
        sub: "Same page, same deck — two separate outreach contacts",
      },
    ],
  },
  {
    title: "GROWTH",
    emoji: "+",
    color: "#7C3AED",
    items: [
      {
        text: "Submit CashClip to Google Play Store",
        sub: "Android build needs its own submission — separate from iOS",
      },
      {
        text: "Post launch script to Instagram",
        sub: "PDF is ready — copy, paste, post the moment Apple approves",
      },
      {
        text: "Post launch script to Facebook",
        sub: "Same script — ready to go",
      },
      {
        text: "Share iBoard ecosystem page with active investors",
        sub: "absustaininvest.com/ventures/iboard",
      },
    ],
  },
];

let y = divY + 16;

function newPage() {
  doc.addPage();
  doc.save().rect(0, 0, PAGE_W, doc.page.height).fill("#FFFFFF").restore();
  doc.save().rect(0, 0, PAGE_W, 6).fill(GREEN).restore();
  y = 48;
}

function ensure(needed: number) {
  if (y + needed > doc.page.height - 56) newPage();
}

for (const section of sections) {
  // Section header
  const headerH = 26;
  ensure(headerH + 8 + 44);
  doc.save().roundedRect(ML, y, CW, headerH, 5).fill(section.color + "15").restore();
  doc.save().rect(ML, y, 3, headerH).fill(section.color).restore();

  // Badge
  const badgeW = 18;
  doc.save().circle(ML + 14, y + headerH / 2, 7).fill(section.color).restore();
  doc.save().fillColor("#FFFFFF").fontSize(8).font("Helvetica-Bold")
    .text(section.emoji, ML + 14 - doc.widthOfString(section.emoji, { fontSize: 8 } as any) / 2, y + headerH / 2 - 4, { lineBreak: false })
    .restore();

  doc.save().fillColor(section.color).fontSize(9).font("Helvetica-Bold")
    .text(section.title, ML + badgeW + 8, y + 9, { width: CW - badgeW - 12, characterSpacing: 1 })
    .restore();

  y += headerH + 8;

  for (const item of section.items) {
    const BOX = 14;
    const textH0 = doc.heightOfString(item.text, { width: CW - BOX - 12, fontSize: 11 } as any);
    const subH0 = item.sub ? doc.heightOfString(item.sub, { width: CW - BOX - 12, fontSize: 9 } as any) : 0;
    ensure(textH0 + subH0 + 20);
    const itemY = y;

    // Checkbox
    doc.save().roundedRect(ML, itemY, BOX, BOX, 2)
      .strokeColor(item.urgent ? "#EF4444" : BORDER).lineWidth(1.5).stroke().restore();

    // Item text
    doc.save().fillColor(BLACK).fontSize(11).font("Helvetica-Bold")
      .text(item.text, ML + BOX + 10, itemY, { width: CW - BOX - 12, lineGap: 2 })
      .restore();

    const textH = doc.heightOfString(item.text, { width: CW - BOX - 12, fontSize: 11 } as any);

    if (item.sub) {
      doc.save().fillColor(GRAY).fontSize(9).font("Helvetica")
        .text(item.sub, ML + BOX + 10, itemY + textH + 2, { width: CW - BOX - 12, lineGap: 2 })
        .restore();
      const subH = doc.heightOfString(item.sub, { width: CW - BOX - 12, fontSize: 9 } as any);
      y += textH + subH + 18;
    } else {
      y += textH + 16;
    }
  }

  y += 8;
}

// ─── NOTES SECTION ───────────────────────────────────────────────────────────
if (y < doc.page.height - 120) {
  doc.save().moveTo(ML, y).lineTo(ML + CW, y).strokeColor(BORDER).lineWidth(1).stroke().restore();
  y += 12;
  doc.save().fillColor(GRAY).fontSize(9).font("Helvetica-Bold")
    .text("NOTES", ML, y, { characterSpacing: 1.5 }).restore();
  y += 16;
  for (let i = 0; i < 4; i++) {
    doc.save().moveTo(ML, y).lineTo(ML + CW, y).strokeColor(LIGHT).lineWidth(1).stroke().restore();
    y += 22;
  }
}

// ─── FOOTER ──────────────────────────────────────────────────────────────────
const footerY = doc.page.height - 38;
doc.save().moveTo(ML, footerY).lineTo(ML + CW, footerY).strokeColor(BORDER).lineWidth(0.5).stroke().restore();
doc.save().fillColor(GRAY).fontSize(8).font("Helvetica")
  .text("Jorge Ballen  ·  AB Sustainability Investments LLC  ·  absustaininvest.com", ML, footerY + 8, { width: CW, align: "center" })
  .restore();

doc.save().rect(0, doc.page.height - 6, PAGE_W, 6).fill(GREEN).restore();

doc.end();
stream.on("finish", () => console.log(`✅ PDF written to: ${OUT_PATH}`));
stream.on("error", (err) => { console.error("❌", err); process.exit(1); });
