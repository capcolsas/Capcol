export function csvCell(value) {
  const raw = String(value ?? '');
  return raw.includes(',') || raw.includes('"') || raw.includes('\n') ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function parseDelimitedRows(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') { cur += '"'; i += 1; } else inQuotes = !inQuotes;
    } else if ((ch === ',' || ch === ';' || ch === '\t') && !inQuotes) {
      row.push(cur);
      cur = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (cur !== '' || row.length) { row.push(cur); rows.push(row); row = []; cur = ''; }
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
