# ClearSkin Hub

ClearSkin Hub is a local-first Electron + React + TypeScript desktop application for radiation treatment note workflows. It is designed for single-site use, stores all data locally, generates editable/regeneratable PDFs, keeps patient/course/visit history searchable after archive, and seeds its default note wording from the uploaded 2026 EBRT source forms while removing site-specific branding.

## What The App Does

- Creates and manages patient profiles with MRN, DOB, notes, and an optional face photo used only inside the app.
- Supports multiple treatment courses per patient over time.
- Auto-suggests the correct note family by course type and treatment number.
- Lets staff override the suggested note type before saving.
- Attaches daily treatment photos to the visit and appends them to the generated PDF.
- Stores editable note text so visits can be reopened, corrected, and regenerated without creating a replacement visit.
- Separates active workflow from finished/archive views while keeping history viewable and searchable.
- Lets admins edit note templates later through the built-in template manager.

## Local Storage Model

The MVP is local-first and single-site:

- Structured data is stored in a local SQLite database powered by `sql.js`.
- Patient face photos, visit treatment photos, and app-managed history files are stored under the hidden Electron user-data directory.
- Generated PDFs are filed into a Desktop library folder for easy access: `All Patient Notes\Consult Notes\[Last, First]` and `All Patient Notes\Treatment Notes\[Last, First]`.
- There is no cloud sync, no shared cross-site database, and no telemetry.

On Windows, a packaged app creates its hidden working data under the Electron user-data folder, typically inside:

