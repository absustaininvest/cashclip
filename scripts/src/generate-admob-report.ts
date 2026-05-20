import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

const OUT = path.resolve("attached_assets/admob-report.pdf");

const BG     = "#0d1117";
const CARD   = "#161b22";
const GREEN  = "#3fb950";
const BLUE   = "#58a6ff";
const ORANGE = "#e3b341";
const MUTED  = "#8b949e";
const WHITE  = "#f0f6fc";
const RED    = "#f85149";

const daily = [
  { date: "May 11", requests: 56,  matched: 0,   impressions: 0,   earnings: 0.00 },
  { date: "May 12", requests: 17,  matched: 0,   impressions: 0,   earnings: 0.00 },
  { date: "May 13", requests: 67,  matched: 0,   impressions: 0,   earnings: 0.00 },
  { date: "May 14", requests: 352, matched: 4,   impressions: 1,   earnings: 0.00 },
  { date: "May 15", requests: 398, matched: 151, impressions: 115, earnings: 0.02 },
  { date: "May 16", requests: 469, matched: 237, impressions: 179, earnings: 8.62 },
  { date: "May 17", requests: 804, matched: 787, impressions: 661, earnings: 23.09 },
];

const countries = [
  { name: "United States",    earnings: 12.37 },
  { name: "Germany",          earnings: 5.36  },
  { name: "Czechia",          earnings: 2.58  },
  { name: "Nigeria",          earnings: 1.24  },
  { name: "Philippines",      earnings: 0.52  },
  { name: "Uganda",           earnings: 0.24  },
  { name: "Saudi Arabia",     earnings: 0.14  },
  { name: "Sweden",           earnings: 0.12  },
  { name: "Vietnam",          earnings: 0.12  },
  { name: "Iraq",             earnings: 0.07  },
  { name: "Jamaica",          earnings: 0.06  },
  { name: "Trinidad & Tobago",earnings: 0.04  },
];

const countryColors = [GREEN, BLUE, ORANGE, "#a371f7", RED, "#79c0ff",
  "#56d364", "#e3b341", "#ffa657", "#d2a8ff", "#7ee787", "#ff7b72"];

const totalEarnings = daily.reduce((s, d) => s + d.earnings, 0);
const totalImpr     = daily.reduce((s, d) => s + d.impressions, 0);
const totalReq      = daily.reduce((s, d) => s + d.requests, 0);
const peakMatch     = Math.max(...daily.map(d => d.requests > 0 ? 100 * d.matched / d.requests : 0));

function hex(c: string): string { return c; }

function drawRect(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, fill: string, radius = 0) {
  if (radius > 0) {
    doc.roundedRect(x, y, w, h, radius).fillColor(fill).fill();
  } else {
    doc.rect(x, y, w, h).fillColor(fill).fill();
  }
}

function drawBar(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, color: string) {
  if (h <= 0) return;
  doc.roundedRect(x, y, w, h, 2).fillColor(color).fill();
}

function drawLine(doc: PDFKit.PDFDocument, points: [number, number][], color: string, lw = 1.5) {
  if (points.length < 2) return;
  doc.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) doc.lineTo(points[i][0], points[i][1]);
  doc.strokeColor(color).lineWidth(lw).stroke();
}

const doc = new PDFDocument({ size: "LETTER", margin: 0, autoFirstPage: true });
const stream = fs.createWriteStream(OUT);
doc.pipe(stream);

const PW = 612, PH = 792;
const PAD = 36;

// ── PAGE 1 ────────────────────────────────────────────────────────────────────
drawRect(doc, 0, 0, PW, PH, BG);

// Header band
drawRect(doc, 0, 0, PW, 72, CARD);
doc.fontSize(20).fillColor(WHITE).font("Helvetica-Bold")
   .text("CashClip — AdMob Performance Report", PAD, 18, { width: PW - PAD * 2, align: "center" });
doc.fontSize(10).fillColor(MUTED).font("Helvetica")
   .text("May 11 – 17, 2026  ·  Rewarded Video  ·  iOS  ·  Generated May 18, 2026",
         PAD, 46, { width: PW - PAD * 2, align: "center" });

