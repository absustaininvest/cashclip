#!/usr/bin/env python3
"""Generate a printable CashClip Go-Live Revenue Checklist PDF."""
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable,
)

OUT = "exports/CashClip_GoLive_Revenue_Checklist.pdf"

NAVY = colors.HexColor("#0f2e4a")
GREEN = colors.HexColor("#1b7f4b")
AMBER = colors.HexColor("#b8860b")
RED = colors.HexColor("#8a1f1f")
LIGHT = colors.HexColor("#eef3f7")
GREY = colors.HexColor("#5b6b7a")
GRID = colors.HexColor("#c7d2dc")

styles = getSampleStyleSheet()
h1 = ParagraphStyle("h1", parent=styles["Title"], textColor=NAVY, fontSize=20, spaceAfter=2)
sub = ParagraphStyle("sub", parent=styles["Normal"], textColor=GREY, fontSize=9.5, spaceAfter=8)
sec = ParagraphStyle("sec", parent=styles["Heading2"], textColor=NAVY, fontSize=12, spaceBefore=10, spaceAfter=4)
cell_name = ParagraphStyle("cn", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9.5, textColor=NAVY, leading=12)
cell_desc = ParagraphStyle("cd", parent=styles["Normal"], fontSize=9, textColor=colors.black, leading=11)
note = ParagraphStyle("note", parent=styles["Normal"], fontSize=8.5, textColor=GREY, leading=12)

STATUS_COLOR = {"LIVE": GREEN, "ATTENTION": AMBER, "OFF": RED}


def status_para(s):
    label = {"LIVE": "LIVE", "ATTENTION": "ATTENTION", "OFF": "OFF"}[s]
    return Paragraph(
        f'<b>{label}</b>',
        ParagraphStyle("st", parent=cell_desc, textColor=STATUS_COLOR[s],
                       fontName="Helvetica-Bold", alignment=1, fontSize=9),
    )


# (Section title, [(pipe, status, what it needs), ...])
GROUPS = [
    ("Ads  (your bidding stack)", [
        ("Google AdMob", "LIVE", "ADMOB_APP_ID is set. Primary ad network."),
        ("Unity Ads", "LIVE", "iOS + Android Game IDs set. Bids against AdMob to push your rate up."),
        ("ironSource", "OFF", "Needs IRONSOURCE_APP_KEY. (You're reaching out.) Extra ad mediation."),
    ]),
    ("Surveys", [
        ("CPX Research", "ATTENTION", "Keys set; crediting TESTED OK. Confirm the postback URL is set in your CPX dashboard."),
        ("BitLabs", "ATTENTION", "Keys set; crediting TESTED OK. Confirm the postback URL is set in your BitLabs dashboard."),
        ("Cint", "OFF", "Needs CINT_API_KEY + CINT_WEBHOOK_SECRET. 3-5 day approval. (You have the contact.)"),
        ("Pollfish", "OFF", "Needs POLLFISH_API_KEY + POLLFISH_WEBHOOK_SECRET."),
        ("Lucid", "OFF", "Needs LUCID_API_KEY + LUCID_WEBHOOK_SECRET."),
    ]),
    ("Offerwalls  (your highest-margin pipe - all off)", [
        ("Tapjoy", "OFF", "Needs TAPJOY_SDK_KEY (pull offers) + TAPJOY_WEBHOOK_SECRET (credit users). You're getting this."),
        ("AdGate Media", "OFF", "Needs ADGATE_API_KEY + ADGATE_WEBHOOK_SECRET."),
        ("OfferToro", "OFF", "Needs OFFERTORO_API_KEY + OFFERTORO_WEBHOOK_SECRET."),
        ("Lootably", "OFF", "Needs LOOTABLY_API_KEY (+ webhook secret)."),
        ("Adjoe", "OFF", "Needs ADJOE_SDK_KEY + ADJOE_APP_ID."),
    ]),
    ("Affiliate / Invest  (your 'lure & profit' pipes)", [
        ("Acorns", "OFF", "Needs ACORNS_AFFILIATE_ID. Apply at acorns.com/affiliates. ~$5-$10 per new account."),
        ("Stash Invest", "OFF", "Needs STASH_AFFILIATE_ID. Email partnerships@stash.com. ~$5-$15 per new account."),
    ]),
    ("Payments  (the payout pipe)", [
        ("PayPal Payouts", "ATTENTION", "Keys set but in SANDBOX mode. Needs LIVE Business credentials before real withdrawals work."),
    ]),
]


