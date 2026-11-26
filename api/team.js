// api/team.js
// -----------------------------------------------------------------------------
// Vercel serverless function: team links and PIN logins for housekeepers who
// do not use email. One address, four actions (POST JSON { action, ... }):
//
//   link    (admin/supervisor)  get this property's team link + QR code;
//                               { rotate: true } makes a new one and the old
//                               link stops working at once.
//   setpin  (admin/supervisor)  set or reset a team member's PIN.
//   staff   (anyone with link)  the property name and the first names of the
//                               team members who can sign in with a PIN.
//   login   (anyone with link)  check name + PIN; returns a one-time Firebase
//                               sign-in token. 5 wrong PINs lock that person
//                               for 15 minutes.
//
// Needs the same FIREBASE_SERVICE_ACCOUNT environment variable as create-user.js.
// See api/_team.js for where the secrets are kept.
// -----------------------------------------------------------------------------

var T = require("./_team");
var QRCode = require("qrcode");

// Only the first word of a name is shown to anyone holding the link.
function firstName(n) {
  var s = String(n || "").trim().split(/\s+/)[0] || "Team member";
  return s.slice(0, 24);
}

function resolveToken(db, token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
    return Promise.reject({ httpStatus: 404, message: "This team link is not valid. Ask your manager for the new one." });
  }
  return db.doc("teamlinks/" + token).get().then(function (snap) {
    if (!snap.exists) { throw { httpStatus: 404, message: "This team link is not valid. Ask your manager for the new one." }; }
    return snap.data();
  });
}

function pinMembers(db, orgId, hotelId) {
  return db.collection("orgs/" + orgId + "/users").where("loginType", "==", "pin").where("active", "==", true).get()
    .then(function (snap) {
      var out = [];
      snap.forEach(function (d) {
        var u = d.data();
        if ((u.hotelIds || []).indexOf(hotelId) === -1) { return; }
        out.push({ uid: d.id, name: firstName(u.displayName), fullName: u.displayName || "" });
      });
      // Two people with the same first name get their surname initial too.
      var seen = {};
      out.forEach(function (m) { seen[m.name] = (seen[m.name] || 0) + 1; });
      out.forEach(function (m) {
        if (seen[m.name] > 1) {
          var parts = m.fullName.trim().split(/\s+/);
          if (parts.length > 1) { m.name = m.name + " " + parts[parts.length - 1].charAt(0).toUpperCase() + "."; }
        }
        delete m.fullName;
      });
      out.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
      return out;
    });
}

function doLink(req, res, db, body) {
  var orgId = body.orgId, hotelId = body.hotelId;
  if (!hotelId) { res.status(400).json({ error: "Missing property." }); return; }
  T.caller(req, db, orgId, ["admin", "supervisor"]).then(function (me) {
    if (me.profile.role !== "admin" && (me.profile.hotelIds || []).indexOf(hotelId) === -1) {
      throw { httpStatus: 403, message: "You do not have access to that property." };
    }
    if (body.rotate && me.profile.role !== "admin") {
      throw { httpStatus: 403, message: "Only an admin can make a new team link." };
    }
    return db.doc("orgs/" + orgId + "/hotels/" + hotelId).get();
  }).then(function (h) {
    if (!h.exists) { throw { httpStatus: 404, message: "Property not found." }; }
    var byRef = db.doc("teamlinkByHotel/" + orgId + "_" + hotelId);
    return byRef.get().then(function (by) {
      var old = by.exists ? by.data().token : "";
      if (old && !body.rotate) { return old; }
      var token = T.newToken();
      var batch = db.batch();
      batch.set(db.doc("teamlinks/" + token), { orgId: orgId, hotelId: hotelId, createdAt: T.admin.firestore.FieldValue.serverTimestamp() });
      batch.set(byRef, { token: token });
      if (old) { batch.delete(db.doc("teamlinks/" + old)); }
      return batch.commit().then(function () { return token; });
    });
  }).then(function (token) {
    var url = T.siteUrl() + "/team.html?t=" + token;
    return QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#12222f", light: "#ffffff" } })
      .then(function (svg) { res.status(200).json({ ok: true, url: url, qrSvg: svg }); });
  }).catch(function (err) { T.sendError(res, err, "Could not get the team link."); });
}

