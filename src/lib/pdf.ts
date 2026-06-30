import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type AgendaPdfRow = {
  time: string;
  withName: string;
  table: string;
  location?: string;
};

export type CompanyAgendaPdfRow = AgendaPdfRow & {
  contactName: string;
};

const FOOTER_TEXT_PREFIX = "Sistema de Rodada de Negócios Promperu - ";
const FOOTER_LINK_TEXT = "rodada.tur.br";
const FOOTER_TEXT_SUFFIX = " - Suporte WhatsApp (11) 99367-0633";
const FOOTER_LINK_URL = "https://rodada.tur.br";

function drawFooterOnAllPages(doc: jsPDF) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const pageCount = doc.getNumberOfPages();
  const y = H - 24;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const prefixW = doc.getTextWidth(FOOTER_TEXT_PREFIX);
    const linkW = doc.getTextWidth(FOOTER_LINK_TEXT);
    const suffixW = doc.getTextWidth(FOOTER_TEXT_SUFFIX);
    const totalW = prefixW + linkW + suffixW;
    const startX = (W - totalW) / 2;
    doc.setTextColor(110);
    doc.text(FOOTER_TEXT_PREFIX, startX, y);
    doc.setTextColor(0, 102, 204);
    doc.textWithLink(FOOTER_LINK_TEXT, startX + prefixW, y, { url: FOOTER_LINK_URL });
    doc.setTextColor(110);
    doc.text(FOOTER_TEXT_SUFFIX, startX + prefixW + linkW, y);
  }
  doc.setTextColor(0);
}

export function buildAgendaPdf(opts: {
  title: string;
  subtitle?: string;
  ownerName: string;
  rows: AgendaPdfRow[];
  generatedLabel: string;
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(opts.title, 40, 50);

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0);
  if (opts.subtitle) doc.text(opts.subtitle, 40, 70);
  doc.text(opts.ownerName, 40, opts.subtitle ? 88 : 70);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(110);
  doc.text(opts.generatedLabel, W - 40, 60, { align: "right" });
  doc.setTextColor(0);

  autoTable(doc, {
    startY: opts.subtitle ? 110 : 95,
    head: [["Horário / Hora", "Com / Con", "Mesa", "Detalhes"]],
    body: opts.rows.map((r) => [r.time, r.withName, r.table, r.location ?? ""]),
    styles: { fontSize: 10, cellPadding: 8 },
    headStyles: { fillColor: [30, 30, 30], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    columnStyles: {
      0: { cellWidth: 110, fontStyle: "bold" },
      2: { cellWidth: 60, halign: "center" },
    },
  });

  drawFooterOnAllPages(doc);
  return doc;
}

/**
 * Consolidated company agenda PDF.
 *
 * Used by the `cliente` profile export flow. Every meeting belonging to ANY
 * active contact of the company is listed in a single chronologically-sorted
 * table, with the owning contact clearly labelled. This is intentionally
 * different from `buildAgendaPdf` (single-contact slice).
 */
export function buildCompanyAgendaPdf(opts: {
  title: string;
  subtitle?: string;
  companyName: string;
  rows: CompanyAgendaPdfRow[];
  generatedLabel: string;
  totalLabel: string;
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(opts.title, 40, 50);

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0);
  if (opts.subtitle) doc.text(opts.subtitle, 40, 70);
  doc.text(opts.companyName, 40, opts.subtitle ? 88 : 70);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(110);
  doc.text(opts.totalLabel, 40, opts.subtitle ? 104 : 86);

  doc.setFontSize(9);
  doc.text(opts.generatedLabel, W - 40, 60, { align: "right" });
  doc.setTextColor(0);

  autoTable(doc, {
    startY: opts.subtitle ? 120 : 102,
    head: [["Horário / Hora", "Contato", "Com / Con", "Mesa"]],
    body: opts.rows.map((r) => [r.time, r.contactName, r.withName, r.table]),
    styles: { fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: [30, 30, 30], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    columnStyles: {
      0: { cellWidth: 95, fontStyle: "bold" },
      1: { cellWidth: 130 },
      3: { cellWidth: 55, halign: "center" },
    },
  });

  drawFooterOnAllPages(doc);
  return doc;
}

export const __pdfFooterInternals = {
  FOOTER_TEXT_PREFIX,
  FOOTER_LINK_TEXT,
  FOOTER_TEXT_SUFFIX,
  FOOTER_LINK_URL,
  drawFooterOnAllPages,
};