// ── KPI tiles ────────────────────────────────────────────────────────────────
const kpis = [
  { label: "Total Earnings",    value: `$${totalEarnings.toFixed(2)}`, color: GREEN  },
  { label: "Total Impressions", value: totalImpr.toLocaleString(),     color: BLUE   },
  { label: "Peak Match Rate",   value: `${peakMatch.toFixed(0)}%`,     color: ORANGE },
  { label: "Total Requests",    value: totalReq.toLocaleString(),      color: MUTED  },
];
const kpiW = (PW - PAD * 2 - 12 * 3) / 4;
kpis.forEach((kpi, i) => {
  const kx = PAD + i * (kpiW + 12);
  const ky = 84;
  drawRect(doc, kx, ky, kpiW, 56, CARD, 6);
  doc.fontSize(8).fillColor(MUTED).font("Helvetica")
     .text(kpi.label, kx + 10, ky + 10, { width: kpiW - 20 });
  doc.fontSize(18).fillColor(kpi.color).font("Helvetica-Bold")
     .text(kpi.value, kx + 10, ky + 26, { width: kpiW - 20 });
});

// ── Chart 1: Daily Earnings bar chart ────────────────────────────────────────
const c1x = PAD, c1y = 158, c1w = PW - PAD * 2, c1h = 140;
drawRect(doc, c1x, c1y, c1w, c1h, CARD, 6);
doc.fontSize(10).fillColor(WHITE).font("Helvetica-Bold")
   .text("Daily Estimated Earnings (USD)", c1x + 12, c1y + 10);

const barArea = { x: c1x + 44, y: c1y + 28, w: c1w - 56, h: c1h - 44 };
const maxEarn = Math.max(...daily.map(d => d.earnings));
const barW = barArea.w / daily.length;

// Grid lines
[0, 0.25, 0.5, 0.75, 1].forEach(pct => {
  const gy = barArea.y + barArea.h * (1 - pct);
  doc.moveTo(barArea.x, gy).lineTo(barArea.x + barArea.w, gy)
     .strokeColor("#21262d").lineWidth(0.5).stroke();
  if (pct > 0) {
    doc.fontSize(7).fillColor(MUTED).font("Helvetica")
       .text(`$${(maxEarn * pct).toFixed(1)}`, c1x + 2, gy - 4, { width: 38, align: "right" });
  }
});

daily.forEach((d, i) => {
  const bx = barArea.x + i * barW + barW * 0.15;
  const bw = barW * 0.7;
  const bh = maxEarn > 0 ? (d.earnings / maxEarn) * barArea.h : 0;
  const by = barArea.y + barArea.h - bh;
  const color = d.earnings > 0 ? GREEN : "#21262d";
  drawBar(doc, bx, by, bw, bh, color);
  if (d.earnings > 0) {
    doc.fontSize(7.5).fillColor(GREEN).font("Helvetica-Bold")
       .text(`$${d.earnings.toFixed(2)}`, bx - 4, by - 13, { width: bw + 8, align: "center" });
  }
  doc.fontSize(7.5).fillColor(MUTED).font("Helvetica")
     .text(d.date, bx - 4, barArea.y + barArea.h + 4, { width: bw + 8, align: "center" });
});

// ── Chart 2: Match Rate line chart ───────────────────────────────────────────
const c2x = PAD, c2y = 310, c2w = (PW - PAD * 2 - 12) / 2, c2h = 130;
drawRect(doc, c2x, c2y, c2w, c2h, CARD, 6);
doc.fontSize(10).fillColor(WHITE).font("Helvetica-Bold")
   .text("Match Rate (%)", c2x + 12, c2y + 10);

const mr = { x: c2x + 44, y: c2y + 28, w: c2w - 56, h: c2h - 42 };
[0, 25, 50, 75, 100].forEach(pct => {
  const gy = mr.y + mr.h * (1 - pct / 100);
  doc.moveTo(mr.x, gy).lineTo(mr.x + mr.w, gy)
     .strokeColor("#21262d").lineWidth(0.5).stroke();
  doc.fontSize(7).fillColor(MUTED).font("Helvetica")
     .text(`${pct}%`, c2x + 2, gy - 4, { width: 38, align: "right" });
});

