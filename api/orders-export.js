// Private order export: every paid order as a CSV (one row per item), read
// straight from Stripe. Locked behind ADMIN_EXPORT_TOKEN - if that
// environment variable is not set in Vercel the endpoint stays switched off,
// so it only exists while you want it to. Open:
//   https://<your-vercel-domain>/api/orders-export?token=<ADMIN_EXPORT_TOKEN>
// It contains customer names, emails and phone numbers, so keep the file
// private and remove the variable from Vercel when you are done.

const crypto = require('crypto');
const Stripe = require('stripe');

function tokenMatches(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function money(cents) {
  return ((cents || 0) / 100).toFixed(2);
}

function localDate(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleString('sv-SE', { timeZone: 'America/Toronto' });
}

// line-item names look like "Le Hoodie — Marron — Taille M"
function splitItemName(description) {
  const parts = String(description || '').split(' — ');
  const product = parts[0] || '';
  const size = (parts[parts.length - 1] || '').replace(/^Taille\s+/i, '');
  const colour = parts.length >= 3 ? parts[1] : '';
  return { product, colour, size };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (!process.env.ADMIN_EXPORT_TOKEN) {
    res.status(503).send('Export is switched off (no ADMIN_EXPORT_TOKEN configured).');
    return;
  }
  if (!tokenMatches(req.query && req.query.token, process.env.ADMIN_EXPORT_TOKEN)) {
    res.status(401).send('Unauthorized');
    return;
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    res.status(500).send('STRIPE_SECRET_KEY is not configured.');
    return;
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const sessions = [];
    let startingAfter;
    let expandItems = true;
    for (;;) {
      const params = {
        limit: 100,
        status: 'complete',
        starting_after: startingAfter,
        expand: ['data.payment_intent.latest_charge'].concat(expandItems ? ['data.line_items'] : [])
      };
      let page;
      try {
        page = await stripe.checkout.sessions.list(params);
      } catch (e) {
        // if Stripe will not expand line items on a list, fetch them per order instead
        if (expandItems && /expand/i.test(e.message || '')) { expandItems = false; continue; }
        throw e;
      }
      sessions.push(...page.data);
      if (!page.has_more) break;
      startingAfter = page.data[page.data.length - 1].id;
    }
    if (!expandItems) {
      for (let i = 0; i < sessions.length; i += 8) {
        await Promise.all(sessions.slice(i, i + 8).map(async (s) => {
          s.line_items = await stripe.checkout.sessions.listLineItems(s.id, { limit: 100 });
        }));
      }
    }

    const header = [
      'Order date (Toronto)', 'Order ID', 'Customer name', 'Email', 'Phone',
      'Product', 'Colour', 'Size', 'Qty', 'Unit price (before tax)', 'Line total (before tax)',
      'Order subtotal', 'Tax', 'Discount', 'Order total paid', 'Refunded', 'Status'
    ];
    const rows = [header];

    sessions
      .filter((s) => s.payment_status === 'paid')
      .sort((a, b) => a.created - b.created)
      .forEach((s) => {
        const cust = s.customer_details || {};
        const charge = s.payment_intent && typeof s.payment_intent === 'object' ? s.payment_intent.latest_charge : null;
        const refunded = charge && typeof charge === 'object' ? charge.amount_refunded : 0;
        const status = refunded > 0 ? (refunded >= s.amount_total ? 'Refunded' : 'Partly refunded') : 'Paid';
        const items = (s.line_items && s.line_items.data) || [];
        items.forEach((li, i) => {
          const { product, colour, size } = splitItemName(li.description);
          rows.push([
            localDate(s.created), s.id, cust.name, cust.email, cust.phone,
            product, colour, size, li.quantity,
            money(li.price && li.price.unit_amount), money(li.amount_subtotal),
            // order-level amounts only on the first row of each order, so sums stay correct
            i === 0 ? money(s.amount_subtotal) : '',
            i === 0 ? money(s.total_details && s.total_details.amount_tax) : '',
            i === 0 ? money(s.total_details && s.total_details.amount_discount) : '',
            i === 0 ? money(s.amount_total) : '',
            i === 0 ? money(refunded) : '',
            status
          ]);
        });
      });

    const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="maison-fauteux-orders.csv"');
    res.status(200).send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).send('Export failed: ' + (err.message || 'unknown error'));
  }
};
