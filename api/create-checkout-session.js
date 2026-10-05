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

// A product is on sale until its saleEndsAt moment passes — decided here on
// the server clock, so a stale page (or a tampered one) can never get the
// sale price after the sale has ended.
function effectivePrice(p) {
  const onSale = p.salePrice != null && p.saleEndsAt && Date.now() < Date.parse(p.saleEndsAt);
  return onSale ? p.salePrice : p.price;
}

// Checked here (before payment) so a sold-out item fails fast with a clear
// message, rather than after the customer has already gone through
// Stripe's payment page. Stock only actually gets *decremented* once
// payment succeeds — see the decrementStock() call in stripe-webhook.js —
// this function only reads, never writes.
async function checkStock(items) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Inventory tracking isn't configured yet — don't block checkout over
    // a feature that hasn't been set up, just skip the check.
    return { ok: true };
  }

  const orFilter = items
    .map((item) => 'and(product_id.eq.' + encodeURIComponent(item.id) + ',color.eq.' + encodeURIComponent(item.color || '') + ',size.eq.' + encodeURIComponent(item.size) + ')')
    .join(',');

  const res = await fetch(
    process.env.SUPABASE_URL + '/rest/v1/product_stock?select=product_id,color,size,quantity&or=(' + orFilter + ')',
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
      }
    }
  );
  if (!res.ok) {
    // Supabase itself is unreachable/misconfigured — fail open rather than
    // blocking every sale over an inventory-tracking outage.
    console.error('Stock check failed:', res.status, await res.text());
    return { ok: true };
  }
  const rows = await res.json();

  const stockByKey = {};
  rows.forEach((row) => { stockByKey[row.product_id + ':' + (row.color || '') + ':' + row.size] = row.quantity; });

  for (const item of items) {
    const qty = Math.max(1, Math.min(20, parseInt(item.qty, 10) || 1));
    const available = stockByKey[item.id + ':' + (item.color || '') + ':' + item.size];
    // no row at all for that product/color/size = not tracked, don't block it
    if (available !== undefined && available < qty) {
      return { ok: false, id: item.id, size: item.size, color: item.color, available };
    }
  }
  return { ok: true };
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

    const stock = await checkStock(items);
    if (!stock.ok) {
      const product = PRODUCTS.find((p) => p.id === stock.id);
      const name = product ? product.name : stock.id;
      const colorObj = product && product.colors ? product.colors.find((c) => c.id === stock.color) : null;
      const label = name + (colorObj ? ' — ' + colorObj.label : '') + ' — taille ' + stock.size;
      res.status(409).json({
        error: stock.available > 0
          ? label + ' : il n\'en reste que ' + stock.available + '.'
          : label + ' est épuisé.',
        outOfStock: { id: stock.id, size: stock.size, color: stock.color, available: stock.available }
      });
      return;
    }

    // Re-derive line items server-side from products.json rather than
    // trusting client-sent prices — never trust a price the browser sends.
    // This is the same file the storefront reads its catalog from, so a
    // product/price edit only ever has to be made in one place.
    const CATALOG = {};
    PRODUCTS.forEach((p) => { CATALOG[p.id] = { name: p.name, price: effectivePrice(p), colors: p.colors, image: p.image }; });

    const taxRateId = await getOrCreateTaxRate(stripe);

    const line_items = items.map((item) => {
      const product = CATALOG[item.id];
      if (!product) {
        throw new Error('Produit inconnu : ' + item.id);
      }
      const colorObj = product.colors ? (product.colors.find((c) => c.id === item.color) || product.colors[0]) : null;
      const qty = Math.max(1, Math.min(20, parseInt(item.qty, 10) || 1));
      // Stripe needs a fully-qualified, publicly reachable URL here — a
      // relative path like the one stored in products.json is meaningless
      // once it's on Stripe's own checkout page rather than our site.
      const image = colorObj ? colorObj.image : product.image;
      const nameParts = [product.name];
      if (colorObj) nameParts.push(colorObj.label);
      nameParts.push('Taille ' + item.size);
      const productData = { name: nameParts.join(' — ') };
      if (image) {
        productData.images = ['https://maisonfauteux.ca/' + image];
      }
      return {
        price_data: {
          currency: 'cad',
          product_data: productData,
          unit_amount: Math.round(product.price * 100)
        },
        quantity: qty,
        tax_rates: [taxRateId]
      };
    });

    const origin = req.headers.origin || ('https://' + req.headers.host);
    // GitHub Pages project sites live under a /repo-name/ subpath, unlike
    // Vercel's root — the front-end tells us its own path so the redirect
    // back after Stripe lands on the actual site, not the bare domain.
    const base = origin + (typeof returnPath === 'string' ? returnPath : '/');

    // Carries the exact product/size/quantity through to the webhook, so
    // stock can be decremented for the right rows once payment succeeds —
    // the webhook only sees Stripe's own session data, not our request body.
    const cartForMetadata = items.map((item) => ({
      id: item.id,
      size: item.size,
      color: item.color || null,
      qty: Math.max(1, Math.min(20, parseInt(item.qty, 10) || 1))
    }));

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      metadata: { cart: JSON.stringify(cartForMetadata) },
      // Pickup only - no delivery, so no address or shipping rate is collected.
      // The notice sits right above the pay button on Stripe's page.
      custom_text: {
        submit: {
          message: 'Ramassage gratuit — Pavillon Fauteux, 57 rue Louis-Pasteur, Ottawa (certaines périodes). Aucune livraison. Aucun remboursement ni retour — toutes les ventes sont finales. / No refunds or returns — all sales are final.'
        }
      },
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
