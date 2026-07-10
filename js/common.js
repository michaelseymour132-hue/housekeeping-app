// js/common.js - shared logic for Housekeeping Hub
// Auth guard, role check, toast, modal, date helpers, photo compression,
// app-shell nav rendering, roomhistory + auditlog writers.
// Style: var / function() / string concatenation / .then().catch() only.

var HK = {};
HK.state = { user: null, profile: null, orgId: null, hotelId: null };

// ---- Toast ---------------------------------------------------------------
HK.toast = function (message, kind) {
  var host = document.getElementById("toast-host");
  if (!host) { host = document.createElement("div"); host.id = "toast-host"; document.body.appendChild(host); }
  var t = document.createElement("div");
  t.className = "toast toast-" + (kind || "info");
  t.textContent = message;
  host.appendChild(t);
  setTimeout(function () { if (t.parentNode) { t.parentNode.removeChild(t); } }, 3800);
};

// ---- Modal (confirm) -----------------------------------------------------
HK.confirm = function (title, message, confirmLabel, danger) {
  return new Promise(function (resolve) {
    var back = document.createElement("div"); back.className = "modal-backdrop";
    var box = document.createElement("div"); box.className = "modal";
    var h = document.createElement("h2"); h.textContent = title; box.appendChild(h);
    var p = document.createElement("p"); p.className = "muted"; p.textContent = message; box.appendChild(p);
    var acts = document.createElement("div"); acts.className = "modal-actions";
    var cancel = document.createElement("button"); cancel.className = "btn btn-secondary"; cancel.textContent = "Cancel";
    var ok = document.createElement("button"); ok.className = "btn " + (danger ? "btn-danger" : "btn-accent"); ok.textContent = confirmLabel || "Confirm";
    acts.appendChild(cancel); acts.appendChild(ok); box.appendChild(acts); back.appendChild(box); document.body.appendChild(back);
    function close(v) { if (back.parentNode) { back.parentNode.removeChild(back); } resolve(v); }
    cancel.onclick = function () { close(false); };
    ok.onclick = function () { close(true); };
    back.onclick = function (e) { if (e.target === back) { close(false); } };
  });
};

// ---- Date helpers --------------------------------------------------------
HK.todayStr = function () { return HK.dateStr(new Date()); };
HK.dateStr = function (d) {
  var y = d.getFullYear(); var m = ("0" + (d.getMonth() + 1)).slice(-2); var day = ("0" + d.getDate()).slice(-2);
  return y + "-" + m + "-" + day;
};
HK.fmtDateTime = function (ts) {
  if (!ts) { return "-"; }
  var d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
HK.daysBetween = function (a, b) { return Math.round((b - a) / 86400000); };
HK.addDays = function (d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; };

// ---- Auth guard + profile load ------------------------------------------
// Call HK.requireAuth(rolesArray, onReady). Redirects to index.html if not
// signed in or if role not permitted. Loads org membership + profile.
HK.requireAuth = function (allowedRoles, onReady) {
  auth.onAuthStateChanged(function (user) {
    if (!user) { window.location.href = "index.html"; return; }
    HK.state.user = user;
    HK.loadProfile(user).then(function (ok) {
      if (!ok) { HK.toast("Your account has no access. Contact your administrator.", "error"); auth.signOut(); return; }
      var role = HK.state.profile.role;
      if (allowedRoles && allowedRoles.length && allowedRoles.indexOf(role) === -1) {
        HK.toast("You do not have permission to view that page.", "error");
        window.location.href = HK.homeForRole(role); return;
      }
      if (onReady) { onReady(HK.state); }
    }).catch(function (e) { HK.toast("Could not load your profile: " + e.message, "error"); });
  });
};

// Finds the org the user belongs to and loads their profile doc.
// Stores chosen hotelId in localStorage per org.
HK.loadProfile = function (user) {
  return db.collectionGroup("users").where("uid", "==", user.uid).where("active", "==", true).limit(1).get()
    .then(function (snap) {
      if (snap.empty) { return false; }
      var doc = snap.docs[0];
      var data = doc.data();
      // path: orgs/{orgId}/users/{uid}
      var orgId = doc.ref.parent.parent.id;
      HK.state.profile = data;
      HK.state.orgId = orgId;
      var hotelIds = data.hotelIds || [];
      var stored = localStorage.getItem("hk_hotel_" + orgId);
      HK.state.hotelId = (stored && hotelIds.indexOf(stored) !== -1) ? stored : (hotelIds[0] || null);
      // best-effort lastLoginAt update
      doc.ref.update({ lastLoginAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(function () {});
      return true;
    });
};

HK.homeForRole = function (role) {
  if (role === "housekeeper") { return "mytasks.html"; }
  return "dashboard.html";
};

HK.signOut = function () { auth.signOut().then(function () { window.location.href = "index.html"; }); };

// Convenience path builders -------------------------------------------------
HK.orgRef = function () { return db.collection("orgs").doc(HK.state.orgId); };
HK.hotelRef = function () { return HK.orgRef().collection("hotels").doc(HK.state.hotelId); };
HK.col = function (name) { return HK.hotelRef().collection(name); };

// ---- Audit log (append-only) + room history ------------------------------
HK.audit = function (action, detail) {
  var p = HK.state.profile || {};
  return HK.orgRef().collection("auditlog").add({
    action: action, detail: detail || "",
    actorUid: HK.state.user ? HK.state.user.uid : null,
    actorName: p.displayName || "",
    hotelId: HK.state.hotelId || null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).catch(function (e) { /* audit must never block the main action */ });
};

HK.history = function (roomId, roomNumber, eventType, summary, refId) {
  var p = HK.state.profile || {};
  return HK.col("roomhistory").add({
    roomId: roomId, roomNumber: roomNumber || "", eventType: eventType,
    summary: summary || "", refId: refId || null,
    actorUid: HK.state.user ? HK.state.user.uid : null,
    actorName: p.displayName || "",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).catch(function () {});
};

// ---- Photo compression + upload -----------------------------------------
// Compress a File to <=1280px longest edge, JPEG ~0.7, then upload to Storage.
// onProgress(percent). Resolves with the download URL. Releases blobs after.
HK.uploadPhoto = function (file, storagePath, onProgress) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function () { reject(new Error("Could not read file")); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { reject(new Error("Could not decode image")); };
      img.onload = function () {
        var max = 1280; var w = img.width; var h = img.height;
        if (w > h && w > max) { h = Math.round(h * max / w); w = max; }
        else if (h > max) { w = Math.round(w * max / h); h = max; }
        var canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error("Could not compress image")); return; }
          var task = storage.ref().child(storagePath).put(blob, { contentType: "image/jpeg" });
          task.on("state_changed", function (snap) {
            if (onProgress) { onProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)); }
          }, function (err) { reject(err); }, function () {
            task.snapshot.ref.getDownloadURL().then(function (url) { resolve(url); }).catch(reject);
          });
        }, "image/jpeg", 0.7);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
};

