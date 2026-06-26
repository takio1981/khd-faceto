import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Shift } from '../models/models';

const base = `${environment.apiBaseUrl}/shifts`;

@Injectable({ providedIn: 'root' })
export class ShiftService {
  constructor(private http: HttpClient) {}

  list(): Observable<Shift[]> {
    return this.http.get<Shift[]>(base);
  }

  get(id: number): Observable<Shift> {
    return this.http.get<Shift>(`${base}/${id}`);
  }

  create(body: Omit<Shift, 'id'>): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(base, body);
  }

  update(id: number, body: Omit<Shift, 'id'>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${base}/${id}`, body);
  }

  delete(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${base}/${id}`);
  }
}
