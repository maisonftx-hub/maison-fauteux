// Vercel serverless function — creates a real Stripe Checkout Session from
// the cart the front-end sends, then hands back the URL to redirect to.
//
// The site itself is hosted separately on GitHub Pages (a static host with
// no server of its own), so this function is called cross-origin — hence
// the CORS handling below. Only ALLOWED_ORIGINS may call this.
//
// Requires the STRIPE_SECRET_KEY environment variable to be set in the
// Vercel project (Settings → Environment Variables), never committed to
// the repo. See ../STRIPE_SETUP.md for the one-time setup steps.

const Stripe = require('stripe');
const PRODUCTS = require('../products.json');

const ALLOWED_ORIGINS = [
  'https://maisonftx-hub.github.io',
  // the custom domain, once DNS is pointed at GitHub Pages — kept here
  // ahead of time so nothing needs redeploying the moment it goes live
  'https://maisonfauteux.ca',
  'https://www.maisonfauteux.ca',
  'http://localhost:3000',
  'http://localhost:5000'
];

// Ontario HST, flat — the association operates out of the Faculty of Law
// (Pavillon Fauteux, Ottawa), so this is a fixed rate rather than Stripe's
// automatic per-province tax calculation (which needs Stripe Tax enabled
// and a business origin address configured in the Dashboard). Keep this in
// sync with the identical constant in index.html's renderCart().
const TAX_RATE_PERCENT = 13;
const TAX_DISPLAY_NAME = 'TVH (Ontario)';

// A flat shipping fee that scales with order size until the real carrier
// cost is known. Adjust these three numbers as needed — nothing else in
// the codebase needs to change to update the shipping price.
const SHIPPING = {
  baseCents: 800,       // first item
  perExtraCents: 300,   // each additional item
  capCents: 1800        // never charge more than this per order
};

function computeShippingCents(items) {
  const totalQty = items.reduce((sum, item) => {
    return sum + Math.max(1, Math.min(20, parseInt(item.qty, 10) || 1));
  }, 0);
  const amount = SHIPPING.baseCents + SHIPPING.perExtraCents * Math.max(0, totalQty - 1);
  return Math.min(amount, SHIPPING.capCents);
}

// Stripe requires an existing Tax Rate object id on each line item (there's
// no way to pass a bare percentage inline) — find the one we've already
// created, or create it once. No manual Dashboard step needed either way.
async function getOrCreateTaxRate(stripe) {
  const existing = await stripe.taxRates.list({ active: true, limit: 100 });
  const found = existing.data.find((t) => t.display_name === TAX_DISPLAY_NAME && t.percentage === TAX_RATE_PERCENT);
  if (found) return found.id;

  const created = await stripe.taxRates.create({
    display_name: TAX_DISPLAY_NAME,
    percentage: TAX_RATE_PERCENT,
    jurisdiction: 'ON',
    country: 'CA',
    inclusive: false
  });
  return created.id;
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    res.status(500).json({ error: 'STRIPE_SECRET_KEY is not configured on this deployment.' });
    return;
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const { items, returnPath } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Panier vide.' });
      return;
    }

    // Re-derive line items server-side from products.json rather than
    // trusting client-sent prices — never trust a price the browser sends.
    // This is the same file the storefront reads its catalog from, so a
    // product/price edit only ever has to be made in one place.
    const CATALOG = {};
    PRODUCTS.forEach((p) => { CATALOG[p.id] = { name: p.name, price: p.price }; });

    const taxRateId = await getOrCreateTaxRate(stripe);

    const line_items = items.map((item) => {
      const product = CATALOG[item.id];
      if (!product) {
        throw new Error('Produit inconnu : ' + item.id);
      }
      const qty = Math.max(1, Math.min(20, parseInt(item.qty, 10) || 1));
      return {
        price_data: {
          currency: 'cad',
          product_data: {
            name: product.name + ' — Taille ' + item.size
          },
          unit_amount: Math.round(product.price * 100)
        },
        quantity: qty,
        tax_rates: [taxRateId]
      };
    });

    const shippingCents = computeShippingCents(items);

    const origin = req.headers.origin || ('https://' + req.headers.host);
    // GitHub Pages project sites live under a /repo-name/ subpath, unlike
    // Vercel's root — the front-end tells us its own path so the redirect
    // back after Stripe lands on the actual site, not the bare domain.
    const base = origin + (typeof returnPath === 'string' ? returnPath : '/');

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      shipping_address_collection: { allowed_countries: ['CA'] },
      // Two options shown on Stripe's own page — free pickup at the
      // faculty, or shipping at a fee that scales with order size (see
      // computeShippingCents above).
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: 0, currency: 'cad' },
            display_name: 'Ramassage gratuit — Pavillon Fauteux, 57 rue Louis-Pasteur (certaines périodes)'
          }
        },
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: shippingCents, currency: 'cad' },
            display_name: 'Livraison au Canada',
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 3 },
              maximum: { unit: 'business_day', value: 10 }
            }
          }
        }
      ],
      phone_number_collection: { enabled: true },
      // Shows a real "Add promotion code" field on Stripe's own checkout
      // page — Stripe validates and applies the discount itself, nothing
      // custom to build or trust here. The actual codes are created in the
      // Stripe Dashboard (Product catalog → Coupons), not in this code.
      allow_promotion_codes: true,
      success_url: base + '?commande=succes',
      cancel_url: base + '?commande=annulee'
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Une erreur est survenue.' });
  }
};
