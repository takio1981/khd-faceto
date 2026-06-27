import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ConsentStatus, Employee, EmployeeCreateRequest, FaceRecord } from '../models/models';

const base = `${environment.apiBaseUrl}/employees`;

@Injectable({ providedIn: 'root' })
export class EmployeeService {
  constructor(private http: HttpClient) {}

  list(includeInactive = false): Observable<Employee[]> {
    return this.http.get<Employee[]>(base, { params: includeInactive ? { includeInactive: '1' } : {} });
  }

  get(id: number): Observable<Employee> {
    return this.http.get<Employee>(`${base}/${id}`);
  }

  create(body: EmployeeCreateRequest): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(base, body);
  }

  update(id: number, body: Partial<EmployeeCreateRequest>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${base}/${id}`, body);
  }

  delete(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${base}/${id}`);
  }

  enrollFace(id: number, descriptor: number[], thumbnail?: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${base}/${id}/face`, { descriptor, thumbnail });
  }

  listFaces(id: number): Observable<FaceRecord[]> {
    return this.http.get<FaceRecord[]>(`${base}/${id}/faces`);
  }

  clearFaces(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${base}/${id}/face`);
  }

  getConsent(id: number): Observable<ConsentStatus> {
    return this.http.get<ConsentStatus>(`${base}/${id}/consent`);
  }

  recordConsent(id: number): Observable<ConsentStatus> {
    return this.http.post<ConsentStatus>(`${base}/${id}/consent`, {});
  }

  withdrawConsent(id: number): Observable<ConsentStatus> {
    return this.http.delete<ConsentStatus>(`${base}/${id}/consent`);
  }
}
