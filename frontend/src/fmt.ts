// Number and date formatting with the formatters made once. `n.toLocaleString(undefined, opts)`
// builds a new Intl formatter on every call: thousands of chart labels, table cells and SQL rows
// made opening Analysis on a slow office PC mostly that.

const numbers = new Map<string, Intl.NumberFormat>();
const dates = new Map<string, Intl.DateTimeFormat>();

export function numberFormat(opts: Intl.NumberFormatOptions = {}, locale?: string): Intl.NumberFormat {
  const key = `${locale ?? ""}|${JSON.stringify(opts)}`;
  let f = numbers.get(key);
  if (!f) numbers.set(key, (f = new Intl.NumberFormat(locale, opts)));
  return f;
}

export function dateFormat(opts: Intl.DateTimeFormatOptions = {}, locale?: string): Intl.DateTimeFormat {
  const key = `${locale ?? ""}|${JSON.stringify(opts)}`;
  let f = dates.get(key);
  if (!f) dates.set(key, (f = new Intl.DateTimeFormat(locale, opts)));
  return f;
}

/** `n.toLocaleString(locale, opts)`, with a kept formatter. */
export const num = (n: number, opts?: Intl.NumberFormatOptions, locale?: string) => numberFormat(opts, locale).format(n);

/** `d.toLocaleDateString(locale, opts)` / `toLocaleString`, with a kept formatter. */
export const date = (d: Date, opts?: Intl.DateTimeFormatOptions, locale?: string) => dateFormat(opts, locale).format(d);
