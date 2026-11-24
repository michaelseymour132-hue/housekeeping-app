// js/hk-model.js - the housekeeping rules every page shares (statuses, front-office
// state, tasks, credits, discrepancies). Modelled on how Oracle OPERA runs housekeeping,
// sized for small properties.
// Style: var / function() only, ASCII only (matches the rest of the app).

// ---- Room (cleaning) status ------------------------------------------------
HK.STATUSES = [
  { id: "dirty",      label: "Dirty",          code: "DI", badge: "badge-red" },
  { id: "pickup",     label: "Pickup",         code: "PU", badge: "badge-amber" },
  { id: "inprogress", label: "Being serviced", code: "SV", badge: "badge-amber" },
  { id: "clean",      label: "Clean",          code: "CL", badge: "badge-green" },
  { id: "inspected",  label: "Inspected",      code: "IN", badge: "badge-blue" },
  { id: "ooo",        label: "Out of order",   code: "OO", badge: "badge-grey" },
  { id: "oos",        label: "Out of service", code: "OS", badge: "badge-grey" }
];
HK.statusInfo = function (id) {
  if (id === "dnd") { id = "dirty"; }   // old data: DND used to be a room status
  for (var i = 0; i < HK.STATUSES.length; i++) { if (HK.STATUSES[i].id === id) { return HK.STATUSES[i]; } }
  return { id: id || "dirty", label: id || "Unknown", code: "??", badge: "badge-grey" };
};
HK.isReady = function (r) { return r.status === "clean" || r.status === "inspected"; };
HK.isOut = function (r) { return r.status === "ooo" || r.status === "oos"; };

// ---- Front office state (from bookings / the arrivals import) --------------
// vacant | arrival | stayover | dueout
HK.foState = function (r, dateStr) {
  var d = dateStr || HK.todayStr();
  var occ = String(r.occStatus || r.occupancy || "vacant").toLowerCase();
  var occupied = occ === "occupied" || occ === "inhouse" || occ === "in-house" || occ === "stayover";
  if (r.departure && r.departure === d && (occupied || (r.arrival && r.arrival < d))) { return "dueout"; }
  if (occupied) { return "stayover"; }
  if (r.arrival && r.arrival === d) { return "arrival"; }
  return "vacant";
};
HK.FO_LABELS = { vacant: "Vacant", arrival: "Arrival today", stayover: "Stayover", dueout: "Due out" };
HK.FO_CODES = { vacant: "V", arrival: "ARR", stayover: "SO", dueout: "DO" };

// ---- Housekeeping check vs front office: Skip / Sleep discrepancies ---------
// Skip  = bookings say someone is staying, housekeeping found the room empty.
// Sleep = bookings say the room is empty, housekeeping found it in use.
HK.discrepancy = function (r, dateStr) {
  if (!r.hkStatus) { return ""; }
  var fo = HK.foState(r, dateStr);
  var foOcc = fo === "stayover" || fo === "dueout";
  if (foOcc && r.hkStatus === "vacant") { return "skip"; }
  if (!foOcc && r.hkStatus === "occupied") { return "sleep"; }
  return "";
};

// ---- Guest service status ---------------------------------------------------
HK.GUEST_SERVICE = { "": "No request", dnd: "Do not disturb", mur: "Make up room", declined: "Service declined" };

// ---- Tasks and credits -------------------------------------------------------
HK.TASKS = {
  departure: { label: "Departure clean", badge: "badge-red" },
  stayover:  { label: "Stayover service", badge: "badge-blue" },
  pickup:    { label: "Pickup", badge: "badge-amber" },
  turndown:  { label: "Turndown", badge: "badge-purple" },
  reclean:   { label: "Re-clean", badge: "badge-red" },
  deepclean: { label: "Deep clean", badge: "badge-purple" },
  daily:     { label: "Clean", badge: "badge-grey" }
};
HK.taskLabel = function (t) { return (HK.TASKS[t] || { label: t || "Clean" }).label; };
HK.DEFAULT_HK_SETTINGS = {
  credits: { departure: 3, stayover: 2, pickup: 1, turndown: 1, reclean: 1, deepclean: 6, daily: 2 },
  linenDays: 3,           // change bed linen for stayovers every N nights
  maxCredits: 0           // most credits on one task sheet (0 = no limit)
};
HK.hkSettings = function (hotel) {
  var s = ((hotel && hotel.settings) || {}).hk || {};
  var d = HK.DEFAULT_HK_SETTINGS;
  var credits = {};
  Object.keys(d.credits).forEach(function (k) {
    var v = s.credits && s.credits[k];
    credits[k] = (typeof v === "number" && v >= 0) ? v : d.credits[k];
  });
  return {
    credits: credits,
    linenDays: (typeof s.linenDays === "number" && s.linenDays >= 0) ? s.linenDays : d.linenDays,
    maxCredits: (typeof s.maxCredits === "number" && s.maxCredits >= 0) ? s.maxCredits : d.maxCredits
  };
};

