import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import { NotificationService } from '../../core/services/notification.service';
import { NotifyService } from '../../core/services/notify.service';
import { ScanLocationService } from '../../core/services/scan-location.service';
import { patchLeafletDefaultIcon } from '../../shared/utils/leaflet-icon-fix';
import { SettingsService } from '../../core/services/settings.service';
import { NotificationSettings, ScanLocation } from '../../core/models/models';

declare const L: any;

const NAKHON_RATCHASIMA: [number, number] = [14.9799, 102.0978];
const GMAIL_HOST = 'smtp.gmail.com';
const GMAIL_PORT = 465;

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
    MatCheckboxModule,
    MatDividerModule,
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent implements OnInit, AfterViewInit {
  @ViewChild('mapEl') mapEl?: ElementRef<HTMLDivElement>;

  private fb = inject(FormBuilder);
  private settingsService = inject(SettingsService);
  private scanLocationService = inject(ScanLocationService);
  private notificationService = inject(NotificationService);
  private notify = inject(NotifyService);

  // ===== 1. Login security =====
  readonly loginForm = this.fb.group({
    loginMaxAttempts: this.fb.control<number>(5, [Validators.required, Validators.min(1), Validators.max(20)]),
    loginLockoutMinutes: this.fb.control<number>(15, [Validators.required, Validators.min(1), Validators.max(1440)]),
  });
  loginSaving = false;

  // ===== 2. Scan locations =====
  readonly locationForm = this.fb.group({
    name: ['', Validators.required],
    latitude: this.fb.control<number | null>(null, Validators.required),
    longitude: this.fb.control<number | null>(null, Validators.required),
  });
  locations: ScanLocation[] = [];
  editingLocationId: number | null = null;
  locationSaving = false;
  locatingGps = false;

  private map: any;
  private pendingMarker: any;
  private readonly markersById = new Map<number, any>();

  // ===== 3. Notifications =====
  readonly notifForm = this.fb.group({
    email: this.fb.group({
      enabled: [false],
      useGmail: [true],
      host: [''],
      port: this.fb.control<number>(587),
      secure: [false],
      user: [''],
      pass: [''],
      from: [''],
    }),
    line: this.fb.group({
      enabled: [false],
      channelAccessToken: [''],
    }),
    telegram: this.fb.group({
      enabled: [false],
      botToken: [''],
    }),
    local: this.fb.group({
      enabled: [false],
    }),
    admin: this.fb.group({
      emails: [''],
      lineUserId: [''],
      telegramChatId: [''],
    }),
    events: this.fb.group({
      late: this.fb.group({ employee: [true], admin: [true] }),
      absent: this.fb.group({ employee: [false], admin: [true] }),
      success: this.fb.group({ employee: [true], admin: [false] }),
    }),
  });
  notifSaving = false;

  testTargets: Record<'email' | 'line' | 'telegram', string> = { email: '', line: '', telegram: '' };
  testing: Record<'email' | 'line' | 'telegram' | 'local', boolean> = {
    email: false,
    line: false,
    telegram: false,
    local: false,
  };

  constructor() {}

  ngOnInit(): void {
    this.loadLoginSettings();
    this.loadNotificationSettings();
  }

  ngAfterViewInit(): void {
    this.initMap();
    this.loadLocations();
  }

  // ---- 1. Login security ----

  private loadLoginSettings(): void {
    this.settingsService.get().subscribe({
      next: (s) => this.loginForm.patchValue(s),
      error: () => this.notify.toast('โหลดการตั้งค่าไม่สำเร็จ', 'error'),
    });
  }

  saveLoginSettings(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }
    this.loginSaving = true;
    const v = this.loginForm.getRawValue();
    this.settingsService
      .update({ loginMaxAttempts: v.loginMaxAttempts!, loginLockoutMinutes: v.loginLockoutMinutes! })
      .subscribe({
        next: () => {
          this.loginSaving = false;
          this.notify.toast('บันทึกการตั้งค่าเรียบร้อยแล้ว', 'success');
        },
        error: (err) => {
          this.loginSaving = false;
          this.notify.toast(err.error?.error || 'บันทึกไม่สำเร็จ', 'error');
        },
      });
  }

  // ---- 2. Scan locations ----

  private initMap(): void {
    if (!this.mapEl || typeof L === 'undefined') return;
    patchLeafletDefaultIcon();

    this.map = L.map(this.mapEl.nativeElement).setView(NAKHON_RATCHASIMA, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(this.map);

    setTimeout(() => this.map.invalidateSize(), 0);
    window.addEventListener('resize', () => this.map.invalidateSize());

    this.map.on('click', (e: any) => this.setPendingMarker(e.latlng.lat, e.latlng.lng));
  }

  private setPendingMarker(lat: number, lng: number): void {
    if (this.pendingMarker) this.map.removeLayer(this.pendingMarker);
    this.pendingMarker = L.marker([lat, lng], { draggable: true }).addTo(this.map);
    this.pendingMarker.on('dragend', () => {
      const p = this.pendingMarker.getLatLng();
      this.locationForm.patchValue({ latitude: Number(p.lat.toFixed(7)), longitude: Number(p.lng.toFixed(7)) });
    });
    this.locationForm.patchValue({ latitude: Number(lat.toFixed(7)), longitude: Number(lng.toFixed(7)) });
  }

  locateGps(): void {
    if (!navigator.geolocation) {
      this.notify.toast('อุปกรณ์/เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง GPS', 'error');
      return;
    }
    this.locatingGps = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        this.setPendingMarker(latitude, longitude);
        this.map.setView([latitude, longitude], 17);
        this.locatingGps = false;
      },
      (err) => {
        this.notify.toast(err.message || 'กรุณาอนุญาตการเข้าถึงตำแหน่ง (GPS) ในเบราว์เซอร์', 'error');
        this.locatingGps = false;
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  private loadLocations(): void {
    this.scanLocationService.list().subscribe({
      next: (locations) => {
        this.locations = locations;
        this.markersById.forEach((m) => this.map.removeLayer(m));
        this.markersById.clear();
        locations.forEach((loc) => {
          const marker = L.marker([loc.latitude, loc.longitude]).addTo(this.map).bindPopup(loc.name);
          this.markersById.set(loc.id, marker);
        });
      },
      error: () => this.notify.toast('โหลดจุดสแกนไม่สำเร็จ', 'error'),
    });
  }

  resetLocationForm(): void {
    this.editingLocationId = null;
    this.locationForm.reset({ name: '', latitude: null, longitude: null });
    if (this.pendingMarker) {
      this.map.removeLayer(this.pendingMarker);
      this.pendingMarker = null;
    }
  }

  editLocation(loc: ScanLocation): void {
    this.editingLocationId = loc.id;
    this.locationForm.patchValue({ name: loc.name, latitude: loc.latitude, longitude: loc.longitude });
    this.setPendingMarker(loc.latitude, loc.longitude);
    this.map.setView([loc.latitude, loc.longitude], 16);
  }

  async deleteLocation(loc: ScanLocation): Promise<void> {
    const ok = await this.notify.confirm({
      title: 'ยืนยันการลบ',
      message: `ลบจุดสแกน "${loc.name}" นี้?`,
      confirmText: 'ลบ',
      cancelText: 'ยกเลิก',
      danger: true,
    });
    if (!ok) return;
    this.scanLocationService.delete(loc.id).subscribe({
      next: () => {
        if (this.editingLocationId === loc.id) this.resetLocationForm();
        this.notify.toast('ลบจุดสแกนเรียบร้อยแล้ว', 'success');
        this.loadLocations();
      },
      error: (err) => this.notify.toast(err.error?.error || 'ลบไม่สำเร็จ', 'error'),
    });
  }

  saveLocation(): void {
    if (this.locationForm.invalid) {
      this.locationForm.markAllAsTouched();
      this.notify.toast('กรุณากรอกชื่อจุดติดตั้ง และคลิกบนแผนที่เพื่อเลือกตำแหน่ง', 'error');
      return;
    }
    const v = this.locationForm.getRawValue();
    const body = { name: v.name!.trim(), latitude: v.latitude!, longitude: v.longitude! };
    this.locationSaving = true;
    const obs: Observable<unknown> = this.editingLocationId
      ? this.scanLocationService.update(this.editingLocationId, body)
      : this.scanLocationService.create(body);
    obs.subscribe({
      next: () => {
        this.locationSaving = false;
        this.notify.toast('บันทึกจุดสแกนเรียบร้อยแล้ว', 'success');
        this.resetLocationForm();
        this.loadLocations();
      },
      error: (err: any) => {
        this.locationSaving = false;
        this.notify.toast(err.error?.error || 'บันทึกไม่สำเร็จ', 'error');
      },
    });
  }

  // ---- 3. Notifications ----

  onEmailUseGmailChange(): void {
    const emailGroup = this.notifForm.controls.email;
    if (emailGroup.controls.useGmail.value) {
      emailGroup.patchValue({ host: GMAIL_HOST, port: GMAIL_PORT, secure: true });
    }
  }

  private loadNotificationSettings(): void {
    this.notificationService.get().subscribe({
      next: (s) => {
        const useGmail = !s.email.host || s.email.host.trim().toLowerCase() === GMAIL_HOST;
        this.notifForm.patchValue({
          email: { ...s.email, useGmail },
          line: s.line,
          telegram: s.telegram,
          local: s.local,
          admin: s.admin,
          events: s.events,
        });
      },
      error: () => this.notify.toast('โหลดการตั้งค่าแจ้งเตือนไม่สำเร็จ', 'error'),
    });
  }

  private buildNotificationPayload(): NotificationSettings {
    const v = this.notifForm.getRawValue();
    return {
      email: {
        enabled: v.email.enabled!,
        host: (v.email.host || '').trim(),
        port: Number(v.email.port) || 587,
        secure: v.email.secure!,
        user: (v.email.user || '').trim(),
        pass: v.email.pass || '',
        from: (v.email.from || '').trim(),
      },
      line: {
        enabled: v.line.enabled!,
        channelAccessToken: (v.line.channelAccessToken || '').trim(),
      },
      telegram: {
        enabled: v.telegram.enabled!,
        botToken: (v.telegram.botToken || '').trim(),
      },
      local: {
        enabled: v.local.enabled!,
      },
      admin: {
        emails: (v.admin.emails || '').trim(),
        lineUserId: (v.admin.lineUserId || '').trim(),
        telegramChatId: (v.admin.telegramChatId || '').trim(),
      },
      events: {
        late: { employee: !!v.events.late.employee, admin: !!v.events.late.admin },
        absent: { employee: !!v.events.absent.employee, admin: !!v.events.absent.admin },
        success: { employee: !!v.events.success.employee, admin: !!v.events.success.admin },
      },
    };
  }

  saveNotificationSettings(): void {
    this.notifSaving = true;
    this.notificationService.save(this.buildNotificationPayload()).subscribe({
      next: () => {
        this.notifSaving = false;
        this.notify.toast('บันทึกการตั้งค่าแจ้งเตือนเรียบร้อยแล้ว', 'success');
      },
      error: (err) => {
        this.notifSaving = false;
        this.notify.toast(err.error?.error || 'บันทึกไม่สำเร็จ', 'error');
      },
    });
  }

  testChannel(channel: 'email' | 'line' | 'telegram' | 'local'): void {
    const target = channel === 'local' ? '' : this.testTargets[channel];
    if (channel !== 'local' && !target.trim()) {
      this.notify.toast('กรุณากรอกปลายทางสำหรับทดสอบ', 'warning');
      return;
    }
    this.testing[channel] = true;
    // Save current form state first so the test uses the credentials just typed in.
    this.notificationService.save(this.buildNotificationPayload()).subscribe({
      next: () => {
        this.notificationService.test(channel, target.trim()).subscribe({
          next: () => {
            this.testing[channel] = false;
            this.notify.toast('ส่งข้อความทดสอบเรียบร้อยแล้ว', 'success');
          },
          error: (err) => {
            this.testing[channel] = false;
            this.notify.toast(err.error?.error || 'ส่งข้อความทดสอบไม่สำเร็จ', 'error');
          },
        });
      },
      error: (err) => {
        this.testing[channel] = false;
        this.notify.toast(err.error?.error || 'บันทึกการตั้งค่าก่อนทดสอบไม่สำเร็จ', 'error');
      },
    });
  }

  trackByLocationId = (_: number, loc: ScanLocation) => loc.id;

  formatCoord(value: number): string {
    return Number(value).toFixed(6);
  }
}

export default SettingsComponent;
