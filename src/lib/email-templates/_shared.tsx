import * as React from "react";

export const PRIMARY = "#D52B1E";
export const FONT =
  '"Source Sans 3", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';

export const main = { backgroundColor: "#ffffff", fontFamily: FONT };
export const container = {
  padding: "32px 28px",
  maxWidth: "560px",
  margin: "0 auto",
};
export const h1 = {
  fontSize: "22px",
  fontWeight: "700",
  color: "#111111",
  margin: "0 0 16px",
  lineHeight: "1.3",
};
export const text = {
  fontSize: "15px",
  color: "#333333",
  lineHeight: "1.6",
  margin: "0 0 16px",
};
export const small = {
  fontSize: "13px",
  color: "#666666",
  lineHeight: "1.5",
  margin: "0 0 8px",
};
export const button = {
  backgroundColor: PRIMARY,
  color: "#ffffff",
  padding: "12px 24px",
  borderRadius: "6px",
  textDecoration: "none",
  fontWeight: "600",
  fontSize: "15px",
  display: "inline-block",
};
export const card = {
  backgroundColor: "#f7f7f8",
  border: "1px solid #e6e6e8",
  borderRadius: "8px",
  padding: "16px 18px",
  margin: "0 0 24px",
};
export const footer = {
  fontSize: "12px",
  color: "#999999",
  margin: "32px 0 0",
  borderTop: "1px solid #eeeeee",
  paddingTop: "16px",
};

const PT_MONTHS = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];
const ES_MONTHS = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

// Format an ISO instant in America/Sao_Paulo (UTC-3, no DST today).
export function formatSlot(
  startIso: string,
  endIso: string,
  lang: "pt-BR" | "es",
): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const offsetMs = -3 * 60 * 60 * 1000;
  const s = new Date(start.getTime() + offsetMs);
  const e = new Date(end.getTime() + offsetMs);
  const months = lang === "es" ? ES_MONTHS : PT_MONTHS;
  const day = s.getUTCDate();
  const month = months[s.getUTCMonth()];
  const pad = (n: number) => String(n).padStart(2, "0");
  const hhmm = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const dateLabel =
    lang === "es"
      ? `${day} de ${month}`
      : `${day} de ${month}`;
  return `${dateLabel} · ${hhmm(s)}–${hhmm(e)} (BRT)`;
}