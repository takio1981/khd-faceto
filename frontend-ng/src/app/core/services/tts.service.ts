import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

const base = `${environment.apiBaseUrl}/tts`;

// Public endpoint (no auth) backing the checkin kiosk's spoken announcements
// — see backend/src/routes/tts.routes.ts. Generates Thai speech server-side
// (Microsoft Edge's free neural voices) instead of relying on the browser's
// own speechSynthesis voice list, which is unreliable for Thai — Chrome in
// particular often has no usable local Thai voice at all.
@Injectable({ providedIn: 'root' })
export class TtsService {
  constructor(private http: HttpClient) {}

  speak(text: string, gender: 'male' | 'female'): Observable<Blob> {
    return this.http.post(`${base}/speak`, { text, gender }, { responseType: 'blob' });
  }
}
