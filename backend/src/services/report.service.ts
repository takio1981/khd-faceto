import { Response } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { RowDataPacket } from 'mysql2';
import { pool } from '../db';
import { config } from '../config';

export type ReportType = 'daily' | 'monthly' | 'yearly';

const STATUS_LABEL: Record<string, string> = {
  on_time: 'ตรงเวลา',
  late: 'สาย',
  absent: 'ขาด',
  ot: 'OT',
};
const SCANTYPE_LABEL: Record<string, string> = {
  check_in: 'เข้างาน',
  check_out: 'ออกงาน',
  ot: 'OT',
};

export interface ReportRow {
  employee_code: string;
  full_name: string;
  department: string | null;
  employee_type: string;
  scan_time: string;
  scan_type: string;
  status: string;
  scan_location_name: string | null;
}

// Build the WHERE clause + params for each report period
function periodFilter(type: ReportType, q: any): { where: string; params: any[]; title: string } {
  if (type === 'daily') {
    const date = q.date || new Date().toISOString().slice(0, 10);
    return { where: 'DATE(ar.scan_time) = ?', params: [date], title: `รายงานประจำวัน ${date}` };
  }
  if (type === 'monthly') {
    const year = Number(q.year);
    const month = Number(q.month);
    return {
      where: 'YEAR(ar.scan_time) = ? AND MONTH(ar.scan_time) = ?',
      params: [year, month],
      title: `รายงานประจำเดือน ${String(month).padStart(2, '0')}/${year}`,
    };
  }
  // yearly
  const year = Number(q.year);
  return { where: 'YEAR(ar.scan_time) = ?', params: [year], title: `รายงานประจำปี ${year}` };
}

