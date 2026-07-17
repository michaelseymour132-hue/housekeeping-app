# Housekeeping Hub

An enterprise hotel housekeeping operations platform: room status, daily cleans, inspections, deep-clean scheduling, maintenance, documents, reporting, and a full admin console. Plain HTML/CSS/vanilla JS front end on Firebase (Firestore, Auth, Storage), hosted on Vercel.

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
calendar.html       Month/week calendar of assignments, deep cleans, maintenance
allocation.html     Occupancy-driven room allocation (CSV import)
css/style.css       Design system + print styles
js/firebase-config.js   Firebase config (with Console locations)
js/common.js        Auth guard, roles, toast, dates, photo upload, shell
firestore.rules     Firestore security rules (paste into Console)
storage.rules       Storage security rules (paste into Console)
api/create-user.js  Serverless function: create staff logins in-app (Vercel)
package.json        Server dependency (firebase-admin) for the /api function
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
7. **Add more staff**: once the in-app user creation backend is set up (see below), go to Settings > Users in the app, enter a name, email and role and press Create - the login account and profile are created automatically and the person is emailed a link to set their own password. (Before that setup, or as a fallback, you can still add people the old way: Authentication > Add user, then Settings > Users.)

## Vercel

Connect the GitHub repo in Vercel; it serves the static files as-is and turns any file under `/api` into a serverless function. Every push to `main` auto-deploys. No build step is required. One environment variable is needed for in-app user creation - see the next section.

## In-app user creation (backend setup)

The app can create staff logins for you (Settings > Users) instead of you making each one by hand in the Firebase Console. This uses one serverless function (`api/create-user.js`) that runs on Vercel. One-time setup, no command line:

1. **Get a service account key.** Firebase Console > gear icon (Project settings) > **Service accounts** tab > **Generate new private key** > Generate key. A `.json` file downloads. Treat it like a password - it grants full access to your Firebase project. Never put it in the repo.
2. **Copy its contents.** Open the downloaded `.json` file in a text editor and copy everything.
3. **Add it to Vercel.** Vercel dashboard > your project > **Settings** > **Environment Variables**. Add a variable named exactly `FIREBASE_SERVICE_ACCOUNT`, paste the whole JSON as the value, apply it to all environments, and Save.
4. **Redeploy.** Vercel > Deployments > latest deployment > "..." menu > Redeploy, so the new variable is picked up. `firebase-admin` installs automatically from `package.json` - you run nothing yourself.

Until this is done, the "Create user" button reports a "Server not configured" error, and you can add people the old way (Firebase Console > Authentication > Add user).

## Composite indexes

Firestore may ask for a composite index the first time certain queries run (reports date ranges, some filtered lists). When that happens the browser console prints a direct "create index" link - open it and click Create; the index builds in a minute. Likely candidates: `assignments` by `date` + `assignedToUid`; `roomnotes` by `isMaintenanceIssue` + `maintenanceStatus`; `roomhistory` by `roomId` + `createdAt`.

## Known limitations (be transparent with buyers)

- **Audit log** is written by the client, so rules make it append-only but cannot fully prevent a technical user forging entries. A Cloud Function would make it tamper-proof - see ROADMAP.
- **Free (Spark) plan** has daily read/write quotas; heavy real-time use during big demos can hit them. Blaze plan removes this.
- Demo staff created by `seed.html` are Firestore profiles only; to log in as them, also create matching Auth users.

## Code style

Vanilla JS only: `var`, `function()`, string concatenation, `.then()/.catch()`. No arrow functions, template literals, async/await, or build tools. ASCII only.
