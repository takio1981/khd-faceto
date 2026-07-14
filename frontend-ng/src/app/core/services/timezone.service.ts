import { Injectable } from '@angular/core';

export type TzMode = 'auto' | 'manual';

const MODE_KEY = 'appTzMode';
const TZ_KEY = 'appTzManual';

// Common IANA timezone list — fallback for browsers that don't support
// Intl.supportedValuesOf('timeZone') (Safari < 15.4, older Chrome).
const COMMON_TZ = [
  'Pacific/Midway', 'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles',
  'America/Denver', 'America/Chicago', 'America/New_York', 'America/Sao_Paulo',
  'Atlantic/Azores', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Istanbul', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka',
  'Asia/Bangkok', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai',
  'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland', 'UTC',
];

@Injectable({ providedIn: 'root' })
export class TimezoneService {
  /** All IANA timezone names the current browser supports. */
  readonly allTimezones: string[] = this.buildList();

  getMode(): TzMode {
    return (localStorage.getItem(MODE_KEY) as TzMode) || 'auto';
  }

  getBrowserTimezone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  getManualTimezone(): string {
    return localStorage.getItem(TZ_KEY) || this.getBrowserTimezone();
  }

  getActiveTimezone(): string {
    return this.getMode() === 'manual' ? this.getManualTimezone() : this.getBrowserTimezone();
  }

  save(mode: TzMode, tz?: string): void {
    localStorage.setItem(MODE_KEY, mode);
    if (mode === 'manual' && tz) localStorage.setItem(TZ_KEY, tz);
  }

  private buildList(): string[] {
    try {
      return (Intl as any).supportedValuesOf('timeZone') as string[];
    } catch {
      return COMMON_TZ;
    }
  }
}
