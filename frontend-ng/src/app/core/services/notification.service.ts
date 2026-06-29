import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { NotificationHistoryListResponse, NotificationSettings, NotifyEventType, RecentNotification } from '../models/models';

export interface NotificationHistoryFilter {
  eventType?: NotifyEventType | '';
  isRead?: '0' | '1' | '';
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

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

  // ---- Personal notification history ----

  listMine(filter: NotificationHistoryFilter): Observable<NotificationHistoryListResponse> {
    const params: Record<string, string> = {};
    Object.entries(filter).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') params[k] = String(v);
    });
    return this.http.get<NotificationHistoryListResponse>(`${base}/my`, { params });
  }

  setRead(id: number, isRead: boolean): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${base}/my/${id}/read`, { isRead });
  }

  markAllRead(): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${base}/my/read-all`, {});
  }

  deleteMine(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${base}/my/${id}`);
  }
}
