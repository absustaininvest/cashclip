from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, white, black
from reportlab.pdfgen import canvas
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
import os

# Brand colors
BG = HexColor("#06060E")
GREEN = HexColor("#00E676")
WHITE = white
DIM = HexColor("#888888")
DIM2 = HexColor("#555555")
CARD = HexColor("#0F0F1A")
BORDER = HexColor("#1A1A2E")
GOLD = HexColor("#F5A623")

W, H = letter  # 8.5 x 11 inches

def draw_bg(c):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, fill=1, stroke=0)

def draw_header_bar(c, label):
    c.setFillColor(GREEN)
    c.setFont("Helvetica", 7)
    c.drawCentredString(W/2, H - 0.5*inch, label.upper())

def draw_footer(c, doc_name, page_num, total):
    c.setFillColor(DIM2)
    c.setFont("Helvetica", 7)
    c.drawString(0.6*inch, 0.35*inch, f"AB Sustainability Investments LLC — {doc_name} — Confidential")
    c.drawRightString(W - 0.6*inch, 0.35*inch, f"{page_num} / {total}")
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.line(0.6*inch, 0.5*inch, W - 0.6*inch, 0.5*inch)

def draw_section_label(c, text, x, y):
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 7)
    c.drawString(x, y, text.upper())

def draw_card(c, x, y, w, h):
    c.setFillColor(CARD)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.roundRect(x, y, w, h, 6, fill=1, stroke=1)

def draw_status_badge(c, x, y, text, color):
    c.setFillColor(color)
    badge_w = len(text) * 5.5 + 12
    c.roundRect(x, y - 3, badge_w, 14, 4, fill=1, stroke=0)
    c.setFillColor(BG)
    c.setFont("Helvetica-Bold", 7)
    c.drawString(x + 6, y + 1, text)

def wrap_text(c, text, x, y, max_width, font, size, color, line_height=None):
    if line_height is None:
        line_height = size * 1.45
    c.setFillColor(color)
    c.setFont(font, size)
    words = text.split()
    lines = []
    current = []
    for word in words:
        test = ' '.join(current + [word])
        if c.stringWidth(test, font, size) <= max_width:
            current.append(word)
        else:
            if current:
                lines.append(' '.join(current))
            current = [word]
    if current:
        lines.append(' '.join(current))
    for line in lines:
        c.drawString(x, y, line)
        y -= line_height
    return y

# ─────────────────────────────────────────────
# PITCH DECK
# ─────────────────────────────────────────────

