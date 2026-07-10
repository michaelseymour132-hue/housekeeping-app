# ROADMAP - what to build next

A sales-facing view of where Housekeeping Hub goes after v1.

## Near term (hardening)
- **Server-side audit log via Cloud Function** - make the audit trail tamper-proof (currently client-written / append-only). Also move sensitive writes (role changes, deletes) behind Functions.
- **In-app user invites** - invite by email so admins never touch the Firebase Console (Cloud Function creates the Auth user + profile together).
- **Composite indexes shipped as config** - pre-declare indexes so first-run queries never error.

## Product expansion
- **PMS integration** - sync room occupancy, check-in/checkout, and arrivals from Opera / Mews / Cloudbeds so dirty/checkout status is automatic.
- **Linen & stock module** - par levels, cupboard counts, low-stock alerts, reorder lists.
- **Email / push digests** - morning assignment summaries to housekeepers, end-of-day completion + inspection report to managers.
- **Lost property register** - dedicated workflow with guest matching and return tracking.
- **Multi-hotel switcher + group dashboard** - roll-up KPIs across a portfolio for regional managers.

## Analytics & quality
- **Trend analytics** - clean-time trends, pass-rate by housekeeper over time, deep-clean compliance.
- **SLA / target tracking** - set targets (e.g. rooms/hour) and flag misses.
- **Guest-facing quality scores** - optional link between inspection results and guest review scores.

## Platform
- **Offline support (PWA)** - service worker so housekeepers keep working through dead spots, syncing when back online.
- **Native wrapper** - installable app + real push notifications.
- **White-label theming end-to-end** - apply the branding colour/logo across every page at load.
- **Roles & permissions granularity** - custom roles beyond the three built-in tiers.
