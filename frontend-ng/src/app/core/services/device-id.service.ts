import { Injectable } from '@angular/core';

const KEY = 'khd_pin_device_id';

// A persistent, client-generated device identifier for PIN login device
// binding. This is NOT a credential/secret — its only security property is
// scarcity (max 2 registered per user), not confidentiality — so plain
// localStorage (surviving browser restarts, consistent with how
// AuthService already stores the JWT/role/username) is appropriate.
@Injectable({ providedIn: 'root' })
export class DeviceIdService {
  getOrCreate(): string {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  }
}
