import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ReportRow } from '../models/models';

export type ReportType = 'daily' | 'monthly' | 'yearly';

const base = `${environment.apiBaseUrl}/reports`;

@Injectable({ providedIn: 'root' })
export class ReportService {
  constructor(private http: HttpClient) {}

  get(type: ReportType, params: Record<string, string | number | undefined>): Observable<{ title: string; rows: ReportRow[] }> {
    return this.http.get<{ title: string; rows: ReportRow[] }>(`${base}/${type}`, { params: this.clean(params) });
  }

  export(type: ReportType, format: 'xlsx' | 'pdf', params: Record<string, string | number | undefined>): Observable<Blob> {
    return this.http.get(`${base}/export`, {
      params: this.clean({ ...params, type, format }),
      responseType: 'blob',
    });
  }

  private clean(params: Record<string, string | number | undefined>): Record<string, string> {
    const out: Record<string, string> = {};
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') out[k] = String(v);
    });
    return out;
  }
}
