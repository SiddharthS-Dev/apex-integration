"""Builds docs/reference/APEX_Product_Overview.xlsx in the Apex palette.

Same sheet structure as the IVEOS reference workbook: Overview, Features & Benefits,
Competitor Comparison, Unique Selling Points, Pricing, Notes. Inputs are blue; everything
else that can be calculated is a live formula.

    python "docs/reference/apex-source/build_xlsx.py"
"""
from pathlib import Path

from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

OUT = Path(__file__).resolve().parent.parent / "APEX_Product_Overview.xlsx"

# Apex palette (apex/public/index.html, logo.svg)
NAVY, INK, MUTED = "0B1530", "0F172A", "5B6B85"
CYAN, PURPLE = "0891B2", "7C3AED"
TINT, CYAN_TINT = "EEF3FB", "ECFEFF"
INPUT = "0000FF"  # blue = editable input, by spreadsheet convention
FONT = "Inter"

thin = Side(style="thin", color="DBE3F0")
BORDER = Border(bottom=thin)
WRAP = Alignment(wrap_text=True, vertical="top")
HEAD_FILL = PatternFill("solid", fgColor=NAVY)
APEX_FILL = PatternFill("solid", fgColor=CYAN_TINT)


def font(**kw):
    return Font(name=FONT, **{"size": 10, "color": INK, **kw})


def title(ws, text, sub, sub_color=MUTED, sub_bold=False):
    ws["A1"] = text
    ws["A1"].font = font(size=16, bold=True, color=NAVY)
    ws["A2"] = sub
    ws["A2"].font = font(size=10, color=sub_color, bold=sub_bold)
    ws.sheet_view.showGridLines = False


def header(ws, row, labels):
    for i, label in enumerate(labels, 1):
        c = ws.cell(row, i, label)
        c.font = font(size=11, bold=True, color="FFFFFF")
        c.fill = HEAD_FILL
        c.alignment = Alignment(wrap_text=True, vertical="center")
    ws.row_dimensions[row].height = 30


def body(ws, row, values, bold_first=True):
    for i, v in enumerate(values, 1):
        c = ws.cell(row, i, v)
        c.font = font(bold=bold_first and i == 1)
        c.alignment = WRAP
        c.border = BORDER


def widths(ws, **w):
    for col, width in w.items():
        ws.column_dimensions[col].width = width


wb = Workbook()

# ------------------------------------------------------------------ Overview
ws = wb.active
ws.title = "Overview"
title(ws, "APEX — Product Overview", "Inspironics · Prepared 13 November 2026")
rows = [
    ("Product name", "Apex — Inspironics Apex"),
    ("Company", "Inspironics"),
    ("Delivery model", "Self-hosted; subscription per organisation"),
    ("Products behind the front door", "Innovation Showcase · SlidesVault · Inspironics Academia"),
    ("Description", "Apex brings an innovation showcase, a presentation library and an engineering academy behind one "
                    "sign-in. People sign in once, see which products are ready, and move between them at one address, "
                    "while every file stays in the organisation's own Dropbox."),
    ("Value statement", "One front door to your organisation's knowledge: show it, find it, learn it and certify it."),
]
for r, (k, v) in enumerate(rows, 4):
    a, b = ws.cell(r, 1, k), ws.cell(r, 2, v)
    a.font, a.fill = font(size=11, bold=True, color=NAVY), PatternFill("solid", fgColor=CYAN_TINT)
    b.font, b.alignment = font(size=11), WRAP
    a.alignment = Alignment(vertical="top")
ws.row_dimensions[8].height = 46

ws["A11"] = "Headline figures"
ws["A11"].font = font(size=12, bold=True, color=NAVY)
header(ws, 12, ["Figure", "Value"])
figures = [
    ("Products behind one sign-in", 3, True),
    ("Integrated capabilities", "=COUNTA('Features & Benefits'!A5:A100)", False),
    ("Unique selling points", "=COUNTA('Unique Selling Points'!B5:B100)", False),
    ("Subscription plans", '=COUNTIF(Pricing!B5:B20,"Subscription")', False),
    ("Automated tests passing at the last full run", 567, True),
    ("Curated solution blueprints in the Showcase", 235, True),
    ("Apex coverage of the comparison capabilities", "='Competitor Comparison'!B17", False),
]
for r, (k, v, is_input) in enumerate(figures, 13):
    body(ws, r, [k, v], bold_first=False)
    ws.cell(r, 2).alignment = Alignment(horizontal="left", vertical="top")
    if is_input:
        ws.cell(r, 2).font = font(color=INPUT)
