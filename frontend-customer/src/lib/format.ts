/** Money/distance formatting from minor units and meters. */
export function formatMoney(amountMinor: number, currency: string, locale: string): string {
  const digits = new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amountMinor / 10 ** digits);
}
/** Display unit for a locale: miles for en-GB/en-US, km everywhere else. */
export function unitFor(locale: string): 'km' | 'mi' {
  return locale.startsWith('en-GB') || locale === 'en-US' ? 'mi' : 'km';
}

export function formatDistance(meters: number, locale: string): string {
  const imperial = unitFor(locale) === 'mi';
  if (imperial) return `${(meters / 1609.34).toFixed(1)} mi`;
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}
