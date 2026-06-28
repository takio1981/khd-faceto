import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AttendanceListResponse, AttendanceRecord, AttendanceStatus, RecentScanItem, ScanResult, ScanType } from '../models/models';

const base = `${environment.apiBaseUrl}/attendance`;

export interface AttendanceFilter {
  dateFrom?: string;
  dateTo?: string;
  employeeId?: number;
  department?: string;
  scanType?: ScanType;
  status?: AttendanceStatus;
  search?: string;
  page?: number;
  pageSize?: number;
}

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  constructor(private http: HttpClient) {}

  list(filter: AttendanceFilter): Observable<AttendanceListResponse> {
    const params: Record<string, string> = {};
    Object.entries(filter).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') params[k] = String(v);
    });
    return this.http.get<AttendanceListResponse>(base, { params });
  }

  getImageBlob(id: number): Observable<Blob> {
    return this.http.get(`${base}/image/${id}`, { responseType: 'blob' });
  }

  update(id: number, body: Partial<Pick<AttendanceRecord, 'scan_time' | 'scan_type' | 'status'>>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${base}/${id}`, body);
  }

  delete(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${base}/${id}`);
  }

  scan(descriptor: number[], imageBase64: string | undefined, scanLocationId: number | null): Observable<ScanResult> {
    return this.http.post<ScanResult>(`${base}/scan`, { descriptor, imageBase64, scanLocationId });
  }

  preview(descriptor: number[]): Observable<ScanResult> {
    return this.http.post<ScanResult>(`${base}/preview`, { descriptor });
  }

  // Public endpoint (no auth) backing the checkin kiosk's live feed — see
  // backend/src/routes/attendance.routes.ts GET /recent. Sourced from the
  // real attendance_records table (scoped to today + optionally one scan
  // location) so edits/deletes made via the admin Attendance page are
  // reflected on the next poll, unlike a client-only cache.
  recent(scanLocationId: number | null, limit: number): Observable<RecentScanItem[]> {
    const params: Record<string, string> = { limit: String(limit) };
    if (scanLocationId) params['scanLocationId'] = String(scanLocationId);
    return this.http.get<RecentScanItem[]>(`${base}/recent`, { params });
  }
}