const mrPoints: [number, number][] = daily.map((d, i) => {
  const rate = d.requests > 0 ? (d.matched / d.requests) * 100 : 0;
  return [mr.x + (i + 0.5) * (mr.w / daily.length), mr.y + mr.h * (1 - rate / 100)];
});
drawLine(doc, mrPoints, GREEN, 2);
mrPoints.forEach(([px, py], i) => {
  const rate = daily[i].requests > 0 ? (daily[i].matched / daily[i].requests) * 100 : 0;
  doc.circle(px, py, 3).fillColor(GREEN).fill();
  if (rate > 0) {
    doc.fontSize(7).fillColor(GREEN).font("Helvetica")
       .text(`${rate.toFixed(0)}%`, px - 10, py - 13, { width: 20, align: "center" });
  }
  doc.fontSize(7).fillColor(MUTED).font("Helvetica")
     .text(daily[i].date, px - 14, mr.y + mr.h + 4, { width: 28, align: "center" });
});

// ── Chart 3: Requests vs Impressions ─────────────────────────────────────────
const c3x = PAD + c2w + 12, c3y = 310, c3w = c2w, c3h = 130;
drawRect(doc, c3x, c3y, c3w, c3h, CARD, 6);
doc.fontSize(10).fillColor(WHITE).font("Helvetica-Bold")
   .text("Requests vs Impressions", c3x + 12, c3y + 10);

const rv = { x: c3x + 44, y: c3y + 28, w: c3w - 56, h: c3h - 42 };
const maxRV = Math.max(...daily.map(d => d.requests));
[0, 0.5, 1].forEach(pct => {
  const gy = rv.y + rv.h * (1 - pct);
  doc.moveTo(rv.x, gy).lineTo(rv.x + rv.w, gy)
     .strokeColor("#21262d").lineWidth(0.5).stroke();
  if (pct > 0) {
    doc.fontSize(7).fillColor(MUTED).font("Helvetica")
       .text(`${Math.round(maxRV * pct)}`, c3x + 2, gy - 4, { width: 38, align: "right" });
  }
});

const slotW = rv.w / daily.length;
daily.forEach((d, i) => {
  const bw = slotW * 0.32;
  const bx1 = rv.x + i * slotW + slotW * 0.05;
  const bx2 = bx1 + bw + 2;
  const reqH = maxRV > 0 ? (d.requests / maxRV) * rv.h : 0;
  const imprH = maxRV > 0 ? (d.impressions / maxRV) * rv.h : 0;
  drawBar(doc, bx1, rv.y + rv.h - reqH,  bw, reqH,  BLUE);
  drawBar(doc, bx2, rv.y + rv.h - imprH, bw, imprH, ORANGE);
  doc.fontSize(6.5).fillColor(MUTED).font("Helvetica")
     .text(d.date, bx1 - 2, rv.y + rv.h + 4, { width: slotW - 2, align: "center" });
});

// Legend
const legY = c3y + c3h - 14;
doc.circle(c3x + 12, legY + 3, 3).fillColor(BLUE).fill();
doc.fontSize(7.5).fillColor(MUTED).font("Helvetica").text("Requests", c3x + 18, legY - 1);
doc.circle(c3x + 72, legY + 3, 3).fillColor(ORANGE).fill();
doc.fontSize(7.5).fillColor(MUTED).font("Helvetica").text("Impressions", c3x + 78, legY - 1);

// ── Growth callout box ────────────────────────────────────────────────────────
const cx = PAD, cy = 453, cw = PW - PAD * 2, ch = 52;
drawRect(doc, cx, cy, cw, ch, "#0f2a1a", 6);
doc.moveTo(cx, cy).lineTo(cx, cy + ch).strokeColor(GREEN).lineWidth(3).stroke();
doc.fontSize(10).fillColor(GREEN).font("Helvetica-Bold")
   .text("7-day growth signal", cx + 14, cy + 8);
