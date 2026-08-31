import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PinDevice, PinStatus } from '../models/models';
import { DeviceIdService } from './device-id.service';

const base = `${environment.apiBaseUrl}/auth`;

// Kept separate from AuthService (which only owns "am I logged in") for the
// same reason UserService/SettingsService are separate from it — this is
// PIN/device CRUD, not session state.
@Injectable({ providedIn: 'root' })
export class PinService {
  constructor(private http: HttpClient, private deviceId: DeviceIdService) {}

  myDeviceId(): string {
    return this.deviceId.getOrCreate();
  }

  status(): Observable<PinStatus> {
    return this.http.get<PinStatus>(`${base}/pin/status`);
  }

  setup(pin: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${base}/pin/setup`, {
      pin,
      confirmPin: pin,
      deviceId: this.myDeviceId(),
    });
  }

  change(currentPin: string, newPin: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${base}/pin/change`, {
      currentPin,
      newPin,
      confirmNewPin: newPin,
    });
  }

  reset(password: string, newPin: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${base}/pin/reset`, {
      password,
      newPin,
      confirmNewPin: newPin,
    });
  }

  listDevices(): Observable<PinDevice[]> {
    return this.http.get<PinDevice[]>(`${base}/devices`);
  }

  registerDevice(): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${base}/devices`, { deviceId: this.myDeviceId() });
  }

  removeDevice(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${base}/devices/${id}`);
  }
}
