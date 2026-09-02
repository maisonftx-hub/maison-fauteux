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

// .trim() guards against the most common copy-paste mistake — a stray
// space or newline pasted along with the address/app password, which
// Gmail's SMTP would otherwise reject (or silently misdeliver) without an
// obvious error pointing back to "there's whitespace in your env var".
function gmailTransporter() {
  const gmailUser = (process.env.GMAIL_USER || '').trim();
  const gmailPass = (process.env.GMAIL_APP_PASSWORD || '').trim();
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailPass }
  });
  return { transporter, gmailUser };
}

// Shared order details both emails need — line items, the shipping/pickup
// choice, the collected address, and the customer's own contact info.
async function getOrderDetails(stripe, session) {
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
  const itemLines = lineItems.data
    .map((li) => '  • ' + li.description + '  ×' + li.quantity + '  —  ' + (li.amount_total / 100).toFixed(2) + ' $')
    .join('\n');

  let shippingLabel = 'Non spécifié';
  let isPickup = false;
  if (session.shipping_cost && session.shipping_cost.shipping_rate) {
    try {
      const rate = await stripe.shippingRates.retrieve(session.shipping_cost.shipping_rate);
      isPickup = session.shipping_cost.amount_total === 0;
      shippingLabel = rate.display_name + ' (' +
        (session.shipping_cost.amount_total === 0 ? 'Gratuit' : (session.shipping_cost.amount_total / 100).toFixed(2) + ' $') + ')';
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
  const address = addressParts.length ? addressParts.join(', ') : 'Non fournie';

  return {
    customer: session.customer_details || {},
    itemLines,
    shippingLabel,
    isPickup,
    address,
    subtotal: (session.amount_subtotal / 100).toFixed(2),
    total: (session.amount_total / 100).toFixed(2)
  };
}

// The internal "an order came in" notification — goes to the association's
// own inbox (same address it's sent from, since it's a self-notification).
async function sendOrderNotificationEmail(stripe, session, details) {
  const { transporter, gmailUser } = gmailTransporter();

  const body =
    'Nouvelle commande reçue !\n\n' +
    'Client : ' + (details.customer.name || 'N/A') + '\n' +
    'Courriel : ' + (details.customer.email || 'N/A') + '\n' +
    'Téléphone : ' + (details.customer.phone || 'N/A') + '\n\n' +
    'Articles :\n' + details.itemLines + '\n\n' +
    'Sous-total : ' + details.subtotal + ' $\n' +
    'Total payé : ' + details.total + ' $\n\n' +
    'Livraison/Ramassage : ' + details.shippingLabel + '\n' +
    'Adresse : ' + details.address + '\n\n' +
    'Voir dans Stripe : https://dashboard.stripe.com/payments/' + session.payment_intent + '\n';

  await transporter.sendMail({
    from: gmailUser,
    to: gmailUser,
    subject: 'Nouvelle commande — ' + details.total + ' $',
    text: body
  });
  // makes it possible to tell "sent successfully" apart from "silently
  // never even tried" when checking `vercel logs` later
  console.log('Order notification email sent to', gmailUser, 'for session', session.id);
}

// The customer-facing confirmation — this is the email the site's own
// "Merci." confirmation page already promises ("un courriel de
// confirmation vous sera envoyé sous peu"), so it needs to actually exist.
async function sendCustomerConfirmationEmail(stripe, session, details) {
  const customerEmail = details.customer.email;
  if (!customerEmail) {
    console.error('No customer email on session', session.id, '— skipping customer confirmation.');
    return;
  }

  const { transporter, gmailUser } = gmailTransporter();

  const pickupNote = details.isPickup
    ? 'Vous pourrez récupérer votre commande au Pavillon Fauteux — 57, rue Louis-Pasteur, Ottawa (Ontario) K1N 6N5 — certaines périodes seulement. Nous vous recontacterons dès qu\'elle sera prête.\n\n'
    : 'Votre commande sera livrée à :\n' + details.address + '\n\n';

  const body =
    'Bonjour' + (details.customer.name ? ' ' + details.customer.name : '') + ',\n\n' +
    'Merci pour votre commande chez Maison Fauteux !\n\n' +
    'Voici votre récapitulatif :\n\n' +
    details.itemLines + '\n\n' +
    'Sous-total : ' + details.subtotal + ' $\n' +
    'Livraison/Ramassage : ' + details.shippingLabel + '\n' +
    'Total payé : ' + details.total + ' $\n\n' +
    pickupNote +
    'Des questions sur votre commande ? Écrivez-nous à ' + gmailUser + '.\n\n' +
    '— Maison Fauteux';

  await transporter.sendMail({
    from: gmailUser,
    to: customerEmail,
    subject: 'Confirmation de votre commande — Maison Fauteux',
    text: body
  });
  console.log('Customer confirmation email sent to', customerEmail, 'for session', session.id);
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
    const session = event.data.object;
    // Each email is independent — a problem with one (e.g. a bad customer
    // address) should never prevent the other from sending. Don't fail the
    // webhook over an email problem either way — Stripe would keep
    // retrying the same order forever otherwise. Log failures so they're
    // visible in Vercel's function logs instead.
    try {
      const details = await getOrderDetails(stripe, session);
      await Promise.allSettled([
        sendOrderNotificationEmail(stripe, session, details).catch((err) => {
          console.error('Failed to send order notification email:', err);
        }),
        sendCustomerConfirmationEmail(stripe, session, details).catch((err) => {
          console.error('Failed to send customer confirmation email:', err);
        })
      ]);
    } catch (err) {
      console.error('Failed to build order details:', err);
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
