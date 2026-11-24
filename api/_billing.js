// api/_billing.js
// -----------------------------------------------------------------------------
// Shared helpers for the card-payment functions (checkout, billing-portal,
// stripe-webhook). The leading underscore means Vercel does NOT publish this file
// as a web address of its own - it is only used by the other files in /api.
//
// PAYMENTS ARE HANDLED BY STRIPE. Card numbers never touch this app or its
// database: the customer types them on Stripe's own page.
//
// SECRETS (set in Vercel > Settings > Environment Variables, never in the repo):
//   FIREBASE_SERVICE_ACCOUNT  - already used by create-user.js
//   STRIPE_SECRET_KEY         - Stripe's secret key (starts sk_test_ or sk_live_)
//   STRIPE_PRICE_STARTER      - the Stripe price id for the Starter plan (price_...)
//   STRIPE_PRICE_PRO          - the Stripe price id for the Professional plan (price_...)
//   SITE_URL                  - optional; defaults to https://www.housekeepinghub.app
//
// Until STRIPE_SECRET_KEY is set, the functions answer "payments not switched on"
// and the plan page falls back to "we will be in touch".
// -----------------------------------------------------------------------------

var admin = require("firebase-admin");

// Plans that can be bought online. maxRooms must match js/site-config.js.
var PLANS = {
  starter: { id: "starter", name: "Starter", maxRooms: 15, priceEnv: "STRIPE_PRICE_STARTER" },
  pro: { id: "pro", name: "Professional", maxRooms: 40, priceEnv: "STRIPE_PRICE_PRO" }
};

function ensureApp() {
  if (admin.apps && admin.apps.length) { return; }
  var raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) { throw new Error("Server not configured: FIREBASE_SERVICE_ACCOUNT is missing. See README."); }
  var creds;
  try { creds = JSON.parse(raw); }
  catch (e) { throw new Error("Server not configured: FIREBASE_SERVICE_ACCOUNT is not valid JSON."); }
  admin.initializeApp({ credential: admin.credential.cert(creds) });
}

function siteUrl() {
  var u = process.env.SITE_URL || "https://www.housekeepinghub.app";
  return u.replace(/\/+$/, "");
}

function stripeReady() { return !!process.env.STRIPE_SECRET_KEY; }

// Turn a nested object into Stripe's form format: a[b][c]=value
function encodeForm(obj, prefix, out) {
  out = out || [];
  Object.keys(obj).forEach(function (k) {
    var v = obj[k];
    if (v === undefined || v === null) { return; }
    var key = prefix ? prefix + "[" + k + "]" : k;
    if (typeof v === "object") { encodeForm(v, key, out); }
    else { out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v))); }
  });
  return out;
}

// Call Stripe. Resolves with the parsed answer; rejects with { httpStatus, message }.
function stripe(method, path, params) {
  var opts = {
    method: method,
    headers: { "Authorization": "Bearer " + process.env.STRIPE_SECRET_KEY }
  };
  if (params) {
    opts.headers["Content-Type"] = "application/x-www-form-urlencoded";
    opts.body = encodeForm(params).join("&");
  }
  return fetch("https://api.stripe.com/v1" + path, opts).then(function (r) {
    return r.json().then(function (data) {
      if (!r.ok) {
        var m = (data && data.error && data.error.message) || ("Stripe error " + r.status);
        throw { httpStatus: 502, message: "Payment provider said: " + m };
      }
      return data;
    });
  });
}

// Check the caller's sign-in token and that they are an active admin of orgId.
// Resolves with { uid, email, org (data), orgRef, db }.
function requireOrgAdmin(req, orgId) {
  var idToken = "";
  var authHeader = req.headers.authorization || req.headers.Authorization || "";
  if (authHeader.indexOf("Bearer ") === 0) { idToken = authHeader.slice(7); }
  if (!idToken) { return Promise.reject({ httpStatus: 401, message: "Missing sign-in token." }); }
  if (!orgId || typeof orgId !== "string" || orgId.indexOf("/") !== -1) {
    return Promise.reject({ httpStatus: 400, message: "Missing or invalid organisation." });
  }
  var db = admin.firestore();
  var who = {};
  return admin.auth().verifyIdToken(idToken).then(function (decoded) {
    who.uid = decoded.uid;
    who.email = decoded.email || "";
    return db.doc("orgs/" + orgId + "/users/" + decoded.uid).get();
  }).then(function (snap) {
    if (!snap.exists) { throw { httpStatus: 403, message: "You are not a member of this organisation." }; }
    var p = snap.data();
    if (p.role !== "admin" || p.active !== true) { throw { httpStatus: 403, message: "Only an active admin can manage the plan." }; }
    return db.doc("orgs/" + orgId).get();
  }).then(function (orgSnap) {
    if (!orgSnap.exists) { throw { httpStatus: 404, message: "Organisation not found." }; }
    return { uid: who.uid, email: who.email, org: orgSnap.data(), orgRef: orgSnap.ref, db: db };
  });
}

// Count the active rooms across every hotel in the org (used for the plan size check).
function countActiveRooms(db, orgId) {
  return db.collection("orgs/" + orgId + "/hotels").get().then(function (hotels) {
    var jobs = [];
    hotels.forEach(function (h) {
      jobs.push(h.ref.collection("rooms").where("active", "==", true).get().then(function (s) { return s.size; }));
    });
    return Promise.all(jobs);
  }).then(function (sizes) {
    var n = 0, i;
    for (i = 0; i < sizes.length; i++) { n += sizes[i]; }
    return n;
  });
}

function planByPriceId(priceId) {
  var found = null;
  Object.keys(PLANS).forEach(function (k) {
    if (process.env[PLANS[k].priceEnv] && process.env[PLANS[k].priceEnv] === priceId) { found = PLANS[k]; }
  });
  return found;
}

function fail(res, err, fallback) {
  if (err && err.httpStatus) {
    var out = { error: err.message };
    if (err.code) { out.code = err.code; }
    res.status(err.httpStatus).json(out);
    return;
  }
  res.status(500).json({ error: (err && err.message) || fallback || "Something went wrong." });
}

module.exports = {
  admin: admin,
  PLANS: PLANS,
  ensureApp: ensureApp,
  siteUrl: siteUrl,
  stripeReady: stripeReady,
  encodeForm: encodeForm,
  stripe: stripe,
  requireOrgAdmin: requireOrgAdmin,
  countActiveRooms: countActiveRooms,
  planByPriceId: planByPriceId,
  fail: fail
};
