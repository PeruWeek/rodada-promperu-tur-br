// Utilities for Brazilian masks and validation.

export const UF_LIST = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB",
  "PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
] as const;

const onlyDigits = (s: string) => s.replace(/\D+/g, "");

export function formatCNPJ(value: string): string {
  const d = onlyDigits(value).slice(0, 14);
  const p1 = d.slice(0, 2);
  const p2 = d.slice(2, 5);
  const p3 = d.slice(5, 8);
  const p4 = d.slice(8, 12);
  const p5 = d.slice(12, 14);
  let out = p1;
  if (d.length > 2) out += "." + p2;
  if (d.length > 5) out += "." + p3;
  if (d.length > 8) out += "/" + p4;
  if (d.length > 12) out += "-" + p5;
  return out;
}

export function isValidCNPJ(value: string): boolean {
  const c = onlyDigits(value);
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;
  const calc = (base: string) => {
    const len = base.length;
    const start = len - 7;
    let sum = 0;
    let pos = len + 1;
    for (let i = 0; i < len; i++) {
      sum += Number(base[i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(c.slice(0, 12));
  const d2 = calc(c.slice(0, 12) + d1);
  return d1 === Number(c[12]) && d2 === Number(c[13]);
}

// Valid Brazilian area codes (DDDs)
const VALID_DDD = new Set([
  11,12,13,14,15,16,17,18,19,21,22,24,27,28,31,32,33,34,35,37,38,41,42,43,44,
  45,46,47,48,49,51,53,54,55,61,62,63,64,65,66,67,68,69,71,73,74,75,77,79,81,
  82,83,84,85,86,87,88,89,91,92,93,94,95,96,97,98,99,
]);

export function formatBRPhone(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return "(" + d;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  if (rest.length <= 8) {
    // landline: 4+4
    return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  }
  // mobile: 5+4
  return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
}

export function isValidBRPhone(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 10 && d.length !== 11) return false;
  const ddd = Number(d.slice(0, 2));
  if (!VALID_DDD.has(ddd)) return false;
  if (d.length === 11 && d[2] !== "9") return false;
  return true;
}

/** Convert a masked/raw BR phone to E.164 (+55...). Returns "" if invalid. */
export function toE164BR(value: string): string {
  const d = onlyDigits(value);
  if (!isValidBRPhone(d)) return "";
  return "+55" + d;
}