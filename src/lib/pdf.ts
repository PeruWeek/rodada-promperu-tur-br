import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type AgendaPdfRow = {
  time: string;
  withName: string;
  table: string;
  location?: string;
  website?: string | null;
};

export type CompanyAgendaPdfRow = AgendaPdfRow & {
  contactName: string;
};

const DEFAULT_TECH_FOOTER = {
  text: "IAutonoma.com.br",
  url: "https://iautonoma.com.br/",
} as const;

function drawFooterOnAllPages(
  doc: jsPDF,
  opts: { siteText?: string; siteUrl?: string } = {},
) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const pageCount = doc.getNumberOfPages();
  const y = H - 24;

  const siteText = (opts.siteText || "").trim();
  const siteUrl = (opts.siteUrl || "").trim();
  const prefix1 = siteText ? `Sistema de ${siteText} - ` : "";
  const mid = " - Suporte WhatsApp (11) 99367-0633 - by ";

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);

    const w1 = doc.getTextWidth(prefix1);
    const link1Text = siteUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "") || "";
    const wLink1 = link1Text ? doc.getTextWidth(link1Text) : 0;
    const w2 = doc.getTextWidth(mid);
    const wLink2 = doc.getTextWidth(DEFAULT_TECH_FOOTER.text);

    const totalW = w1 + wLink1 + w2 + wLink2;
    let x = (W - totalW) / 2;

    doc.setTextColor(110);
    if (prefix1) {
      doc.text(prefix1, x, y);
      x += w1;
    }

    if (link1Text) {
      doc.setTextColor(0, 102, 204);
      doc.textWithLink(link1Text, x, y, { url: siteUrl });
      x += wLink1;
    }

    doc.setTextColor(110);
    doc.text(mid, x, y);
    x += w2;

    doc.setTextColor(0, 102, 204);
    doc.textWithLink(DEFAULT_TECH_FOOTER.text, x, y, { url: DEFAULT_TECH_FOOTER.url });
  }

  doc.setTextColor(0);
}

export function buildAgendaPdf(opts: {
  title: string;
  subtitle?: string;
  ownerName: string;
  rows: AgendaPdfRow[];
  generatedLabel: string;
  footerSiteText?: string;
  footerSiteUrl?: string;
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(opts.title, 40, 50);

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(0);
  if (opts.subtitle) doc.text(opts.subtitle, 40, 70);
  doc.setFont("helvetica", "bold");
  doc.text(opts.ownerName, 40, opts.subtitle ? 88 : 70);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(110);
  doc.text(opts.generatedLabel, W - 40, 70, { align: "right" });
  doc.setTextColor(0);

  autoTable(doc, {
    startY: opts.subtitle ? 110 : 95,
    head: [["Horário / Hora", "Com / Con", "Mesa", "Detalhes"]],
    body: opts.rows.map((r) => [
      r.time,
      r.website ? `${r.withName}\n${r.website}` : r.withName,
      r.table,
      r.location ?? "",
    ]),
    styles: { fontSize: 10, cellPadding: 8 },
    headStyles: { fillColor: [30, 30, 30], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    columnStyles: {
      0: { cellWidth: 110, fontStyle: "bold" },
      2: { cellWidth: 60, halign: "center" },
    },
    didDrawCell: (data) => {
      if (data.section !== "body" || data.column.index !== 1) return;
      const row = opts.rows[data.row.index];
      if (!row?.website) return;
      const url = /^https?:\/\//i.test(row.website)
        ? row.website
        : `https://${row.website}`;
      const padLeft = 8;
      const padBottom = 8;
      const x = data.cell.x + padLeft;
      const y = data.cell.y + data.cell.height - padBottom;
      const w = doc.getTextWidth(row.website);
      doc.link(x, y - 10, w, 12, { url });
    },
  });

  drawFooterOnAllPages(doc, { siteText: opts.footerSiteText, siteUrl: opts.footerSiteUrl });
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
  footerSiteText?: string;
  footerSiteUrl?: string;
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(opts.title, 40, 50);

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(0);
  if (opts.subtitle) doc.text(opts.subtitle, 40, 70);
  doc.setFont("helvetica", "bold");
  doc.text(opts.companyName, 40, opts.subtitle ? 88 : 70);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(110);
  doc.text(opts.totalLabel, 40, opts.subtitle ? 104 : 86);

  doc.setFontSize(9);
  doc.text(opts.generatedLabel, W - 40, 70, { align: "right" });
  doc.setTextColor(0);

  autoTable(doc, {
    startY: opts.subtitle ? 120 : 102,
    head: [["Horário / Hora", "Contato", "Com / Con", "Mesa"]],
    body: opts.rows.map((r) => [
      r.time,
      r.contactName,
      r.website ? `${r.withName}\n${r.website}` : r.withName,
      r.table,
    ]),
    styles: { fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: [30, 30, 30], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    columnStyles: {
      0: { cellWidth: 95, fontStyle: "bold" },
      1: { cellWidth: 130 },
      3: { cellWidth: 55, halign: "center" },
    },
    didDrawCell: (data) => {
      if (data.section !== "body" || data.column.index !== 2) return;
      const row = opts.rows[data.row.index];
      if (!row?.website) return;
      const url = /^https?:\/\//i.test(row.website)
        ? row.website
        : `https://${row.website}`;
      const padLeft = 6;
      const padBottom = 6;
      const x = data.cell.x + padLeft;
      const y = data.cell.y + data.cell.height - padBottom;
      const w = doc.getTextWidth(row.website);
      doc.link(x, y - 10, w, 12, { url });
    },
  });

  drawFooterOnAllPages(doc, { siteText: opts.footerSiteText, siteUrl: opts.footerSiteUrl });
  return doc;
}

export const __pdfFooterInternals = {
  drawFooterOnAllPages,
};
