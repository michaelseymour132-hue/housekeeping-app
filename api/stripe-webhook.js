// api/stripe-webhook.js
// -----------------------------------------------------------------------------
// Stripe calls this address whenever something happens to a subscription:
// a payment goes through, a card fails, a customer cancels. This is the ONLY
// place that switches an organisation's plan on or off.
//
// HOW IT STAYS SAFE: anyone on the internet can call this address, so nothing in
// the incoming message is trusted. The function takes only the event's id from
// the message and then asks Stripe directly, using the secret key, "is this event
// real, and what does it say?". Only Stripe's own answer is acted on. A made-up
// message therefore achieves nothing.
//
// It is also safe to receive the same event twice, or events out of order: every
// time, the function reads the subscription's CURRENT state from Stripe and
// writes that, rather than replaying what the event said.
//
// What gets written on the organisation record (orgs/{orgId}):
//   plan        "starter" | "pro" while paid; back to "trial" (ended) if it lapses
//   planName    "Starter" | "Professional"
//   billing     { customerId, subscriptionId, status, priceId, currentPeriodEnd,
//                 cancelAtPeriodEnd, updatedAt }
// -----------------------------------------------------------------------------

var B = require("./_billing");

// Subscription states that keep the app switched on. "past_due" stays on while
// Stripe retries the card (it emails the customer); it only lapses if Stripe
// gives up and marks it canceled or unpaid.
var LIVE = { active: true, trialing: true, past_due: true };

function eventIdFrom(req) {
  var b = req.body;
  if (b && typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (b && Buffer.isBuffer(b)) { try { b = JSON.parse(b.toString("utf8")); } catch (e2) { b = null; } }
  var id = b && b.id;
  if (typeof id !== "string" || !/^evt_[A-Za-z0-9_]+$/.test(id)) { return null; }
  return id;
}

// Write the subscription's current state onto its organisation.
function applySubscription(sub, hintOrgId) {
  var admin = B.admin;
  var db = admin.firestore();
  var orgId = (sub.metadata && sub.metadata.orgId) || hintOrgId;
  if (!orgId || typeof orgId !== "string" || orgId.indexOf("/") !== -1) { return Promise.resolve("no-org"); }

  var item = sub.items && sub.items.data && sub.items.data[0];
  var priceId = item && item.price && item.price.id;
  var plan = B.planByPriceId(priceId);
  var periodEnd = sub.current_period_end || (item && item.current_period_end) || null;
  var ref = db.doc("orgs/" + orgId);

  return db.runTransaction(function (tx) {
    return tx.get(ref).then(function (snap) {
      if (!snap.exists) { return "no-org"; }
      var org = snap.data();
      var existing = org.billing || {};
      // Ignore news about an OLD subscription once a newer one is on record.
      if (existing.subscriptionId && existing.subscriptionId !== sub.id && LIVE[existing.status] && !LIVE[sub.status]) {
        return "stale";
      }
      var billing = {
        customerId: typeof sub.customer === "string" ? sub.customer : ((sub.customer && sub.customer.id) || existing.customerId || null),
        subscriptionId: sub.id,
        status: sub.status,
        priceId: priceId || null,
        currentPeriodEnd: periodEnd ? admin.firestore.Timestamp.fromMillis(periodEnd * 1000) : null,
        cancelAtPeriodEnd: sub.cancel_at_period_end === true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      var update = { billing: billing };
      if (LIVE[sub.status] && plan) {
        update.plan = plan.id;
        update.planName = plan.name;
        update.planRequest = admin.firestore.FieldValue.delete();
      } else if (!LIVE[sub.status]) {
        // Lapsed: back to an ended trial, which pauses changes but keeps all data readable.
        update.plan = "trial";
        update.planName = admin.firestore.FieldValue.delete();
        update.trialEndsAt = admin.firestore.Timestamp.now();
      }
      tx.update(ref, update);
      return LIVE[sub.status] ? "live" : "lapsed";
    });
  });
}

function handle(event) {
  var type = event.type;
  var obj = event.data && event.data.object;
  if (!obj) { return Promise.resolve("ignored"); }

  if (type === "checkout.session.completed") {
    if (obj.mode !== "subscription" || !obj.subscription) { return Promise.resolve("ignored"); }
    var subId = typeof obj.subscription === "string" ? obj.subscription : obj.subscription.id;
    var hint = obj.client_reference_id || (obj.metadata && obj.metadata.orgId);
    return B.stripe("GET", "/subscriptions/" + encodeURIComponent(subId)).then(function (sub) {
      return applySubscription(sub, hint);
    });
  }

  if (type === "customer.subscription.created" || type === "customer.subscription.updated" ||
      type === "customer.subscription.deleted") {
    // Read the live state rather than trusting the order events arrive in.
    return B.stripe("GET", "/subscriptions/" + encodeURIComponent(obj.id)).then(function (sub) {
      return applySubscription(sub, null);
    });
  }

  return Promise.resolve("ignored");
}

module.exports = function (req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!B.stripeReady()) { res.status(503).json({ error: "Card payments are not switched on yet." }); return; }

  try { B.ensureApp(); }
  catch (e) { res.status(500).json({ error: e.message }); return; }

  var id = eventIdFrom(req);
  if (!id) { res.status(400).json({ error: "Not a Stripe event." }); return; }

  // Ask Stripe for the real event. A forged id simply is not found.
  B.stripe("GET", "/events/" + encodeURIComponent(id)).then(function (event) {
    return handle(event);
  }).then(function (result) {
    res.status(200).json({ received: true, result: result });
  }).catch(function (err) {
    // A non-200 answer makes Stripe try again later, which is what we want on a real failure.
    B.fail(res, err, "Could not process the event.");
  });
};

// Exposed for the automated tests only.
module.exports._handle = handle;
module.exports._applySubscription = applySubscription;
module.exports._eventIdFrom = eventIdFrom;
