# maison Fauteux

The association's official merch site — single-page HTML/CSS/JS site with a
Stripe Checkout serverless function. The static site is hosted on GitHub
Pages; the one bit of server code (creating a Stripe Checkout session) runs
on Vercel, called cross-origin.

## Structure

- `index.html` — the whole site (styles and script inline)
- `products.json` — the product catalog (name, price, sizes, description) —
  the one file to edit to add or change a product. See `GUIDE_PRODUITS.md`.
- `assets/` — logo and other images
- `api/create-checkout-session.js` — Vercel serverless function that creates
  a real Stripe Checkout session from the cart; reads `products.json` for
  prices so there's a single source of truth between the shop and checkout

## Adding or editing a product

See `GUIDE_PRODUITS.md` (in French) — no code, no terminal, just editing
`products.json` through GitHub's web editor.

## Editing the code with your own Claude

See `GUIDE_CLAUDE.md` (in French) — how a teammate connects their own
Claude account to this GitHub repo, for changes beyond what
`GUIDE_PRODUITS.md` covers.

## Setup for real payments

See `STRIPE_SETUP.md` in the parent project folder for the full walkthrough
(in French) — creating the Stripe account, inviting team members, and
adding `STRIPE_SECRET_KEY` to this project's Vercel Environment Variables.

## Local development

This is a plain static site plus one serverless function — no build step.
To preview locally: `npx vercel dev`.

## Deploying

One `git push` to `main` deploys both halves automatically:
- GitHub Pages rebuilds the static site (https://maisonftx-hub.github.io/maison-fauteux/)
- Vercel redeploys the checkout function (its Git integration is linked to
  this same repo)
