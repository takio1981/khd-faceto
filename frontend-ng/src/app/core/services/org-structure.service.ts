import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CivilServiceLevel, Department, Division, Position } from '../models/models';

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

  listPositions(): Observable<Position[]> {
    return this.http.get<Position[]>(`${base}/positions`);
  }

  createPosition(body: { name: string; category: string | null }): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${base}/positions`, body);
  }

  updatePosition(id: number, body: { name: string; category: string | null }): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${base}/positions/${id}`, body);
  }

  deletePosition(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${base}/positions/${id}`);
  }

  listLevelsForPosition(positionId: number): Observable<CivilServiceLevel[]> {
    return this.http.get<CivilServiceLevel[]>(`${base}/positions/${positionId}/levels`);
  }

  listLevels(): Observable<CivilServiceLevel[]> {
    return this.http.get<CivilServiceLevel[]>(`${base}/levels`);
  }

  createLevel(body: { name: string; category: string | null }): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${base}/levels`, body);
  }

  updateLevel(id: number, body: { name: string; category: string | null }): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${base}/levels/${id}`, body);
  }

  deleteLevel(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${base}/levels/${id}`);
  }
}
