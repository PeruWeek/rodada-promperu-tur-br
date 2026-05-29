import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type AgendaPdfRow = {
  time: string;
  withName: string;
  table: string;
  location?: string;
};

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

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(110);
  if (opts.subtitle) doc.text(opts.subtitle, 40, 70);
  doc.text(opts.ownerName, 40, opts.subtitle ? 88 : 70);

  doc.setFontSize(9);
  doc.text(opts.generatedLabel, W - 40, 40, { align: "right" });
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

  return doc;
}