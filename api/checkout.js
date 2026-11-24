// api/checkout.js
// -----------------------------------------------------------------------------
// Starts a card payment. The plan page calls this when an admin presses
// "Choose Starter" or "Choose Professional". It answers with the address of
// Stripe's secure payment page, and the browser goes there.
//
// Nothing is switched on here: the plan only becomes active when Stripe tells
// api/stripe-webhook.js that the payment went through.
//
// Checks, in order: payments are switched on; the caller is a signed-in active
// admin of the organisation; the plan exists; the property is not too big for
// the plan; the organisation does not already have a live subscription.
// -----------------------------------------------------------------------------

var B = require("./_billing");

module.exports = function (req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!B.stripeReady()) { res.status(503).json({ error: "Card payments are not switched on yet.", code: "payments_off" }); return; }

  try { B.ensureApp(); }
  catch (e) { res.status(500).json({ error: e.message }); return; }

  var body = req.body || {};
  var orgId = body.orgId;
  var plan = B.PLANS[body.planId];
  if (!plan) { res.status(400).json({ error: "That plan cannot be bought online." }); return; }
  var priceId = process.env[plan.priceEnv];
  if (!priceId) { res.status(503).json({ error: "Card payments are not switched on for this plan yet.", code: "payments_off" }); return; }

  var ctx;
  B.requireOrgAdmin(req, orgId).then(function (c) {
    ctx = c;
    var bill = ctx.org.billing || {};
    if (bill.subscriptionId && (bill.status === "active" || bill.status === "trialing" || bill.status === "past_due")) {
      throw { httpStatus: 409, message: "This account already has a subscription. Use Manage billing to change it.", code: "already_subscribed" };
    }
    return B.countActiveRooms(ctx.db, orgId);
  }).then(function (rooms) {
    if (plan.maxRooms !== null && rooms > plan.maxRooms) {
      throw { httpStatus: 400, message: "The " + plan.name + " plan covers up to " + plan.maxRooms + " rooms and you have " + rooms + "." };
    }
    var bill = ctx.org.billing || {};
    var params = {
      mode: "subscription",
      line_items: { 0: { price: priceId, quantity: 1 } },
      success_url: B.siteUrl() + "/plan.html?paid=1",
      cancel_url: B.siteUrl() + "/plan.html?cancelled=1",
      client_reference_id: orgId,
      allow_promotion_codes: "true",
      billing_address_collection: "required",
      metadata: { orgId: orgId, planId: plan.id },
      subscription_data: { metadata: { orgId: orgId, planId: plan.id } }
    };
    // Re-use the Stripe customer if this org has paid before; otherwise pre-fill the email.
    if (bill.customerId) { params.customer = bill.customerId; }
    else if (ctx.email) { params.customer_email = ctx.email; }
    return B.stripe("POST", "/checkout/sessions", params);
  }).then(function (session) {
    res.status(200).json({ ok: true, url: session.url });
  }).catch(function (err) {
    B.fail(res, err, "Could not start the payment.");
  });
};
