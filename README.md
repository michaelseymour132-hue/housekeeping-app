# Housekeeping Hub

An enterprise hotel housekeeping operations platform: room status, daily cleans, inspections, deep-clean scheduling, maintenance, documents, reporting, and a full admin console. Plain HTML/CSS/vanilla JS front end on Firebase (Firestore, Auth, Storage), hosted on Vercel.

> The original single-file prototype is preserved as `legacy.html`.

## File tree

```
index.html          Login (split-screen, password reset)
onboarding.html     First-run wizard: hotel, bulk rooms, checklists
dashboard.html      KPIs + real-time room grid (supervisor/admin)
room.html           Room profile: overview, history, documents, maintenance
mytasks.html        Housekeeper daily flow: start, checklist, complete
assign.html         Assignments: multi-select, workload, copy yesterday
inspect.html        Inspection queue: pass / fail-reclean
deepcleans.html     Deep clean planner + before/after photo flow
maintenance.html    Maintenance queue (open/in-progress/resolved)
documents.html      Document library (PDF/image upload)
reports.html        Analytics, SVG charts, CSV export, print
settings.html       Admin console (7 sections)
privacy.html        GDPR privacy policy TEMPLATE
seed.html           Dev-only demo data (refuses non-empty hotel)
legacy.html         Original prototype (kept for reference)
css/style.css       Design system + print styles
js/firebase-config.js   Firebase config (with Console locations)
js/common.js        Auth guard, roles, toast, dates, photo upload, shell
firestore.rules     Firestore security rules (paste into Console)
storage.rules       Storage security rules (paste into Console)
README.md TESTING.md ROADMAP.md
```

## Roles

- **admin** - everything, including users, settings, branding, audit log.
- **supervisor** - dashboard, assign, inspect, deep cleans, maintenance, edit rooms.
- **housekeeper** - My Tasks (own assignments only), documents, add notes.

## Firebase Console setup (no CLI needed)

1. **Create / open project** at https://console.firebase.google.com. This repo is configured for project `housekeeping-app-4684b`; to use another, edit `js/firebase-config.js` (each value notes where to find it: Project settings > General > Your apps > SDK setup and configuration).
2. **Authentication** > Get started > enable **Email/Password**.
3. **Firestore Database** > Create database (production mode).
4. **Firestore > Rules** > paste all of `firestore.rules` > **Publish**.
5. **Storage** > Get started > then **Storage > Rules** > paste all of `storage.rules` > **Publish**.
6. **Create your first admin login**: Authentication > Users > Add user (email + password). Then sign in to the deployed app - because you have no profile yet, you are routed to `onboarding.html`, which creates your org, hotel, rooms, and your own admin profile automatically.
7. **Add more staff**: create their Auth user (Authentication > Add user), copy their UID, then in the app go to Settings > Users and create a matching profile with that UID, email, and role.

## Vercel

Connect the GitHub repo in Vercel; it serves the static files as-is. Every push to `main` auto-deploys. No build step or environment variables required.

## Composite indexes

Firestore may ask for a composite index the first time certain queries run (reports date ranges, some filtered lists). When that happens the browser console prints a direct "create index" link - open it and click Create; the index builds in a minute. Likely candidates: `assignments` by `date` + `assignedToUid`; `roomnotes` by `isMaintenanceIssue` + `maintenanceStatus`; `roomhistory` by `roomId` + `createdAt`.

## Known limitations (be transparent with buyers)

- **Audit log** is written by the client, so rules make it append-only but cannot fully prevent a technical user forging entries. A Cloud Function would make it tamper-proof - see ROADMAP.
- **Free (Spark) plan** has daily read/write quotas; heavy real-time use during big demos can hit them. Blaze plan removes this.
- Demo staff created by `seed.html` are Firestore profiles only; to log in as them, also create matching Auth users.

## Code style

Vanilla JS only: `var`, `function()`, string concatenation, `.then()/.catch()`. No arrow functions, template literals, async/await, or build tools. ASCII only.