// Which task a room needs on a date, or "" for none.
HK.taskFor = function (r, dateStr) {
  if (!r || r.active === false || HK.isOut(r)) { return ""; }
  if (r.guestService === "declined") { return ""; }
  var st = r.status === "dnd" ? "dirty" : r.status;
  if (st !== "dirty" && st !== "pickup") { return ""; }
  if (st === "pickup") { return "pickup"; }
  return HK.foState(r, dateStr) === "stayover" ? "stayover" : "departure";
};

// Stayover linen change every N nights since arrival (OPERA "linen change frequency").
HK.linenDue = function (r, dateStr, linenDays) {
  if (!linenDays || !r.arrival) { return false; }
  if (HK.foState(r, dateStr) !== "stayover") { return false; }
  var a = new Date(r.arrival + "T00:00:00"), d = new Date((dateStr || HK.todayStr()) + "T00:00:00");
  var nights = Math.round((d - a) / 86400000);
  return nights > 0 && nights % linenDays === 0;
};

// Priority: flagged by a supervisor, or a guest arriving today into a room that is not ready.
HK.isPriority = function (r, dateStr) {
  return !!r.priority || (HK.foState(r, dateStr) === "arrival" && !HK.isReady(r));
};

// Split rooms into task sheets for the chosen attendants. Rooms stay in floor/number
// order so each attendant works one area; sheets are balanced on credits.
// rooms: [{room, task, credits, priority}]  -> [{attendant, items: [...], credits}]
HK.buildSheets = function (items, attendants, maxCredits) {
  var sorted = items.slice().sort(function (a, b) {
    var fa = Number(a.room.floor) || 0, fb = Number(b.room.floor) || 0;
    if (fa !== fb) { return fa - fb; }
    return HK.roomCompare(a.room, b.room);
  });
  var total = sorted.reduce(function (s, x) { return s + x.credits; }, 0);
  var sheets = attendants.map(function (u) { return { attendant: u, items: [], credits: 0 }; });
  if (!sheets.length) { return { sheets: [], unassigned: sorted }; }
  var target = total / sheets.length;
  var si = 0, unassigned = [];
  sorted.forEach(function (x) {
    // move on when this sheet has its fair share (or would break the cap), unless it is the last one
    while (si < sheets.length - 1 && sheets[si].items.length &&
           (sheets[si].credits + x.credits / 2 > target || (maxCredits && sheets[si].credits + x.credits > maxCredits))) { si++; }
    if (maxCredits && sheets[si].credits + x.credits > maxCredits) {
      // last sheet full: try any sheet with room, otherwise leave unassigned
      var alt = sheets.filter(function (s) { return s.credits + x.credits <= maxCredits; })[0];
      if (!alt) { unassigned.push(x); return; }
      alt.items.push(x); alt.credits += x.credits; return;
    }
    sheets[si].items.push(x); sheets[si].credits += x.credits;
  });
  sheets.forEach(function (s) {
    s.items.sort(function (a, b) {
      if (a.priority !== b.priority) { return a.priority ? -1 : 1; }
      var fa = Number(a.room.floor) || 0, fb = Number(b.room.floor) || 0;
      if (fa !== fb) { return fa - fb; }
      return HK.roomCompare(a.room, b.room);
    });
  });
  return { sheets: sheets, unassigned: unassigned };
};

// Natural room-number order: 2 before 10, 101 before 1001.
HK.roomCompare = function (a, b) {
  var x = String(a.roomNumber || ""), y = String(b.roomNumber || "");
  var nx = parseFloat(x), ny = parseFloat(y);
  if (!isNaN(nx) && !isNaN(ny) && nx !== ny) { return nx - ny; }
  return x < y ? -1 : (x > y ? 1 : 0);
};

// Minutes since a Firestore timestamp (or null).
HK.minutesSince = function (ts) {
  if (!ts) { return null; }
  var d = ts.toDate ? ts.toDate() : new Date(ts);
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
};

// Start of a new housekeeping day (OPERA does this at end of day / night audit):
// occupied rooms need service again, guest requests and housekeeping checks reset.
// Returns the list of {id, data} updates to apply.
HK.dayRollUpdates = function (rooms, dateStr) {
  var out = [];
  rooms.forEach(function (r) {
    var fo = HK.foState(r, dateStr);
    var data = {};
    if ((fo === "stayover" || fo === "dueout") && HK.isReady(r)) { data.status = "dirty"; }
    if (r.status === "dnd") { data.status = "dirty"; }
    if (r.guestService) { data.guestService = ""; }
    if (r.hkStatus) { data.hkStatus = ""; }
    if (r.turndown && r.turndown !== "") { data.turndown = ""; }
    if (r.priority) { data.priority = false; }
    if (Object.keys(data).length) { out.push({ id: r.id, data: data }); }
  });
  return out;
};
