// api/owner.js
// -----------------------------------------------------------------------------
// Vercel serverless function for the OWNER of Housekeeping Hub (you, the person
// selling it) - not for customers. POST JSON { action, ... } with a Firebase
// sign-in token.
//
//   list     (owner only)  every business that has signed up: name, admin email,
//                          rooms, plan, trial end, founding member or not.
//   grant    (owner only)  { orgId, months } make a business a FOUNDING MEMBER:
//                          free for that many months, no card needed. Their free
//                          period is extended; nothing else changes.
//   signup   (the new customer, once, from the setup wizard) tells the owner a
//                          new business has signed up, by Telegram if set up.
//
// WHO IS THE OWNER: the sign-in emails listed in the Vercel environment variable
// OWNER_EMAILS (comma separated). If it is not set, the address below is used.
//
// OPTIONAL TELEGRAM ALERT ON EVERY NEW SIGN-UP (Vercel > Settings > Environment
// Variables, then redeploy):
//   TELEGRAM_BOT_TOKEN  - the bot's token from @BotFather
//   TELEGRAM_CHAT_ID    - your chat id with that bot
// Without them, sign-ups still appear on owner.html - just no alert.
// -----------------------------------------------------------------------------

var T = require("./_team");
var admin = T.admin;

var DEFAULT_OWNERS = ["michaelseymour132@gmail.com"];

function owners() {
  var raw = process.env.OWNER_EMAILS || "";
  var list = raw.split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(function (s) { return !!s; });
  return list.length ? list : DEFAULT_OWNERS;
}

function verify(req) {
  var authHeader = req.headers.authorization || req.headers.Authorization || "";
  var idToken = authHeader.indexOf("Bearer ") === 0 ? authHeader.slice(7) : "";
  if (!idToken) { return Promise.reject({ httpStatus: 401, message: "Missing sign-in token." }); }
  return admin.auth().verifyIdToken(idToken);
}

function requireOwner(req) {
  return verify(req).then(function (decoded) {
    var email = String(decoded.email || "").toLowerCase();
    if (!email || owners().indexOf(email) === -1) { throw { httpStatus: 403, message: "This page is only for the owner of Housekeeping Hub." }; }
    return decoded;
  });
}

function ms(ts) { return ts && ts.toMillis ? ts.toMillis() : null; }

function telegram(text) {
  var token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) { return Promise.resolve(false); }
  return fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: text, disable_web_page_preview: true })
  }).then(function (r) { return r.ok; }).catch(function () { return false; });
}

function describeOrg(db, doc) {
  var o = doc.data();
  var orgRef = doc.ref;
  return Promise.all([
    orgRef.collection("users").where("role", "==", "admin").get(),
    orgRef.collection("hotels").get(),
    orgRef.collection("users").get()
  ]).then(function (r) {
    var admins = [], lastLogin = null;
    r[0].forEach(function (u) { var d = u.data(); if (d.email) { admins.push(d.email); } });
    r[2].forEach(function (u) { var t = ms(u.data().lastLoginAt); if (t && (!lastLogin || t > lastLogin)) { lastLogin = t; } });
    var hotels = [];
    r[1].forEach(function (h) { hotels.push({ id: h.id, name: h.data().name || "" }); });
    return Promise.all(hotels.map(function (h) {
      return orgRef.collection("hotels").doc(h.id).collection("rooms").where("active", "==", true).count().get()
        .then(function (c) { return c.data().count; }).catch(function () { return null; });
    })).then(function (counts) {
      var rooms = counts.reduce(function (s, n) { return s + (n || 0); }, 0);
      return {
        orgId: doc.id,
        name: o.name || "",
        properties: hotels.map(function (h) { return h.name; }).filter(function (n) { return !!n; }),
        adminEmails: admins,
        staff: r[2].size,
        rooms: rooms,
        plan: o.plan || "trial",
        paying: !!(o.billing && o.billing.subscriptionId) && (o.plan || "trial") !== "trial",
        founding: !!o.founding,
        foundingUntil: ms(o.foundingUntil),
        trialEndsAt: ms(o.trialEndsAt),
        createdAt: ms(o.createdAt),
        lastLoginAt: lastLogin
      };
    });
  });
}

