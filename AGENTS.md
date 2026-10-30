<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Preserve TanStack file routing and integration-managed Cloud clients; uploaded projects must not overwrite runtime configuration or generated integrations.
- Keep shared branding in SiteFrame and semantic styling in src/styles.css so all marketplace pages remain consistent.
- Own the browser session subscription in AuthProvider, and keep payment credentials and settlement operations server-only for consistent authentication and safe wallet updates.
- Verify dashboard access with the existing has_role RPC and active profile status; dashboard reads must use deployed schema so pending management migrations cannot block sign-in.
- The deploy snapshot excludes .env (gitignored), so client-side VITE_ backend constants (project URL + publishable key, public by design) are also wired as fallbacks in vite.config.ts before defineConfig AND baked into import.meta.env via a `define` block, so any build of this code (Lovable publish or a self-hosted export like Cloudflare Pages) works without .env; platform-injected env always wins. Why: a build without them renders a blank screen with "Missing Supabase environment variable(s)".
- Lovable asset pointers (`/__l5e/assets-v1/...`) only resolve on Lovable hosting; self-hosted copies 404 them. Always render pointer URLs through `assetUrl()` from src/lib/assets.ts, which resolves against the canonical published origin. Why: the logo broke on the user's Cloudflare Pages deployment.
