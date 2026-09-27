import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import { pool } from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { config } from '../config';
import { Shift, ScanType, AttendanceStatus, ScanResult } from '../types';
import { ensureFaceCache, findBestMatchStrict } from './faceCache';
import { notifyScan, notifyUnknownFace } from './notification.service';
import { ictSecondsSinceMidnight, ictMysqlDateTime, ictDateKey, ictTimeStamp, isWeekendDateKey, dowFromDateKey } from '../utils/ict';
import { isHoliday } from './holidays.service';

// ---- Time helpers ---------------------------------------------------------

// 'HH:MM:SS' -> seconds since midnight
function timeToSeconds(t: string): number {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

// Date -> seconds since midnight, always evaluated in ICT (Asia/Bangkok, UTC+7)
// regardless of the host/container system timezone.
const dateToSeconds = ictSecondsSinceMidnight;

// 'YYYY-MM-DD HH:MM:SS' for MySQL DATETIME, in ICT wall-clock time.
const toMysqlDateTime = ictMysqlDateTime;

// 'YYYY-MM-DD' calendar day, in ICT wall-clock time.
const dateKey = ictDateKey;

// ---- Face image storage ----------------------------------------------------

// Capped so every saved face image stays small on disk regardless of the
// capturing device's camera resolution or browser JPEG quality setting —
// these are face-recognition audit thumbnails, not photos that need to be
// sharp at full resolution.
const FACE_IMAGE_MAX_DIM = 480;
const FACE_IMAGE_JPEG_QUALITY = 72;

// Save a base64 data-URL JPEG to disk under FACE_IMAGE_DIR/<YYYY-MM-DD>/<code>_<ts>.jpg
// Returns the relative path stored in the DB, or null on failure / no image.
// `codeOrLabel` is the employee_code for a matched scan, or a fixed label
// (e.g. "unknown") for an unrecognized-face capture — either way it's just
// used to keep filenames human-readable, not as a DB key.
export async function saveFaceImage(imageBase64: string | null | undefined, codeOrLabel: string, now: Date): Promise<string | null> {
  if (!imageBase64) return null;
  const match = /^data:image\/\w+;base64,(.+)$/.exec(imageBase64);
  const data = match ? match[1] : imageBase64;
  try {
    const resized = await sharp(Buffer.from(data, 'base64'))
      .rotate() // honor any EXIF orientation before resizing
      .resize({ width: FACE_IMAGE_MAX_DIM, height: FACE_IMAGE_MAX_DIM, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: FACE_IMAGE_JPEG_QUALITY })
      .toBuffer();

    const day = ictDateKey(now);
    const ts = ictTimeStamp(now);
    const dir = path.join(config.face.imageDir, day);
    await fs.mkdir(dir, { recursive: true });
    const filename = `${codeOrLabel}_${ts}_${Date.now() % 1000}.jpg`;
    const relPath = path.join(day, filename);
    await fs.writeFile(path.join(config.face.imageDir, relPath), resized);
    return relPath.split(path.sep).join('/');
  } catch (err) {
    console.error('[shift] failed to save face image', err);
    return null;
  }
}

async function getScanLocationName(scanLocationId: number | null): Promise<string | null> {
  if (!scanLocationId) return null;
  const [rows] = await pool.query<RowDataPacket[]>('SELECT name FROM scan_locations WHERE id = ?', [scanLocationId]);
  return rows[0]?.name ?? null;
}

// ---- Unknown-face alert debounce -------------------------------------------
// The kiosk calls /preview continuously (every ~150-600ms) while ANY face is
// in frame, known or not — so we can't notify admin on every unmatched
// preview without spamming them. Track the last alert time per scan
// location in memory (resets on server restart, which is fine — worst case
// is one extra alert) and only flag the preview result for a follow-up
// image-capture call once the cooldown has elapsed.
const unknownFaceAlertAt = new Map<string, number>();
const UNKNOWN_FACE_ALERT_COOLDOWN_MS = 5 * 60 * 1000;

function shouldAlertUnknownFace(scanLocationId: number | null): boolean {
  const key = String(scanLocationId ?? 'none');
  const last = unknownFaceAlertAt.get(key) ?? 0;
  const now = Date.now();
  if (now - last < UNKNOWN_FACE_ALERT_COOLDOWN_MS) return false;
  unknownFaceAlertAt.set(key, now);
  return true;
}

// ---- Shift lookup ---------------------------------------------------------

async function getShift(shiftId: number | null): Promise<Shift | null> {
  // Fall back to the first defined shift if the employee has none assigned
  const sql = shiftId
    ? 'SELECT * FROM shifts WHERE id = ? LIMIT 1'
    : 'SELECT * FROM shifts ORDER BY id ASC LIMIT 1';
  const params = shiftId ? [shiftId] : [];
  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  return rows.length ? (rows[0] as Shift) : null;
}

const DOW_COLUMNS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function shiftAppliesOnDate(shift: Shift, dateKeyStr: string): boolean {
  return !!shift[DOW_COLUMNS[dowFromDateKey(dateKeyStr)]];
}

// A calendar day that counts as OT for classification purposes: an actual
// Saturday/Sunday or a declared holiday — independent of which shift (regular
// or holiday-designated) ends up resolving for that day. Exported so
// processScan/processScanPreview can compute it once and pass it into
// classify().
export async function isOtDate(dateKeyStr: string): Promise<boolean> {
  return isWeekendDateKey(dateKeyStr) || (await isHoliday(dateKeyStr));
}

// Resolves which of an employee's two shifts (if either) is active for a
// given calendar day: prefer holiday_shift_id on weekends/declared holidays
// (existing behavior), but only if that shift's own days-of-week actually
// covers this day — otherwise fall back to the other shift, and only if
// THAT one covers the day either. Returns null when neither does ("not
// expected to work today"). Keyed by calendar day (not a Date+time) so this
// is reusable by day-level checks (dashboard, absence notifications) as
// well as real-time scan classification.
export async function resolveEffectiveShift(
  shiftId: number | null,
  holidayShiftId: number | null,
  dateKeyStr: string
): Promise<Shift | null> {
  const preferHoliday = !!holidayShiftId && (await isOtDate(dateKeyStr));
  const order = preferHoliday ? [holidayShiftId, shiftId] : [shiftId, holidayShiftId];
  for (const id of order) {
    const shift = await getShift(id);
    if (shift && shiftAppliesOnDate(shift, dateKeyStr)) return shift;
  }
  return null;
}

// ---- Today's existing scans ----------------------------------------------

interface TodayScans {
  hasCheckIn: boolean;
  hasCheckOut: boolean;
  hasOtIn: boolean;
  hasOtOut: boolean;
  lastScanTime: Date | null;
  checkInTime: Date | null;
  otInTime: Date | null;
}

async function getTodayScans(employeeId: number, day: string): Promise<TodayScans> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT scan_type, scan_time
       FROM attendance_records
      WHERE employee_id = ? AND DATE(scan_time) = ?
      ORDER BY scan_time ASC`,
    [employeeId, day]
  );
  let hasCheckIn = false;
  let hasCheckOut = false;
  let hasOtIn = false;
  let hasOtOut = false;
  let lastScanTime: Date | null = null;
  let checkInTime: Date | null = null;
  let otInTime: Date | null = null;
  for (const r of rows) {
    if (r.scan_type === 'check_in') { hasCheckIn = true; checkInTime = new Date(r.scan_time); }
    if (r.scan_type === 'check_out') hasCheckOut = true;
    if (r.scan_type === 'ot_in') { hasOtIn = true; otInTime = new Date(r.scan_time); }
    if (r.scan_type === 'ot_out') hasOtOut = true;
    lastScanTime = new Date(r.scan_time);
  }
  return { hasCheckIn, hasCheckOut, hasOtIn, hasOtOut, lastScanTime, checkInTime, otInTime };
}

// ---- Classification -------------------------------------------------------

interface Classification {
  scanType: ScanType;
  status: AttendanceStatus;
  message: string;
}

// Classify a scan based on shift windows and today's scan history (ICT timezone).
// Valid windows (all bounds inclusive):
//   checkin_start .. late_cutoff    → เข้างาน (ตรงเวลา if ≤ checkin_end, สาย otherwise)
//   checkout_start .. checkout_end  → ออกงาน (requires prior check-in)
//   ot_start .. ot_end              → OT-เข้า / OT-ออก (requires prior check-in+check-out)
// Scans that fall outside every applicable window return null → no record written.
//
// `isOtDay` (an actual Saturday/Sunday or declared holiday — see isOtDate
// above) reclassifies the whole session as OT: the first scan in the normal
// check-in window records ot_in instead of check_in, the second (in the
// checkout window) records ot_out instead of check_out, with no on_time/late
// distinction. This applies regardless of whether the resolved shift is the
// employee's regular shift_id (whose days-of-week happen to include this
// day) or a dedicated holiday_shift_id — any work on an OT day is OT.
function classify(shift: Shift, now: Date, today: TodayScans, isOtDay: boolean): Classification | null {
  if (shift.flexible_time) return classifyFlexible(shift, now, today, isOtDay);

  const sec = dateToSeconds(now);

  const checkinStart  = timeToSeconds(shift.checkin_start);
  const checkinEnd    = timeToSeconds(shift.checkin_end);
  const lateCutoff    = timeToSeconds(shift.late_cutoff);
  const checkoutStart = timeToSeconds(shift.checkout_start);
  const checkoutEnd   = timeToSeconds(shift.checkout_end);
  const otStart       = timeToSeconds(shift.ot_start);
  const otEnd         = timeToSeconds(shift.ot_end);

  const hasIn  = isOtDay ? today.hasOtIn  : today.hasCheckIn;
  const hasOut = isOtDay ? today.hasOtOut : today.hasCheckOut;

  // ---- Day already complete ----
  if (hasIn && hasOut) {
    // A normal day still allows a further same-day OT phase (ot_start..
    // ot_end) after regular hours. An OT day's whole session was already OT
    // — there's no additional phase beyond it.
    if (!isOtDay) {
      if (today.hasOtIn && !today.hasOtOut) {
        return { scanType: 'ot_out', status: 'ot', message: 'บันทึกเวลา OT-ออก' };
      }
      if (!today.hasOtIn && sec >= otStart && sec <= otEnd) {
        return { scanType: 'ot_in', status: 'ot', message: 'บันทึกเวลา OT-เข้า' };
      }
    }
    return null;
  }

  // ---- Has entry, awaiting exit ----
  if (hasIn && !hasOut) {
    if (sec >= checkoutStart && sec <= checkoutEnd) {
      return isOtDay
        ? { scanType: 'ot_out', status: 'ot', message: 'บันทึกเวลา OT-ออก' }
        : { scanType: 'check_out', status: 'on_time', message: 'ลงเวลาออกงานสำเร็จ' };
    }
    return null;
  }

  // ---- No entry yet ----
  // Allow exit in the checkout window even without a prior entry (employee
  // may have been recorded by other means, or missed the entry scan).
  if (sec >= checkoutStart && sec <= checkoutEnd) {
    return isOtDay
      ? { scanType: 'ot_out', status: 'ot', message: 'บันทึกเวลา OT-ออก (ไม่มีบันทึกเข้างานวันนี้)' }
      : { scanType: 'check_out', status: 'on_time', message: 'ลงเวลาออกงาน (ไม่มีบันทึกเข้างานวันนี้)' };
  }
  // Only allow entry within the check-in window (checkin_start → late_cutoff).
  if (sec < checkinStart || sec > lateCutoff) {
    return null;
  }
  if (isOtDay) {
    return { scanType: 'ot_in', status: 'ot', message: 'บันทึกเวลา OT-เข้า' };
  }
  if (sec <= checkinEnd) {
    return { scanType: 'check_in', status: 'on_time', message: 'ลงเวลาเข้างานสำเร็จ (ตรงเวลา)' };
  }
  return { scanType: 'check_in', status: 'late', message: 'ลงเวลาเข้างานสำเร็จ (สาย)' };
}

// Flexible-time shift (e.g. a holiday/on-call shift): any time is a valid
// entry or exit. No on-time/late distinction (there's no fixed start to be
// late against) and no separate additional OT phase — a single in/out pair
// is the whole session. On an OT day (see isOtDate) that pair is recorded as
// ot_in/ot_out; otherwise as check_in/check_out.
//
// flexible_min_hours (0 = no restriction) guards against a second scan of
// the same person shortly after entry — past the general anti-duplicate
// cooldown (config.face.cooldownMinutes, typically a few minutes) but still
// clearly not a real end-of-shift — being misread as an exit.
function classifyFlexible(shift: Shift, now: Date, today: TodayScans, isOtDay: boolean): Classification | null {
  const hasIn  = isOtDay ? today.hasOtIn  : today.hasCheckIn;
  const hasOut = isOtDay ? today.hasOtOut : today.hasCheckOut;

  if (hasIn && hasOut) return null; // day already complete
  if (hasIn) {
    if (shift.flexible_min_hours > 0) {
      const inTime = isOtDay ? today.otInTime : today.checkInTime;
      if (inTime) {
        const hoursSinceIn = (now.getTime() - inTime.getTime()) / 3_600_000;
        if (hoursSinceIn < shift.flexible_min_hours) return null; // too soon to exit
      }
    }
    return isOtDay
      ? { scanType: 'ot_out', status: 'ot', message: 'บันทึกเวลา OT-ออก' }
      : { scanType: 'check_out', status: 'on_time', message: 'ลงเวลาออกงานสำเร็จ' };
  }
  return isOtDay
    ? { scanType: 'ot_in', status: 'ot', message: 'บันทึกเวลา OT-เข้า' }
    : { scanType: 'check_in', status: 'on_time', message: 'ลงเวลาเข้างานสำเร็จ' };
}

// Returns a contextual "outside window" message for display only.
function outsideWindowMessage(shift: Shift, now: Date, today: TodayScans, isOtDay: boolean): string {
  if (shift.flexible_time) {
    const hasIn  = isOtDay ? today.hasOtIn  : today.hasCheckIn;
    const hasOut = isOtDay ? today.hasOtOut : today.hasCheckOut;
    if (hasIn && hasOut) {
      return isOtDay
        ? 'บันทึก OT เข้า-ออกงานของวันนี้ครบแล้ว (Already checked in and out today)'
        : 'บันทึกเข้า-ออกงานของวันนี้ครบแล้ว (Already checked in and out today)';
    }
    if (hasIn && !hasOut && shift.flexible_min_hours > 0) {
      const inTime = isOtDay ? today.otInTime : today.checkInTime;
      if (inTime) {
        const hoursSinceIn = (now.getTime() - inTime.getTime()) / 3_600_000;
        if (hoursSinceIn < shift.flexible_min_hours) {
          const remainingMin = Math.max(1, Math.ceil((shift.flexible_min_hours - hoursSinceIn) * 60));
          return `ยังไม่ถึงเวลาขั้นต่ำก่อนออกงาน (ต้องผ่านไปอย่างน้อย ${shift.flexible_min_hours} ชม. หลังเข้างาน — อีกประมาณ ${remainingMin} นาที)`;
        }
      }
    }
  }
  return 'ไม่อยู่ในช่วงเวลาลงเวลา (Outside scan window)';
}

// ---- Public API: process one scan ----------------------------------------

export async function processScan(
  descriptor: number[],
  imageBase64: string | null,
  now: Date = new Date(),
  scanLocationId: number | null = null,
  fullFrameBase64?: string | null,
): Promise<ScanResult> {
  await ensureFaceCache();

  const best = findBestMatchStrict(descriptor, config.face.matchThreshold, config.face.minMargin);
  if (!best) {
    return { matched: false, message: 'ไม่พบใบหน้าที่ตรงกัน (Unknown face)' };
  }
  if (best.ambiguous) {
    return { matched: false, ambiguous: true, message: 'ใบหน้าไม่ชัดเจนพอ กรุณาสแกนใหม่ (Ambiguous match)' };
  }

  const entry = best.entry;
  const confidence = Math.max(0, 1 - best.distance);
  const day = dateKey(now);
  const otDay = await isOtDate(day);

  const today = await getTodayScans(entry.employeeId, day);

  // Cooldown: ignore repeated scans of the same person within the window
  if (today.lastScanTime) {
    const diffMin = (now.getTime() - today.lastScanTime.getTime()) / 60000;
    if (diffMin < config.face.cooldownMinutes) {
      return {
        matched: true,
        ignored: true,
        employee: { id: entry.employeeId, employee_code: entry.employeeCode, full_name: entry.fullName },
        confidence,
        message: `บันทึกไปแล้วเมื่อสักครู่ (รอ ${config.face.cooldownMinutes} นาที)`,
      };
    }
  }

  const shift = await resolveEffectiveShift(entry.shiftId, entry.holidayShiftId, day);
  if (!shift) {
    return {
      matched: true,
      employee: { id: entry.employeeId, employee_code: entry.employeeCode, full_name: entry.fullName },
      confidence,
      message: 'ยังไม่ได้กำหนดกะการทำงาน (No shift configured)',
    };
  }

  const classification = classify(shift, now, today, otDay);
  if (!classification) {
    return {
      matched: true,
      employee: { id: entry.employeeId, employee_code: entry.employeeCode, full_name: entry.fullName },
      confidence,
      message: outsideWindowMessage(shift, now, today, otDay),
    };
  }

  // Save the image (if any) before inserting so face_image_path is correct
  // from the start — this used to be a separate UPDATE the route handler ran
  // *after* processScan returned, racing against the fire-and-forget
  // notifyScan() call below for which one saw the path first. Doing it here
  // means notifyScan always has the right path.
  const faceImagePath = await saveFaceImage(imageBase64, entry.employeeCode, now);
  const fullFramePath = await saveFaceImage(fullFrameBase64 ?? null, `env_${entry.employeeCode}`, now);
  const scanLocationName = await getScanLocationName(scanLocationId);

  // Insert the record. A UNIQUE KEY on (employee_id, scan_date, scan_type)
  // guards against a race (two near-simultaneous scans both reading "not
  // recorded yet" before either INSERT commits) creating duplicate rows of
  // the same scan_type for the same employee/day.
  try {
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO attendance_records
         (employee_id, scan_location_id, shift_id, scan_time, scan_type, status, matched_confidence, face_image_path, full_frame_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.employeeId,
        scanLocationId,
        shift.id,
        toMysqlDateTime(now),
        classification.scanType,
        classification.status,
        confidence.toFixed(4),
        faceImagePath,
        fullFramePath,
      ]
    );

    notifyScan(entry.employeeId, classification.status, classification.message, {
      imagePath: faceImagePath,
      scanLocationName,
      scanTime: now,
    });

    return {
      matched: true,
      employee: { id: entry.employeeId, employee_code: entry.employeeCode, full_name: entry.fullName },
      scan_type: classification.scanType,
      status: classification.status,
      confidence,
      message: classification.message,
      recordId: result.insertId,
      scanLocationName,
    };
  } catch (err: any) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return {
        matched: true,
        ignored: true,
        employee: { id: entry.employeeId, employee_code: entry.employeeCode, full_name: entry.fullName },
        confidence,
        message: `บันทึก${SCANTYPE_LABEL[classification.scanType]}ของวันนี้ไปแล้ว`,
      };
    }
    throw err;
  }
}

const SCANTYPE_LABEL: Record<ScanType, string> = {
  check_in: 'เข้างาน',
  check_out: 'ออกงาน',
  ot_in: 'OT-เข้า',
  ot_out: 'OT-ออก',
};

// Preview scan without saving (for frontend confirmation dialog)
export async function processScanPreview(
  descriptor: number[],
  now: Date = new Date(),
  scanLocationId: number | null = null
): Promise<ScanResult> {
  await ensureFaceCache();

  const best = findBestMatchStrict(descriptor, config.face.matchThreshold, config.face.minMargin);
  if (!best) {
    // Debounced admin alert for a face nobody recognizes (5 min/location
    // cooldown — see shouldAlertUnknownFace) — flagged here so the kiosk
    // knows to follow up with a face-image capture via a separate call
    // instead of uploading an image on every single preview tick.
    return {
      matched: false,
      message: 'ไม่พบใบหน้าที่ตรงกัน (Unknown face)',
      unknownFaceAlert: shouldAlertUnknownFace(scanLocationId),
    };
  }
  if (best.ambiguous) {
    return { matched: false, ambiguous: true, message: 'ใบหน้าไม่ชัดเจนพอ กรุณาสแกนใหม่ (Ambiguous match)', confidence: 0 };
  }

  const entry = best.entry;
  const confidence = Math.max(0, 1 - best.distance);
  const day = dateKey(now);
  const otDay = await isOtDate(day);

  const today = await getTodayScans(entry.employeeId, day);

  // Cooldown check
  if (today.lastScanTime) {
    const diffMin = (now.getTime() - today.lastScanTime.getTime()) / 60000;
    if (diffMin < config.face.cooldownMinutes) {
      return {
        matched: true,
        ignored: true,
        employee: { id: entry.employeeId, employee_code: entry.employeeCode, full_name: entry.fullName },
        confidence,
        message: `บันทึกไปแล้วเมื่อสักครู่ (รอ ${config.face.cooldownMinutes} นาที)`,
      };
    }
  }

  const shift = await resolveEffectiveShift(entry.shiftId, entry.holidayShiftId, day);
  if (!shift) {
    return {
      matched: true,
      employee: { id: entry.employeeId, employee_code: entry.employeeCode, full_name: entry.fullName },
      confidence,
      message: 'ยังไม่ได้กำหนดกะการทำงาน (No shift configured)',
    };
  }

  const classification = classify(shift, now, today, otDay);
  if (!classification) {
    return {
      matched: true,
      employee: { id: entry.employeeId, employee_code: entry.employeeCode, full_name: entry.fullName },
      confidence,
      message: outsideWindowMessage(shift, now, today, otDay),
    };
  }

  return {
    matched: true,
    employee: { id: entry.employeeId, employee_code: entry.employeeCode, full_name: entry.fullName },
    scan_type: classification.scanType,
    status: classification.status,
    confidence,
    message: classification.message,
    previewOnly: true, // flag that this is a preview, no record inserted
  };
}

// Called by POST /attendance/unknown-face — the kiosk's follow-up call after
// a preview result came back with unknownFaceAlert: true. Saves the capture
// (separate "unknown" subfolder, no employee_code to file it under) and
// fires the admin-only notification.
export async function saveUnknownFaceAndNotify(
  imageBase64: string | null | undefined,
  scanLocationId: number | null,
  now: Date = new Date()
): Promise<void> {
  const imagePath = await saveFaceImage(imageBase64, 'unknown', now);
  const scanLocationName = await getScanLocationName(scanLocationId);
  notifyUnknownFace(imagePath, scanLocationName, now);
}

// Validate shift time ordering (used by shift routes).
// Times must be non-decreasing across the day. Touching boundaries are allowed
// (e.g. ot_start == checkout_end). The error names the offending fields so the
// user knows exactly what to fix.
export function validateShiftOrder(s: Omit<Shift, 'id' | 'name'>): string | null {
  if ((s as any).flexible_time) {
    if (!s.checkout_end || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(s.checkout_end)) {
      return 'กรุณากรอกเวลาตัดยอดให้ถูกต้อง';
    }
    const minHours = Number((s as any).flexible_min_hours);
    if (!Number.isFinite(minHours) || minHours < 0 || minHours > 24) {
      return 'ชั่วโมงขั้นต่ำก่อนออกงานต้องเป็นตัวเลข 0-24';
    }
    return null;
  }

  const seq: Array<[string, string]> = [
    ['เริ่มเข้างาน', s.checkin_start],
    ['ตรงเวลาถึง', s.checkin_end],
    ['สายได้ถึง', s.late_cutoff],
    ['เริ่มออกงาน', s.checkout_start],
    ['สิ้นสุดออกงาน', s.checkout_end],
    ['เริ่ม OT', s.ot_start],
    ['สิ้นสุด OT', s.ot_end],
  ];

  // All fields must be present and look like a time value
  for (const [label, v] of seq) {
    if (!v || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(v)) {
      return `กรุณากรอกเวลา "${label}" ให้ถูกต้อง`;
    }
  }

  const secs = seq.map(([, v]) => timeToSeconds(v));
  for (let i = 1; i < secs.length; i++) {
    if (secs[i] < secs[i - 1]) {
      const cur = seq[i][1].slice(0, 5);
      const prev = seq[i - 1][1].slice(0, 5);
      return `ลำดับเวลาไม่ถูกต้อง: "${seq[i][0]}" (${cur}) ต้องไม่น้อยกว่า "${seq[i - 1][0]}" (${prev})`;
    }
  }

  // Non-decreasing alone still allows a zero-width window (e.g. every
  // check-in/checkout time set to 00:00), which passes the check above but
  // makes check-in/checkout impossible — classify() would reject every scan
  // as "outside window".
  if (secs[2] <= secs[0]) {
    return 'ช่วงเข้างานว่างเปล่า: "สายได้ถึง" ต้องมากกว่า "เริ่มเข้างาน" — ไม่อย่างนั้นจะสแกนเข้างานไม่ได้เลย';
  }
  if (secs[4] <= secs[3]) {
    return 'ช่วงออกงานว่างเปล่า: "สิ้นสุดออกงาน" ต้องมากกว่า "เริ่มออกงาน" — ไม่อย่างนั้นจะสแกนออกงานไม่ได้เลย';
  }
  return null;
}
