// Excel-style sums typed in a number box: "=16-7" -> 9, "=(21-5)/2" -> 8, "=7.5+0.25" -> 7.75.
// Only numbers, + - * / and brackets are accepted (a small parser, never eval), so a formula
// can't do anything but arithmetic.

/** The value of "=…", or null when the text is not a formula, or NaN when the formula is wrong. */
export function formulaValue(text: string): number | null {
  const t = text.trim();
  if (!t.startsWith("=")) return null;
  const src = t.slice(1).replace(/\s+/g, "").replace(/×/g, "*").replace(/÷/g, "/");
  let i = 0;
  const peek = () => src[i];
  const number = (): number => {
    const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
    if (!m) throw new Error("number expected");
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const factor = (): number => {
    if (peek() === "-") {
      i++;
      return -factor();
    }
    if (peek() === "+") {
      i++;
      return factor();
    }
    if (peek() === "(") {
      i++;
      const v = expr();
      if (peek() !== ")") throw new Error(") expected");
      i++;
      return v;
    }
    return number();
  };
  const term = (): number => {
    let v = factor();
    while (peek() === "*" || peek() === "/") {
      const op = src[i++];
      const r = factor();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (peek() === "+" || peek() === "-") {
      const op = src[i++];
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  try {
    if (!src) return NaN;
    const v = expr();
    if (i !== src.length || !Number.isFinite(v)) return NaN;
    return Math.round(v * 10000) / 10000;
  } catch {
    return NaN;
  }
}

/** "=16-7" -> "9" (a formula is replaced by its value, as Excel shows it); anything else unchanged. */
export function settleFormula(text: string): string {
  const v = formulaValue(text);
  return v === null || Number.isNaN(v) ? text : String(v);
}
