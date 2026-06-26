// Explicit Indochina Time (ICT, UTC+7) helpers.
// These do NOT depend on the host/container TZ setting — they work off the
// absolute UTC timestamp (Date#getTime) so attendance times stay correct in
// ICT even if the server's system timezone is misconfigured.

const ICT_OFFSET_MS = 7 * 60 * 60 * 1000;

interface ICTParts {
  year: number;
  month: number; // 1-12
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function ictParts(d: Date): ICTParts {
  const ict = new Date(d.getTime() + ICT_OFFSET_MS);
  return {
    year: ict.getUTCFullYear(),
    month: ict.getUTCMonth() + 1,
    day: ict.getUTCDate(),
    hours: ict.getUTCHours(),
    minutes: ict.getUTCMinutes(),
    seconds: ict.getUTCSeconds(),
  };
}

// Seconds since midnight, ICT wall-clock time.
export function ictSecondsSinceMidnight(d: Date): number {
  const p = ictParts(d);
  return p.hours * 3600 + p.minutes * 60 + p.seconds;
}

// 'YYYY-MM-DD' calendar day, ICT wall-clock time.
export function ictDateKey(d: Date): string {
  const p = ictParts(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

// 'YYYY-MM-DD HH:MM:SS' for MySQL DATETIME, ICT wall-clock time.
export function ictMysqlDateTime(d: Date): string {
  const p = ictParts(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hours)}:${pad(p.minutes)}:${pad(p.seconds)}`;
}

// 'HHMMSS', ICT wall-clock time (used for face image filenames).
export function ictTimeStamp(d: Date): string {
  const p = ictParts(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(p.hours)}${pad(p.minutes)}${pad(p.seconds)}`;
}
