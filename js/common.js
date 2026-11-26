
// ---- PWA: manifest link + theme color + service worker registration ------
// Added once here so every page (all load common.js) becomes installable and
// gets a cached shell for offline resilience. Never interferes with Firebase.
(function () {
  try {
    var head = document.head || document.getElementsByTagName("head")[0];
    function ensure(sel, make) {
      if (head.querySelector(sel)) { return; }
      head.appendChild(make());
    }
    ensure("link[rel=\"manifest\"]", function () {
      var l = document.createElement("link"); l.rel = "manifest"; l.href = "manifest.json"; return l;
    });
    ensure("meta[name=\"theme-color\"]", function () {
      var m = document.createElement("meta"); m.name = "theme-color"; m.content = "#1a2332"; return m;
    });
    ensure("link[rel=\"apple-touch-icon\"]", function () {
      var l = document.createElement("link"); l.rel = "apple-touch-icon"; l.href = "icon.svg"; return l;
    });
    ensure("meta[name=\"apple-mobile-web-app-capable\"]", function () {
      var m = document.createElement("meta"); m.name = "apple-mobile-web-app-capable"; m.content = "yes"; return m;
    });
  } catch (e) { /* head injection is best-effort */ }

  if ("serviceWorker" in navigator && window.location.protocol === "https:") {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {
        /* registration failure must never block the app */
      });
    });
  }
})();
// js/common.js - shared logic for Housekeeping Hub
// Auth guard, role check, toast, modal, date helpers, photo compression,
// app-shell nav rendering, roomhistory + auditlog writers.
// Style: var / function() / string concatenation / .then().catch() only.

var HK = {};
HK.state = { user: null, profile: null, orgId: null, hotelId: null, org: null };

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
// Call HK.requireAuth(rolesArray, onReady). Redirects to login.html if not
// signed in or if role not permitted. Loads org membership + profile.
HK.requireAuth = function (allowedRoles, onReady) {
  auth.onAuthStateChanged(function (user) {
    if (!user) { window.location.href = HK.signInPage(); return; }
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
      // The organisation record carries the plan, the trial end date and the branding.
      return db.collection("orgs").doc(orgId).get().then(function (o) {
        HK.state.org = o.exists ? o.data() : {};
        return true;
      }).catch(function () { HK.state.org = {}; return true; });
    });
};

// ---- Plan / free trial ---------------------------------------------------
// Returns { plan, onTrial, daysLeft, ended, endsAt }. An org with no trial end
// date (created before trials existed) counts as active.
HK.trial = function () {
  var o = HK.state.org || {};
  var plan = o.plan || "trial";
  var out = { plan: plan, onTrial: false, daysLeft: null, ended: false, endsAt: null };
  if (plan !== "trial" || !o.trialEndsAt) { return out; }
  var ends = o.trialEndsAt.toDate ? o.trialEndsAt.toDate() : new Date(o.trialEndsAt);
  var msLeft = ends.getTime() - Date.now();
  out.onTrial = true;
  out.endsAt = ends;
  out.ended = msLeft <= 0;
  out.daysLeft = out.ended ? 0 : Math.ceil(msLeft / 86400000);
  return out;
};

// The bar across the top of every app page while on trial (or once it ends).
HK.trialBar = function () {
  var t = HK.trial();
  if (!t.onTrial) { return null; }
  var role = (HK.state.profile || {}).role;
  if (role !== "admin" && !t.ended) { return null; }   // the team only hear about it if work is paused
  var bar = document.createElement("div");
  bar.className = "trial-bar" + (t.ended ? " trial-ended" : (t.daysLeft <= 3 ? " trial-soon" : ""));
  var msg = document.createElement("span");
  if (t.ended) {
    var lapsed = !!((HK.state.org || {}).billing || {}).subscriptionId;   // paid before, then stopped
    var what = lapsed ? "subscription" : "free trial";
    msg.textContent = role === "admin"
      ? "Your " + what + " has ended. Your data is safe and you can still view it - choose a plan to keep working."
      : "This account's " + what + " has ended. You can view everything, but changes are paused until your manager chooses a plan.";
  } else {
    msg.textContent = "Free trial - " + t.daysLeft + (t.daysLeft === 1 ? " day" : " days") + " left.";
  }
  bar.appendChild(msg);
  if (role === "admin" && !/plan\.html$/.test(window.location.pathname)) {
    var a = document.createElement("a");
    a.href = "plan.html";
    a.className = "trial-cta";
    a.textContent = t.ended ? "Choose a plan" : "See plans";
    bar.appendChild(a);
  }
  return bar;
};

// Branding lives on the organisation record (Settings > Branding).
HK.brand = function () {
  var b = (HK.state.org && HK.state.org.branding) || {};
  return {
    appName: (b.appName && String(b.appName).trim()) || "Housekeeping Hub",
    color: /^#[0-9a-fA-F]{6}$/.test(b.primaryColor || "") ? b.primaryColor : "",
    logoUrl: /^https:\/\//.test(b.logoUrl || "") ? b.logoUrl : ""
  };
};
HK.applyBrandColour = function () {
  var c = HK.brand().color;
  if (!c) { return; }
  var r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
  function shade(x) { return Math.max(0, Math.round(x * 0.8)); }
  function hex(x) { return ("0" + x.toString(16)).slice(-2); }
  var root = document.documentElement.style;
  root.setProperty("--accent", c);
  root.setProperty("--accent-dark", "#" + hex(shade(r)) + hex(shade(g)) + hex(shade(b)));
  root.setProperty("--accent-soft", "rgba(" + r + "," + g + "," + b + ",0.12)");
};

HK.homeForRole = function (role) {
  if (role === "housekeeper") { return "mytasks.html"; }
  return "dashboard.html";
};