function doList(req, res, db) {
  requireOwner(req).then(function () {
    return db.collection("orgs").get();
  }).then(function (snap) {
    var docs = []; snap.forEach(function (d) { docs.push(d); });
    return Promise.all(docs.map(function (d) { return describeOrg(db, d); }));
  }).then(function (list) {
    list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    res.status(200).json({ ok: true, orgs: list, telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) });
  }).catch(function (err) { T.sendError(res, err, "Could not load sign-ups."); });
}

function doGrant(req, res, db, body) {
  var months = parseInt(body.months, 10);
  if (!body.orgId || isNaN(months) || months < 1 || months > 12) { res.status(400).json({ error: "Choose between 1 and 12 months." }); return; }
  var ref = db.doc("orgs/" + body.orgId);
  requireOwner(req).then(function () {
    return db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        if (!snap.exists) { throw { httpStatus: 404, message: "Business not found." }; }
        var o = snap.data();
        if ((o.plan || "trial") !== "trial") { throw { httpStatus: 400, message: "This business is already on a paid plan." }; }
        var from = Math.max(Date.now(), ms(o.trialEndsAt) || 0);
        var until = new Date(from);
        until.setMonth(until.getMonth() + months);
        var stamp = admin.firestore.Timestamp.fromDate(until);
        tx.update(ref, { trialEndsAt: stamp, founding: true, foundingUntil: stamp, foundingGrantedAt: admin.firestore.FieldValue.serverTimestamp() });
        return until.getTime();
      });
    });
  }).then(function (until) {
    res.status(200).json({ ok: true, until: until });
  }).catch(function (err) { T.sendError(res, err, "Could not update the business."); });
}

// Called once by the setup wizard straight after a new business is created.
function doSignup(req, res, db, body) {
  var ref = db.doc("orgs/" + (body.orgId || "x"));
  var decoded;
  verify(req).then(function (d) {
    decoded = d;
    return db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        if (!snap.exists) { throw { httpStatus: 404, message: "Business not found." }; }
        var o = snap.data();
        if (o.ownerUid !== decoded.uid) { throw { httpStatus: 403, message: "Not your business." }; }
        if (o.signupNotifiedAt) { return null; }
        tx.update(ref, { signupNotifiedAt: admin.firestore.FieldValue.serverTimestamp() });
        return o;
      });
    });
  }).then(function (o) {
    if (!o) { res.status(200).json({ ok: true, already: true }); return; }
    return ref.collection("hotels").get().then(function (hs) {
      var props = [];
      hs.forEach(function (h) { if (h.data().name) { props.push(h.data().name + (h.data().address ? " (" + h.data().address + ")" : "")); } });
      var text = "New Housekeeping Hub sign-up\n" +
        "Business: " + (o.name || "-") + "\n" +
        "Property: " + (props.join(", ") || "-") + "\n" +
        "Email: " + (decoded.email || "-") + "\n" +
        "Open the owner page: " + T.siteUrl() + "/owner.html";
      return telegram(text).then(function (sent) { res.status(200).json({ ok: true, alerted: sent }); });
    });
  }).catch(function (err) { T.sendError(res, err, "Could not record the sign-up."); });
}

module.exports = function (req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  try { T.ensureApp(); }
  catch (e) { res.status(500).json({ error: e.message }); return; }
  var body = req.body || {};
  var db = admin.firestore();
  if (body.action === "list") { doList(req, res, db); return; }
  if (body.action === "grant") { doGrant(req, res, db, body); return; }
  if (body.action === "signup") { doSignup(req, res, db, body); return; }
  res.status(400).json({ error: "Unknown action." });
};
