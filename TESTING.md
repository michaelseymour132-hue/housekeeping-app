# TESTING - click-path walkthrough

Do the Firebase setup in README first (Auth on, Firestore + Storage rules published). Then follow these in order.

## 0. Website, sign-up + onboarding
1. Open the deployed site. The home page shows features, three plans and "Start free trial".
2. Start free trial > enter name, email, password (8+), tick the privacy box > Start free trial.
3. You land on **onboarding** (it says the 14-day trial starts when you finish).
4. Step 1: business + property name > Continue. Step 2: Generate block (expect 12 rooms) > Continue.
5. Step 3: review checklists > Finish setup. Expect the **dashboard** with "Free trial - 14 days left" at the top.
6. Plan (admin menu): status card, the plan that fits your room count is highlighted; Choose it > "we will be in touch".
7. Trial end check (optional): in Firestore set `orgs/{id}.trialEndsAt` to yesterday > reload > red bar; try to change a room status > refused. Set it back.

## 1. Quick demo data (optional)
- Visit `seed.html`. If the hotel is empty it seeds 30 rooms, 3 staff profiles, and a week of assignments/notes/maintenance, then sends you to the dashboard. Re-visiting refuses to run (protects data).

## 2. Dashboard (admin/supervisor)
- KPI cards populate (clean %, remaining, deep cleans due, open maintenance).
- Room grid shows colours. Change a filter (floor/status/occupancy) and the search box - grid updates live.
- Tap a tile > popover > change status > Save > tile colour updates in real time.
- Tap a tile > View room profile.

## 3. Room profile
- Overview: edit bed config/notes/quirks (admin/supervisor) > Save.
- Add photo (on a phone this opens the camera) - watch the % then the thumbnail.
- Report issue > pick category + details > Save.
- History tab: see the status change, note, and photo events; Load more paginates.
- Documents / Maintenance tabs load their lists.

## 4. Assign (admin/supervisor)
- Pick date = today, choose a housekeeper. Select all dirty (or tap tiles) > Assign selected.
- Watch the per-housekeeper workload badges update.
- Try assigning an already-assigned room > duplicate warning appears.
- Copy yesterday: creates today from yesterday, skipping duplicates.

## 5. Housekeeper flow (My Tasks)
- Sign in as a housekeeper (create their Auth user + Settings profile first, or reuse admin to view).
- My Tasks lists today only, re-cleans at the top. Progress bar shows "0 of N".
- Start cleaning (room goes in-progress) > tick checklist > optional note > Complete room.
- Try completing with items unticked > skip-reason confirmation.
- Progress bar and status badge update.

## 6. Inspect (admin/supervisor)
- Completed cleans from today appear. Pass > room becomes inspected.
- Fail/re-clean (comment required) > room back to dirty AND a new re-clean task is created for the same housekeeper (check My Tasks).

## 7. Deep cleans
- Overdue / Due(14d) tabs list rooms by nextDeepCleanDue. Schedule one > pick staff.
- Scheduled tab > Start > add a before photo (status flips to in-progress) > tick checklist > add an after photo > Complete.
- Completing requires >=1 before and >=1 after photo; then room is clean and nextDeepCleanDue moves forward by the interval. Completed tab shows it.

## 8. Maintenance
- Issues reported from room profiles appear under Open. Start work > In progress. Mark resolved > Resolved. Each change adds a room-history event.

## 9. Documents
- Upload a PDF or image with a title + category, optionally linked to a room. Search + category filter. View opens the file. (Housekeepers can view but not upload.)

## 10. Reports (admin/supervisor)
- Presets Today/7/30 or custom range > Run. KPI cards + a bar chart of cleans/day + a per-housekeeper table populate.
- Export CSV downloads the table. Print gives a clean printout (nav hidden).

## 11. Settings (admin only)
- Hotel: edit details + deep-clean interval > Save.
- Checklists: add/remove/reorder items > Save checklists.
- Rooms: add a room; deactivate one (confirm modal) - it leaves the boards.
- Users: create a profile from a Firebase UID; deactivate/reactivate (not yourself).
- Branding: change app name/colour/logo URL > Save > reload to see the new name in nav.
- Data export: each button downloads that collection as CSV.
- Audit log: read-only table of admin actions you just performed.

## 12. Access control spot-checks
- As a housekeeper, try opening `settings.html` or `assign.html` directly - you are redirected to My Tasks.
- A housekeeper cannot complete someone else\u2019s task (rules block it).

## 13. Robustness
- Kill your network mid-save: you get an error toast, not a silent failure, and your input is preserved.
- Resize to 360px wide: no horizontal scroll; bottom tab bar appears; 44px tap targets.

## Team link and PIN sign-in
1. Settings > Users > "Show team link and QR code". Expect a link, a QR code, Copy link, Print staff-room poster and (admin) Make a new link.
2. Add a team member: name "Test Cleaner", role Housekeeper, "Team link and PIN", PIN 5829 > Create. Expect "is set up" and the list shows "team link + PIN". Try PIN 1234: refused as too easy.
3. Open the team link in a private window (or scan the QR with a phone). Expect the property name and a "Test" button.
4. Tap it, type 5829, Sign in > lands on My Tasks.
5. Sign out > back on the team page, not the email sign-in page.
6. Type a wrong PIN 5 times > "Too many wrong PINs" lock. Settings > Reset PIN > sign in again with the new PIN.
7. Make a new link > the old link now says "not valid".
