from __future__ import annotations

from pathlib import Path
import sys

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
SHOT_DIR = ROOT / "tmp" / "ipad-tutorial"
CROP_DIR = ROOT / "tmp" / "ipad-tutorial-crops"
DEFAULT_OUTPUT_PATH = ROOT / "docs" / "ClearSkin-Hub-iPad-Therapist-Workflow-Guide.pdf"

PAGE_WIDTH, PAGE_HEIGHT = letter
MARGIN_X = 0.7 * inch
MARGIN_TOP = 0.7 * inch
MARGIN_BOTTOM = 0.55 * inch
CONTENT_WIDTH = PAGE_WIDTH - (MARGIN_X * 2)

BRAND_BLUE = colors.HexColor("#174c79")
ACCENT_BLUE = colors.HexColor("#57b8e8")
TEXT_COLOR = colors.HexColor("#16324f")
MUTED_TEXT = colors.HexColor("#54708c")
PANEL_FILL = colors.HexColor("#eef6fb")

SCREENSHOT_CROPS: dict[str, tuple[int, int, int, int]] = {
    "01-landing.png": (0, 260, 1668, 1910),
    "03-dashboard.png": (0, 320, 1668, 1920),
    "04-add-patient.png": (0, 560, 1668, 1830),
    "05-patient-detail.png": (0, 1640, 1668, 2388),
    "06-new-consent-intake.png": (0, 520, 1668, 2200),
    "08-consent-review.png": (0, 430, 1668, 2250),
    "10-complete-course-setup.png": (0, 430, 1668, 2170),
    "11-active-course.png": (0, 1320, 1668, 2500),
    "12-course-documents.png": (0, 700, 1668, 2300),
    "13-visit-editor-top.png": (0, 1320, 1668, 3090),
    "14-visit-editor-vitals.png": (0, 1360, 1668, 3520),
    "16-documents-tab.png": (0, 420, 1668, 2000),
}


class GuideDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str):
        frame = Frame(
            MARGIN_X,
            MARGIN_BOTTOM,
            PAGE_WIDTH - (MARGIN_X * 2),
            PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM,
            id="normal",
        )
        super().__init__(
            filename,
            pagesize=letter,
            leftMargin=MARGIN_X,
            rightMargin=MARGIN_X,
            topMargin=MARGIN_TOP,
            bottomMargin=MARGIN_BOTTOM,
            title="ClearSkin Hub iPad Therapist Workflow Guide",
            author="Codex",
        )
        self.addPageTemplates([PageTemplate(id="guide", frames=[frame], onPage=self._draw_page)])

    def _draw_page(self, canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(ACCENT_BLUE)
        canvas.setLineWidth(1)
        canvas.line(MARGIN_X, PAGE_HEIGHT - 0.52 * inch, PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 0.52 * inch)
        canvas.setFont("Helvetica-Bold", 10)
        canvas.setFillColor(BRAND_BLUE)
        canvas.drawString(MARGIN_X, PAGE_HEIGHT - 0.42 * inch, "ClearSkin Hub iPad Workflow Guide")
        canvas.setFont("Helvetica", 9)
        canvas.setFillColor(MUTED_TEXT)
        canvas.drawRightString(PAGE_WIDTH - MARGIN_X, 0.28 * inch, f"Page {doc.page}")
        canvas.drawString(MARGIN_X, 0.28 * inch, "Demo screenshots only. No real patient data.")
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and flowable.style.name == "GuideHeading1":
            self.notify("TOCEntry", (0, flowable.getPlainText(), self.page))


def build_styles():
    sample = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "GuideTitle",
            parent=sample["Title"],
            fontName="Helvetica-Bold",
            fontSize=24,
            leading=30,
            textColor=BRAND_BLUE,
            spaceAfter=12,
        ),
        "subtitle": ParagraphStyle(
            "GuideSubtitle",
            parent=sample["BodyText"],
            fontName="Helvetica",
            fontSize=12.5,
            leading=17,
            textColor=TEXT_COLOR,
            spaceAfter=8,
        ),
        "meta": ParagraphStyle(
            "GuideMeta",
            parent=sample["BodyText"],
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            textColor=MUTED_TEXT,
            spaceAfter=8,
        ),
        "heading1": ParagraphStyle(
            "GuideHeading1",
            parent=sample["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=18,
            leading=22,
            textColor=BRAND_BLUE,
            spaceAfter=10,
            spaceBefore=6,
        ),
        "body": ParagraphStyle(
            "GuideBody",
            parent=sample["BodyText"],
            fontName="Helvetica",
            fontSize=11,
            leading=15,
            textColor=TEXT_COLOR,
            spaceAfter=6,
        ),
        "small": ParagraphStyle(
            "GuideSmall",
            parent=sample["BodyText"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=12,
            textColor=MUTED_TEXT,
            spaceAfter=4,
        ),
        "caption": ParagraphStyle(
            "GuideCaption",
            parent=sample["BodyText"],
            fontName="Helvetica-Oblique",
            fontSize=9.5,
            leading=12,
            alignment=1,
            textColor=MUTED_TEXT,
            spaceBefore=4,
            spaceAfter=8,
        ),
        "toc_title": ParagraphStyle(
            "GuideTocTitle",
            parent=sample["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=19,
            leading=24,
            textColor=BRAND_BLUE,
            spaceAfter=10,
        ),
        "toc_level": ParagraphStyle(
            "GuideTocLevel1",
            fontName="Helvetica",
            fontSize=11,
            leading=14,
            leftIndent=10,
            firstLineIndent=-10,
            textColor=TEXT_COLOR,
        ),
    }


def cropped_image_path(path: Path) -> Path:
    crop_box = SCREENSHOT_CROPS.get(path.name)
    if not crop_box:
        return path

    CROP_DIR.mkdir(parents=True, exist_ok=True)
    target = CROP_DIR / path.name
    with PILImage.open(path) as image:
        left, top, right, bottom = crop_box
        safe_box = (
            max(0, left),
            max(0, top),
            min(image.width, right),
            min(image.height, bottom),
        )
        image.crop(safe_box).save(target)
    return target


def scaled_image(path: Path, max_width: float, max_height: float) -> Image:
    path = cropped_image_path(path)
    with PILImage.open(path) as image:
        width, height = image.size
    scale = min(max_width / width, max_height / height)
    return Image(str(path), width=width * scale, height=height * scale)


def bullet_list(items: list[str], style: ParagraphStyle) -> Table:
    rows = [["•", Paragraph(item, style)] for item in items]
    table = Table(rows, colWidths=[0.2 * inch, CONTENT_WIDTH - (0.2 * inch)])
    table.setStyle(
        TableStyle(
            [
                ("TEXTCOLOR", (0, 0), (0, -1), BRAND_BLUE),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (0, -1), 12),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table


def build_cover(story: list, styles: dict[str, ParagraphStyle]):
    cover_image = scaled_image(SHOT_DIR / "01-landing.png", CONTENT_WIDTH, 6.2 * inch)
    story.extend(
        [
            Spacer(1, 0.25 * inch),
            Paragraph("ClearSkin Hub", styles["title"]),
            Paragraph("iPad Therapist Workflow Guide", styles["subtitle"]),
            Paragraph(
                "A short step-by-step training guide for daily therapist use on iPad, from install to scheduling, consent, sim worksheet, and note generation.",
                styles["body"],
            ),
            Paragraph(
                'Start here on iPad Safari: <link href="https://dermatherapies.vercel.app/"><b><font color="#174c79">https://dermatherapies.vercel.app/</font></b></link>',
                styles["body"],
            ),
            Paragraph(
                "All screenshots in this guide use demo patients created for training. No real PHI is shown.",
                styles["meta"],
            ),
            Spacer(1, 0.1 * inch),
            cover_image,
            Spacer(1, 0.08 * inch),
            Paragraph("Figure: First-time iPad setup screen with Add to Home Screen guidance.", styles["caption"]),
            PageBreak(),
        ]
    )


def build_toc(story: list, styles: dict[str, ParagraphStyle]):
    toc = TableOfContents()
    toc.levelStyles = [styles["toc_level"]]
    story.extend(
        [
            Paragraph("Table of Contents", styles["toc_title"]),
            Paragraph(
                "Use this guide in order the first time, then keep it as a quick reference during daily use.",
                styles["body"],
            ),
            Spacer(1, 0.12 * inch),
            toc,
            PageBreak(),
        ]
    )


def build_section(
    story: list,
    styles: dict[str, ParagraphStyle],
    title: str,
    bullets: list[str],
    image_name: str | None = None,
    caption: str | None = None,
    note: str | None = None,
):
    story.append(Paragraph(title, styles["heading1"]))
    story.append(bullet_list(bullets, styles["body"]))

    if note:
        note_table = Table([[Paragraph(note, styles["small"])]], colWidths=[CONTENT_WIDTH])
        note_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), PANEL_FILL),
                    ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#c7dceb")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 10),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                    ("TOPPADDING", (0, 0), (-1, -1), 7),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ]
            )
        )
        story.extend([note_table, Spacer(1, 0.12 * inch)])

    if image_name:
        story.append(scaled_image(SHOT_DIR / image_name, CONTENT_WIDTH, 5.95 * inch))
        if caption:
            story.append(Paragraph(caption, styles["caption"]))

    story.append(PageBreak())


