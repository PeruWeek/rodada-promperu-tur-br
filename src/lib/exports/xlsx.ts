import * as XLSX from "xlsx";

import { downloadBlob } from "./csv";

export function downloadXlsx(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
) {
  const aoa: Array<Array<string | number | null>> = [headers, ...rows.map((r) => r.map((v) => (v ?? null) as string | number | null))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  downloadBlob(
    filename,
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
  );
}