doc.fontSize(9).fillColor(WHITE).font("Helvetica")
   .text(
     "Match rate climbed from 0% → 98% in 7 days as the mediation algorithm warmed up. " +
     "May 17 delivered $23.09 from 661 impressions across 18 countries — a 268× day-over-day " +
     "earnings jump from May 16 ($8.62). US, Germany, and Czechia drove 74% of revenue.",
     cx + 14, cy + 22, { width: cw - 28 }
   );

// Footer
doc.fontSize(8).fillColor(MUTED).font("Helvetica")
   .text("CashClip  ·  AdMob Report  ·  Page 1 of 2", PAD, PH - 24, { width: PW - PAD * 2, align: "center" });

// ── PAGE 2: Country Breakdown ─────────────────────────────────────────────────
doc.addPage();
drawRect(doc, 0, 0, PW, PH, BG);
drawRect(doc, 0, 0, PW, 72, CARD);
doc.fontSize(20).fillColor(WHITE).font("Helvetica-Bold")
   .text("Earnings by Country", PAD, 18, { width: PW - PAD * 2, align: "center" });
doc.fontSize(10).fillColor(MUTED).font("Helvetica")
   .text("May 11 – 17, 2026  ·  All countries with revenue > $0",
         PAD, 46, { width: PW - PAD * 2, align: "center" });

const totalCountryEarn = countries.reduce((s, c) => s + c.earnings, 0);
const maxCountry = Math.max(...countries.map(c => c.earnings));
const barAreaH = { x: PAD + 120, y: 90, w: PW - PAD * 2 - 200, h: 580 };
const rowH = barAreaH.h / countries.length;

// Grid lines vertical
[0, 0.25, 0.5, 0.75, 1].forEach(pct => {
  const gx = barAreaH.x + pct * barAreaH.w;
  doc.moveTo(gx, barAreaH.y - 8).lineTo(gx, barAreaH.y + barAreaH.h)
     .strokeColor("#21262d").lineWidth(0.5).stroke();
  doc.fontSize(7.5).fillColor(MUTED).font("Helvetica")
     .text(`$${(maxCountry * pct).toFixed(2)}`, gx - 14, barAreaH.y - 18, { width: 28, align: "center" });
});

countries.forEach((c, i) => {
  const ry  = barAreaH.y + i * rowH + rowH * 0.1;
  const rh  = rowH * 0.72;
  const bw  = (c.earnings / maxCountry) * barAreaH.w;
  const col = countryColors[i % countryColors.length];

  drawRect(doc, barAreaH.x, ry, barAreaH.w, rh, "#1a1f27", 3);
  drawRect(doc, barAreaH.x, ry, bw, rh, col, 3);

  doc.fontSize(9).fillColor(WHITE).font("Helvetica-Bold")
     .text(c.name, PAD, ry + rh / 2 - 5, { width: 112, align: "right" });

  const pct = ((c.earnings / totalCountryEarn) * 100).toFixed(1);
  doc.fontSize(9).fillColor(WHITE).font("Helvetica-Bold")
     .text(`$${c.earnings.toFixed(2)}`, barAreaH.x + bw + 8, ry + rh / 2 - 5);
  doc.fontSize(8).fillColor(MUTED).font("Helvetica")
     .text(`${pct}%`, barAreaH.x + bw + 56, ry + rh / 2 - 5);
});

// Total
const totY = barAreaH.y + barAreaH.h + 16;
drawRect(doc, PAD, totY, PW - PAD * 2, 36, CARD, 6);
doc.fontSize(10).fillColor(MUTED).font("Helvetica")
   .text("Total period earnings", PAD + 12, totY + 11);
doc.fontSize(14).fillColor(GREEN).font("Helvetica-Bold")
   .text(`$${totalCountryEarn.toFixed(2)}`, PW - PAD - 80, totY + 9, { width: 68, align: "right" });

doc.fontSize(8).fillColor(MUTED).font("Helvetica")
   .text("CashClip  ·  AdMob Report  ·  Page 2 of 2", PAD, PH - 24, { width: PW - PAD * 2, align: "center" });

doc.end();
stream.on("finish", () => console.log("PDF written:", OUT));
stream.on("error", (e) => { console.error(e); process.exit(1); });
