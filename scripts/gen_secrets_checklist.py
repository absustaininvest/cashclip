#!/usr/bin/env python3
"""Generate a printable CashClip secrets checklist PDF."""
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable,
)
from reportlab.lib.enums import TA_LEFT

OUT = "exports/CashClip_Secrets_Checklist.pdf"

NAVY = colors.HexColor("#0f2e4a")
GREEN = colors.HexColor("#1b7f4b")
LIGHT = colors.HexColor("#eef3f7")
GREY = colors.HexColor("#5b6b7a")
RED = colors.HexColor("#8a1f1f")

styles = getSampleStyleSheet()
h1 = ParagraphStyle("h1", parent=styles["Title"], textColor=NAVY, fontSize=20, spaceAfter=2)
sub = ParagraphStyle("sub", parent=styles["Normal"], textColor=GREY, fontSize=9.5, spaceAfter=10)
sec = ParagraphStyle("sec", parent=styles["Heading2"], textColor=NAVY, fontSize=12, spaceBefore=10, spaceAfter=4)
cell_name = ParagraphStyle("cn", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9.5, textColor=NAVY, leading=12)
cell_desc = ParagraphStyle("cd", parent=styles["Normal"], fontSize=9, textColor=colors.black, leading=11)
note = ParagraphStyle("note", parent=styles["Normal"], fontSize=8.5, textColor=GREY, leading=12)
note_red = ParagraphStyle("notered", parent=styles["Normal"], fontSize=9, textColor=RED, leading=12)

# (Category, [(name, description), ...])
GROUPS = [
    ("Login & Security  (the heart of it)", [
        ("JWT_ACCESS_SECRET", "Signs login tokens"),
        ("JWT_REFRESH_SECRET", "Keeps people logged in for 30 days"),
        ("ADMIN_TOKEN", "Admin / operator access"),
        ("SESSION_SECRET", "Session cookies"),
        ("DATABASE_URL", "The connection to your database"),
    ]),
    ("Account Seeding / Passwords", [
        ("SEED_PASSWORD_SUPPORT", "Support account password"),
        ("SEED_PASSWORD_CASHCLIP", "CashClip seed account password"),
        ("SEED_PASSWORD_HINT", "Seed password hint"),
    ]),
    ("Email", [
        ("ZOHO_SMTP_PASSWORD", "Sends your OTP codes & support email"),
    ]),
    ("Survey & Offer Partners  (money-earning)", [
        ("CPX_API_KEY", "CPX Research - API key"),
        ("CPX_APP_ID", "CPX Research - app ID"),
        ("CPX_WEBHOOK_SECRET", "CPX Research - webhook validation"),
        ("BITLABS_API_KEY", "BitLabs - API key"),
        ("BITLABS_WEBHOOK_SECRET", "BitLabs - webhook validation"),
    ]),
    ("Payouts", [
        ("PAYPAL_CLIENT_ID", "PayPal - client ID"),
        ("PAYPAL_SECRET", "PayPal - secret"),
        ("PAYPAL_WEBHOOK_ID", "PayPal - webhook ID"),
    ]),
    ("Ads", [
        ("UNITY_ADS_GAME_ID_ANDROID", "Unity Ads - Android game ID"),
        ("UNITY_ADS_GAME_ID_IOS", "Unity Ads - iOS game ID"),
    ]),
    ("App Store / Build  (Expo + Apple)", [
        ("EXPO_TOKLAST", "Expo / EAS build login token"),
        ("APPLE_ASC_ISSUER_ID", "Apple App Store Connect - issuer ID"),
        ("APPLE_ASC_KEY_ID", "Apple App Store Connect - key ID"),
        ("APPLE_ASC_PRIVATE_KEY", "Apple App Store Connect - private key"),
    ]),
]

REMOVED = [
    "INVECE", "RIPRENDERE", "JWT_TRIDENTE", "BRIDGE_INGRID_WICKED",
    "WORKAROUND_CASHCLIP", "WORKAROUND_HINT", "WORKAROUND_SUPPORT",
]

