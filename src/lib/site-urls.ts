/**
 * Central URL builder — the ONLY correct way to produce an absolute link
 * to the current site from either client or server code. Never concatenate
 * `rodada.promperu.tur.br` or any hostname manually.
 */
import type { SiteContext } from "./site-context";

export function buildSiteUrl(site: SiteContext, path: string = "/"): string {
  const base = (site.siteUrl || "").replace(/\/+$/, "");
  if (!base) return path.startsWith("/") ? path : `/${path}`;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function buildEmailFromLabel(site: SiteContext): string | null {
  if (!site.emailFromAddress) return null;
  if (site.emailFromName) return `${site.emailFromName} <${site.emailFromAddress}>`;
  return site.emailFromAddress;
}