def header_row():
    return [
        Paragraph("<b>Pipe</b>", cell_desc),
        Paragraph("<b>Status</b>", ParagraphStyle("hc", parent=cell_desc, alignment=1)),
        Paragraph("<b>What it needs to go live</b>", cell_desc),
        Paragraph("<b>Done</b>", ParagraphStyle("hc2", parent=cell_desc, alignment=1)),
    ]


def build():
    doc = SimpleDocTemplate(
        OUT, pagesize=letter,
        leftMargin=0.6 * inch, rightMargin=0.6 * inch,
        topMargin=0.55 * inch, bottomMargin=0.55 * inch,
        title="CashClip Go-Live Revenue Checklist",
    )
    story = []
    story.append(Paragraph("CashClip - Go-Live Revenue Checklist", h1))
    story.append(Paragraph(
        "Every revenue pipe, its current status, and exactly what it needs to start earning. "
        "Generated June 1, 2026.", sub))
    # Legend
    legend = Table([[
        Paragraph('<b>LIVE</b> = serving now', ParagraphStyle("lg", parent=note, textColor=GREEN)),
        Paragraph('<b>ATTENTION</b> = on, needs a step', ParagraphStyle("la", parent=note, textColor=AMBER)),
        Paragraph('<b>OFF</b> = needs keys', ParagraphStyle("lo", parent=note, textColor=RED)),
    ]], colWidths=[2.3 * inch, 2.7 * inch, 2.2 * inch])
    legend.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0)]))
    story.append(legend)
    story.append(HRFlowable(width="100%", thickness=1.2, color=NAVY, spaceBefore=6, spaceAfter=4))

    col_widths = [1.5 * inch, 0.9 * inch, 4.2 * inch, 0.6 * inch]
    counts = {"LIVE": 0, "ATTENTION": 0, "OFF": 0}
    for title, rows in GROUPS:
        story.append(Paragraph(title, sec))
        data = [header_row()]
        for pipe, st, needs in rows:
            counts[st] += 1
            data.append([
                Paragraph(pipe, cell_name),
                status_para(st),
                Paragraph(needs, cell_desc),
                Paragraph("[    ]", ParagraphStyle("box", parent=cell_desc, alignment=1, fontSize=11)),
            ])
        t = Table(data, colWidths=col_widths, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
            ("LINEBELOW", (0, 0), (-1, 0), 0.8, NAVY),
            ("GRID", (0, 0), (-1, -1), 0.4, GRID),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("ALIGN", (1, 0), (1, -1), "CENTER"),
            ("ALIGN", (3, 0), (3, -1), "CENTER"),
        ]))
        story.append(t)
        story.append(Spacer(1, 4))

    story.append(Spacer(1, 4))
    story.append(Paragraph(
        f"Snapshot: <b><font color='#1b7f4b'>{counts['LIVE']} live</font></b> &nbsp;|&nbsp; "
        f"<b><font color='#b8860b'>{counts['ATTENTION']} need a step</font></b> &nbsp;|&nbsp; "
        f"<b><font color='#8a1f1f'>{counts['OFF']} off</font></b>.", note))

    story.append(HRFlowable(width="100%", thickness=0.8, color=GRID, spaceBefore=10, spaceAfter=6))
    story.append(Paragraph("Postback (callback) URLs to set in each provider dashboard", sec))
    story.append(Paragraph(
        "CPX: &nbsp; https://api.cash-clip.app/api/surveys/webhook/cpx", cell_desc))
    story.append(Paragraph(
        "BitLabs: &nbsp; https://api.cash-clip.app/api/surveys/webhook/bitlabs", cell_desc))

    story.append(Spacer(1, 8))
    story.append(Paragraph("Two things to remember", sec))
    story.append(Paragraph(
        "1. Every survey & offerwall pipe needs TWO secrets: an API KEY (to fetch offers) AND a "
        "separate WEBHOOK SECRET (to credit users when they finish). Miss the webhook secret and "
        "offers show but never pay out.", cell_desc))
    story.append(Spacer(1, 3))
    story.append(Paragraph(
        "2. Biggest unlock right now: turn on one offerwall (Tapjoy) + get PayPal live. That "
        "completes the full earn-to-payout loop with real margin.", cell_desc))

    doc.build(story)
    print("wrote", OUT)


if __name__ == "__main__":
    build()