OPTIONAL = [
    ("JWT_ACCESS_SECRET_PREV", "Only needed during key rotation"),
    ("SECRETS_PASSPHRASE", "Only to rotate integration keys from admin panel"),
    ("SEED_ADMIN_PASSWORD", "Only to seed reserved admin accounts"),
    ("GITHUB_PAT", "Only for GitHub automation"),
]


def header_row():
    return [
        Paragraph("<b>#</b>", cell_desc),
        Paragraph("<b>Secret name</b>", cell_desc),
        Paragraph("<b>What it does</b>", cell_desc),
        Paragraph("<b>In app?</b>", cell_desc),
        Paragraph("<b>Updated</b>", cell_desc),
    ]


def build():
    doc = SimpleDocTemplate(
        OUT, pagesize=letter,
        leftMargin=0.6 * inch, rightMargin=0.6 * inch,
        topMargin=0.55 * inch, bottomMargin=0.55 * inch,
        title="CashClip Secrets Checklist",
    )
    story = []
    story.append(Paragraph("CashClip - Secrets Checklist", h1))
    story.append(Paragraph(
        "Keep one of each of these. Tick the box once you've confirmed it in your Secrets panel. "
        "Generated June 1, 2026.", sub))
    story.append(HRFlowable(width="100%", thickness=1.2, color=NAVY, spaceAfter=8))

    col_widths = [0.35 * inch, 2.35 * inch, 2.95 * inch, 0.7 * inch, 0.85 * inch]
    n = 0
    for title, rows in GROUPS:
        story.append(Paragraph(title, sec))
        data = [header_row()]
        for name, desc in rows:
            n += 1
            data.append([
                Paragraph(str(n), cell_desc),
                Paragraph(name, cell_name),
                Paragraph(desc, cell_desc),
                Paragraph("YES", ParagraphStyle("y", parent=cell_desc, textColor=GREEN, fontName="Helvetica-Bold", alignment=1)),
                Paragraph("[      ]", ParagraphStyle("box", parent=cell_desc, fontName="Helvetica", fontSize=12, alignment=1)),
            ])
        t = Table(data, colWidths=col_widths, repeatRows=1)
        ts = TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
            ("LINEBELOW", (0, 0), (-1, 0), 0.8, NAVY),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#c7d2dc")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("ALIGN", (0, 0), (0, -1), "CENTER"),
            ("ALIGN", (3, 0), (4, -1), "CENTER"),
        ])
        # draw an empty square in the "Updated" column for each data row
        for r in range(1, len(data)):
            ts.add("BOX", (4, r), (4, r), 0.0, colors.white)
        t.setStyle(ts)
        # overlay checkbox squares
        story.append(t)
        story.append(Spacer(1, 4))

    story.append(Spacer(1, 6))
    story.append(Paragraph(
        f"Total to keep: <b>{n} secrets</b>.", note))

    story.append(HRFlowable(width="100%", thickness=0.8, color=colors.HexColor("#c7d2dc"), spaceBefore=10, spaceAfter=6))
    story.append(Paragraph("Already removed - the old duplicates (should NOT appear)", sec))
    story.append(Paragraph(
        " &nbsp; ".join("[ &nbsp; ] " + r for r in REMOVED), note_red))
    story.append(Paragraph(
        "If you still see any of these in your panel, tick its box and delete it.", note))

    story.append(Spacer(1, 8))
    story.append(Paragraph("Optional - only if you specifically need them (safe to skip)", sec))
    opt_data = [[Paragraph("<b>Secret</b>", cell_desc), Paragraph("<b>When you'd need it</b>", cell_desc)]]
    for name, desc in OPTIONAL:
        opt_data.append([Paragraph(name, cell_name), Paragraph(desc, cell_desc)])
    ot = Table(opt_data, colWidths=[2.6 * inch, 4.6 * inch])
    ot.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#c7d2dc")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(ot)

    doc.build(story, onFirstPage=_draw_boxes, onLaterPages=_draw_boxes)
    print("wrote", OUT)


# We draw the checkbox squares as an afterthought using canvas callbacks is complex
# with flowable tables; instead embed a unicode box glyph per row.
def _draw_boxes(canvas, doc):
    pass


if __name__ == "__main__":
    build()
