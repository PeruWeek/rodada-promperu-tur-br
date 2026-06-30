import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import JSZip from "jszip";

import { buildAgendaPdf } from "@/lib/pdf";
import type { BulkAgendaEntry } from "@/lib/staff-exports.functions";
import { downloadBlob } from "./csv";
import { sortRowsForExport } from "./sort";

function sortAgendaEntries(entries: BulkAgendaEntry[]): BulkAgendaEntry[] {
  // Rule: order by company name (nome fantasia); when missing, fallback to
  // participant name; stable tiebreak by profileId.
  return sortRowsForExport(entries, {
    tradeName: (e) => e.companyName,
    fullName: (e) => e.profileName,
    id: (e) => e.profileId,
  });
}

function safeName(s: string) {
  return s.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 80) || "agenda";
}

export function buildConsolidatedAgendaPdf(opts: {
  title: string;
  subtitle?: string;
  generatedLabel: string;
  emptyLabel: string;
  entries: BulkAgendaEntry[];
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  let first = true;

  for (const entry of sortAgendaEntries(opts.entries)) {
    if (!first) doc.addPage();
    first = false;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(opts.title, 40, 50);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(110);
    if (opts.subtitle) doc.text(opts.subtitle, 40, 66);
    doc.text(opts.generatedLabel, W - 40, 40, { align: "right" });
    doc.setTextColor(0);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    const headerLine =
      entry.role === "exhibitor" && entry.tableNumber
        ? `Mesa ${entry.tableNumber} · ${entry.companyName}`
        : entry.companyName;
    doc.text(headerLine, 40, 92);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(110);
    doc.text(entry.profileName, 40, 108);
    doc.setTextColor(0);

    if (entry.rows.length === 0) {
      doc.setFontSize(11);
      doc.text(opts.emptyLabel, 40, 140);
      continue;
    }

    autoTable(doc, {
      startY: 124,
      head: [["Horário", "Com / Con", "Mesa", "Detalhes"]],
      body: entry.rows.map((r) => [r.time, r.withName, r.table, r.location ?? ""]),
      styles: { fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: [30, 30, 30], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      columnStyles: {
        0: { cellWidth: 100, fontStyle: "bold" },
        2: { cellWidth: 50, halign: "center" },
      },
    });
  }

  return doc;
}

export async function downloadAgendaZip(opts: {
  title: string;
  subtitle?: string;
  generatedLabel: string;
  entries: BulkAgendaEntry[];
  filename: string;
}) {
  const zip = new JSZip();
  const nonEmpty = sortAgendaEntries(opts.entries.filter((e) => e.rows.length > 0));
  if (nonEmpty.length === 0) throw new Error("EMPTY");

  const usedNames = new Set<string>();
  for (const entry of nonEmpty) {
    const doc = buildAgendaPdf({
      title: opts.title,
      subtitle: opts.subtitle
        ? `${opts.subtitle} · ${entry.companyName}`
        : entry.companyName,
      ownerName: entry.profileName,
      generatedLabel: opts.generatedLabel,
      rows: entry.rows,
    });
    const ab = doc.output("arraybuffer");
    const prefix =
      entry.role === "exhibitor" && entry.tableNumber
        ? `mesa-${entry.tableNumber.padStart(2, "0")}-`
        : "";
    let name = `${prefix}${safeName(entry.companyName)}-${safeName(entry.profileName)}.pdf`;
    let i = 2;
    while (usedNames.has(name)) {
      name = `${prefix}${safeName(entry.companyName)}-${safeName(entry.profileName)}-${i}.pdf`;
      i++;
    }
    usedNames.add(name);
    zip.file(name, ab);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(opts.filename, blob);
}