export async function fetchReportRows(type: ReportType, q: any): Promise<{ rows: ReportRow[]; title: string }> {
  const { where, params, title } = periodFilter(type, q);
  const extra: string[] = [];
  if (q.employeeId) { extra.push('ar.employee_id = ?'); params.push(q.employeeId); }
  if (q.status)     { extra.push('ar.status = ?'); params.push(q.status); }
  if (q.scanType)   { extra.push('ar.scan_type = ?'); params.push(q.scanType); }
  if (q.department) { extra.push('e.department = ?'); params.push(q.department); }
  if (q.employeeType) { extra.push('e.employee_type = ?'); params.push(q.employeeType); }
  if (q.search) {
    extra.push('(e.full_name LIKE ? OR e.employee_code LIKE ? OR e.department LIKE ?)');
    const kw = `%${q.search}%`;
    params.push(kw, kw, kw);
  }
  const whereSql = [where, ...extra].join(' AND ');

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT e.employee_code, e.full_name, e.department, e.employee_type,
            ar.scan_time, ar.scan_type, ar.status, sl.name AS scan_location_name
       FROM attendance_records ar
       JOIN employees e ON e.id = ar.employee_id
       LEFT JOIN scan_locations sl ON sl.id = ar.scan_location_id
      WHERE ${whereSql}
      ORDER BY ar.scan_time ASC`,
    params
  );
  return { rows: rows as ReportRow[], title };
}

function fmtDateTime(v: string): string {
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---- Excel ----------------------------------------------------------------

export async function buildExcel(res: Response, type: ReportType, rows: ReportRow[], title: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = config.companyName;
  const ws = wb.addWorksheet('Report');

  const headers = ['รหัสพนักงาน', 'ชื่อ-นามสกุล', 'แผนก', 'วันที่/เวลา', 'ประเภท', 'สถานะ', 'จุดสแกน'];

  // Title row 1: organisation
  ws.mergeCells(1, 1, 1, headers.length);
  const orgCell = ws.getCell(1, 1);
  orgCell.value = config.companyName;
  orgCell.font = { bold: true, size: 14, color: { argb: 'FF0A6E3E' } };
  orgCell.alignment = { horizontal: 'center' };

  // Title row 2: system name + report title
  ws.mergeCells(2, 1, 2, headers.length);
  const subCell = ws.getCell(2, 1);
  subCell.value = `${config.appName} — ${title}`;
  subCell.font = { size: 11, color: { argb: 'FF475569' } };
  subCell.alignment = { horizontal: 'center' };

  // Header row
  const headerRow = ws.getRow(3);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    cell.alignment = { horizontal: 'center' };
  });

  // Data rows
  rows.forEach((r, idx) => {
    const row = ws.getRow(4 + idx);
    row.getCell(1).value = r.employee_code;
    row.getCell(2).value = r.full_name;
    row.getCell(3).value = r.department || '-';
    row.getCell(4).value = fmtDateTime(r.scan_time);
    row.getCell(5).value = SCANTYPE_LABEL[r.scan_type] || r.scan_type;
    row.getCell(6).value = STATUS_LABEL[r.status] || r.status;
    row.getCell(7).value = r.scan_location_name || '-';
    if (idx % 2 === 1) {
      for (let c = 1; c <= headers.length; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      }
    }
  });

  // Auto width
  const widths = [16, 28, 18, 20, 12, 12, 22];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="report-${type}-${Date.now()}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

// ---- PDF ------------------------------------------------------------------

// Try to locate a Thai-capable TTF font so PDF text renders correctly.
function findThaiFont(): string | null {
  const candidates = [
    path.join(__dirname, '../../assets/fonts/Sarabun-Regular.ttf'),
    path.join(process.cwd(), 'assets/fonts/Sarabun-Regular.ttf'),
    'C:/Windows/Fonts/tahoma.ttf',
    'C:/Windows/Fonts/THSarabunNew.ttf',
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return null;
}

export function buildPdf(res: Response, type: ReportType, rows: ReportRow[], title: string): void {
  const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape' });

  const thaiFont = findThaiFont();
  if (thaiFont) {
    doc.registerFont('thai', thaiFont);
    doc.font('thai');
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="report-${type}-${Date.now()}.pdf"`);
  doc.pipe(res);

  // Header
  doc.fontSize(16).fillColor('#0a6e3e').text(`${config.companyName}`, { align: 'center' });
  doc.fontSize(12).fillColor('#334155').text(`${config.appName} — ${title}`, { align: 'center' });
  doc.fillColor('#000000');
  doc.moveDown(0.5);

  const headers = ['รหัส', 'ชื่อ-นามสกุล', 'แผนก', 'วันที่/เวลา', 'ประเภท', 'สถานะ', 'จุดสแกน'];
  const colWidths = [60, 130, 90, 110, 65, 60, 120];
  const startX = doc.page.margins.left;
  let y = doc.y;

  const drawRow = (cells: string[], opts: { bold?: boolean; fill?: string } = {}) => {
    const rowHeight = 20;
    let x = startX;
    if (opts.fill) {
      doc.save().rect(startX, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill(opts.fill).restore();
    }
    doc.fillColor(opts.bold ? '#ffffff' : '#000000').fontSize(10);
    cells.forEach((cell, i) => {
      doc.text(cell, x + 3, y + 5, { width: colWidths[i] - 6, ellipsis: true });
      x += colWidths[i];
    });
    doc.fillColor('#000000');
    y += rowHeight;
  };

  // Header row with blue fill
  doc.save();
  doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), 20).fill('#2563eb');
  doc.restore();
  drawRow(headers, { bold: true });

  rows.forEach((r, idx) => {
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    drawRow(
      [
        r.employee_code,
        r.full_name,
        r.department || '-',
        fmtDateTime(r.scan_time),
        SCANTYPE_LABEL[r.scan_type] || r.scan_type,
        STATUS_LABEL[r.status] || r.status,
        r.scan_location_name || '-',
      ],
      { fill: idx % 2 === 1 ? '#f1f5f9' : undefined }
    );
  });

  doc.moveDown(1);
  doc.fontSize(9).fillColor('#666666')
    .text(`รวม ${rows.length} รายการ | สร้างเมื่อ ${new Date().toLocaleString('th-TH')}`, startX, y + 10);

  doc.end();
}
