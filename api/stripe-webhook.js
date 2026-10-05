// Vercel serverless function — Stripe calls this the instant a checkout
// finishes, so the association gets an email the moment an order comes in
// instead of having to remember to check the Stripe Dashboard.
//
// Requires these environment variables in Vercel (Settings → Environment
// Variables), in addition to STRIPE_SECRET_KEY:
//   STRIPE_WEBHOOK_SECRET      — from Stripe Dashboard → Developers → Webhooks
//   GMAIL_USER                 — the Gmail address notifications are sent from/to
//   GMAIL_APP_PASSWORD         — a Gmail "App Password" (not the normal password)
//   SUPABASE_URL               — optional; inventory tracking is skipped without it
//   SUPABASE_SERVICE_ROLE_KEY  — optional; the *secret* key, never the public one
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

// Shared order details both emails need — line items, totals, and the
// customer's own contact info. Orders are pickup-only, so there is no
// shipping choice or address to carry.
async function getOrderDetails(stripe, session) {
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
  const itemLines = lineItems.data
    .map((li) => '  • ' + li.description + '  ×' + li.quantity + '  —  ' + (li.amount_total / 100).toFixed(2) + ' $')
    .join('\n');

  return {
    customer: session.customer_details || {},
    items: lineItems.data, // raw, for the HTML email's table
    itemLines, // pre-formatted, for the plain-text emails
    subtotal: (session.amount_subtotal / 100).toFixed(2),
    total: (session.amount_total / 100).toFixed(2)
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The customer confirmation's HTML version — the site's actual dark
// palette and fonts, not an invented light template. Tables (not divs)
// throughout, with both a CSS background and an HTML bgcolor attribute on
// every colored cell: a dark design has more to lose than a light one if
// a client ignores the CSS half and falls back to a plain white default,
// so both are set everywhere rather than relying on the CSS alone.
function buildCustomerEmailHtml(details) {
  const ground = '#170c10', groundRaised = '#241318', muted = '#120d0f';
  const ink = '#ece7e3', inkMuted = '#ab929a', line = '#3d2129';
  const garnet = '#7c1f3f', garnetText = '#cc5f7d';
  const serif = "'Playfair Display', Georgia, 'Times New Roman', serif";
  const sans = "'Archivo', Arial, Helvetica, sans-serif";
  const mono = "'Space Mono', 'Courier New', monospace";

  const itemRows = details.items.map((li) => (
    '<tr>' +
      '<td style="padding:12px 0;border-bottom:1px solid ' + line + ';font-family:' + sans + ';font-size:14px;color:' + ink + ';">' +
        escapeHtml(li.description) +
      '</td>' +
      '<td style="padding:12px 0;border-bottom:1px solid ' + line + ';font-family:' + sans + ';font-size:14px;color:' + inkMuted + ';text-align:center;">' +
        '×' + li.quantity +
      '</td>' +
      '<td style="padding:12px 0;border-bottom:1px solid ' + line + ';font-family:' + mono + ';font-size:14px;color:' + ink + ';text-align:right;white-space:nowrap;">' +
        (li.amount_total / 100).toFixed(2) + ' $' +
      '</td>' +
    '</tr>'
  )).join('');

  const pickupHeading = 'Ramassage';
  const pickupBodyText = 'Pavillon Fauteux — 57, rue Louis-Pasteur, Ottawa (Ontario) K1N 6N5, certaines périodes seulement. Nous vous recontacterons dès qu\'elle sera prête.';
  const pickupBox =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">' +
      '<tr><td style="padding:16px 20px;background-color:' + groundRaised + ';border-left:3px solid ' + garnet + ';" bgcolor="' + groundRaised + '">' +
        '<p style="margin:0;font-family:' + mono + ';font-size:12px;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;color:' + garnetText + ';">' + pickupHeading + '</p>' +
        '<p style="margin:6px 0 0;font-family:' + sans + ';font-size:14px;line-height:1.6;color:' + ink + ';">' + pickupBodyText + '</p>' +
      '</td></tr>' +
    '</table>';

  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;1,600&family=Archivo:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">' +
    '<style>body{margin:0;padding:0;}</style>' +
    '</head><body style="margin:0;padding:0;background-color:#0c0709;" bgcolor="#0c0709">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0c0709;" bgcolor="#0c0709">' +
      '<tr><td align="center" style="padding:32px 16px;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:' + ground + ';border-top:3px solid ' + garnet + ';" bgcolor="' + ground + '">' +

          '<tr><td align="center" style="padding:36px 40px 24px;" bgcolor="' + ground + '">' +
            '<img src="https://maisonfauteux.ca/assets/logo-white.png" width="180" alt="Maison Fauteux" style="display:block;width:180px;max-width:60%;height:auto;border:0;">' +
          '</td></tr>' +

          '<tr><td style="padding:8px 40px 40px;" bgcolor="' + ground + '">' +
            '<p style="font-family:' + sans + ';font-size:15px;color:' + ink + ';margin:0 0 4px;">' +
              'Bonjour' + (details.customer.name ? ' ' + escapeHtml(details.customer.name) : '') + ',' +
            '</p>' +
            '<p style="font-family:' + sans + ';font-size:15px;color:' + inkMuted + ';line-height:1.6;margin:0 0 28px;">Merci pour votre commande chez Maison Fauteux !</p>' +

            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
              '<tr>' +
                '<td style="padding:0 0 8px;font-family:' + mono + ';font-size:11px;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;color:' + inkMuted + ';border-bottom:1px solid ' + line + ';">Article</td>' +
                '<td style="padding:0 0 8px;font-family:' + mono + ';font-size:11px;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;color:' + inkMuted + ';border-bottom:1px solid ' + line + ';text-align:center;">Qté</td>' +
                '<td style="padding:0 0 8px;font-family:' + mono + ';font-size:11px;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;color:' + inkMuted + ';border-bottom:1px solid ' + line + ';text-align:right;">Prix</td>' +
              '</tr>' +
              itemRows +
            '</table>' +

            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">' +
              '<tr>' +
                '<td style="padding:10px 0 0;font-family:' + mono + ';font-size:13px;color:' + inkMuted + ';">Sous-total</td>' +
                '<td style="padding:10px 0 0;font-family:' + mono + ';font-size:13px;color:' + ink + ';text-align:right;">' + details.subtotal + ' $</td>' +
              '</tr>' +
              '<tr>' +
                '<td style="padding:4px 0 0;font-family:' + mono + ';font-size:13px;color:' + inkMuted + ';">Ramassage</td>' +
                '<td style="padding:4px 0 0;font-family:' + mono + ';font-size:13px;color:' + ink + ';text-align:right;">Gratuit</td>' +
              '</tr>' +
              '<tr>' +
                '<td style="padding:12px 0 0;border-top:1px solid ' + line + ';font-family:' + mono + ';font-size:15px;font-weight:bold;color:' + ink + ';">Total payé</td>' +
                '<td style="padding:12px 0 0;border-top:1px solid ' + line + ';font-family:' + mono + ';font-size:15px;font-weight:bold;color:' + ink + ';text-align:right;">' + details.total + ' $</td>' +
              '</tr>' +
            '</table>' +

            pickupBox +

            '<p style="font-family:' + sans + ';font-size:12px;line-height:1.6;color:' + inkMuted + ';margin:20px 0 0;">' +
              'Aucun remboursement ni retour — toutes les ventes sont finales.<br>No refunds or returns — all sales are final.' +
            '</p>' +

            '<p style="font-family:' + sans + ';font-size:13px;color:' + inkMuted + ';line-height:1.6;margin:32px 0 0;">' +
              'Des questions sur votre commande&nbsp;? Écrivez-nous à ' +
              '<a href="mailto:' + escapeHtml(details.replyTo) + '" style="color:' + garnetText + ';">' + escapeHtml(details.replyTo) + '</a>.' +
            '</p>' +
          '</td></tr>' +

          '<tr><td align="center" style="padding:18px 40px;border-top:1px solid ' + line + ';" bgcolor="' + muted + '">' +
            '<span style="font-family:' + serif + ';font-style:italic;color:' + ink + ';font-size:13px;">Maison Fauteux</span>' +
          '</td></tr>' +

        '</table>' +
      '</td></tr>' +
    '</table>' +
    '</body></html>'
  );
}

// Called once payment has actually succeeded — atomically decrements
// stock for each item via the decrement_stock() Postgres function (see
// STRIPE_SETUP.md), which refuses to go below zero even under concurrent
// orders. Returns which items are now low, for the notification email.
const LOW_STOCK_THRESHOLD = 3;

async function decrementStock(cartItems) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Inventory tracking isn't set up yet — nothing to decrement.
    return [];
  }

  const results = [];
  for (const item of cartItems) {
    try {
      const res = await fetch(process.env.SUPABASE_URL + '/rest/v1/rpc/decrement_stock', {
        method: 'POST',
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ p_product_id: item.id, p_color: item.color || null, p_size: item.size, p_qty: item.qty })
      });
      if (!res.ok) {
        console.error('Stock decrement request failed for', item.id, item.color, item.size, res.status, await res.text());
        continue;
      }
      const rows = await res.json();
      if (!rows.length) {
        // The function's own guard (quantity >= p_qty) rejected it — stock
        // ran out between the pre-payment check and payment completing.
        // Rare, but not something to silently lose track of.
        console.error('Stock decrement guard rejected (already sold out) for', item.id, item.color, item.size);
        continue;
      }
      results.push({ id: item.id, color: item.color, size: item.size, remaining: rows[0].new_quantity });
    } catch (err) {
      console.error('Stock decrement error for', item.id, item.color, item.size, err);
    }
  }
  return results;
}

