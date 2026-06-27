import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Department, Division } from '../models/models';

const base = `${environment.apiBaseUrl}/org`;

@Injectable({ providedIn: 'root' })
export class OrgStructureService {
  constructor(private http: HttpClient) {}

  listDivisions(): Observable<Division[]> {
    return this.http.get<Division[]>(`${base}/divisions`);
  }

  createDivision(body: { name: string; head_employee_id: number | null }): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${base}/divisions`, body);
  }

  updateDivision(id: number, body: { name: string; head_employee_id: number | null }): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${base}/divisions/${id}`, body);
  }

  deleteDivision(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${base}/divisions/${id}`);
  }

  listDepartments(): Observable<Department[]> {
    return this.http.get<Department[]>(`${base}/departments`);
  }

  createDepartment(body: { name: string; division_id: number | null; head_employee_id: number | null }): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${base}/departments`, body);
  }

  updateDepartment(
    id: number,
    body: { name: string; division_id: number | null; head_employee_id: number | null }
  ): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${base}/departments/${id}`, body);
  }

  deleteDepartment(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${base}/departments/${id}`);
  }
}