def build_capabilities_page(story: list, styles: dict[str, ParagraphStyle]):
    story.append(Paragraph("What Therapists Can Do In ClearSkin Hub", styles["heading1"]))
    story.append(
        bullet_list(
            [
                "Create patients, run one-lesion or two-lesion courses, and keep finished history searchable.",
                "Build clinic schedules for sim/consult, treatment, and follow-up visits, either by linked course or manual appointment.",
                "Capture consent, sim worksheet setup, treatment vitals, note text, daily photos, and extra attachments in one chart.",
                "Reopen an old note, correct the structured fields or text, and regenerate the PDF without creating a duplicate visit.",
                "Recover unsaved form work after the iPad has been idle, reloaded, or resumed from the background.",
                "Use iPad-friendly number pads for PINs, dates, blood pressure, lesion size, heart rate, O2 sat, and weight.",
                "Keep all data local to the device or local app storage. The app is designed for local-first use, not cloud workflow.",
            ],
            styles["body"],
        )
    )
    story.append(
        Table(
            [
                [Paragraph("<b>Best daily path</b>", styles["body"])],
                [
                    Paragraph(
                        "Open <b>Schedule</b> for the clinic day, or open <b>Active Patients</b> -> open patient -> use <b>Documents</b> when consent/worksheet needs attention -> tap <b>Start Today’s Note</b> -> save draft or generate PDF.",
                        styles["body"],
                    )
                ],
            ],
            colWidths=[CONTENT_WIDTH],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dceef9")),
                    ("BACKGROUND", (0, 1), (-1, -1), colors.white),
                    ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#c0d8ea")),
                    ("INNERGRID", (0, 0), (-1, -1), 0.8, colors.HexColor("#c0d8ea")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 10),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                    ("TOPPADDING", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ]
            ),
        )
    )