ws.cell(19, 2).number_format = "0%"

ws["A21"] = "Sheets in this workbook"
ws["A21"].font = font(size=12, bold=True, color=NAVY)
for r, name in enumerate(["Features & Benefits", "Competitor Comparison", "Unique Selling Points", "Pricing", "Notes"], 22):
    c = ws.cell(r, 1, name)
    c.hyperlink = f"#'{name}'!A1"
    c.font = font(size=11, color=CYAN, underline="single")
widths(ws, A=44, B=95)

# --------------------------------------------------------- Features & Benefits
ws = wb.create_sheet("Features & Benefits")
title(ws, "Features & Benefits", "Each product keeps its own data and session; Apex joins them so they work as one.")
header(ws, 4, ["Feature", "Product", "What it does", "Customer benefit"])
features = [
    ("Apex Front Door", "Gateway", "One sign-in and one sign-out for every product, with each product's session kept separate", "No more separate logins or forgotten sessions"),
    ("Live Status Dashboard", "Gateway", "Product cards showing Ready, Starting or Offline, live totals and recent sync activity", "People know what is available before they click"),
    ("Cross-product Search", "Gateway", "One search box for platforms, pages, presentations and courses", "Find anything without knowing where it lives"),
    ("Innovation Showcase", "Showcase", "Curated gallery of 235 solution blueprints with search, filters, lightbox and Daily Spotlight", "The portfolio is always ready to present"),
    ("3D Ecosystem Explorer", "Showcase", "Explorable 3D model of industry zones and the sense–connect–model–decide stack, linked to the gallery", "A memorable way for clients to explore the offer"),
    ("Deck Library & Viewer", "SlidesVault", "Ranked search, domain and tag filters, in-app viewer with page bookmarks and related decks", "The right deck in seconds"),
    ("Offline Reading", "SlidesVault", "Installable web app; saved decks open without a connection and are cleared at sign-out", "Present anywhere, even without a network"),
    ("Playbook to Course", "Academia", "Playbooks become modules and lessons traced to their source chapters; AI drafts content, a quality check flags weak lessons, people approve", "Courses in days instead of months, with nothing unreviewed"),
    ("Tests & Certificates", "Academia", "Lesson quizzes, chapter tests and final tests graded on the server; certificates with a public verification link", "Results and certificates that can be trusted"),
    ("Retention & Recertification", "Academia", "Spaced-repetition flashcards; re-certification when a playbook changes materially or a certificate expires", "Knowledge stays current as practice changes"),
    ("Meetings to Actions", "Academia", "Teams, VTT or text transcripts become decisions, owned action items with reminders, and slide briefings", "Meetings that move work forward"),
    ("AI Studio & Spend Controls", "Academia", "Content, voice-over and narrated slide videos, with daily, monthly and render limits checked before each paid call", "AI output with a predictable bill"),
    ("Analytics & Reports", "All products", "Views, downloads and reading time; monthly PDF report; completion dashboards; compliance CSV export", "See what people actually use and learn"),
    ("Dropbox-native, Self-hosted", "Platform", "Files stay in Dropbox and are fetched only by Apex's servers with encrypted tokens; runs on the organisation's own machine", "Your storage, your servers, no new file silo"),
]
for r, row in enumerate(features, 5):
    body(ws, r, row)
    ws.cell(r, 2).font = font(color=CYAN, bold=True)
ws.freeze_panes = "A5"
widths(ws, A=28, B=14, C=70, D=46)

