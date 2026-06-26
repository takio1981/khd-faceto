import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ScanLocation } from '../models/models';

const base = `${environment.apiBaseUrl}/scan-locations`;

@Injectable({ providedIn: 'root' })
export class ScanLocationService {
  constructor(private http: HttpClient) {}

  list(): Observable<ScanLocation[]> {
    return this.http.get<ScanLocation[]>(base);
  }

  create(body: { name: string; latitude: number; longitude: number }): Observable<ScanLocation> {
    return this.http.post<ScanLocation>(base, body);
  }

  update(id: number, body: { name: string; latitude: number; longitude: number }): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${base}/${id}`, body);
  }

  delete(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${base}/${id}`);
  }
}
