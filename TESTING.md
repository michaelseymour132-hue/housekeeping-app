# TESTING - click-path walkthrough

Do the Firebase setup in README first (Auth on, Firestore + Storage rules published). Then follow these in order.

## 0. First admin + onboarding
1. In Firebase Console > Authentication > Add user: create your admin email + password.
2. Open the deployed app, sign in. You have no profile yet, so you land on **onboarding**.
3. Step 1: enter company + hotel name, floors, timezone > Continue.
4. Step 2: set floors 1-3, rooms 1-10, pick a default type > Generate block (expect 30 rooms) > add a single room 401 > Continue.
5. Step 3: review daily + deep-clean checklists, add/remove one each > Finish setup.
6. Expect a success toast then the **dashboard** with your rooms.

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