// ---- App shell nav -------------------------------------------------------
// Renders the sidebar (desktop) + bottom tab bar (mobile), role-gated.
// active = key of current page. Call after profile is loaded.
HK.navItems = function (role) {
  var all = [
    { key: "dashboard", label: "Dashboard", href: "dashboard.html", ic: "grid", roles: ["admin", "supervisor"] },
    { key: "mytasks", label: "My Tasks", href: "mytasks.html", ic: "check", roles: ["admin", "supervisor", "housekeeper"] },
    { key: "assign", label: "Assign", href: "assign.html", ic: "list", roles: ["admin", "supervisor"] },
    { key: "inspect", label: "Inspect", href: "inspect.html", ic: "eye", roles: ["admin", "supervisor"] },
    { key: "deepcleans", label: "Deep Cleans", href: "deepcleans.html", ic: "star", roles: ["admin", "supervisor"] },
    { key: "calendar", label: "Calendar", href: "calendar.html", ic: "cal", roles: ["admin", "supervisor"] },
    { key: "maintenance", label: "Maintenance", href: "maintenance.html", ic: "wrench", roles: ["admin", "supervisor"] },
    { key: "documents", label: "Documents", href: "documents.html", ic: "doc", roles: ["admin", "supervisor", "housekeeper"] },
    { key: "reports", label: "Reports", href: "reports.html", ic: "chart", roles: ["admin", "supervisor"] },
    { key: "settings", label: "Settings", href: "settings.html", ic: "gear", roles: ["admin"] }
  ];
  return all.filter(function (i) { return i.roles.indexOf(role) !== -1; });
};

HK.icon = function (name) {
  var m = { cal: "\uD83D\uDCC5", grid: "\u25A6", check: "\u2713", list: "\u2261", eye: "\u25C9", star: "\u2605", wrench: "\u2692", doc: "\u25A4", chart: "\u2637", gear: "\u2699" };
  return m[name] || "\u2022";
};

HK.renderShell = function (activeKey) {
  var role = HK.state.profile.role;
  var items = HK.navItems(role);
  var brand = (HK.state.profile.branding && HK.state.profile.branding.appName) || "Housekeeping Hub";
  var i, it;
  // sidebar
  var side = document.createElement("nav"); side.className = "sidebar";
  var b = document.createElement("div"); b.className = "brand"; b.textContent = brand; side.appendChild(b);
  for (i = 0; i < items.length; i++) {
    it = items[i];
    var a = document.createElement("a"); a.href = it.href; if (it.key === activeKey) { a.className = "active"; }
    a.innerHTML = "<span class=\"ic\">" + HK.icon(it.ic) + "</span> " + it.label; side.appendChild(a);
  }
  var foot = document.createElement("div"); foot.className = "side-foot";
  var out = document.createElement("button"); out.className = "btn btn-secondary btn-block"; out.textContent = "Sign out"; out.onclick = HK.signOut;
  foot.appendChild(out); side.appendChild(foot);
  // topbar (mobile)
  var top = document.createElement("header"); top.className = "topbar";
  top.innerHTML = "<span class=\"brand\">" + brand + "</span><span class=\"spacer\"></span>";
  var outm = document.createElement("button"); outm.className = "btn btn-sm btn-secondary"; outm.textContent = "Sign out"; outm.onclick = HK.signOut; top.appendChild(outm);
  // bottom tabs (mobile) - cap at 5 most relevant
  var tabs = document.createElement("nav"); tabs.className = "tabbar";
  var mobItems = items.slice(0, 5);
  for (i = 0; i < mobItems.length; i++) {
    it = mobItems[i];
    var ta = document.createElement("a"); ta.href = it.href; if (it.key === activeKey) { ta.className = "active"; }
    ta.innerHTML = "<span class=\"ic\">" + HK.icon(it.ic) + "</span>" + it.label; tabs.appendChild(ta);
  }
  return { side: side, top: top, tabs: tabs };
};

// Mounts shell around an existing .main element inside .app wrapper.
HK.mount = function (activeKey) {
  var app = document.querySelector(".app");
  var main = document.querySelector(".main");
  var shell = HK.renderShell(activeKey);
  app.insertBefore(shell.side, main);
  document.body.insertBefore(shell.top, app);
  document.body.appendChild(shell.tabs);
};

HK.esc = function (s) {
  s = (s == null) ? "" : String(s);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
};

HK.qs = function (name) {
  var m = new RegExp("[?&]" + name + "=([^&]*)").exec(window.location.search);
  return m ? decodeURIComponent(m[1]) : null;
};
