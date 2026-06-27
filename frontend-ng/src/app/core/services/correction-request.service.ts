import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CorrectionRequest, CorrectionRequestType, AttendanceStatus } from '../models/models';

const base = `${environment.apiBaseUrl}/correction-requests`;

export interface CreateCorrectionRequestBody {
  employeeId?: number;
  attendanceRecordId?: number | null;
  requestType: CorrectionRequestType;
  targetDate: string;
  originalScanTime?: string | null;
  originalStatus?: AttendanceStatus | null;
  requestedScanTime?: string | null;
  requestedStatus?: AttendanceStatus | null;
  reason: string;
}

@Injectable({ providedIn: 'root' })
export class CorrectionRequestService {
  constructor(private http: HttpClient) {}

  create(body: CreateCorrectionRequestBody): Observable<CorrectionRequest> {
    return this.http.post<CorrectionRequest>(base, body);
  }

  list(scope: 'mine' | 'approving' | 'all', status?: string): Observable<CorrectionRequest[]> {
    const params: Record<string, string> = { scope };
    if (status) params['status'] = status;
    return this.http.get<CorrectionRequest[]>(base, { params });
  }

  supervisorDecision(id: number, decision: 'approved' | 'rejected', comment?: string): Observable<CorrectionRequest> {
    return this.http.put<CorrectionRequest>(`${base}/${id}/supervisor-decision`, { decision, comment });
  }

  adminDecision(id: number, decision: 'approved' | 'rejected', comment?: string): Observable<CorrectionRequest> {
    return this.http.put<CorrectionRequest>(`${base}/${id}/admin-decision`, { decision, comment });
  }
}
