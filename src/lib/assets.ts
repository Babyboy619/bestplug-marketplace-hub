// Lovable asset pointers store a root-relative CDN URL (/__l5e/assets-v1/...)
// that only Lovable hosting serves. On self-hosted copies of the code (e.g. a
// Cloudflare Pages deployment of the export), resolve those URLs against the
// canonical published origin so images keep loading everywhere.
const CANONICAL_ORIGIN = "https://bestplug-marketplace-hub.lovable.app";

export function assetUrl(pointer: { url: string }): string {
  if (/^https?:\/\//i.test(pointer.url)) return pointer.url;
  if (pointer.url.startsWith("/__l5e/")) return `${CANONICAL_ORIGIN}${pointer.url}`;
  return pointer.url;
}