`%APPDATA%\ClearSkin Hub\`

Inside that hidden app folder, the app creates:

- `data/dermatherapy-note-maker.sqlite`
- `storage/patients/...`
- `launch-status.json`
- `startup-debug.log`

Each site/device keeps its own isolated data set.

## PIN Locking

- On first launch, the app prompts for a 4-8 digit PIN setup.
- The PIN is stored as a salted `scrypt` hash, never plain text.
- The app unlocks on successful PIN entry.
- The app auto-locks after the configured inactivity timeout.
- PIN changes are available in Settings.

## Core Workflow

### Add Patients

1. Open `Active Workflow`.
2. Click `Add Patient`.
3. Enter patient identifiers and optional profile notes.
4. Optionally attach a face photo. This photo is not included in PDFs.

### Treatment Courses

Each patient can have multiple courses.

For each course you can define:

- course name
- one-site or two-site type
- prescribed fractions
- per-site body location, diagnosis, ICD10
- per-site treatment depth, cone/cutout, shields, machine, interval, dose values

Course values carry forward into new daily visit drafts through the site snapshot fields.

### Note Type Auto-Selection

The app uses the following treatment logic:

- consult/simulation notes use `consult_sim`
- treatment 1 uses `first_fraction`
- treatments 2-4, 6-9, 11-14 use `standard_treatment`
- treatments 5, 10, and 15 use `otv`
- 15 is the maximum treatment number

Users can manually override the note type in the visit editor before saving.

### Override Note Type Manually

Open a new or existing visit note and change the `Note Type` dropdown in the visit editor. The app regenerates the draft text from the selected template family, and staff can still freely edit the final note text before saving or generating the PDF.

### Treatment Photos

- Face photos live only on the patient profile.
- Daily treatment photos are attached within the visit editor.
- Visit photos are stored in the visit record and appended to the generated PDF on separate pages.

### PDFs

The app saves editable visit data first, then generates PDFs on demand.

Generated PDFs:

- are stored locally under the visit storage path
- include the edited note text
- include attached treatment photos at the end
- are versioned each time they are regenerated

This supports correction workflows without forcing a brand-new visit.

### Archive / Finished Patients

- `Treatment Completed` marks a course as completed and removes it from the active dashboard.
- Patient archive hides the patient from the active workflow by default.
- `Archive` view remains searchable and supports patient/course restore actions.
- Historical visit notes, PDFs, and photos remain accessible after archive.

## Template Management

The app ships with eight seeded template families:

- `one_site:consult_sim`
- `one_site:first_fraction`
- `one_site:standard_treatment`
- `one_site:otv`
- `two_site:consult_sim`
- `two_site:first_fraction`
- `two_site:standard_treatment`
- `two_site:otv`

The defaults were derived from the uploaded ODT source forms. The active templates are stored in SQLite and can be edited from the `Templates` screen.

Template safety behavior:

- only supported placeholders are allowed
- reset-to-default restores the seeded wording
- placeholders are documented in the UI

The repo also includes a source-template extraction utility:

```powershell
npm run extract:templates -- path/to/source-templates
```

This reads the supplied `.odt` files and writes a manifest to [docs/source-template-manifest.json](docs/source-template-manifest.json).

## Tech Stack

- Electron desktop shell
- React + TypeScript renderer
- `sql.js` local SQLite engine
- `pdf-lib` PDF generation
- app-managed local file storage for photos and PDFs
- typed preload bridge with `contextIsolation` enabled

Electron was chosen for the MVP because it is straightforward to package for Windows while keeping the UI and business logic in a React/TypeScript codebase that can later be adapted for web/tablet deployment.

## Install Commands

### 1. Install Node.js LTS

```powershell
winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
```

### 2. Install Project Dependencies

From the repo root:

```powershell
npm install
```

If `node` is installed but not on your current terminal PATH, reopen the terminal and try again.

## Database Setup

There is no manual database migration step for the MVP.

The app creates its local database automatically on first launch:

1. first app launch creates the SQLite file
2. default settings row is seeded
3. default template definitions are seeded
4. file-storage folders are created automatically as needed

## Run Commands

### One-Click Launch

Double-click [Launch ClearSkin Hub.vbs](<Launch ClearSkin Hub.vbs>) for the normal windowless launcher.

It will:

- open the packaged portable app if it already exists
- fall back to the unpacked app if present
- build/package the app first if needed, then launch it

[Launch ClearSkin Hub.bat](<Launch ClearSkin Hub.bat>) remains available as a visible troubleshooting launcher if startup errors need to be inspected.

Desktop shortcut for daily use:

- `%USERPROFILE%\Desktop\ClearSkin Hub.lnk`

Verification command used after app changes:

```powershell
npm run verify:shortcut
```

### Development

```powershell
npm run dev
```

### Build

```powershell
npm run build
```

### Tests

```powershell
npm test
```

## Packaging / Distribution

Build Windows distributables with:

```powershell
npm run package
```

The project is configured for:

- `nsis` installer output
- `portable` build output

After packaging, distribute the generated files from the `dist/` folder to a single site/device. Each installed copy creates and uses its own local database and local storage.

Current Windows artifacts after packaging:

- `dist\ClearSkin Hub Setup 0.1.0.exe`
- `dist\ClearSkin Hub 0.1.0.exe`
- `dist\win-unpacked\ClearSkin Hub.exe`

Recommended local deployment pattern:

1. package the app
2. email or transfer the installer/portable build to the destination site
3. install locally on the site machine
4. launch and create the local site PIN
5. use the app with local-only patient data on that machine

## Browser Refresh Notice

The browser/iPad build emits a same-origin `refresh-pulse.json` file during `npm run build:browser`. Open browser sessions check that file periodically and show the in-app refresh banner when a newer deployment is available, so active users know to refresh before continuing work.

## Update Checks

Settings includes a manual update check. In the desktop app, it compares the installed desktop release tag with the public GitHub latest release and opens the latest Windows installer when an update is available. In the browser/iPad app, it checks the deployed refresh pulse and offers to refresh when the browser shell is behind. Patient records stay in local app data and are not sent during either check.

## Branding

- Project/app name: `ClearSkin Hub`
- App icon sources:
  - [assets/branding/dermatherapy-icon.ico](assets/branding/dermatherapy-icon.ico)
  - [assets/branding/dermatherapy-icon.png](assets/branding/dermatherapy-icon.png)
  - [assets/branding/dermatherapy-logo.png](assets/branding/dermatherapy-logo.png)

The provided JPG logo is now used in the packaged Windows app, installer configuration, window icon path, favicon, and in-app sidebar/lock screen branding.

## Verification

Completed verification for this repo:

- `npm run build`
- `npx tsc --noEmit`
- `npm test`

The Vitest suite covers:

- patient creation
- multiple courses per patient
- note-type auto-selection
- manual note-type override
- cumulative dose calculation
- archive/restore behavior
- PDF generation
- appended treatment photos in PDF
- note edit/regenerate flow
- saved option reuse and deletion

## Project Files

Key implementation files:

- [AGENTS.md](AGENTS.md)
- [package.json](package.json)
- [electron.vite.config.ts](electron.vite.config.ts)
- [src/main/index.ts](src/main/index.ts)
- [src/main/backend.ts](src/main/backend.ts)
- [src/main/repository.ts](src/main/repository.ts)
- [src/main/pdf.ts](src/main/pdf.ts)
- [src/preload/index.ts](src/preload/index.ts)
- [src/shared/types.ts](src/shared/types.ts)
- [src/shared/note-rules.ts](src/shared/note-rules.ts)
- [src/shared/templates.ts](src/shared/templates.ts)
- [src/shared/template-engine.ts](src/shared/template-engine.ts)
- [src/renderer/src/App.tsx](src/renderer/src/App.tsx)
- [src/renderer/src/screen-components.tsx](src/renderer/src/screen-components.tsx)
- [src/renderer/src/visit-editor-screen.tsx](src/renderer/src/visit-editor-screen.tsx)
- [src/renderer/src/modal-components.tsx](src/renderer/src/modal-components.tsx)
- [src/renderer/src/styles.css](src/renderer/src/styles.css)
- [tests/workflow.test.ts](tests/workflow.test.ts)
- [scripts/extract-source-templates.mjs](scripts/extract-source-templates.mjs)
