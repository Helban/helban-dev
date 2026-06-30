# helban.dev

Personal services storefront. One hand-coded page that lists fixed-scope packages
(websites, scrapers, Chrome extensions, automations) with a starting price, a live
proof link for each, and an order flow. Polish and English, dark glass theme.

No framework, no build step, no runtime dependencies. The page is fully readable
with JavaScript disabled (Polish is the markup default).

## Stack

- Single `index.html` with the CSS inlined, so first paint never waits on a stylesheet.
- `js/main.js` (deferred): PL/EN language toggle, mobile nav, order prefill, lead form.
- Inter (display/body) + JetBrains Mono (labels/prices), self-hosted in `fonts/` as
  subset woff2 (latin + latin-ext, so Polish glyphs are covered), `@font-face` inline
  with `font-display: swap`. The two above-the-fold fonts are preloaded.
- All imagery is inline SVG (favicon, OG card, demo thumbnails), so there is no raster
  payload and no layout shift.

## Internationalisation

Polish text sits in the DOM. Every translatable leaf element carries a `data-en`
attribute with the English string; `main.js` snapshots the Polish defaults on load and
swaps `textContent`, input placeholders, and prices (`data-price-pl` / `data-price-en`)
on toggle. The choice persists in `localStorage` and can be forced with `?lang=en`.

The UI language also sets a hidden form field: Polish routes orders to Useme, English to
Upwork.

## Order flow (no payment on the site)

There is no checkout here, by design. Clicking "order" on a package fills the contact
form with the chosen service and price, and the message is delivered as a lead through
[Web3Forms](https://web3forms.com). The contract, invoice, and escrow live on Useme (PL)
or Upwork (EN); the client only pays once the contract is signed there.

To enable lead delivery, get a free Web3Forms key (paste your email, no account) and
replace `REPLACE_WITH_WEB3FORMS_ACCESS_KEY` in `js/main.js`. Until then the form shows a
"email me directly" fallback instead of failing silently.

## Measured quality (Lighthouse, mobile)

- Accessibility 100, Best Practices 100, SEO 100.
- LCP 868 ms and CLS 0.00 under 4x CPU + Slow 4G throttling.

## Local development

```
python3 -m http.server 8787 --directory .
```

Then open http://127.0.0.1:8787/.

## Deploy

Static, Cloudflare Pages (Git integration, output directory `/`), custom domain
`helban.dev`. `_headers` caches `fonts/` and `assets/` for a year.