# ------------------------------------------------------- Competitor Comparison
ws = wb.create_sheet("Competitor Comparison")
title(ws, "Competitor Comparison", "Category-level view. Verify against each vendor's current offering before external use.")
header(ws, 4, [
    "Capability", "Apex",
    "Sales-content hubs\n(Showpad, Seismic, Highspot)",
    "Employee intranets\n(SharePoint, Unily, Staffbase)",
    "Brand asset libraries\n(Bynder, Brandfolder, Frontify)",
    "Learning platforms\n(Docebo, TalentLMS, 360Learning)",
])
ws.row_dimensions[4].height = 46
ws.cell(4, 2).fill = PatternFill("solid", fgColor=CYAN)
cmp_rows = [
    ("One sign-in across several apps", "Yes", "No", "Yes", "No", "No"),
    ("Presentation library and viewer", "Yes", "Yes", "Limited", "Limited", "No"),
    ("Innovation / solution showcase", "Yes", "Limited", "Limited", "Yes", "No"),
    ("Playbook-to-course with AI drafting", "Yes", "Coaching content", "No", "No", "Yes"),
    ("Server-graded tests and verifiable certificates", "Yes", "Limited", "No", "No", "Yes"),
    ("Re-certification when the source changes", "Yes", "No", "No", "No", "Time-based"),
    ("Meetings to action items", "Yes", "No", "No", "No", "No"),
    ("Dropbox stays the source of truth", "Yes", "Connector", "Connector", "Connector", "No"),
    ("Self-hosted, light footprint", "Yes", "No", "Limited (SharePoint Server)", "No", "No"),
    ("Native mobile apps and CRM integrations", "No", "Yes", "Yes", "Limited", "Yes"),
]
for r, row in enumerate(cmp_rows, 5):
    body(ws, r, row)
    for c in range(2, 7):
        ws.cell(r, c).alignment = Alignment(horizontal="center", vertical="top", wrap_text=True)
    ws.cell(r, 2).fill = APEX_FILL
last = 4 + len(cmp_rows)
rng = f"B5:F{last}"
ws.conditional_formatting.add(rng, FormulaRule(formula=['LEFT(B5,3)="Yes"'], font=Font(name=FONT, color="047857", bold=True)))
ws.conditional_formatting.add(rng, FormulaRule(formula=['B5="No"'], font=Font(name=FONT, color="94A3B8")))
ws.conditional_formatting.add(rng, FormulaRule(formula=['AND(B5<>"No",LEFT(B5,3)<>"Yes")'], font=Font(name=FONT, color="B45309")))

summary = last + 2  # row 16 = count of Yes, row 17 = coverage
labels = ["Capabilities fully covered (count of Yes)", "Coverage of the capability list"]
for i, label in enumerate(labels):
    r = summary + i
    ws.cell(r, 1, label).font = font(bold=True, color=NAVY)
    for c in range(2, 7):
        col = chr(64 + c)
        f = f'=COUNTIF({col}5:{col}{last},"Yes*")' if i == 0 else f"={col}{summary}/COUNTA($A$5:$A${last})"
        cell = ws.cell(r, c, f)
        cell.font = font(bold=c == 2)
        cell.alignment = Alignment(horizontal="center")
        if i == 1:
            cell.number_format = "0%"
    ws.cell(r, 2).fill = APEX_FILL
ws.cell(summary + 3, 1, "Legend: Yes = full capability · Limited / Partial / Connector / Time-based = partial · No = not offered. "
        "Edit any cell; the coverage rows recalculate.").font = font(size=9, color=MUTED)
ws.cell(summary + 4, 1, "Apex's Dropbox connection has been tested against a simulated Dropbox; the first live sync is pending.").font = font(size=9, color=MUTED)
ws.freeze_panes = "B5"
widths(ws, A=46, B=12, C=22, D=22, E=22, F=22)

# ------------------------------------------------------- Unique Selling Points
ws = wb.create_sheet("Unique Selling Points")
title(ws, "Unique Selling Points", "What makes Apex different, strongest first.")
header(ws, 4, ["#", "Selling point", "Why it matters"])
usps = [
    ("Three products, one front door", "A showcase, a deck library and an academy behind one sign-in and one sign-out, at one address, with live status for each. Point tools keep these apart."),
    ("Playbooks become certified skills", "Playbook to course to test to certificate in one flow, with re-certification triggered when the playbook itself changes."),
    ("Tests learners cannot game", "Every quiz and test is graded on the server, answers never reach the browser, and anyone can verify a certificate from its link."),
    ("Your files stay in your Dropbox", "Apex's servers fetch and check every file; the browser never contacts Dropbox, and access tokens are encrypted."),
    ("AI drafts, people decide", "AI is optional and budget-capped; generated lessons pass an automatic quality check and a human approval before learners see them."),
    ("Light and self-hosted", "A zero-dependency gateway starts the whole stack with one command and stays closed to the network unless opened on purpose."),
    ("Tested before it ships", "567 automated tests, server-side access checks on every change, and zero open dependency advisories."),
]
for r, (point, why) in enumerate(usps, 5):
    body(ws, r, [r - 4, point, why], bold_first=False)
    ws.cell(r, 1).alignment = Alignment(horizontal="center", vertical="top")
    ws.cell(r, 1).font = font(bold=True, color=PURPLE)
    ws.cell(r, 2).font = font(bold=True)
