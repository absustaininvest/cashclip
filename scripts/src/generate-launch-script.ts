import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

const OUT_DIR = path.resolve("exports");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT_PATH = path.join(OUT_DIR, "CashClip-LaunchScript.pdf");

const doc = new PDFDocument({
  size: "LETTER",
  margins: { top: 72, bottom: 72, left: 80, right: 80 },
  info: {
    Title: "CashClip — Launch Script",
    Author: "Jorge Ballen",
  },
});

const stream = fs.createWriteStream(OUT_PATH);
doc.pipe(stream);

const PAGE_W = doc.page.width;
const MARGIN_L = 80;
const MARGIN_R = 80;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

// ─── BACKGROUND ──────────────────────────────────────────────────────────────
doc.save().rect(0, 0, PAGE_W, doc.page.height).fill("#FFFFFF").restore();
doc.save().rect(0, 0, PAGE_W, 5).fill("#00C853").restore();
doc.save().rect(0, doc.page.height - 5, PAGE_W, 5).fill("#00C853").restore();

// ─── LABEL ───────────────────────────────────────────────────────────────────
doc.save()
  .fillColor("#00C853")
  .fontSize(8)
  .font("Helvetica-Bold")
  .text("CASHCLIP  ·  LAUNCH ANNOUNCEMENT", MARGIN_L, 40, {
    width: CONTENT_W,
    align: "center",
    characterSpacing: 2,
  })
  .restore();

// ─── DIVIDER ─────────────────────────────────────────────────────────────────
doc.save()
  .moveTo(MARGIN_L, 55)
  .lineTo(MARGIN_L + CONTENT_W, 55)
  .strokeColor("#00C853")
  .lineWidth(0.5)
  .strokeOpacity(0.4)
  .stroke()
  .restore();

// ─── SCRIPT BODY ─────────────────────────────────────────────────────────────
const lines: Array<{ text: string; style: "heading" | "body" | "bold" | "motto" | "cta" | "spacer" }> = [
  { text: "Today is a day I'll never forget.", style: "heading" },
  { text: "", style: "spacer" },
  { text: "CashClip is officially live.", style: "bold" },
  { text: "", style: "spacer" },
  {
    text: "But before you download it, I want you to know why I built it.",
    style: "body",
  },
  { text: "", style: "spacer" },
  {
    text: "I built it for the person who takes Uber to work every day because they can't afford a car yet. I built it for the single mom stretching every dollar. I built it for anyone who ever felt like the system wasn't built for them — because honestly, most of the time it wasn't.",
    style: "body",
  },
  { text: "", style: "spacer" },
  {
    text: "Here's how it works — and I promise it's not complicated.",
    style: "bold",
  },
  { text: "", style: "spacer" },
  {
    text: "You scroll your phone anyway. You watch videos anyway. You fill out the occasional survey anyway. CashClip just makes sure that time puts something back in your pocket. Real cash. Not points, not gift cards — actual money that lands in your PayPal. And when that little balance starts growing and you feel ready, you invest it. For the first time ever. Without touching a single dollar of your own.",
    style: "body",
  },
  { text: "", style: "spacer" },
  {
    text: "Baby steps. Little by little.",
    style: "motto",
  },
  {
    text: "Build, Grow, Sustain, Succeed.",
    style: "motto",
  },
  { text: "", style: "spacer" },
  {
    text: "I'm not doing this for fame. I'm not doing this to get rich. I'm doing this because I genuinely believe every single person deserves a fair shot at a better future — even if it starts with one penny.",
    style: "body",
  },
  { text: "", style: "spacer" },
  {
    text: "Download CashClip. Tell someone who needs it. Let's build together.",
    style: "cta",
  },
];

let y = 80;

for (const line of lines) {
  if (line.style === "spacer") {
    y += 14;
    continue;
  }

  if (line.style === "heading") {
    doc.save()
      .fillColor("#0A0A0A")
      .fontSize(22)
      .font("Helvetica-Bold")
      .text(line.text, MARGIN_L, y, { width: CONTENT_W, lineGap: 4 })
      .restore();
    y = doc.y + 4;
    continue;
  }

  if (line.style === "bold") {
    doc.save()
      .fillColor("#0A0A0A")
      .fontSize(13)
      .font("Helvetica-Bold")
      .text(line.text, MARGIN_L, y, { width: CONTENT_W, lineGap: 4 })
      .restore();
    y = doc.y + 4;
    continue;
  }

  if (line.style === "body") {
    doc.save()
      .fillColor("#3A3A3A")
      .fontSize(12.5)
      .font("Helvetica")
      .text(line.text, MARGIN_L, y, { width: CONTENT_W, lineGap: 5 })
      .restore();
    y = doc.y + 4;
    continue;
  }

  if (line.style === "motto") {
    doc.save()
      .fillColor("#00A846")
      .fontSize(13)
      .font("Helvetica-Bold")
      .text(line.text, MARGIN_L, y, { width: CONTENT_W, lineGap: 4 })
      .restore();
    y = doc.y + 2;
    continue;
  }

  if (line.style === "cta") {
    doc.save()
      .fillColor("#0A0A0A")
      .fontSize(13.5)
      .font("Helvetica-Bold")
      .text(line.text, MARGIN_L, y, { width: CONTENT_W, lineGap: 4 })
      .restore();
    y = doc.y + 4;
    continue;
  }
}

// ─── BOTTOM DIVIDER + NOTE ────────────────────────────────────────────────────
const bottomY = doc.page.height - 48;
doc.save()
  .moveTo(MARGIN_L, bottomY)
  .lineTo(MARGIN_L + CONTENT_W, bottomY)
  .strokeColor("#00E676")
  .lineWidth(0.5)
  .strokeOpacity(0.2)
  .stroke()
  .restore();

doc.save()
  .fillColor("#AAAAAA")
  .fontSize(8)
  .font("Helvetica")
  .text(
    "Personal · Not for distribution · CashClip by AB Sustainability Investments LLC",
    MARGIN_L,
    bottomY + 10,
    { width: CONTENT_W, align: "center" }
  )
  .restore();

doc.end();
stream.on("finish", () => console.log(`✅ PDF written to: ${OUT_PATH}`));
stream.on("error", (err) => { console.error("❌", err); process.exit(1); });
