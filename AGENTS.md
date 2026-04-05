# AGENTS.md

## Project Mission

Build a production-quality, local-first radiation treatment note application for single-site clinical use. The MVP must run locally without cloud dependencies, protect patient information, preserve treatment history, and generate editable/regeneratable PDFs from site-neutral templates derived from the provided source forms.

## Product Rules

- The application is local-first. No cloud sync, shared backend, telemetry, analytics, or external AI calls are enabled in the MVP.
- The application uses a single site-local database and app-controlled local file storage for photos and PDFs.
- The MVP supports a maximum of two treatment sites per course.
- Patient face photos are for identification in the app only and must never be embedded in generated note PDFs.
- Daily treatment photos belong to a visit note and must be appended to the generated PDF.
- Completed courses and archived patients remain searchable and viewable in history, but should not appear in the active workflow by default.
- Template wording is editable through the app, but default seed templates must reflect the uploaded source forms while removing logos and site-specific branding.
- The app must support reopening a visit, editing structured fields and note text, and regenerating the PDF without creating a replacement visit.

## Architecture Rules

- Use TypeScript across the Electron main process, preload bridge, shared domain code, and React renderer.
- Keep domain logic independent from framework/UI code where practical. Business rules for note selection, dose calculations, archive behavior, and template rendering belong in shared modules, not in React components.
- Keep the Electron security model explicit: `contextIsolation` on, `nodeIntegration` off, and all privileged access routed through a typed preload API.
- Store structured relational data in SQLite and binary/document assets in app-controlled local directories referenced from the database.
- Keep file-system operations, PDF generation, image handling, and database access on the desktop/main side behind service boundaries.
- The renderer should consume typed view models and commands rather than direct database access.
- Preserve a future migration path by isolating repositories, services, domain rules, and template rendering so they can later be reused in a web/cloud deployment.

## Privacy And Security Rules

- Collect only the minimum data needed for the clinical note workflow.
- Never send patient data off-device in the MVP.
- Do not add telemetry, crash reporting, analytics beacons, or third-party tracking scripts.
- Hash the app PIN before storage; do not store plain text PIN values.
- Support inactivity auto-lock and explicit lock/unlock flows.
- Minimize PHI exposure on overview screens. Active lists should display only the information needed for daily workflow.
- Keep patient assets in app-managed storage paths rather than arbitrary shared folders.
- Do not expose raw local storage paths in the UI except where needed for export actions.
- PDFs and photos remain locally stored and linked to the patient/course/visit history.

## Implementation Conventions

- Prefer small, verified steps over broad rewrites.
- Use seeded default templates generated from the supplied ODT references.
- Keep styling professional, site-neutral, and optimized for minimal-click clinical workflows.
- Favor accessible forms, large action targets, clear status badges, and obvious archive boundaries.
- Add tests for note-selection logic, archive/restore flows, dose calculations, template override persistence, and PDF regeneration behavior.
- Document install, database, run, and packaging steps in the README.
- After desktop-app changes, verify the Desktop shortcut launch path still opens Dermatherapy Note Maker and reaches its first real screen before reporting completion.

## Forbidden Behaviors

- Do not add cloud sync or multi-site shared storage to the MVP.
- Do not require user accounts or online authentication.
- Do not embed patient face photos in note PDFs.
- Do not remove placeholder safeguards from editable templates.
- Do not hard-code site branding, logos, or organization-specific wording into generated output.
- Do not bypass the preload/API boundary by giving the renderer unrestricted Node or filesystem access.
- Do not delete historical patient, course, note, photo, or PDF data as part of archive actions.
