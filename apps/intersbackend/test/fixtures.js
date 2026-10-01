import * as XLSX from 'xlsx';

export function xlsxBuffer(sheets) {
  const workbook = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([name, rows]) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name));
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
