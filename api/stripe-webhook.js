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
    items: lineItems.data, // raw, for the HTML email's table
    itemLines, // pre-formatted, for the plain-text emails
    shippingLabel,
    isPickup,
    address,
    subtotal: (session.amount_subtotal / 100).toFixed(2),
    total: (session.amount_total / 100).toFixed(2)
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The customer confirmation's HTML version — inline styles throughout
// (email clients strip <style> blocks unpredictably). Light background by
// design (reads reliably across every email client and prints cleanly,
// unlike dark-mode email), but built from the actual Brand Kit colors —
// Almond Cream as the card, Midnight Violet/Wine Plum for text, rather
// than an invented light palette.
function buildCustomerEmailHtml(details) {
  const paper = '#ECE1D5', ink = '#331C27', inkSoft = '#532932', line = '#d9cbc3';
  const garnet = '#532932', garnetWash = '#ede6e3';
  const serif = "'Source Serif 4', Georgia, 'Times New Roman', serif";
  const sans = "Arial, Helvetica, sans-serif"; // Glacial Indifference can't reliably self-host in email clients

  const itemRows = details.items.map((li) => (
    '<tr>' +
      '<td style="padding:12px 0;border-bottom:1px solid ' + line + ';font-family:' + sans + ';font-size:14px;color:' + ink + ';">' +
        escapeHtml(li.description) +
      '</td>' +
      '<td style="padding:12px 0;border-bottom:1px solid ' + line + ';font-family:' + sans + ';font-size:14px;color:' + inkSoft + ';text-align:center;">' +
        '×' + li.quantity +
      '</td>' +
      '<td style="padding:12px 0;border-bottom:1px solid ' + line + ';font-family:' + sans + ';font-size:14px;color:' + ink + ';text-align:right;white-space:nowrap;">' +
        (li.amount_total / 100).toFixed(2) + ' $' +
      '</td>' +
    '</tr>'
  )).join('');

  const pickupBox = details.isPickup
    ? '<div style="margin-top:24px;padding:16px 20px;background:' + garnetWash + ';border-left:3px solid ' + garnet + ';">' +
        '<p style="margin:0;font-family:' + sans + ';font-size:13px;font-weight:bold;letter-spacing:0.04em;text-transform:uppercase;color:' + garnet + ';">Ramassage</p>' +
        '<p style="margin:6px 0 0;font-family:' + sans + ';font-size:14px;line-height:1.6;color:' + ink + ';">Pavillon Fauteux — 57, rue Louis-Pasteur, Ottawa (Ontario) K1N 6N5, certaines périodes seulement. Nous vous recontacterons dès qu\'elle sera prête.</p>' +
      '</div>'
    : '<div style="margin-top:24px;padding:16px 20px;background:' + garnetWash + ';border-left:3px solid ' + garnet + ';">' +
        '<p style="margin:0;font-family:' + sans + ';font-size:13px;font-weight:bold;letter-spacing:0.04em;text-transform:uppercase;color:' + garnet + ';">Livraison</p>' +
        '<p style="margin:6px 0 0;font-family:' + sans + ';font-size:14px;line-height:1.6;color:' + ink + ';">' + escapeHtml(details.address) + '</p>' +
      '</div>';

  return (
    '<div style="background:#cebbb1;padding:32px 16px;font-family:' + sans + ';">' +
      '<div style="max-width:560px;margin:0 auto;background:' + paper + ';border-top:3px solid ' + garnet + ';">' +
        '<div style="padding:40px 40px 8px;text-align:center;">' +
          '<div style="font-family:' + serif + ';font-style:italic;font-weight:600;font-size:26px;color:' + ink + ';">Maison Fauteux</div>' +
        '</div>' +
        '<div style="padding:16px 40px 40px;">' +
          '<p style="font-family:' + sans + ';font-size:15px;color:' + ink + ';margin:0 0 4px;">' +
            'Bonjour' + (details.customer.name ? ' ' + escapeHtml(details.customer.name) : '') + ',' +
          '</p>' +
          '<p style="font-family:' + sans + ';font-size:15px;color:' + inkSoft + ';line-height:1.6;margin:0 0 28px;">Merci pour votre commande chez Maison Fauteux !</p>' +

          '<table role="presentation" width="100%" style="border-collapse:collapse;">' +
            '<tr>' +
              '<td style="padding:0 0 8px;font-family:' + sans + ';font-size:11px;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;color:' + inkSoft + ';border-bottom:1px solid ' + line + ';">Article</td>' +
              '<td style="padding:0 0 8px;font-family:' + sans + ';font-size:11px;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;color:' + inkSoft + ';border-bottom:1px solid ' + line + ';text-align:center;">Qté</td>' +
              '<td style="padding:0 0 8px;font-family:' + sans + ';font-size:11px;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;color:' + inkSoft + ';border-bottom:1px solid ' + line + ';text-align:right;">Prix</td>' +
            '</tr>' +
            itemRows +
          '</table>' +

          '<table role="presentation" width="100%" style="border-collapse:collapse;margin-top:4px;">' +
            '<tr>' +
              '<td style="padding:10px 0 0;font-family:' + sans + ';font-size:13px;color:' + inkSoft + ';">Sous-total</td>' +
              '<td style="padding:10px 0 0;font-family:' + sans + ';font-size:13px;color:' + ink + ';text-align:right;">' + details.subtotal + ' $</td>' +
            '</tr>' +
            '<tr>' +
              '<td style="padding:4px 0 0;font-family:' + sans + ';font-size:13px;color:' + inkSoft + ';">Livraison/Ramassage</td>' +
              '<td style="padding:4px 0 0;font-family:' + sans + ';font-size:13px;color:' + ink + ';text-align:right;">' + escapeHtml(details.shippingLabel) + '</td>' +
            '</tr>' +
            '<tr>' +
              '<td style="padding:12px 0 0;border-top:1px solid ' + line + ';font-family:' + sans + ';font-size:15px;font-weight:bold;color:' + ink + ';">Total payé</td>' +
              '<td style="padding:12px 0 0;border-top:1px solid ' + line + ';font-family:' + sans + ';font-size:15px;font-weight:bold;color:' + ink + ';text-align:right;">' + details.total + ' $</td>' +
            '</tr>' +
          '</table>' +

          pickupBox +

          '<p style="font-family:' + sans + ';font-size:13px;color:' + inkSoft + ';line-height:1.6;margin:32px 0 0;">' +
            'Des questions sur votre commande&nbsp;? Écrivez-nous à ' +
            '<a href="mailto:' + escapeHtml(details.replyTo) + '" style="color:' + garnet + ';">' + escapeHtml(details.replyTo) + '</a>.' +
          '</p>' +
        '</div>' +
        '<div style="background:' + ink + ';padding:18px 40px;text-align:center;">' +
          '<span style="font-family:' + serif + ';font-style:italic;color:#ECE1D5;font-size:13px;">Maison Fauteux</span>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
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

  details.replyTo = gmailUser;

  await transporter.sendMail({
    from: gmailUser,
    to: customerEmail,
    subject: 'Confirmation de votre commande — Maison Fauteux',
    text: body, // plain-text fallback for clients that don't render HTML
    html: buildCustomerEmailHtml(details)
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