function doSetPin(req, res, db, body) {
  var orgId = body.orgId, uid = body.uid, pin = String(body.pin || "");
  if (!uid) { res.status(400).json({ error: "Missing team member." }); return; }
  if (!T.validPin(pin)) { res.status(400).json({ error: "A PIN is 4 to 6 numbers." }); return; }
  if (T.weakPin(pin)) { res.status(400).json({ error: "That PIN is too easy to guess. Avoid 1234, 0000 and similar." }); return; }
  T.caller(req, db, orgId, ["admin", "supervisor"]).then(function (me) {
    return db.doc("orgs/" + orgId + "/users/" + uid).get().then(function (snap) {
      if (!snap.exists) { throw { httpStatus: 404, message: "Team member not found." }; }
      var u = snap.data();
      if (me.profile.role !== "admin" && u.role !== "housekeeper") {
        throw { httpStatus: 403, message: "Supervisors can only set PINs for housekeepers." };
      }
      if (u.loginType !== "pin") { throw { httpStatus: 400, message: "This person signs in with email, not a PIN." }; }
      return T.savePin(db, orgId, uid, pin);
    });
  }).then(function () { res.status(200).json({ ok: true }); })
    .catch(function (err) { T.sendError(res, err, "Could not set the PIN."); });
}

function doStaff(req, res, db, body) {
  var link;
  resolveToken(db, body.token).then(function (l) {
    link = l;
    return Promise.all([
      db.doc("orgs/" + link.orgId + "/hotels/" + link.hotelId).get(),
      pinMembers(db, link.orgId, link.hotelId)
    ]);
  }).then(function (r) {
    var hotel = r[0].exists ? r[0].data() : {};
    res.status(200).json({ ok: true, property: hotel.name || "Your property", staff: r[1] });
  }).catch(function (err) { T.sendError(res, err, "Could not load the team."); });
}

function doLogin(req, res, db, body) {
  var pin = String(body.pin || ""), uid = body.uid, link;
  if (!uid || !T.validPin(pin)) { res.status(400).json({ error: "Enter your 4 to 6 number PIN." }); return; }
  resolveToken(db, body.token).then(function (l) {
    link = l;
    return db.doc("orgs/" + link.orgId + "/users/" + uid).get();
  }).then(function (snap) {
    var u = snap.exists ? snap.data() : null;
    if (!u || u.active !== true || u.loginType !== "pin" || (u.hotelIds || []).indexOf(link.hotelId) === -1) {
      throw { httpStatus: 403, message: "That name cannot sign in here. Ask your manager." };
    }
    return T.checkPin(db, link.orgId, uid, pin);
  }).then(function (result) {
    if (result === "locked") { throw { httpStatus: 429, message: "Too many wrong PINs. Try again in " + T.LOCK_MINUTES + " minutes, or ask your manager to reset it." }; }
    if (result === "nopin") { throw { httpStatus: 403, message: "No PIN has been set for you yet. Ask your manager." }; }
    if (result !== "ok") { throw { httpStatus: 401, message: "Wrong PIN. Please try again." }; }
    return T.admin.auth().createCustomToken(uid, { team: true });
  }).then(function (customToken) {
    res.status(200).json({ ok: true, customToken: customToken, hotelId: link.hotelId, orgId: link.orgId });
  }).catch(function (err) { T.sendError(res, err, "Could not sign in."); });
}

module.exports = function (req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  try { T.ensureApp(); }
  catch (e) { res.status(500).json({ error: e.message }); return; }
  var body = req.body || {};
  var db = T.admin.firestore();
  if (body.action === "link") { doLink(req, res, db, body); return; }
  if (body.action === "setpin") { doSetPin(req, res, db, body); return; }
  if (body.action === "staff") { doStaff(req, res, db, body); return; }
  if (body.action === "login") { doLogin(req, res, db, body); return; }
  res.status(400).json({ error: "Unknown action." });
};