def generate_pitch_deck(path):
    c = canvas.Canvas(path, pagesize=letter)
    total = 10

    # ── Page 1: Cover ──
    draw_bg(c)
    # Logo mark
    c.setFillColor(GREEN)
    c.roundRect(0.6*inch, H - 1.1*inch, 0.45*inch, 0.45*inch, 4, fill=1, stroke=0)
    c.setFillColor(BG)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(0.7*inch, H - 0.75*inch, "AB")
    # Company name
    c.setFillColor(WHITE)
    c.setFont("Helvetica", 9)
    c.drawString(1.15*inch, H - 0.75*inch, "AB Sustainability Investments LLC")
    c.setFillColor(DIM)
    c.setFont("Helvetica", 8)
    c.drawString(1.15*inch, H - 0.95*inch, "absustaininvest.com")

    # Center content
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 38)
    c.drawCentredString(W/2, H/2 + 1.5*inch, "One Company.")
    c.setFont("Helvetica-Bold", 38)
    c.drawCentredString(W/2, H/2 + 0.9*inch, "Four Ventures.")
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 38)
    c.drawCentredString(W/2, H/2 + 0.3*inch, "One Vision.")
    c.setFillColor(DIM)
    c.setFont("Helvetica", 11)
    c.drawCentredString(W/2, H/2 - 0.25*inch, "A diversified holding company building the future of")
    c.drawCentredString(W/2, H/2 - 0.5*inch, "AdTech, mobility media, hospitality, and e-commerce.")

    # Divider
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.line(1.5*inch, H/2 - 0.85*inch, W - 1.5*inch, H/2 - 0.85*inch)

    # Metrics
    mx = W/2 - 2*inch
    c.setFillColor(DIM)
    c.setFont("Helvetica", 7)
    c.drawString(mx, H/2 - 1.1*inch, "PRE-MONEY VALUATION")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 20)
    c.drawString(mx, H/2 - 1.45*inch, "$1,000,000")
    mx2 = W/2 + 0.5*inch
    c.setFillColor(DIM)
    c.setFont("Helvetica", 7)
    c.drawString(mx2, H/2 - 1.1*inch, "TARGET RAISE")
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 20)
    c.drawString(mx2, H/2 - 1.45*inch, "$250,000")

    c.setFillColor(DIM)
    c.setFont("Helvetica", 8)
    c.drawCentredString(W/2, H/2 - 1.75*inch, "Seed Round — Equity Model     •     20–25% equity at $1M valuation")

    # Footer contact
    c.setFillColor(DIM2)
    c.setFont("Helvetica", 8)
    c.drawCentredString(W/2, 0.9*inch, "Jorge Ballen — Founder & CEO — jorge.ballen@cash-clip.app")
    c.setFillColor(DIM2)
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(W/2, 0.55*inch, "INVESTOR PITCH DECK  —  SEED ROUND  —  2026")
    c.setFillColor(DIM2)
    c.setFont("Helvetica", 7)
    c.drawCentredString(W/2, 0.35*inch, "CONFIDENTIAL")
    c.showPage()

    # ── Page 2: The Problem ──
    draw_bg(c)
    draw_footer(c, "Investor Pitch Deck", 2, total)
    draw_header_bar(c, "The Problem")

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 28)
    c.drawString(0.6*inch, H - 1.1*inch, "Time. Money. Attention.")
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 28)
    c.drawString(0.6*inch, H - 1.55*inch, "All being wasted.")

    problems = [
        ("Users earn nothing for their time", "People spend hours completing surveys and watching ads — platforms capture 100% of the value. The user sees zero return."),
        ("Drivers are underearned", "28M+ daily US rideshare trips pass with empty headrests — a massive, monetizable surface that Uber and Lyft have left on the table."),
        ("Brands waste billions on bad ads", "Digital ad fraud costs $84B annually. Untargeted, skippable placements produce CPMs with no engagement guarantee and no accountability."),
    ]
    y = H - 2.1*inch
    for title, desc in problems:
        draw_card(c, 0.6*inch, y - 0.9*inch, W - 1.2*inch, 0.95*inch)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(0.9*inch, y - 0.2*inch, title)
        wrap_text(c, desc, 0.9*inch, y - 0.45*inch, W - 1.8*inch, "Helvetica", 9, DIM)
        y -= 1.1*inch
    c.showPage()

    # ── Page 3: Our Solution ──
    draw_bg(c)
    draw_footer(c, "Investor Pitch Deck", 3, total)
    draw_header_bar(c, "Our Solution")

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 28)
    c.drawString(0.6*inch, H - 1.1*inch, "Four Ventures.")
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 28)
    c.drawString(0.6*inch, H - 1.55*inch, "One Ecosystem.")

    ventures = [
        ("MOBILE ADTECH", "CashClip", GREEN, "Mobile rewards app — users earn real cash from surveys, ads, and games. PayPal withdrawals. iOS + Android.", "App Store Review"),
        ("MOBILITY MEDIA", "iBoard", HexColor("#4FC3F7"), "Smart screens in Uber/Lyft — brands pay per impression, drivers earn passively, passengers earn via CashClip.", "Partnership Dev"),
        ("HOSPITALITY", "Solera", GOLD, "Modern restaurant in Lake Worth Beach, FL. Online ordering live. Aged in Tradition. Served with Soul.", "Operating"),
        ("E-COMMERCE", "Online Retail", HexColor("#CE93D8"), "Sustainable consumer goods — Amazon Business + Costco wholesale channels. Direct-to-consumer model.", "2026 Launch"),
    ]
    col_w = (W - 1.4*inch) / 2
    positions = [
        (0.6*inch, H - 2.1*inch),
        (0.6*inch + col_w + 0.2*inch, H - 2.1*inch),
        (0.6*inch, H - 4.0*inch),
        (0.6*inch + col_w + 0.2*inch, H - 4.0*inch),
    ]
    for i, (sector, name, color, desc, status) in enumerate(ventures):
        x, y = positions[i]
        draw_card(c, x, y - 1.4*inch, col_w, 1.5*inch)
        c.setFillColor(color)
        c.setFont("Helvetica-Bold", 7)
        c.drawString(x + 0.2*inch, y - 0.2*inch, sector)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 13)
        c.drawString(x + 0.2*inch, y - 0.45*inch, name)
        wrap_text(c, desc, x + 0.2*inch, y - 0.7*inch, col_w - 0.4*inch, "Helvetica", 8, DIM)
        draw_status_badge(c, x + 0.2*inch, y - 1.3*inch, status, color)
    c.showPage()

    # ── Page 4: CashClip Detail ──
    draw_bg(c)
    draw_footer(c, "Investor Pitch Deck", 4, total)
    draw_header_bar(c, "Venture 1 — CashClip")

    c.setFillColor(DIM)
    c.setFont("Helvetica", 9)
    c.drawString(0.6*inch, H - 0.9*inch, "VENTURE 1 — CASHCLIP")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 26)
    c.drawString(0.6*inch, H - 1.3*inch, "The app that pays you")
    c.setFillColor(GREEN)
    c.drawString(0.6*inch, H - 1.7*inch, "for your attention.")

    metrics = [
        ("$2–8/mo", "Revenue / User"),
        ("PayPal", "Payout Method"),
        ("5+ Active", "Survey Partners"),
        ("iOS + Android", "Platform"),
    ]
    mx = 0.6*inch
    mw = (W - 1.2*inch) / 4
    for val, label in metrics:
        draw_card(c, mx, H - 2.7*inch, mw - 0.1*inch, 0.75*inch)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 14)
        c.drawCentredString(mx + mw/2 - 0.05*inch, H - 2.2*inch, val)
        c.setFillColor(DIM)
        c.setFont("Helvetica", 7)
        c.drawCentredString(mx + mw/2 - 0.05*inch, H - 2.5*inch, label)
        mx += mw

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.6*inch, H - 3.1*inch, "How CashClip makes money:")
    revenue_lines = [
        "30–50% margin on survey and offerwall completions",
        "AdMob ad impression revenue per view",
        "iBoard integration — CashClip IS the passenger reward layer",
        "Referral network — viral growth baked into the reward model",
    ]
    y = H - 3.4*inch
    for line in revenue_lines:
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(0.6*inch, y, "→")
        c.setFillColor(DIM)
        c.setFont("Helvetica", 9)
        c.drawString(0.85*inch, y, line)
        y -= 0.28*inch

    draw_card(c, 0.6*inch, H - 5.1*inch, W - 1.2*inch, 0.75*inch)
    c.setFillColor(DIM)
    c.setFont("Helvetica-Bold", 7)
    c.drawString(0.9*inch, H - 4.55*inch, "BUILD STATUS")
    c.setFillColor(WHITE)
    c.setFont("Helvetica", 9)
    c.drawString(0.9*inch, H - 4.8*inch, "Full iOS app built and submitted to App Store — Build 20. Backend API live on Express +")
    c.drawString(0.9*inch, H - 5.0*inch, "PostgreSQL. PayPal payouts operational. AdMob integrated.")
    c.showPage()

    # ── Page 5: iBoard ──
    draw_bg(c)
    draw_footer(c, "Investor Pitch Deck", 5, total)
    draw_header_bar(c, "Venture 2 — iBoard")

    c.setFillColor(DIM)
    c.setFont("Helvetica", 9)
    c.drawString(0.6*inch, H - 0.9*inch, "VENTURE 2 — iBOARD")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 26)
    c.drawString(0.6*inch, H - 1.3*inch, "The smart screen inside")
    c.setFillColor(HexColor("#4FC3F7"))
    c.drawString(0.6*inch, H - 1.7*inch, "every rideshare.")

    c.setFillColor(DIM)
    c.setFont("Helvetica", 10)
    c.drawString(0.6*inch, H - 2.15*inch, "iBoard turns every Uber and Lyft vehicle into a premium ad surface.")
    c.drawString(0.6*inch, H - 2.4*inch, "Brands pay. Drivers earn. Passengers earn via CashClip. Three sides win.")

    sides = [
        ("BRANDS", HexColor("#4FC3F7"), "$0.08–0.18 CPM", "Route + demographic targeting, real-time dashboard, pay per impression."),
        ("DRIVERS", GREEN, "40% Revenue Share", "Est. $200–600/mo passive income, weekly PayPal payouts, one tablet."),
        ("PASSENGERS", GOLD, "Earn via CashClip", "QR code → CashClip app, 10% revenue shared, real cash withdrawals."),
    ]
    sw = (W - 1.4*inch) / 3
    sx = 0.6*inch
    for label, color, val, desc in sides:
        draw_card(c, sx, H - 4.5*inch, sw - 0.1*inch, 1.7*inch)
        c.setFillColor(color)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(sx + 0.2*inch, H - 2.9*inch, label)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 13)
        c.drawString(sx + 0.2*inch, H - 3.2*inch, val)
        wrap_text(c, desc, sx + 0.2*inch, H - 3.55*inch, sw - 0.45*inch, "Helvetica", 9, DIM)
        sx += sw

    c.showPage()

    # ── Page 6: Solera ──
    draw_bg(c)
    draw_footer(c, "Investor Pitch Deck", 6, total)
    draw_header_bar(c, "Venture 3 — Solera")

    c.setFillColor(DIM)
    c.setFont("Helvetica", 9)
    c.drawString(0.6*inch, H - 0.9*inch, "VENTURE 3 — SOLERA")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 26)
    c.drawString(0.6*inch, H - 1.3*inch, "Where tradition meets")
    c.setFillColor(GOLD)
    c.drawString(0.6*inch, H - 1.7*inch, "modern hospitality.")

    c.setFillColor(DIM)
    c.setFont("Helvetica", 10)
    c.drawString(0.6*inch, H - 2.15*inch, "Solera is a modern restaurant in Lake Worth Beach, FL. Online ordering live.")
    c.drawString(0.6*inch, H - 2.4*inch, "Aged in Tradition. Served with Soul.")

    stats = [("Operating", "Current Status"), ("Lake Worth Beach, FL", "Location"), ("Online Ordering", "Revenue Channel"), ("Full Menu", "Offering")]
    mx = 0.6*inch
    mw = (W - 1.2*inch) / 4
    for val, label in stats:
        draw_card(c, mx, H - 3.5*inch, mw - 0.1*inch, 0.75*inch)
        c.setFillColor(GOLD)
        c.setFont("Helvetica-Bold", 10)
        c.drawCentredString(mx + mw/2 - 0.05*inch, H - 3.0*inch, val)
        c.setFillColor(DIM)
        c.setFont("Helvetica", 7)
        c.drawCentredString(mx + mw/2 - 0.05*inch, H - 3.3*inch, label)
        mx += mw
    c.showPage()

    # ── Page 7: Online Retail ──
    draw_bg(c)
    draw_footer(c, "Investor Pitch Deck", 7, total)
    draw_header_bar(c, "Venture 4 — Online Retail")

    c.setFillColor(DIM)
    c.setFont("Helvetica", 9)
    c.drawString(0.6*inch, H - 0.9*inch, "VENTURE 4 — ONLINE RETAIL")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 26)
    c.drawString(0.6*inch, H - 1.3*inch, "Sustainable consumer goods")
    c.setFillColor(HexColor("#CE93D8"))
    c.drawString(0.6*inch, H - 1.7*inch, "at scale.")

    c.setFillColor(DIM)
    c.setFont("Helvetica", 10)
    c.drawString(0.6*inch, H - 2.15*inch, "Amazon Business + Costco wholesale channels. Direct-to-consumer model.")
    c.drawString(0.6*inch, H - 2.4*inch, "Launching 2026 with CashClip cross-promotion built in.")

    channels = [("Amazon Business", "Primary channel — B2B bulk orders"), ("Costco Wholesale", "Volume distribution"), ("Direct-to-Consumer", "Own platform + CashClip tie-in")]
    y = H - 3.0*inch
    for ch, desc in channels:
        draw_card(c, 0.6*inch, y - 0.55*inch, W - 1.2*inch, 0.6*inch)
        c.setFillColor(HexColor("#CE93D8"))
        c.setFont("Helvetica-Bold", 10)
        c.drawString(0.9*inch, y - 0.15*inch, ch)
        c.setFillColor(DIM)
        c.setFont("Helvetica", 9)
        c.drawString(0.9*inch, y - 0.38*inch, desc)
        y -= 0.75*inch
    c.showPage()

    # ── Page 8: Market Opportunity ──
    draw_bg(c)
    draw_footer(c, "Investor Pitch Deck", 8, total)
    draw_header_bar(c, "Market Opportunity")

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 26)
    c.drawString(0.6*inch, H - 1.1*inch, "A market built for")
    c.setFillColor(GREEN)
    c.drawString(0.6*inch, H - 1.55*inch, "what we are building.")

    markets = [
        ("$500B+", "Global Digital Advertising", "Mobile-first ad spend growing 15% YoY"),
        ("$28M+", "Daily US Rideshare Trips", "Untapped in-vehicle media surface"),
        ("$85B+", "US Casual Dining Market", "Loyalty and digital ordering growing"),
        ("$6T+", "Global E-Commerce", "Sustainable goods commanding premium pricing"),
    ]
    mw = (W - 1.4*inch) / 2
    positions = [
        (0.6*inch, H - 2.0*inch),
        (0.6*inch + mw + 0.2*inch, H - 2.0*inch),
        (0.6*inch, H - 3.9*inch),
        (0.6*inch + mw + 0.2*inch, H - 3.9*inch),
    ]
    for i, (num, label, sub) in enumerate(markets):
        x, y = positions[i]
        draw_card(c, x, y - 1.5*inch, mw, 1.6*inch)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 22)
        c.drawString(x + 0.2*inch, y - 0.4*inch, num)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(x + 0.2*inch, y - 0.7*inch, label)
        c.setFillColor(DIM)
        c.setFont("Helvetica", 8)
        c.drawString(x + 0.2*inch, y - 0.95*inch, sub)
    c.showPage()

    # ── Page 9: Team & Financials ──
    draw_bg(c)
    draw_footer(c, "Investor Pitch Deck", 9, total)
    draw_header_bar(c, "Leadership & Use of Funds")

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 22)
    c.drawString(0.6*inch, H - 1.0*inch, "Leadership")

    team = [
        ("JB", GREEN, "Jorge Ballen", "Founder & CEO", "Entrepreneur and technology builder behind AB Sustainability Investments and CashClip. Leads product development, technology infrastructure, and strategic direction."),
        ("AT", GOLD, "Ashley Turner", "Head of Partnerships & Growth", "Enterprise retail executive — 20+ years, former RVP overseeing $150M+ P&L. US Army Veteran. Leads all partnerships and growth strategy."),
    ]
    tw = (W - 1.4*inch) / 2
    tx = 0.6*inch
    for init, color, name, title, bio in team:
        draw_card(c, tx, H - 2.9*inch, tw - 0.1*inch, 1.6*inch)
        c.setFillColor(color)
        c.setFont("Helvetica-Bold", 14)
        c.drawString(tx + 0.2*inch, H - 1.55*inch, init)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(tx + 0.2*inch, H - 1.85*inch, name)
        c.setFillColor(color)
        c.setFont("Helvetica-Bold", 7)
        c.drawString(tx + 0.2*inch, H - 2.1*inch, title.upper())
        wrap_text(c, bio, tx + 0.2*inch, H - 2.4*inch, tw - 0.45*inch, "Helvetica", 8, DIM)
        tx += tw

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(0.6*inch, H - 3.25*inch, "Use of $250,000 Seed Raise")
    uses = [
        ("Product & Technology", "$80,000", "EAS build pipeline, Android launch, App Store scaling"),
        ("iBoard Pilot (10 vehicles)", "$65,000", "Tablets, app deployment, first brand campaign"),
        ("Marketing & User Acquisition", "$55,000", "ASO, influencer, referral activation"),
        ("Operations & Legal", "$30,000", "Compliance, incorporation costs, accounting"),
        ("Working Capital Reserve", "$20,000", "Runway buffer for first 90 days"),
    ]
    y = H - 3.65*inch
    for use, amt, desc in uses:
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(0.6*inch, y, use)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 9)
        c.drawRightString(W - 0.6*inch, y, amt)
        c.setFillColor(DIM)
        c.setFont("Helvetica", 8)
        c.drawString(0.6*inch, y - 0.2*inch, desc)
        c.setStrokeColor(BORDER)
        c.setLineWidth(0.3)
        c.line(0.6*inch, y - 0.3*inch, W - 0.6*inch, y - 0.3*inch)
        y -= 0.45*inch
    c.showPage()

    # ── Page 10: Closing / Valuation Path ──
    draw_bg(c)
    draw_footer(c, "Investor Pitch Deck", 10, total)
    draw_header_bar(c, "90-Day Valuation Path")

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 24)
    c.drawString(0.6*inch, H - 1.0*inch, "90-Day Valuation Path")

    milestones = [
        ("Today — Seed Round", "$1,000,000", GREEN),
        ("CashClip live + 500 users", "+$500,000", HexColor("#4FC3F7")),
        ("iBoard 10-car pilot", "+$750,000", GOLD),
        ("Solera documented revenue", "+$250,000", HexColor("#CE93D8")),
        ("Projected Round 2 valuation", "$2,500,000", GREEN),
    ]
    y = H - 1.6*inch
    for label, val, color in milestones:
        draw_card(c, 0.6*inch, y - 0.55*inch, W - 1.2*inch, 0.6*inch)
        c.setFillColor(WHITE)
        c.setFont("Helvetica", 10)
        c.drawString(0.9*inch, y - 0.15*inch, label)
        c.setFillColor(color)
        c.setFont("Helvetica-Bold", 12)
        c.drawRightString(W - 0.9*inch, y - 0.15*inch, val)
        y -= 0.72*inch

    # Closing tagline
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(W/2, H - 5.2*inch, '"Transparency first. Every dollar has a milestone."')
    c.setFillColor(DIM)
    c.setFont("Helvetica", 9)
    c.drawCentredString(W/2, H - 5.5*inch, "— Jorge Ballen, Founder & CEO, AB Sustainability Investments LLC")

    # Contact block
    draw_card(c, 0.6*inch, 0.9*inch, W - 1.2*inch, 1.4*inch)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.9*inch, 2.0*inch, "Jorge Ballen")
    c.setFillColor(DIM)
    c.setFont("Helvetica", 9)
    c.drawString(0.9*inch, 1.75*inch, "Business Development — ashley.turner@cash-clip.app")
    links = [
        ("Corporate Website", "absustaininvest.com"),
        ("Investor Page", "absustaininvest.com/investors"),
        ("iBoard Partnership", "absustaininvest.com/ventures/iboard"),
        ("CashClip", "cash-clip.app"),
    ]
    lx = 0.9*inch
    lw = (W - 1.8*inch) / 4
    for label, url in links:
        c.setFillColor(DIM2)
        c.setFont("Helvetica", 7)
        c.drawString(lx, 1.45*inch, label)
        c.setFillColor(GREEN)
        c.setFont("Helvetica", 8)
        c.drawString(lx, 1.25*inch, url)
        lx += lw
    c.showPage()

    c.save()
    print(f"Pitch deck saved: {path}")


