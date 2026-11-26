// api/_team.js
// -----------------------------------------------------------------------------
// Shared helpers for team (PIN) logins. The leading underscore means Vercel does
// NOT publish this file as a web address - it is only used by other /api files.
//
// WHY: not every housekeeper has, or wants to use, an email address. Each
// property gets a private TEAM LINK (and QR code). A housekeeper opens it, taps
// their name and types a 4-6 digit PIN. The server checks the PIN and hands back
// a one-time Firebase sign-in token, so the rest of the app (and every security
// rule) works exactly as it does for an email login.
//
// WHERE THE SECRETS LIVE (Firestore, written ONLY by these server functions -
// firestore.rules has no match for these paths, so the app itself can never
// read or write them):
//   teamlinks/{token}                      -> { orgId, hotelId, createdAt }
//   teamlinkByHotel/{orgId}_{hotelId}      -> { token }
//   orgs/{orgId}/pins/{uid}                -> { salt, hash, fails, lockedUntil }
// PINs are never stored as typed: only a salted scrypt hash.
// -----------------------------------------------------------------------------

var admin = require("firebase-admin");
var crypto = require("crypto");

var MAX_FAILS = 5;                 // wrong PINs in a row before the lock
var LOCK_MINUTES = 15;             // how long the lock lasts

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

function validPin(pin) { return typeof pin === "string" && /^[0-9]{4,6}$/.test(pin); }

// Obvious PINs are refused so a lost phone or a guess cannot open someone's account.
function weakPin(pin) {
  if (/^(\d)\1+$/.test(pin)) { return true; }                       // 0000, 1111
  var up = "0123456789", down = "9876543210";
  if (up.indexOf(pin) !== -1 || down.indexOf(pin) !== -1) { return true; } // 1234, 4321
  return false;
}

function hashPin(pin, salt) {
  return crypto.scryptSync(pin, salt, 32).toString("hex");
}

function newToken() {
  return crypto.randomBytes(18).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Store a PIN for a member of an org (resets any lock).
function savePin(db, orgId, uid, pin) {
  var salt = crypto.randomBytes(16).toString("hex");
  return db.doc("orgs/" + orgId + "/pins/" + uid).set({
    salt: salt,
    hash: hashPin(pin, salt),
    fails: 0,
    lockedUntil: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

// Check a PIN with a lock after repeated failures.
// Resolves "ok" | "wrong" | "locked" | "nopin".
function checkPin(db, orgId, uid, pin) {
  var ref = db.doc("orgs/" + orgId + "/pins/" + uid);
  return db.runTransaction(function (tx) {
    return tx.get(ref).then(function (snap) {
      if (!snap.exists) { return "nopin"; }
      var p = snap.data();
      var now = Date.now();
      if (p.lockedUntil && p.lockedUntil.toMillis() > now) { return "locked"; }
      var given = Buffer.from(hashPin(pin, p.salt), "hex");
      var stored = Buffer.from(p.hash, "hex");
      var match = given.length === stored.length && crypto.timingSafeEqual(given, stored);
      if (match) {
        tx.update(ref, { fails: 0, lockedUntil: null });
        return "ok";
      }
      var fails = (p.fails || 0) + 1;
      var upd = { fails: fails };
      if (fails >= MAX_FAILS) {
        upd.fails = 0;
        upd.lockedUntil = admin.firestore.Timestamp.fromMillis(now + LOCK_MINUTES * 60000);
      }
      tx.update(ref, upd);
      return fails >= MAX_FAILS ? "locked" : "wrong";
    });
  });
}

// Verify the caller's Firebase sign-in token and load their profile in the org.
// Resolves { uid, profile } or rejects { httpStatus, message }.
function caller(req, db, orgId, roles) {
  var authHeader = req.headers.authorization || req.headers.Authorization || "";
  var idToken = authHeader.indexOf("Bearer ") === 0 ? authHeader.slice(7) : "";
  if (!idToken) { return Promise.reject({ httpStatus: 401, message: "Missing sign-in token." }); }
  if (!orgId) { return Promise.reject({ httpStatus: 400, message: "Missing organisation." }); }
  return admin.auth().verifyIdToken(idToken).then(function (decoded) {
    return db.doc("orgs/" + orgId + "/users/" + decoded.uid).get().then(function (snap) {
      if (!snap.exists) { throw { httpStatus: 403, message: "You are not a member of this organisation." }; }
      var profile = snap.data();
      if (profile.active !== true || roles.indexOf(profile.role) === -1) {
        throw { httpStatus: 403, message: "You do not have permission to do that." };
      }
      return { uid: decoded.uid, profile: profile };
    });
  });
}

function sendError(res, err, fallback) {
  if (err && err.httpStatus) { res.status(err.httpStatus).json({ error: err.message }); return; }
  res.status(500).json({ error: (err && err.message) || fallback || "Something went wrong." });
}

module.exports = {
  admin: admin,
  ensureApp: ensureApp,
  siteUrl: siteUrl,
  validPin: validPin,
  weakPin: weakPin,
  savePin: savePin,
  checkPin: checkPin,
  newToken: newToken,
  caller: caller,
  sendError: sendError,
  MAX_FAILS: MAX_FAILS,
  LOCK_MINUTES: LOCK_MINUTES
};
