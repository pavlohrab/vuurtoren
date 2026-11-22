# site

vuurtoren.app: one static page, no build step. Open `index.html` in a browser to see it.

## Publish

Cloudflare Pages: Workers & Pages → Create → Pages → Connect to Git → this repository.

- Build command: none
- Build output directory: `site`

Then Custom domains → `vuurtoren.app`. Every push to `main` publishes it again.
