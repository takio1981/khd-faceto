import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { NotificationSettings, RecentNotification } from '../models/models';

const base = `${environment.apiBaseUrl}/notifications`;

@Injectable({ providedIn: 'root' })
export class NotificationService {
  constructor(private http: HttpClient) {}

  get(): Observable<NotificationSettings> {
    return this.http.get<NotificationSettings>(base);
  }

  save(body: NotificationSettings): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(base, body);
  }

  test(channel: 'email' | 'line' | 'telegram' | 'local', target: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${base}/test`, { channel, target });
  }

  recent(sinceId: number): Observable<RecentNotification[]> {
    return this.http.get<RecentNotification[]>(`${base}/recent`, { params: { sinceId: String(sinceId) } });
  }
}
