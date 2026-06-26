import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SettingsResponse } from '../models/models';

const base = `${environment.apiBaseUrl}/settings`;

@Injectable({ providedIn: 'root' })
export class SettingsService {
  constructor(private http: HttpClient) {}

  get(): Observable<SettingsResponse> {
    return this.http.get<SettingsResponse>(base);
  }

  update(body: SettingsResponse): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(base, body);
  }
}
