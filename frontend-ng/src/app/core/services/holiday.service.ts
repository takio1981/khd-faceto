import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Holiday } from '../models/models';

const base = `${environment.apiBaseUrl}/holidays`;

@Injectable({ providedIn: 'root' })
export class HolidayService {
  constructor(private http: HttpClient) {}

  list(year?: number): Observable<Holiday[]> {
    return this.http.get<Holiday[]>(base, { params: year ? { year: String(year) } : {} });
  }

  create(body: { holiday_date: string; name: string }): Observable<Holiday> {
    return this.http.post<Holiday>(base, body);
  }

  update(id: number, body: { holiday_date: string; name: string }): Observable<Holiday> {
    return this.http.put<Holiday>(`${base}/${id}`, body);
  }

  delete(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${base}/${id}`);
  }
}
