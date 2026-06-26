import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DashboardSummary } from '../models/models';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  constructor(private http: HttpClient) {}

  getSummary(date: string, employeeId?: number): Observable<DashboardSummary> {
    const params: Record<string, string> = { date };
    if (employeeId != null) params['employeeId'] = String(employeeId);
    return this.http.get<DashboardSummary>(`${environment.apiBaseUrl}/dashboard/summary`, { params });
  }
}
