import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuditLogListResponse } from '../models/models';

export interface AuditLogFilter {
  page?: number;
  pageSize?: number;
  action?: string;
  username?: string;
  dateFrom?: string;
  dateTo?: string;
}

@Injectable({ providedIn: 'root' })
export class AuditLogService {
  constructor(private http: HttpClient) {}

  list(filter: AuditLogFilter): Observable<AuditLogListResponse> {
    const params: Record<string, string> = {};
    Object.entries(filter).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') params[k] = String(v);
    });
    return this.http.get<AuditLogListResponse>(`${environment.apiBaseUrl}/audit-log`, { params });
  }
}
