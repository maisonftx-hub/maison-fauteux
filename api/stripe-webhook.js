// Vercel serverless function — Stripe calls this the instant a checkout
// finishes, so the association gets an email the moment an order comes in
// instead of having to remember to check the Stripe Dashboard.
//
// Requires three environment variables in Vercel (Settings → Environment
// Variables), in addition to STRIPE_SECRET_KEY:
//   STRIPE_WEBHOOK_SECRET  — from Stripe Dashboard → Developers → Webhooks
//   GMAIL_USER             — the Gmail address notifications are sent from/to
//   GMAIL_APP_PASSWORD     — a Gmail "App Password" (not the normal password)
// See ../STRIPE_SETUP.md for the one-time setup steps for all of these.

const Stripe = require('stripe');
const nodemailer = require('nodemailer');

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function sendOrderEmail(stripe, session) {
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
  const itemLines = lineItems.data
    .map((li) => '  • ' + li.description + '  ×' + li.quantity + '  —  ' + (li.amount_total / 100).toFixed(2) + ' $')
    .join('\n');

  let shippingLabel = 'Non spécifié';
  if (session.shipping_cost && session.shipping_cost.shipping_rate) {
    try {
      const rate = await stripe.shippingRates.retrieve(session.shipping_cost.shipping_rate);
      shippingLabel = rate.display_name + ' (' + (session.shipping_cost.amount_total / 100).toFixed(2) + ' $)';
    } catch (e) { /* fall back to the default label above */ }
  }

  const addressParts = session.shipping_details && session.shipping_details.address
    ? [
        session.shipping_details.address.line1,
        session.shipping_details.address.line2,
        session.shipping_details.address.city,
        session.shipping_details.address.state,
        session.shipping_details.address.postal_code
      ].filter(Boolean)
    : [];
  const address = addressParts.length ? addressParts.join(', ') : 'Ramassage — aucune adresse fournie';

  const customer = session.customer_details || {};

  const body =
    'Nouvelle commande reçue !\n\n' +
    'Client : ' + (customer.name || 'N/A') + '\n' +
    'Courriel : ' + (customer.email || 'N/A') + '\n' +
    'Téléphone : ' + (customer.phone || 'N/A') + '\n\n' +
    'Articles :\n' + itemLines + '\n\n' +
    'Sous-total : ' + (session.amount_subtotal / 100).toFixed(2) + ' $\n' +
    'Total payé : ' + (session.amount_total / 100).toFixed(2) + ' $\n\n' +
    'Livraison/Ramassage : ' + shippingLabel + '\n' +
    'Adresse : ' + address + '\n\n' +
    'Voir dans Stripe : https://dashboard.stripe.com/payments/' + session.payment_intent + '\n';

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });

  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: process.env.GMAIL_USER,
    subject: 'Nouvelle commande — ' + (session.amount_total / 100).toFixed(2) + ' $',
    text: body
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    // Fail loudly in logs, but tell Stripe not to retry — this only means
    // the one-time webhook setup step hasn't been finished yet.
    console.error('Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET.');
    res.status(200).json({ received: true, warning: 'Webhook not fully configured yet.' });
    return;
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  let event;

  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    res.status(400).send('Webhook Error: ' + err.message);
    return;
  }

  if (event.type === 'checkout.session.completed') {
    try {
      await sendOrderEmail(stripe, event.data.object);
    } catch (err) {
      // Don't fail the webhook over an email problem — Stripe would keep
      // retrying a failed order forever otherwise. Log it so it's visible
      // in Vercel's function logs instead.
      console.error('Failed to send order notification email:', err);
    }
  }

  res.status(200).json({ received: true });
};

// Stripe signs the webhook body using the *raw* bytes — Vercel's default
// JSON body-parsing would re-serialize it slightly differently and break
// signature verification, so it's turned off here (readRawBody above reads
// it manually instead). Must be set after module.exports is assigned the
// handler function above, not before — setting it earlier attaches it to
// the wrong object once module.exports gets reassigned.
module.exports.config = { api: { bodyParser: false } };
