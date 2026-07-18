import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AttendanceListResponse, AttendanceRecord, AttendanceStatus, RecentScanItem, ScanResult, ScanType, SpoofingAlertListResponse } from '../models/models';

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

  bulkDelete(ids: number[]): Observable<{ ok: boolean; deleted: number }> {
    return this.http.delete<{ ok: boolean; deleted: number }>(base, { body: { ids } });
  }

  scan(descriptor: number[], imageBase64: string | undefined, scanLocationId: number | null): Observable<ScanResult> {
    return this.http.post<ScanResult>(`${base}/scan`, { descriptor, imageBase64, scanLocationId });
  }

  preview(descriptor: number[], scanLocationId: number | null): Observable<ScanResult> {
    return this.http.post<ScanResult>(`${base}/preview`, { descriptor, scanLocationId });
  }

  // Follow-up call after a preview result comes back with unknownFaceAlert:
  // true (server-debounced ~once/5min/location) — captures the face that
  // didn't match anyone so admin can review it.
  reportUnknownFace(imageBase64: string | undefined, scanLocationId: number | null): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${base}/unknown-face`, { imageBase64, scanLocationId });
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

  reportLivenessFail(
    employee: { id: number; employee_code: string; full_name: string },
    imageBase64: string | undefined,
    scanLocationId: number | null,
  ): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${base}/liveness-fail`, {
      employeeId: employee.id,
      employeeCode: employee.employee_code,
      fullName: employee.full_name,
      imageBase64,
      scanLocationId,
    });
  }

  listSpoofingAlerts(page: number, pageSize: number, dateFrom?: string, dateTo?: string): Observable<SpoofingAlertListResponse> {
    const params: Record<string, string> = { page: String(page), pageSize: String(pageSize) };
    if (dateFrom) params['dateFrom'] = dateFrom;
    if (dateTo) params['dateTo'] = dateTo;
    return this.http.get<SpoofingAlertListResponse>(`${base}/liveness-alerts`, { params });
  }

  getSpoofingAlertImageBlob(alertId: number): Observable<Blob> {
    return this.http.get(`${base}/liveness-alerts/${alertId}/image`, { responseType: 'blob' });
  }

  deleteSpoofingAlert(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${base}/liveness-alerts/${id}`);
  }

  deleteSpoofingAlerts(ids: number[]): Observable<{ ok: boolean; deleted: number }> {
    return this.http.delete<{ ok: boolean; deleted: number }>(`${base}/liveness-alerts`, { body: { ids } });
  }
}
