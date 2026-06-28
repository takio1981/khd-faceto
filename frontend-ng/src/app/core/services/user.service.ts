import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Role, UserAccount } from '../models/models';

const base = `${environment.apiBaseUrl}/users`;

export interface UserFilter {
  role?: Role | '';
  search?: string;
  employeeId?: number;
  unlinkedOnly?: boolean;
  lockedOnly?: boolean;
}

export interface UserCreateRequest {
  username: string;
  password: string;
  role: Role;
  employee_id?: number | null;
}

export interface UserUpdateRequest {
  username?: string;
  password?: string;
  role?: Role;
  employee_id?: number | null;
}

@Injectable({ providedIn: 'root' })
export class UserService {
  constructor(private http: HttpClient) {}

  list(filter: UserFilter): Observable<UserAccount[]> {
    const params: Record<string, string> = {};
    if (filter.role) params['role'] = filter.role;
    if (filter.search) params['search'] = filter.search;
    if (filter.employeeId) params['employeeId'] = String(filter.employeeId);
    if (filter.unlinkedOnly) params['unlinkedOnly'] = '1';
    if (filter.lockedOnly) params['lockedOnly'] = '1';
    return this.http.get<UserAccount[]>(base, { params });
  }

  create(body: UserCreateRequest): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(base, body);
  }

  update(id: number, body: UserUpdateRequest): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${base}/${id}`, body);
  }

  unlock(id: number): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${base}/${id}/unlock`, {});
  }

  delete(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${base}/${id}`);
  }
}