widths(ws, A=5, B=34, C=100)

# ------------------------------------------------------------------- Pricing
ws = wb.create_sheet("Pricing")
title(ws, "Project Price (USD)",
      "INDICATIVE — proposal not yet approved by Inspironics. Blue cells are inputs; black cells are formulas.",
      sub_color="B91C1C", sub_bold=True)
header(ws, 4, ["Plan", "Type", "Intended for", "Included users", "Monthly price ($)",
               "Annual list price ($)", "Annual price with discount ($)", "Effective monthly on annual ($)"])
USD = '$#,##0;($#,##0);-'
plans = [
    ("Team", "One department or a small innovation team", "Up to 25", 750),
    ("Business", "Organisations rolling out playbooks and certification", "Up to 150", 2000),
    ("Enterprise", "Large or multi-site organisations (custom quote; price shown is the starting point)", "Unlimited", 5000),
]
for r, (plan, who, users, price) in enumerate(plans, 5):
    body(ws, r, [plan, "Subscription", who, users, price, f"=E{r}*12", f"=F{r}*(1-$B$13)", f"=G{r}/12"])
    ws.cell(r, 5).font = font(color=INPUT)
    for c in range(5, 9):
        ws.cell(r, c).number_format = USD

ws["A10"] = "One-time and billing terms"
ws["A10"].font = font(size=12, bold=True, color=NAVY)
terms = [
    ("Onboarding fee — low ($)", 4000, USD, "Installation, Dropbox connection, playbook import, training; depends on content volume"),
    ("Onboarding fee — high ($)", 12000, USD, "Upper end for large playbook libraries and several Dropbox folders"),
    ("Annual billing discount", 0.15, "0.0%", "Applied to annual list price in column G"),
]
for r, (k, v, fmt, note) in enumerate(terms, 11):
    ws.cell(r, 1, k).font = font(bold=True)
    c = ws.cell(r, 2, v)
    c.font, c.number_format = font(color=INPUT), fmt
    ws.cell(r, 3, note).font = font(color=MUTED)

ws["A15"] = "First-year cost per customer (subscription on annual billing + onboarding)"
ws["A15"].font = font(size=12, bold=True, color=NAVY)
for i, label in enumerate(["Plan", "With low onboarding ($)", "With high onboarding ($)"], 1):
    c = ws.cell(16, i, label)
    c.font, c.fill = font(size=11, bold=True, color="FFFFFF"), HEAD_FILL
for r, src in zip(range(17, 20), range(5, 8)):
    body(ws, r, [f"=A{src}", f"=G{src}+$B$11", f"=G{src}+$B$12"])
    for c in (2, 3):
        ws.cell(r, c).number_format = USD
ws["A21"] = ("Source: indicative proposal drafted for this overview; no prices exist in the Apex project files. "
             "Confirm with Inspironics management before submission.")
ws["A21"].font = font(color="A3460A")
ws.freeze_panes = "A5"
widths(ws, A=30, B=26, C=48, D=16, E=17, F=19, G=22, H=22)

# --------------------------------------------------------------------- Notes
ws = wb.create_sheet("Notes")
title(ws, "Notes and checks before submission", "Source for all content: docs/APEX_BROCHURE_INPUT_PACK.md")
header(ws, 4, ["Item", "Status"])
notes = [
    ("Pricing is an indicative proposal; confirm with Inspironics management", "Open"),
    ("Competitor comparison is category-level from general positioning; verify each vendor's current offering", "Open"),
    ("Dropbox connection tested against a simulated Dropbox only; complete a live sync before claiming it in sales material", "Open"),
    ("Decide one external name for Academia (Inspironics Academia / Engineering Academy / Inspironics Learn)", "Open"),
    ("Rename demo people and seed content before using any screenshot externally", "Open"),
    ("Feature, USP and description content is taken from the Apex repository (commit 403c989) and its audit report", "Done"),
    ("Test count (567) from docs/architecture/APEX_FULL_AUDIT_REPORT.md section K", "Done"),
]
for r, (item, status) in enumerate(notes, 5):
    body(ws, r, [item, status])
    ws.cell(r, 2).font = font(bold=True, color="047857" if status == "Done" else "B45309")
widths(ws, A=100, B=12)

wb.save(OUT)
print("Saved", OUT)