# ─────────────────────────────────────────────
# CORPORATE ROADMAP
# ─────────────────────────────────────────────

def generate_roadmap(path):
    c = canvas.Canvas(path, pagesize=letter)
    total = 7

    # ── Page 1: Cover ──
    draw_bg(c)
    c.setFillColor(GREEN)
    c.roundRect(0.6*inch, H - 1.1*inch, 0.45*inch, 0.45*inch, 4, fill=1, stroke=0)
    c.setFillColor(BG)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(0.7*inch, H - 0.75*inch, "AB")
    c.setFillColor(WHITE)
    c.setFont("Helvetica", 9)
    c.drawString(1.15*inch, H - 0.75*inch, "AB Sustainability Investments LLC")
    c.setFillColor(DIM)
    c.setFont("Helvetica", 8)
    c.drawString(1.15*inch, H - 0.95*inch, "absustaininvest.com")

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 36)
    c.drawCentredString(W/2, H/2 + 1.3*inch, "Four Ventures.")
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 36)
    c.drawCentredString(W/2, H/2 + 0.65*inch, "One Blueprint.")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 36)
    c.drawCentredString(W/2, H/2 + 0.0*inch, "Real Results.")

    c.setFillColor(DIM)
    c.setFont("Helvetica", 11)
    c.drawCentredString(W/2, H/2 - 0.55*inch, "A diversified holding company across AdTech, mobility media,")
    c.drawCentredString(W/2, H/2 - 0.8*inch, "hospitality, and e-commerce — built for profitability, scale, and community impact.")

    statuses = [("CashClip", "App Store Review", GREEN), ("iBoard", "Partnership Dev", HexColor("#4FC3F7")), ("Solera", "Operating", GOLD), ("Online Retail", "2026 Launch", HexColor("#CE93D8"))]
    sx = 0.6*inch
    sw = (W - 1.2*inch) / 4
    for name, status, color in statuses:
        c.setFillColor(color)
        c.setFont("Helvetica-Bold", 9)
        c.drawCentredString(sx + sw/2, H/2 - 1.3*inch, name)
        c.setFillColor(DIM2)
        c.setFont("Helvetica", 7)
        c.drawCentredString(sx + sw/2, H/2 - 1.55*inch, status)
        sx += sw

    c.setFillColor(DIM2)
    c.setFont("Helvetica", 8)
    c.drawCentredString(W/2, 0.9*inch, "Jorge Ballen — Founder & CEO — jorge.ballen@cash-clip.app")
    c.setFillColor(DIM2)
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(W/2, 0.55*inch, "CORPORATE ROADMAP  —  2026–2028")
    c.setFillColor(DIM2)
    c.setFont("Helvetica", 7)
    c.drawCentredString(W/2, 0.35*inch, "CONFIDENTIAL")
    c.showPage()

    # ── Page 2: Company Overview ──
    draw_bg(c)
    draw_footer(c, "Corporate Roadmap 2026–2028", 2, total)
    draw_header_bar(c, "Company Overview")

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 26)
    c.drawString(0.6*inch, H - 1.0*inch, "Who we are and")
    c.setFillColor(GREEN)
    c.drawString(0.6*inch, H - 1.45*inch, "where we are going.")

    desc = ("AB Sustainability Investments LLC is a Georgia-based holding company founded by Jorge Ballen. "
            "We build, operate, and invest in ventures that create value for underserved communities — "
            "putting cash in users' hands, income in drivers' pockets, and great food on people's tables.")
    y = wrap_text(c, desc, 0.6*inch, H - 2.0*inch, W - 1.2*inch, "Helvetica", 10, DIM, line_height=16)

    values = [
        ("Community First", "Every product we build puts real money into real people's hands. Not points. Not credits. Cash."),
        ("Accountability", "We operate with full transparency. Our valuation is backed by replacement cost, live assets, and documented business activity."),
        ("Vertical Diversification", "Four revenue streams across digital, physical, and mobility sectors reduces concentration risk."),
        ("Execution Over Perfection", "We ship, iterate, and improve in public. CashClip is live. Solera is open. iBoard is next."),
    ]
    y -= 0.3*inch
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(0.6*inch, y, "Core Values")
    y -= 0.35*inch
    for title, body in values:
        draw_card(c, 0.6*inch, y - 0.65*inch, W - 1.2*inch, 0.7*inch)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(0.9*inch, y - 0.15*inch, title)
        wrap_text(c, body, 0.9*inch, y - 0.38*inch, W - 1.8*inch, "Helvetica", 8, DIM)
        y -= 0.82*inch

    c.setFillColor(BORDER)
    c.rect(0.6*inch, 0.65*inch, W - 1.2*inch, 0.45*inch, fill=1, stroke=0)
    c.setFillColor(DIM)
    c.setFont("Helvetica", 7)
    c.drawString(0.9*inch, 0.82*inch, "AB Sustainability Investments LLC  |  State of Georgia  |  Founder: Jorge Ballen  |  absustaininvest.com  |  jorge.ballen@cash-clip.app")
    c.showPage()

    # ── Page 3: CashClip ──
    draw_bg(c)
    draw_footer(c, "Corporate Roadmap 2026–2028", 3, total)
    draw_header_bar(c, "Venture 1 — CashClip")

    c.setFillColor(DIM)
    c.setFont("Helvetica", 9)
    c.drawString(0.6*inch, H - 0.9*inch, "VENTURE 1")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 24)
    c.drawString(0.6*inch, H - 1.3*inch, "Mobile rewards app.")
    c.setFillColor(GREEN)
    c.drawString(0.6*inch, H - 1.7*inch, "Pay people for their attention.")

    c.setFillColor(DIM)
    c.setFont("Helvetica", 10)
    c.drawString(0.6*inch, H - 2.15*inch, "CashClip is an iOS and Android app where users earn real cash by completing surveys,")
    c.drawString(0.6*inch, H - 2.4*inch, "watching videos, playing games, and completing brand offers. Earnings withdrawn via PayPal.")

    milestones = [
        ("DONE", GREEN, "Full app built — iOS + Android", "Expo SDK 54, Express API, PostgreSQL, PayPal payouts, AdMob, 5+ survey partners"),
        ("DONE", GREEN, "Build 20 submitted to App Store", "Apple Team FAX932PG78, Bundle: app.replit.cashclip, cert expires May 2027"),
        ("IN REVIEW", HexColor("#4FC3F7"), "App Store approval pending", "Under active review by Apple"),
        ("Q3 2026", GOLD, "Android launch on Google Play", "EAS production build + Play Console submission"),
        ("Q3 2026", GOLD, "First 500 active users", "ASO, influencer seeding, referral loop activation"),
        ("Q4 2026", HexColor("#CE93D8"), "5,000 active users", "Paid acquisition + iBoard cross-promotion + viral referral"),
    ]
    y = H - 2.85*inch
    for status, color, title, desc in milestones:
        draw_card(c, 0.6*inch, y - 0.6*inch, W - 1.2*inch, 0.65*inch)
        draw_status_badge(c, 0.85*inch, y - 0.18*inch, status, color)
        badge_w = len(status) * 5.5 + 18
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(0.85*inch + badge_w + 0.1*inch, y - 0.15*inch, title)
        c.setFillColor(DIM)
        c.setFont("Helvetica", 8)
        c.drawString(0.85*inch, y - 0.42*inch, desc)
        y -= 0.77*inch
    c.showPage()

    # ── Page 4: iBoard ──
    draw_bg(c)
    draw_footer(c, "Corporate Roadmap 2026–2028", 4, total)
    draw_header_bar(c, "Venture 2 — iBoard")

    c.setFillColor(DIM)
    c.setFont("Helvetica", 9)
    c.drawString(0.6*inch, H - 0.9*inch, "VENTURE 2")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 24)
    c.drawString(0.6*inch, H - 1.3*inch, "Smart screens inside")
    c.setFillColor(HexColor("#4FC3F7"))
    c.drawString(0.6*inch, H - 1.7*inch, "every rideshare.")

    sides = [
        ("BRANDS", HexColor("#4FC3F7"), "Pay per impression", "$0.08–0.18 CPM, route + demographic targeting, real-time dashboard"),
        ("DRIVERS", GREEN, "40% ad revenue share", "$200–600/mo passive income, weekly PayPal payouts, one tablet"),
        ("PASSENGERS", GOLD, "Earn via CashClip", "QR code → CashClip app, 10% revenue shared, real cash withdrawals"),
    ]
    sw = (W - 1.4*inch) / 3
    sx = 0.6*inch
    for label, color, val, desc in sides:
        draw_card(c, sx, H - 3.5*inch, sw - 0.1*inch, 1.5*inch)
        c.setFillColor(color)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(sx + 0.2*inch, H - 2.2*inch, label)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(sx + 0.2*inch, H - 2.5*inch, val)
        wrap_text(c, desc, sx + 0.2*inch, H - 2.8*inch, sw - 0.45*inch, "Helvetica", 8, DIM)
        sx += sw

    milestones = [
        ("Q3 2026", GOLD, "Driver outreach campaign", "Social media + Facebook groups targeting Uber/Lyft drivers in South Florida"),
        ("Q3 2026", GOLD, "10-car pilot launch", "Tablet procurement, iBoard app deployment, first brand campaign sold"),
        ("Q4 2026", HexColor("#CE93D8"), "50-car expansion", "South Florida network — $10K–30K monthly ad revenue"),
        ("2027", GREEN, "Multi-city rollout", "Atlanta, Miami, Orlando — national brand contracts"),
    ]
    y = H - 3.85*inch
    for status, color, title, desc in milestones:
        draw_card(c, 0.6*inch, y - 0.6*inch, W - 1.2*inch, 0.65*inch)
        draw_status_badge(c, 0.85*inch, y - 0.18*inch, status, color)
        badge_w = len(status) * 5.5 + 18
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(0.85*inch + badge_w + 0.1*inch, y - 0.15*inch, title)
        c.setFillColor(DIM)
        c.setFont("Helvetica", 8)
        c.drawString(0.85*inch, y - 0.42*inch, desc)
        y -= 0.77*inch
    c.showPage()

    # ── Page 5: Solera ──
    draw_bg(c)
    draw_footer(c, "Corporate Roadmap 2026–2028", 5, total)
    draw_header_bar(c, "Venture 3 — Solera")

    c.setFillColor(DIM)
    c.setFont("Helvetica", 9)
    c.drawString(0.6*inch, H - 0.9*inch, "VENTURE 3")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 24)
    c.drawString(0.6*inch, H - 1.3*inch, "Modern hospitality.")
    c.setFillColor(GOLD)
    c.drawString(0.6*inch, H - 1.7*inch, "Aged in tradition. Served with soul.")

    c.setFillColor(DIM)
    c.setFont("Helvetica", 10)
    c.drawString(0.6*inch, H - 2.15*inch, "Solera is a modern restaurant operating in Lake Worth Beach, FL.")
    c.drawString(0.6*inch, H - 2.4*inch, "Online ordering live. Full menu operational.")

    milestones = [
        ("DONE", GOLD, "Restaurant operating", "Lake Worth Beach, FL — online ordering live via Square"),
        ("Q3 2026", GOLD, "CashClip loyalty integration", "Diners earn CashClip rewards — cross-promotional loop"),
        ("Q4 2026", HexColor("#CE93D8"), "Revenue documentation", "12-month P&L prepared for institutional investors"),
        ("2027", GREEN, "Second location evaluation", "Expansion pending Q4 2026 performance review"),
    ]
    y = H - 3.0*inch
    for status, color, title, desc in milestones:
        draw_card(c, 0.6*inch, y - 0.6*inch, W - 1.2*inch, 0.65*inch)
        draw_status_badge(c, 0.85*inch, y - 0.18*inch, status, color)
        badge_w = len(status) * 5.5 + 18
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(0.85*inch + badge_w + 0.1*inch, y - 0.15*inch, title)
        c.setFillColor(DIM)
        c.setFont("Helvetica", 8)
        c.drawString(0.85*inch, y - 0.42*inch, desc)
        y -= 0.77*inch
    c.showPage()

    # ── Page 6: Online Retail + Financial ──
    draw_bg(c)
    draw_footer(c, "Corporate Roadmap 2026–2028", 6, total)
    draw_header_bar(c, "Venture 4 + Financial Outlook")

    c.setFillColor(DIM)
    c.setFont("Helvetica", 9)
    c.drawString(0.6*inch, H - 0.9*inch, "VENTURE 4")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(0.6*inch, H - 1.3*inch, "Online Retail")
    c.setFillColor(HexColor("#CE93D8"))
    c.setFont("Helvetica-Bold", 18)
    c.drawString(0.6*inch, H - 1.65*inch, "Sustainable goods at scale.")

    c.setFillColor(DIM)
    c.setFont("Helvetica", 9)
    c.drawString(0.6*inch, H - 2.05*inch, "Amazon Business + Costco wholesale + direct-to-consumer. Launching 2026.")

    milestones_r = [
        ("Q3 2026", HexColor("#CE93D8"), "Product sourcing finalized", "Supplier contracts signed, first SKUs selected"),
        ("Q4 2026", HexColor("#CE93D8"), "Amazon Business launch", "First listings live, CashClip cross-promotion"),
    ]
    y = H - 2.55*inch
    for status, color, title, desc in milestones_r:
        draw_card(c, 0.6*inch, y - 0.6*inch, W - 1.2*inch, 0.65*inch)
        draw_status_badge(c, 0.85*inch, y - 0.18*inch, status, color)
        badge_w = len(status) * 5.5 + 18
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(0.85*inch + badge_w + 0.1*inch, y - 0.15*inch, title)
        c.setFillColor(DIM)
        c.setFont("Helvetica", 8)
        c.drawString(0.85*inch, y - 0.42*inch, desc)
        y -= 0.77*inch

    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.line(0.6*inch, y - 0.1*inch, W - 0.6*inch, y - 0.1*inch)
    y -= 0.35*inch

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(0.6*inch, y, "90-Day Financial Milestones")
    y -= 0.35*inch

    fin = [
        ("Today", "$1,000,000", "Seed round valuation — live assets, operating ventures", GREEN),
        ("CashClip 500 users", "+$500,000", "App Store live + user growth verified", HexColor("#4FC3F7")),
        ("iBoard 10-car pilot", "+$750,000", "First brand revenue + driver payouts running", GOLD),
        ("Solera documented revenue", "+$250,000", "12-month P&L complete", HexColor("#CE93D8")),
        ("Round 2 target", "$2,500,000", "Institutional round — all four ventures active", GREEN),
    ]
    for label, amt, desc, color in fin:
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(0.6*inch, y, label)
        c.setFillColor(color)
        c.setFont("Helvetica-Bold", 10)
        c.drawRightString(W - 0.6*inch, y, amt)
        c.setFillColor(DIM)
        c.setFont("Helvetica", 8)
        c.drawString(0.6*inch, y - 0.2*inch, desc)
        c.setStrokeColor(BORDER)
        c.setLineWidth(0.3)
        c.line(0.6*inch, y - 0.3*inch, W - 0.6*inch, y - 0.3*inch)
        y -= 0.45*inch
    c.showPage()

    # ── Page 7: Leadership & Contact ──
    draw_bg(c)
    draw_footer(c, "Corporate Roadmap 2026–2028", 7, total)
    draw_header_bar(c, "Leadership & Contact")

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 26)
    c.drawString(0.6*inch, H - 1.0*inch, "The people behind")
    c.setFillColor(GREEN)
    c.drawString(0.6*inch, H - 1.45*inch, "the results.")

    team = [
        ("JB", GREEN, "Jorge Ballen", "Founder & CEO",
         "Visionary behind CashClip, iBoard, Solera, and Online Retail. Leads product strategy, fundraising, "
         "and company direction. Hands-on builder with a disciplined, execution-first approach to growing each venture."),
        ("AT", GOLD, "Ashley Turner", "Head of Business Development",
         "Enterprise retail executive with 20+ years of progressive leadership. Former RVP overseeing $150M+ P&L "
         "and 1,200+ employees. US Army Veteran. Primary point of contact for all external inquiries."),
    ]
    tw = (W - 1.4*inch) / 2
    tx = 0.6*inch
    for init, color, name, title, bio in team:
        draw_card(c, tx, H - 4.1*inch, tw - 0.1*inch, 2.35*inch)
        c.setFillColor(color)
        c.setFont("Helvetica-Bold", 18)
        c.drawString(tx + 0.25*inch, H - 2.05*inch, init)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 12)
        c.drawString(tx + 0.25*inch, H - 2.35*inch, name)
        c.setFillColor(color)
        c.setFont("Helvetica-Bold", 7)
        c.drawString(tx + 0.25*inch, H - 2.6*inch, title.upper())
        wrap_text(c, bio, tx + 0.25*inch, H - 2.9*inch, tw - 0.5*inch, "Helvetica", 8, DIM)
        tx += tw

    draw_section_label(c, "Contact & Links", 0.6*inch, H - 4.45*inch)
    links = [
        ("Corporate Website", "absustaininvest.com"),
        ("Investor Page", "absustaininvest.com/investors"),
        ("iBoard Partnership", "absustaininvest.com/ventures/iboard"),
        ("Email", "ashley.turner@cash-clip.app"),
        ("CashClip", "cash-clip.app"),
        ("Solera Orders", "solera-restaurant.square.site"),
    ]
    lx = 0.6*inch
    lw = (W - 1.2*inch) / 3
    row = 0
    for i, (label, url) in enumerate(links):
        col = i % 3
        r = i // 3
        x = 0.6*inch + col * lw
        y_pos = H - 4.85*inch - r * 0.45*inch
        c.setFillColor(DIM2)
        c.setFont("Helvetica", 7)
        c.drawString(x, y_pos, label)
        c.setFillColor(GREEN)
        c.setFont("Helvetica", 9)
        c.drawString(x, y_pos - 0.18*inch, url)

    # Closing tagline
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 13)
    c.drawCentredString(W/2, 1.5*inch, '"Transparency first. Every dollar has a milestone."')
    c.setFillColor(DIM)
    c.setFont("Helvetica", 9)
    c.drawCentredString(W/2, 1.2*inch, "— Jorge Ballen, Founder & CEO")
    c.showPage()

    c.save()
    print(f"Roadmap saved: {path}")


if __name__ == "__main__":
    os.makedirs("exports", exist_ok=True)
    generate_pitch_deck("exports/AB_Sustainability_Investments_Pitch_Deck.pdf")
    generate_roadmap("exports/AB_Sustainability_Investments_Corporate_Roadmap.pdf")
    print("Both PDFs generated successfully.")
