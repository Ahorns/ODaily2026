# ODaily private writer

This directory is a separate, private Cloudflare Pages application. It gives
the author a phone-friendly form and writes each saved entry back to
`log/YYYY-MM-DD.qmd` in the existing GitHub repository. That commit triggers
the public Quarto build.

The browser never receives a GitHub token. The Pages Function holds the token,
and every `/api/*` request also requires the email identity injected by
Cloudflare Access.

## One-time Cloudflare setup

Create two **Direct Upload** Pages projects:

- `odaily2026` for the public `_site` directory.
- `odaily-write` for this private writer.

In the `odaily-write` project, set these production variables and secrets:

| Name | Value |
|---|---|
| `GITHUB_TOKEN` | Fine-grained GitHub token, repository access only, Contents read/write |
| `GITHUB_OWNER` | `Ahorns` |
| `GITHUB_REPO` | `ODaily2026` |
| `GITHUB_BRANCH` | `main` |
| `WRITER_EMAIL` | The only email allowed to save; comma-separate if needed |
| `PUBLIC_SITE_URL` | The public Pages address, for example `https://odaily2026.pages.dev` |

Enable a Cloudflare Access policy for the complete `odaily-write.pages.dev`
hostname and allow only the same email address. The API middleware refuses all
requests that do not contain a matching Cloudflare Access identity header, so
an accidentally public project still cannot write to GitHub.

In the GitHub repository, add these Actions secrets:

| Name | Value |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `CLOUDFLARE_API_TOKEN` | Token with Account / Cloudflare Pages / Edit |

The fine-grained GitHub token belongs only in the Cloudflare writer project.
Do not add it to this repository or to browser JavaScript.

## Local verification

The formatter and parser have no external dependencies:

```sh
npm test
npm run check
```

To exercise Pages Functions locally, copy `.dev.vars.example` to `.dev.vars`,
replace the placeholder values, and run `npx wrangler pages dev public` from
this directory. The deployed version should always be protected by Access.
