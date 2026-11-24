// api/billing-portal.js
// -----------------------------------------------------------------------------
// Opens Stripe's "customer portal" for a paying organisation: the page where the
// admin can change the card, download invoices, or cancel. Stripe hosts it, so
// card details never touch this app.
// -----------------------------------------------------------------------------

var B = require("./_billing");

module.exports = function (req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!B.stripeReady()) { res.status(503).json({ error: "Card payments are not switched on yet.", code: "payments_off" }); return; }

  try { B.ensureApp(); }
  catch (e) { res.status(500).json({ error: e.message }); return; }

  var orgId = (req.body || {}).orgId;
  B.requireOrgAdmin(req, orgId).then(function (ctx) {
    var bill = ctx.org.billing || {};
    if (!bill.customerId) { throw { httpStatus: 400, message: "This account has no payment set up yet." }; }
    return B.stripe("POST", "/billing_portal/sessions", {
      customer: bill.customerId,
      return_url: B.siteUrl() + "/plan.html"
    });
  }).then(function (session) {
    res.status(200).json({ ok: true, url: session.url });
  }).catch(function (err) {
    B.fail(res, err, "Could not open billing.");
  });
};
