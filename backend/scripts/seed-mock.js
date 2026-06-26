/**
 * Mock data generator for demoing dashboard & reports.
 *
 * Inserts ~10 demo employees (codes DEMO101..) with random face descriptors,
 * then generates realistic attendance records from the start of the year up to
 * "today" (server time). Re-runnable: it wipes only its own DEMO* data first.
 *
 * Run inside the app container:
 *   docker compose cp ./backend/scripts/seed-mock.js app:/app/seed-mock.js
 *   docker compose exec -T app node /app/seed-mock.js
 */
const mysql = require('mysql2/promise');

const DEPARTMENTS = [
  'กลุ่มงานบริหารทั่วไป',
  'กลุ่มงานพัฒนายุทธศาสตร์',
  'กลุ่มงานควบคุมโรค',
  'กลุ่มงานส่งเสริมสุขภาพ',
  'กลุ่มงานทันตสาธารณสุข',
];
const POSITIONS = ['นักวิชาการสาธารณสุข', 'เจ้าพนักงานธุรการ', 'พยาบาลวิชาชีพ', 'นักวิเคราะห์นโยบาย', 'เภสัชกร'];
const FIRST = ['สมชาย', 'สมหญิง', 'วิภา', 'ประเสริฐ', 'มาลี', 'อนุชา', 'กนกวรรณ', 'ธีรพงษ์', 'สุนิสา', 'ชัยวัฒน์', 'พรทิพย์', 'ณัฐพล'];
const LAST = ['ใจดี', 'รักงาน', 'ศรีสุข', 'มั่นคง', 'พงษ์ไพร', 'วัฒนา', 'บุญมา', 'แสงทอง', 'ทองดี', 'สุขใจ', 'ก้าวหน้า', 'ไพศาล'];

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function pad(n) { return String(n).padStart(2, '0'); }
function dateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function dt(d, h, m) { return `${dateKey(d)} ${pad(h)}:${pad(m)}:${pad(Math.floor(Math.random() * 60))}`; }
function randDescriptor() { return JSON.stringify(Array.from({ length: 128 }, () => +(Math.random() * 2 - 1).toFixed(4))); }

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'mariadb',
    port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'khdapp',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'khd_attendance',
  });
  console.log('[seed] connected');

  // Ensure there is a shift to attach to (use the first one)
  const [shiftRows] = await conn.query('SELECT id FROM shifts ORDER BY id ASC LIMIT 1');
  if (!shiftRows.length) { throw new Error('No shift found - start the app once so migrations run.'); }
  const shiftId = shiftRows[0].id;

  // Clean previous demo data (idempotent)
  const [oldEmps] = await conn.query("SELECT id FROM employees WHERE employee_code LIKE 'DEMO%'");
  if (oldEmps.length) {
    const ids = oldEmps.map((r) => r.id);
    await conn.query('DELETE FROM attendance_records WHERE employee_id IN (?)', [ids]);
    await conn.query('DELETE FROM face_descriptors WHERE employee_id IN (?)', [ids]);
    await conn.query('DELETE FROM employees WHERE id IN (?)', [ids]);
    console.log(`[seed] removed ${ids.length} previous demo employee(s)`);
  }

  // Create employees
  const employees = [];
  for (let i = 1; i <= 10; i++) {
    const code = 'DEMO' + (100 + i);
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const [res] = await conn.query(
      'INSERT INTO employees (employee_code, full_name, department, position, shift_id, is_active) VALUES (?,?,?,?,?,1)',
      [code, name, pick(DEPARTMENTS), pick(POSITIONS), shiftId]
    );
    await conn.query('INSERT INTO face_descriptors (employee_id, descriptor) VALUES (?, ?)', [res.insertId, randDescriptor()]);
    employees.push({ id: res.insertId, code, name });
  }
  console.log(`[seed] created ${employees.length} demo employees`);

  // Generate attendance from Jan 1 -> today
  const today = new Date();
  const start = new Date(today.getFullYear(), 0, 1);
  const rows = [];
  let absentCount = 0;

  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const day = new Date(d);
    const dow = day.getDay(); // 0 Sun .. 6 Sat
    const isToday = dateKey(day) === dateKey(today);
    const isWeekend = dow === 0 || dow === 6;
    if (isWeekend && !isToday) continue; // weekdays only (but always include today for the demo)

    for (const emp of employees) {
      // ~7% absent on a normal day
      if (!isToday && Math.random() < 0.07) { absentCount++; continue; }

      // Check-in: mostly on time (07:40-08:00), sometimes late (08:01-09:30)
      const late = Math.random() < 0.18;
      let h, m, status;
      if (late) { h = 8; m = 1 + Math.floor(Math.random() * 89); if (m >= 60) { h = 9; m -= 60; } status = 'late'; }
      else { h = 7; m = 40 + Math.floor(Math.random() * 20); if (m >= 60) { h = 8; m -= 60; } status = 'on_time'; }
      rows.push([emp.id, dt(day, h, m), 'check_in', status]);

      // On "today" we only have morning check-ins so far (day in progress)
      if (isToday) continue;

      // Check-out 16:30-18:00
      const coH = Math.random() < 0.5 ? 16 : 17;
      const coM = 30 + Math.floor(Math.random() * 30);
      rows.push([emp.id, dt(day, coH, coM >= 60 ? coM - 60 : coM), 'check_out', 'on_time']);

      // ~20% OT 18:30-21:00
      if (Math.random() < 0.2) {
        const otH = 18 + Math.floor(Math.random() * 3);
        rows.push([emp.id, dt(day, otH, Math.floor(Math.random() * 60)), 'ot', 'ot']);
      }
    }
  }

  // Bulk insert
  const conf = () => (0.9 + Math.random() * 0.09).toFixed(4);
  const values = rows.map((r) => [r[0], r[1], r[2], r[3], conf(), null]);
  // chunk to avoid huge single statement
  const CHUNK = 500;
  for (let i = 0; i < values.length; i += CHUNK) {
    const slice = values.slice(i, i + CHUNK);
    await conn.query(
      'INSERT INTO attendance_records (employee_id, scan_time, scan_type, status, matched_confidence, face_image_path) VALUES ?',
      [slice]
    );
  }

  console.log(`[seed] inserted ${rows.length} attendance records (${absentCount} absences skipped)`);
  console.log('[seed] done. Restart app (or it will refresh face cache on next change).');
  await conn.end();
}

main().catch((e) => { console.error('[seed] ERROR', e); process.exit(1); });
