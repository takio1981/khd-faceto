import { pool } from '../db';
import { RowDataPacket } from 'mysql2';

// In-memory cache of every active employee's face descriptors.
// Avoids a DB round-trip on every scan. Invalidated on enroll/delete.

export interface CachedDescriptor {
  employeeId: number;
  employeeCode: string;
  fullName: string;
  shiftId: number | null;
  holidayShiftId: number | null;
  descriptor: number[]; // 128 floats
}

let cache: CachedDescriptor[] = [];
let loaded = false;

// Compute one mean (centroid) descriptor per employee from their individual
// enrolled poses. The centroid improves matching for head angles that fall
// between the explicitly enrolled poses — e.g. the 10° left pose that lies
// between the enrolled straight (0°) and slightly-left (15°) shots.
// Employees with only one descriptor get no centroid (it would be identical).
function computeMeanDescriptors(entries: CachedDescriptor[]): CachedDescriptor[] {
  const byEmployee = new Map<number, CachedDescriptor[]>();
  for (const entry of entries) {
    const list = byEmployee.get(entry.employeeId) ?? [];
    list.push(entry);
    byEmployee.set(entry.employeeId, list);
  }
  const means: CachedDescriptor[] = [];
  for (const [, descs] of byEmployee) {
    if (descs.length < 2) continue;
    const mean = new Array(128).fill(0) as number[];
    for (const d of descs) {
      for (let i = 0; i < 128; i++) mean[i] += d.descriptor[i];
    }
    const n = descs.length;
    for (let i = 0; i < 128; i++) mean[i] /= n;
    means.push({ ...descs[0], descriptor: mean });
  }
  return means;
}

export async function loadFaceCache(): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT fd.employee_id, fd.descriptor,
            e.employee_code, e.full_name, e.shift_id, e.holiday_shift_id
       FROM face_descriptors fd
       JOIN employees e ON e.id = fd.employee_id
      WHERE e.is_active = 1`
  );

  const individual: CachedDescriptor[] = rows.map((r) => ({
    employeeId: r.employee_id,
    employeeCode: r.employee_code,
    fullName: r.full_name,
    shiftId: r.shift_id,
    holidayShiftId: r.holiday_shift_id ?? null,
    // MariaDB JSON column may come back as a string or already-parsed array
    descriptor: typeof r.descriptor === 'string' ? JSON.parse(r.descriptor) : r.descriptor,
  }));

  // Add a mean (centroid) descriptor per employee who has 2+ enrolled poses.
  // The centroid sits geometrically between the enrolled angles and improves
  // matching for intermediate head positions (e.g. between straight and slightly
  // left) that weren't explicitly captured during enrollment.
  const means = computeMeanDescriptors(individual);
  cache = [...individual, ...means];
  loaded = true;
  console.log(`[faceCache] loaded ${individual.length} descriptor(s) + ${means.length} mean(s)`);
}

export async function ensureFaceCache(): Promise<void> {
  if (!loaded) await loadFaceCache();
}

export function invalidateFaceCache(): void {
  loaded = false;
}

export function getFaceCache(): CachedDescriptor[] {
  return cache;
}

// Euclidean distance between two equal-length vectors
export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export interface BestMatch {
  entry: CachedDescriptor;
  distance: number;
}

// Find the closest cached descriptor to the incoming one
export function findBestMatch(descriptor: number[]): BestMatch | null {
  let best: BestMatch | null = null;
  for (const entry of cache) {
    if (entry.descriptor.length !== descriptor.length) continue;
    const distance = euclideanDistance(entry.descriptor, descriptor);
    if (best === null || distance < best.distance) {
      best = { entry, distance };
    }
  }
  return best;
}

export interface StrictMatch extends BestMatch {
  ambiguous: boolean; // true when a different employee's face is nearly as close
}

// Stricter matcher: in addition to the threshold, requires a minimum distance
// gap (margin) between the best match and the best match belonging to a
// *different* employee. This rejects cases where two enrolled faces look
// similar enough that the wrong person could otherwise be recognized.
export function findBestMatchStrict(
  descriptor: number[],
  threshold: number,
  minMargin: number
): StrictMatch | null {
  let best: BestMatch | null = null;
  let bestOtherDistance = Infinity; // closest distance among a different employee

  for (const entry of cache) {
    if (entry.descriptor.length !== descriptor.length) continue;
    const distance = euclideanDistance(entry.descriptor, descriptor);
    if (best === null || distance < best.distance) {
      // The previous best (if a different employee) becomes a candidate for "other"
      if (best && best.entry.employeeId !== entry.employeeId) {
        bestOtherDistance = Math.min(bestOtherDistance, best.distance);
      }
      best = { entry, distance };
    } else if (entry.employeeId !== best.entry.employeeId) {
      bestOtherDistance = Math.min(bestOtherDistance, distance);
    }
  }

  if (!best || best.distance > threshold) return null;

  const ambiguous = bestOtherDistance - best.distance < minMargin;
  return { ...best, ambiguous };
}
