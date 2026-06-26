import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface AppConfig {
  companyName: string;
  appName: string;
}

@Injectable({ providedIn: 'root' })
export class ConfigService {
  constructor(private http: HttpClient) {}

  get(): Observable<AppConfig> {
    return this.http.get<AppConfig>(`${environment.apiBaseUrl}/config`);
  }
}
