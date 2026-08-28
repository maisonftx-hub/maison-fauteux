# maison Fauteux

The association's official merch site — single-page HTML/CSS/JS site with a
Stripe Checkout serverless function, deployed on Vercel.

## Structure

- `index.html` — the whole site (styles and script inline)
- `assets/` — logo and other images
- `api/create-checkout-session.js` — Vercel serverless function that creates
  a real Stripe Checkout session from the cart

## Setup for real payments

See `STRIPE_SETUP.md` in the parent project folder for the full walkthrough
(in French) — creating the Stripe account, inviting team members, and
adding `STRIPE_SECRET_KEY` to this project's Vercel Environment Variables.

## Local development

This is a plain static site plus one serverless function — no build step.
To preview locally: `npx vercel dev`.

## Deploying

Connected to Vercel — pushing to `main` deploys automatically once the
Vercel project's Git integration is linked to this repo.