def main():
    styles = build_styles()
    output_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_OUTPUT_PATH
    doc = GuideDocTemplate(str(output_path))
    story: list = []

    build_cover(story, styles)
    build_toc(story, styles)

    build_section(
        story,
        styles,
        "1. Add ClearSkin Hub to the iPad Home Screen",
        [
            "In Safari on the iPad, go to https://dermatherapies.vercel.app/ first.",
            "Open ClearSkin Hub in Safari only.",
            "Tap Share, then View More, then Add to Home Screen before doing first-time setup.",
            "Add it once so the app opens like a full-screen iPad app during daily use.",
            "On first setup, enter the default therapist, supervising physician, office name, and a 4-8 digit PIN.",
        ],
        "01-landing.png",
        "The first setup screen includes the Home Screen install reminder.",
        "After setup, the app shows a recovery code one time only. Write it down and store it offline.",
    )

    build_section(
        story,
        styles,
        "2. Learn the Main Navigation",
        [
            "Schedule opens the weekly calendar for consults, treatments, follow-ups, clinic hours, and closed time.",
            "Active Patients is the day-to-day treatment list for patients currently moving through care.",
            "Completed Patients keeps finished courses easy to reopen and review.",
            "Archive hides inactive patients from the daily list without deleting history.",
            "Consent / Sim Docs is for document-only workflows when you need consent and worksheet handling outside a full active course.",
        ],
        "03-dashboard.png",
        "Main navigation after setup.",
    )

    build_section(
        story,
        styles,
        "3. Use Schedule to Plan Visits",
        [
            "Tap Schedule to view the Monday-Friday clinic week.",
            "Use Previous Week, Current Week, and Next Week to move through the calendar. The week field shows the first and last workday.",
            "Use Clinic Hours to set regular open/close times and add closed office time or holidays.",
            "Tap Add Appointment, or tap a calendar time slot, to add sim/consult, treatment, or follow-up visits.",
            "Manual appointments can be entered without using the patient chart side of the app.",
            "Linked course treatment schedules use projected or prescribed fractions, appointment length, and selected weekdays to create the full treatment schedule automatically.",
            "A time slot can hold up to two appointments. A third overlapping appointment is blocked so the calendar does not get overbooked.",
            "Tap an appointment to start the scheduled note, update the status, or edit the appointment. Drag an appointment when only the date or time needs to change.",
            "Print Schedule is available from the pending course so the patient can receive the calendar before the sim worksheet is completed.",
        ],
        note="When a pending sim/consult appointment is started from the calendar, it can move into the active patient workflow without retyping the intake details.",
    )

    build_section(
        story,
        styles,
        "4. Add a New Patient",
        [
            "Tap Add Patient from Active Patients.",
            "Enter first name, last name, MRN, DOB, and sex.",
            "Use the on-screen number pad for DOB entry on iPad.",
            "Tap Save Patient to open the chart.",
        ],
        "04-add-patient.png",
        "Patient creation modal on iPad.",
    )

    build_section(
        story,
        styles,
        "5. Use the Patient Chart as the Main Record",
        [
            "The patient chart keeps demographics, courses, notes, PDFs, and linked documents together.",
            "Tap Add Course to start a new clinical course.",
            "Tap Edit Patient when demographics need to be corrected.",
            "Archive Patient removes the chart from the active list but keeps the full history available.",
        ],
        "05-patient-detail.png",
        "Newly created patient chart before any course is added.",
    )

    build_section(
        story,
        styles,
        "6. Start with Consent / Path Intake",
        [
            "Use intake to capture what is already known before full treatment setup is finished.",
            "Enter lesion count, biopsy date, sim / consult date, treatment location, diagnosis, ICD10, and projected fractions.",
            "Tap Save Intake to create a pending course.",
            "This keeps the patient moving forward even if final setup details are not ready yet.",
        ],
        "06-new-consent-intake.png",
        "Consent / Path Intake starts the course with only the essentials.",
    )

    build_section(
        story,
        styles,
        "7. Review and Sign Consent",
        [
            "From the pending course, tap Review / Sign Consent.",
            "Read the form, capture the patient signature, then capture the witness signature.",
            "Once saved, the consent PDF stays linked to the course.",
            "If a signed paper form already exists, use Import or Replace instead of re-signing.",
        ],
        "08-consent-review.png",
        "Consent review is step-based so signatures happen in order.",
    )

    build_section(
        story,
        styles,
        "8. Complete Course Setup and Generate the Sim Worksheet",
        [
            "After consent/path intake, tap Complete Course Setup.",
            "Enter the treatment-specific details such as cone, cutout, lesion size, depth, positioning, side, and any setup devices.",
            "Tap Save Course to activate the course.",
            "Saving the completed setup automatically generates the Sim Worksheet.",
        ],
        "10-complete-course-setup.png",
        "The full setup screen finishes the active treatment course.",
    )

    build_section(
        story,
        styles,
        "9. Access Consent and Sim Documents from the Course",
        [
            "On the patient chart, tap Documents on the course row.",
            "Open Consent Form launches the linked signed consent PDF.",
            "Open Sim Worksheet launches the worksheet PDF created during setup.",
            "Re-sign, replace, or regenerate from the same window if details change later.",
            "Generated consent and sim worksheet PDFs open in a preview first so you can confirm the correct form before using the iPad share button to save it.",
            "When saved from the preview, the file name should use the patient name, such as Patient Name - Consent or Patient Name - Sim Worksheet.",
        ],
        "12-course-documents.png",
        "Each course keeps its consent and sim worksheet together.",
    )

    build_section(
        story,
        styles,
        "10. Generate Sim / Consult or Treatment Notes",
        [
            "Tap Start Today’s Note from the active course.",
            "The note screen opens with Visit Details, Note Preview, Save Draft, and Finalize.",
            "Set Visit Type to Sim / Consult or treatment as needed.",
            "Sim / Consult notes include Tx site name, ICD10, Total Fractions, Daily dose, Prescribed dose, Tx depth, Cone size, Cutout flex shield size, and Additional Tx devices.",
            "Daily dose and prescribed dose are filled from the projected or prescribed fraction logic and display in cGy.",
            "Save Draft keeps the note editable. Finalize creates the current PDF output for the visit.",
        ],
        "13-visit-editor-top.png",
        "Visit editor with save actions across the top.",
    )

    build_section(
        story,
        styles,
        "11. Enter Vitals, Photos, and Attachments on iPad",
        [
            "Use the docked number pad for dates, blood pressure, lesion size, heart rate, O2 saturation, weight, and PIN entry.",
            "Units like mm, BPM, %, lbs, and mmHg are added automatically where supported.",
            "Attach daily treatment photos and extra files directly from the visit.",
            "Linked course documents are available lower in the visit so everything stays connected.",
        ],
        "14-visit-editor-vitals.png",
        "The iPad note workflow is optimized for fast number entry and attachment handling.",
    )

    build_section(
        story,
        styles,
        "12. Restore Unsaved Edits After iPad Idle Time",
        [
            "If the iPad has been sitting in the background for a long time, Safari may reload or resume the app in the middle of a workflow.",
            "ClearSkin Hub keeps recovery drafts for major forms, including new/edit patient, course/intake/setup, consent signing, document-only records, and sim worksheet setup.",
            "If unsaved work is found, the app shows an Unsaved Edits Found prompt.",
            "Tap Restore Edits to bring the typed information back into the form.",
            "Tap Discard only when you are sure you no longer need those unsaved edits.",
            "A successful Save, Finalize, or an intentional Cancel clears the recovery draft so it does not keep appearing.",
        ],
        note="Recovery drafts are for typed form information and signatures. Large uploaded files or photos are not stored in recovery drafts to avoid iPad storage issues.",
    )

    build_section(
        story,
        styles,
        "13. Use Active Patients for Daily Treatment",
        [
            "Once the course is active, it shows up in Active Patients with quick actions.",
            "Start Today’s Note opens the next note for the course.",
            "Resume Last Note appears when a draft already exists.",
            "When the course is finished, move it to Completed Patients without losing history.",
        ],
        "11-active-course.png",
        "Active course row after setup is complete.",
    )

    build_section(
        story,
        styles,
        "14. Use the Consent / Sim Docs Tab for Document-Only Work",
        [
            "Use this tab when you need consent and sim worksheet handling without building a full active treatment course first.",
            "Tap Add Patient Info to create a document-only record.",
            "This is useful for early paperwork, standalone documentation, or worksheet prep before the full course is ready.",
            "For active treatment patients, the patient chart remains the best place to manage documents.",
        ],
        "16-documents-tab.png",
        "Document-only workflow starts from the Consent / Sim Docs tab.",
    )

    build_capabilities_page(story, styles)
    doc.multiBuild(story)
    print(output_path)


if __name__ == "__main__":
    main()
