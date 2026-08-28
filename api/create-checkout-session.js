// Vercel serverless function — creates a real Stripe Checkout Session from
// the cart the front-end sends, then hands back the URL to redirect to.
//
// Requires the STRIPE_SECRET_KEY environment variable to be set in the
// Vercel project (Settings → Environment Variables), never committed to
// the repo. See ../STRIPE_SETUP.md for the one-time setup steps.

const Stripe = require('stripe');

module.exports = async (req, res) => {
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
    const { items } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Panier vide.' });
      return;
    }

    // Re-derive line items server-side from a fixed catalog rather than
    // trusting client-sent prices — never trust a price the browser sends.
    const CATALOG = {
      hoodie: { name: 'Le Hoodie', price: 85 },
      crewneck: { name: 'Le Crewneck', price: 70 },
      casquette: { name: 'La Casquette', price: 40 },
      tee: { name: 'Le Tee', price: 45 },
      quarterzip: { name: 'Le Quart-Zip', price: 78 },
      teeoversize: { name: 'Le Tee Oversize', price: 48 }
    };

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

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      shipping_address_collection: { allowed_countries: ['CA'] },
      phone_number_collection: { enabled: true },
      success_url: origin + '/?commande=succes',
      cancel_url: origin + '/?commande=annulee'
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Une erreur est survenue.' });
  }
};
