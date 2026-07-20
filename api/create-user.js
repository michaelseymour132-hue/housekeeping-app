// api/create-user.js
// -----------------------------------------------------------------------------
// Vercel serverless function: create a staff LOGIN account + Firestore profile
// in one step, so admins never have to touch the Firebase Console to add people.
//
// HOW IT DEPLOYS: this file lives in the /api folder of the repo. Vercel turns any
// file under /api into a serverless function automatically on git push - there is
// NO command line and NO separate deploy step. Once pushed, it is live at
//   https://<your-app>.vercel.app/api/create-user
//
// ONE-TIME SETUP (see README "In-app user creation"): you must give this function a
// Firebase "service account" key via a Vercel Environment Variable named
// FIREBASE_SERVICE_ACCOUNT. That key is a SECRET - it is never committed to the repo.
//
// SECURITY: the caller must send their Firebase sign-in token. The function verifies
// it, confirms the caller is an ACTIVE ADMIN of the target org, and only then creates
// the account. The Admin SDK runs with full privileges, so this check is essential.
// -----------------------------------------------------------------------------

var admin = require("firebase-admin");

// Initialise the Admin SDK once per warm instance, reading the secret key from the
// environment. Kept inside a function so a missing/invalid key returns a clean error
// instead of crashing the whole function.
function ensureApp() {
  if (admin.apps && admin.apps.length) { return; }
  var raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) { throw new Error("Server not configured: FIREBASE_SERVICE_ACCOUNT is missing. See README."); }
  var creds;
  try { creds = JSON.parse(raw); }
  catch (e) { throw new Error("Server not configured: FIREBASE_SERVICE_ACCOUNT is not valid JSON."); }
  admin.initializeApp({ credential: admin.credential.cert(creds) });
}

// A long random temporary password. The new user never needs it - they receive a
// "set your password" email (sent by the app after this function returns).
function tempPassword() {
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  var s = "", i;
  for (i = 0; i < 18; i++) { s += chars.charAt(Math.floor(Math.random() * chars.length)); }
  return s + "aZ9!";
}

module.exports = function (req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  try { ensureApp(); }
  catch (e) { res.status(500).json({ error: e.message }); return; }

  var idToken = "";
  var authHeader = req.headers.authorization || req.headers.Authorization || "";
  if (authHeader.indexOf("Bearer ") === 0) { idToken = authHeader.slice(7); }
  if (!idToken) { res.status(401).json({ error: "Missing sign-in token." }); return; }

  var body = req.body || {};
  var orgId = body.orgId;
  var hotelId = body.hotelId;
  var email = (body.email || "").trim();
  var name = (body.displayName || "").trim();
  var role = body.role;
  var validRoles = ["housekeeper", "supervisor", "admin"];
  if (!orgId || !hotelId || !email || !name || validRoles.indexOf(role) === -1) {
    res.status(400).json({ error: "Missing or invalid fields." });
    return;
  }

  var db = admin.firestore();

  admin.auth().verifyIdToken(idToken).then(function (decoded) {
    // Confirm the caller is an active admin of this org before doing anything.
    return db.doc("orgs/" + orgId + "/users/" + decoded.uid).get();
  }).then(function (snap) {
    if (!snap.exists) { throw { httpStatus: 403, message: "You are not a member of this organisation." }; }
    var profile = snap.data();
    if (profile.role !== "admin" || profile.active !== true) {
      throw { httpStatus: 403, message: "Only an active admin can create users." };
    }
    return admin.auth().createUser({ email: email, password: tempPassword(), displayName: name });
  }).then(function (userRecord) {
    // Create the matching profile with the SAME uid as the new Auth account.
    return db.doc("orgs/" + orgId + "/users/" + userRecord.uid).set({
      uid: userRecord.uid,
      displayName: name,
      email: email,
      role: role,
      hotelIds: [hotelId],
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastLoginAt: null
    }).then(function () {
      res.status(200).json({ ok: true, uid: userRecord.uid });
    });
  }).catch(function (err) {
    if (err && err.httpStatus) { res.status(err.httpStatus).json({ error: err.message }); return; }
    if (err && err.errorInfo && err.errorInfo.code === "auth/email-already-exists") {
      res.status(409).json({ error: "That email address already has an account." });
      return;
    }
    if (err && err.code === "auth/invalid-email") {
      res.status(400).json({ error: "That email address is not valid." });
      return;
    }
    res.status(500).json({ error: (err && err.message) || "Could not create the user." });
  });
};
