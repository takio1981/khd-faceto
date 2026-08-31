import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PinDevice, PinStatus } from '../../core/models/models';
import { NotifyService } from '../../core/services/notify.service';
import { PinService } from '../../core/services/pin.service';
import { ResponsiveTableComponent, TableColumn } from '../../shared/components/responsive-table/responsive-table.component';
import { PinSetupDialogComponent } from '../login/pin-setup-dialog/pin-setup-dialog.component';
import { PinChangeDialogComponent } from './pin-change-dialog/pin-change-dialog.component';
import { PinResetDialogComponent } from './pin-reset-dialog/pin-reset-dialog.component';

// Self-service "PIN & Devices" page — every logged-in user reaches this
// (route guarded only by the shell's authGuard, no adminGuard), unlike
// /settings which is admin-only. Reuses PinSetupDialogComponent from the
// login feature (same dialog shown right after first password login).
@Component({
  selector: 'app-account-security',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatDialogModule,
    MatIconModule,
    MatTooltipModule,
    ResponsiveTableComponent,
  ],
  templateUrl: './account-security.component.html',
  styleUrl: './account-security.component.scss',
})
export class AccountSecurityComponent implements OnInit {
  private pinService = inject(PinService);
  private notify = inject(NotifyService);
  private dialog = inject(MatDialog);

  readonly status = signal<PinStatus | null>(null);
  readonly devices = signal<PinDevice[]>([]);
  readonly loading = signal(false);

  readonly columns: TableColumn[] = [
    { key: 'device_label', label: 'อุปกรณ์' },
    { key: 'last_login_at', label: 'ใช้งานล่าสุด' },
    { key: 'actions', label: 'จัดการ' },
  ];

  trackById = (_: number, d: PinDevice) => d.id;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.pinService.status().subscribe({
      next: (s) => {
        this.status.set(s);
        this.loading.set(false);
        if (s.configured) this.loadDevices();
        else this.devices.set([]);
      },
      error: () => this.loading.set(false),
    });
  }

  private loadDevices(): void {
    this.pinService.listDevices().subscribe({
      next: (rows) => this.devices.set(rows),
      error: () => {},
    });
  }

  isCurrentDevice(d: PinDevice): boolean {
    return d.device_id === this.pinService.myDeviceId();
  }

  openSetup(): void {
    this.dialog
      .open(PinSetupDialogComponent, { width: '420px' })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) this.load();
      });
  }

  openChange(): void {
    this.dialog
      .open(PinChangeDialogComponent, { width: '420px' })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) this.load();
      });
  }

  openReset(): void {
    this.dialog
      .open(PinResetDialogComponent, { width: '420px' })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) this.load();
      });
  }

  async removeDevice(d: PinDevice): Promise<void> {
    const ok = await this.notify.confirm({
      title: 'ลบอุปกรณ์',
      message: `ลบอุปกรณ์ "${d.device_label || d.device_id}"? อุปกรณ์นี้จะไม่สามารถเข้าสู่ระบบด้วย PIN ได้อีกจนกว่าจะลงทะเบียนใหม่`,
      confirmText: 'ลบ',
      cancelText: 'ยกเลิก',
      danger: true,
    });
    if (!ok) return;
    this.pinService.removeDevice(d.id).subscribe({
      next: () => {
        this.notify.toast('ลบอุปกรณ์แล้ว', 'success');
        this.loadDevices();
      },
      error: (err) => this.notify.toast(err.error?.error || 'ลบไม่สำเร็จ', 'error'),
    });
  }
}
