# ⚠️ Read this first: two copies, two live sites

Agents and maintainers: this project has **two copies of the code** and **two live websites**.
Keep all four in step, or the game goes backwards for someone.

## Two copies of the code

| Copy | What it is | Notes |
| --- | --- | --- |
| **Owner copy** (`blackbird-owner-full.zip`, sent by the owner) | Full working folder with git history, `HANDOFF.md`, `tools/` and `functions/` | **Source of truth.** The live sites are built from this copy. |
| **Public GitHub repo** ([anythingeverything556-blip/browser-flight-sim](https://github.com/anythingeverything556-blip/browser-flight-sim)) | Mirror the owner updates by hand (*Add file → Upload files*) | Can lag behind the owner copy. Its commit history is only "Add files via upload". |

1. **Before changing anything,** compare the two copies. Work from the newer one (normally the owner copy).
2. **Never deploy from the GitHub copy** unless it matches the owner copy file for file.
   Deploying an older copy silently removes features from the live sites.
3. **When you finish,** give the owner two things:
   - an updated owner zip (without `node_modules/`, `dist/` or `.wrangler/`), and
   - a zip of every file that now differs from GitHub, with repository paths, so they can upload it.
   Tell them GitHub is behind until they upload it.

## Two live sites, one build

| Address | Cloudflare Pages project | Role |
| --- | --- | --- |
| https://earthwing.pages.dev | `earthwing` | **Main address** (canonical URL, link previews, README) |
| https://sr71-blackbird.pages.dev | `sr71-blackbird` | Old address from the *Blackbird* days; keep it live so existing links work |

- Both are direct-upload projects on the same Cloudflare account, with production branch `main`.
- **Update both sites every time.** `npm run deploy` (`tools/deploy.sh`) builds once and deploys to both.
  If you deploy by hand, run `wrangler pages deploy dist --branch main` for **both** project names.
- After deploying, check that both addresses serve the new build (for example, compare the `<title>` and the
  `assets/main-*.js` file name in each page).
- Settings made on one project must be made on the other too, for example the live-traffic relay variables
  (`tools/set-traffic-relay.sh` now sets them on both).
- Do not rename or delete the `sr71-blackbird` project.