// The internal "an order came in" notification — goes to the association's
// own inbox (same address it's sent from, since it's a self-notification).
async function sendOrderNotificationEmail(stripe, session, details, stockResults) {
  const { transporter, gmailUser } = gmailTransporter();

  const lowStock = (stockResults || []).filter((r) => r.remaining <= LOW_STOCK_THRESHOLD);
  const lowStockNote = lowStock.length
    ? '\n⚠️ Stock bas — ' + lowStock.map((r) => r.id + (r.color ? ' ' + r.color : '') + ' (' + r.size + ') : ' + r.remaining + ' restant(s)').join(', ') + '\n'
    : '';

  const body =
    'Nouvelle commande reçue !\n\n' +
    'Client : ' + (details.customer.name || 'N/A') + '\n' +
    'Courriel : ' + (details.customer.email || 'N/A') + '\n' +
    'Téléphone : ' + (details.customer.phone || 'N/A') + '\n\n' +
    'Articles :\n' + details.itemLines + '\n' +
    lowStockNote + '\n' +
    'Sous-total : ' + details.subtotal + ' $\n' +
    'Total payé : ' + details.total + ' $\n\n' +
    'Ramassage gratuit au Pavillon Fauteux (aucune adresse de livraison — commande à ramasser)\n\n' +
    'Voir dans Stripe : https://dashboard.stripe.com/payments/' + session.payment_intent + '\n';

  await transporter.sendMail({
    from: gmailUser,
    to: gmailUser,
    subject: (lowStock.length ? '⚠️ ' : '') + 'Nouvelle commande — ' + details.total + ' $',
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

  const pickupNote = 'Vous pourrez récupérer votre commande au Pavillon Fauteux — 57, rue Louis-Pasteur, Ottawa (Ontario) K1N 6N5 — certaines périodes seulement. Nous vous recontacterons dès qu\'elle sera prête.\n\n';

  const body =
    'Bonjour' + (details.customer.name ? ' ' + details.customer.name : '') + ',\n\n' +
    'Merci pour votre commande chez Maison Fauteux !\n\n' +
    'Voici votre récapitulatif :\n\n' +
    details.itemLines + '\n\n' +
    'Sous-total : ' + details.subtotal + ' $\n' +
    'Ramassage : Gratuit\n' +
    'Total payé : ' + details.total + ' $\n\n' +
    pickupNote +
    'Aucun remboursement ni retour — toutes les ventes sont finales.\nNo refunds or returns — all sales are final.\n\n' +
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

      let cart = [];
      try {
        cart = JSON.parse((session.metadata && session.metadata.cart) || '[]');
      } catch (err) {
        console.error('Could not parse session.metadata.cart:', err);
      }
      const stockResults = await decrementStock(cart).catch((err) => {
        console.error('Stock decrement step failed entirely:', err);
        return [];
      });

      await Promise.allSettled([
        sendOrderNotificationEmail(stripe, session, details, stockResults).catch((err) => {
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
