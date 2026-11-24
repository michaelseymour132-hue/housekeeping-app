// js/site-config.js - the business settings for Housekeeping Hub, all in one place.
// Change prices, trial length or contact details HERE; every page reads them from this file.
// Style: var / function() only (matches the rest of the app). ASCII only.

var HH_SITE = {
  productName: "Housekeeping Hub",
  tagline: "Every room ready. Every time.",

  // The site's home address (custom domain on Vercel).
  siteUrl: "https://www.housekeepinghub.app",

  // Contact address shown on the website, the plan page and the privacy policy.
  // Business mailbox (Zoho Mail, hello@housekeepinghub.app). Leave empty to hide contact links.
  supportEmail: "hello@housekeepinghub.app",

  // The legal name of the business that sells Housekeeping Hub (shown in the privacy policy).
  companyName: "",

  // Free trial length in days. Must match the 15-day ceiling in firestore.rules (trial <= 15 days).
  trialDays: 14,

  currency: "£",

  // Plans shown on the website and the plan page. maxRooms: null = no limit.
  plans: [
    { id: "starter", name: "Starter", price: 19, period: "month", maxRooms: 15,
      blurb: "For guest houses and B&Bs.",
      features: ["Up to 15 rooms", "Unlimited staff", "Every feature included", "Email support"] },
    { id: "pro", name: "Professional", price: 39, period: "month", maxRooms: 40, featured: true,
      blurb: "For small hotels with a full team.",
      features: ["Up to 40 rooms", "Unlimited staff", "Every feature included", "Priority support"] },
    { id: "group", name: "Group", price: null, period: "month", maxRooms: null,
      blurb: "More than 40 rooms, or several properties.",
      features: ["More than 40 rooms", "Every feature included", "Help moving your data in", "Talk to us about several properties"] }
  ]
};