// Housekeepers who sign in with a PIN go back to their property's team page,
// everyone else to the email sign-in page.
HK.teamToken = function () {
  try { return localStorage.getItem("hk_team_token") || ""; } catch (x) { return ""; }
};
HK.signInPage = function () {
  var t = HK.teamToken();
  return t ? "team.html?t=" + encodeURIComponent(t) : "login.html";
};
HK.signOut = function () {
  var pinUser = !!(HK.state.profile && HK.state.profile.loginType === "pin");
  auth.signOut().then(function () {
    if (!pinUser) { try { localStorage.removeItem("hk_team_token"); } catch (x) {} }
    window.location.href = HK.signInPage();
  });
};

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
    { key: "dashboard", label: "Board", href: "dashboard.html", ic: "grid", roles: ["admin", "supervisor"] },
    { key: "console", label: "Console", href: "console.html", ic: "people", roles: ["admin", "supervisor"] },
    { key: "assign", label: "Task sheets", href: "assign.html", ic: "list", roles: ["admin", "supervisor"] },
    { key: "inspect", label: "Inspect", href: "inspect.html", ic: "eye", roles: ["admin", "supervisor"] },
    { key: "mytasks", label: "My Tasks", href: "mytasks.html", ic: "check", roles: ["admin", "supervisor", "housekeeper"] },
    { key: "allocation", label: "Arrivals", href: "allocation.html", ic: "board", roles: ["admin", "supervisor"] },
    { key: "deepcleans", label: "Deep Cleans", href: "deepcleans.html", ic: "star", roles: ["admin", "supervisor"] },
    { key: "calendar", label: "Calendar", href: "calendar.html", ic: "cal", roles: ["admin", "supervisor"] },
    { key: "maintenance", label: "Maintenance", href: "maintenance.html", ic: "wrench", roles: ["admin", "supervisor"] },
    { key: "lostfound", label: "Lost & found", href: "lostfound.html", ic: "box", roles: ["admin", "supervisor", "housekeeper"] },
    { key: "documents", label: "Documents", href: "documents.html", ic: "doc", roles: ["admin", "supervisor", "housekeeper"] },
    { key: "reports", label: "Reports", href: "reports.html", ic: "chart", roles: ["admin", "supervisor"] },
    { key: "settings", label: "Settings", href: "settings.html", ic: "gear", roles: ["admin"] },
    { key: "plan", label: "Plan", href: "plan.html", ic: "plan", roles: ["admin"] }
  ];
  return all.filter(function (i) { return i.roles.indexOf(role) !== -1; });
};

HK.icon = function (name) {
  var m = { people: "\u263A", box: "\u25A3", plan: "\u00A3", board: "\uD83D\uDCCB", cal: "\uD83D\uDCC5", grid: "\u25A6", check: "\u2713", list: "\u2261", eye: "\u25C9", star: "\u2605", wrench: "\u2692", doc: "\u25A4", chart: "\u2637", gear: "\u2699" };
  return m[name] || "\u2022";
};

HK.renderShell = function (activeKey) {
  var role = HK.state.profile.role;
  var items = HK.navItems(role);
  var brand = HK.brand().appName;
  var i, it;
  // sidebar
  var side = document.createElement("nav"); side.className = "sidebar";
  var b = document.createElement("div"); b.className = "brand";
  if (HK.brand().logoUrl) { var lg = document.createElement("img"); lg.src = HK.brand().logoUrl; lg.alt = ""; lg.className = "brand-logo"; b.appendChild(lg); }
  b.appendChild(document.createTextNode(brand)); side.appendChild(b);
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
  var tb = document.createElement("span"); tb.className = "brand"; tb.textContent = brand; top.appendChild(tb);
  var sp = document.createElement("span"); sp.className = "spacer"; top.appendChild(sp);
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
  HK.applyBrandColour();
  app.insertBefore(shell.side, main);
  document.body.insertBefore(shell.top, app);
  document.body.appendChild(shell.tabs);
  var bar = HK.trialBar();
  if (bar) { main.insertBefore(bar, main.firstChild); }
};

HK.esc = function (s) {
  s = (s == null) ? "" : String(s);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
};

HK.qs = function (name) {
  var m = new RegExp("[?&]" + name + "=([^&]*)").exec(window.location.search);
  return m ? decodeURIComponent(m[1]) : null;
};

// ---- PWA: manifest link + theme color + service worker registration ------
// Added once here so every page (all load common.js) becomes installable and
// gets a cached shell for offline resilience. Never interferes with Firebase.
(function () {
  try {
    var head = document.head || document.getElementsByTagName("head")[0];
    function ensure(sel, make) {
      if (head.querySelector(sel)) { return; }
      head.appendChild(make());
    }
    ensure("link[rel=\"manifest\"]", function () {
      var l = document.createElement("link"); l.rel = "manifest"; l.href = "manifest.json"; return l;
    });
    ensure("meta[name=\"theme-color\"]", function () {
      var m = document.createElement("meta"); m.name = "theme-color"; m.content = "#1a2332"; return m;
    });
    ensure("link[rel=\"apple-touch-icon\"]", function () {
      var l = document.createElement("link"); l.rel = "apple-touch-icon"; l.href = "icon.svg"; return l;
    });
    ensure("meta[name=\"apple-mobile-web-app-capable\"]", function () {
      var m = document.createElement("meta"); m.name = "apple-mobile-web-app-capable"; m.content = "yes"; return m;
    });
  } catch (e) { /* head injection is best-effort */ }

  if ("serviceWorker" in navigator && window.location.protocol === "https:") {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {
        /* registration failure must never block the app */
      });
    });
  }
})();
