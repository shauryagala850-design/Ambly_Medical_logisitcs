import type { SiteRules } from './types';
import { marathonFuturex } from './marathon-futurex';

/** Register every client site's rules file here. The key must equal the site's slug in the database. */
export const SITE_RULES: Record<string, SiteRules> = {
  [marathonFuturex.slug]: marathonFuturex,
};

export function rulesForSite(slug: string): SiteRules {
  const rules = SITE_RULES[slug];
  if (!rules) throw new Error(`No rules file registered for site "${slug}" (see config/sites/index.ts)`);
  return rules;
}
