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
  'http://localhost:3000',
  'http://localhost:5000'
];

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
        quantity: qty
      };
    });

    const origin = req.headers.origin || ('https://' + req.headers.host);
    // GitHub Pages project sites live under a /repo-name/ subpath, unlike
    // Vercel's root — the front-end tells us its own path so the redirect
    // back after Stripe lands on the actual site, not the bare domain.
    const base = origin + (typeof returnPath === 'string' ? returnPath : '/');

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      shipping_address_collection: { allowed_countries: ['CA'] },
      phone_number_collection: { enabled: true },
      success_url: base + '?commande=succes',
      cancel_url: base + '?commande=annulee'
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Une erreur est survenue.' });
  }
};
