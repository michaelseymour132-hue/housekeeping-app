// api/create-user.js
// -----------------------------------------------------------------------------
// Vercel serverless function: create a staff LOGIN account + Firestore profile
// in one step, so admins never have to touch the Firebase Console to add people.
//
// TWO KINDS OF LOGIN:
//   email - { email } : the person is emailed a link to set their own password
//           (the app sends it after this function returns).
//   pin   - { loginType: "pin", pin } : housekeepers only. No email needed. They
//           sign in from the property's team link by tapping their name and
//           typing their PIN (see api/team.js). The PIN is stored hashed.
//
// HOW IT DEPLOYS: this file lives in the /api folder of the repo. Vercel turns any
// file under /api into a serverless function automatically on git push - there is
// NO command line and NO separate deploy step.
//
// ONE-TIME SETUP (see README "In-app user creation"): you must give this function a
// Firebase "service account" key via a Vercel Environment Variable named
// FIREBASE_SERVICE_ACCOUNT. That key is a SECRET - it is never committed to the repo.
//
// SECURITY: the caller must send their Firebase sign-in token. The function verifies
// it, confirms the caller is an ACTIVE ADMIN of the target org, and only then creates
// the account. The Admin SDK runs with full privileges, so this check is essential.
// -----------------------------------------------------------------------------

var T = require("./_team");
var admin = T.admin;

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

  try { T.ensureApp(); }
  catch (e) { res.status(500).json({ error: e.message }); return; }

  var body = req.body || {};
  var orgId = body.orgId;
  var hotelId = body.hotelId;
  var loginType = body.loginType === "pin" ? "pin" : "email";
  var email = (body.email || "").trim();
  var pin = String(body.pin || "");
  var name = (body.displayName || "").trim().slice(0, 60);
  var role = body.role;
  var validRoles = ["housekeeper", "supervisor", "admin"];
  if (!orgId || !hotelId || !name || validRoles.indexOf(role) === -1) {
    res.status(400).json({ error: "Missing or invalid fields." });
    return;
  }
  if (loginType === "email" && !email) { res.status(400).json({ error: "Enter an email address." }); return; }
  if (loginType === "pin") {
    if (role !== "housekeeper") { res.status(400).json({ error: "PIN sign-in is for housekeepers. Supervisors and admins sign in with email." }); return; }
    if (!T.validPin(pin)) { res.status(400).json({ error: "A PIN is 4 to 6 numbers." }); return; }
    if (T.weakPin(pin)) { res.status(400).json({ error: "That PIN is too easy to guess. Avoid 1234, 0000 and similar." }); return; }
  }

  var db = admin.firestore();

  T.caller(req, db, orgId, ["admin"]).then(function () {
    // This function runs with full privileges, so it must apply the same free-trial
    // rule as firestore.rules itself: no new team members once a trial has ended.
    return db.doc("orgs/" + orgId).get();
  }).then(function (orgSnap) {
    var org = orgSnap.exists ? orgSnap.data() : {};
    var plan = org.plan || "trial";
    if (plan === "trial" && org.trialEndsAt && org.trialEndsAt.toMillis() <= Date.now()) {
      throw { httpStatus: 403, message: (org.billing && org.billing.subscriptionId ? "Your subscription has ended" : "Your free trial has ended") + " - choose a plan to add team members." };
    }
    if (loginType === "pin") { return admin.auth().createUser({ displayName: name }); }
    return admin.auth().createUser({ email: email, password: tempPassword(), displayName: name });
  }).then(function (userRecord) {
    // Create the matching profile with the SAME uid as the new Auth account.
    return db.doc("orgs/" + orgId + "/users/" + userRecord.uid).set({
      uid: userRecord.uid,
      displayName: name,
      email: loginType === "pin" ? "" : email,
      loginType: loginType,
      role: role,
      hotelIds: [hotelId],
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastLoginAt: null
    }).then(function () {
      if (loginType === "pin") { return T.savePin(db, orgId, userRecord.uid, pin); }
    }).then(function () {
      res.status(200).json({ ok: true, uid: userRecord.uid, loginType: loginType });
    });
  }).catch(function (err) {
    if (err && err.httpStatus) { res.status(err.httpStatus).json({ error: err.message }); return; }
    if (err && err.errorInfo && err.errorInfo.code === "auth/email-already-exists") {
      res.status(409).json({ error: "That email address already has an account." });
      return;
    }
    if (err && (err.code === "auth/invalid-email" || (err.errorInfo && err.errorInfo.code === "auth/invalid-email"))) {
      res.status(400).json({ error: "That email address is not valid." });
      return;
    }
    res.status(500).json({ error: (err && err.message) || "Could not create the user." });
  });
};
