import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatNativeDateModule } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AttendanceService } from '../../core/services/attendance.service';
import { AuthService } from '../../core/services/auth.service';
import { NotifyService } from '../../core/services/notify.service';
import { SpoofingAlert, SpoofingAlertListResponse } from '../../core/models/models';

@Component({
  selector: 'app-security-alerts',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './security-alerts.component.html',
  styleUrl: './security-alerts.component.scss',
})
export class SecurityAlertsComponent implements OnInit {
  readonly loading = signal(false);
  readonly alerts = signal<SpoofingAlert[]>([]);
  readonly total = signal(0);

  page = 0;
  pageSize = 20;
  dateFrom: Date | null = null;
  dateTo: Date | null = null;

  previewUrl: string | null = null;
  previewAlt = '';
  previewLoading = false;

  selectedIds = new Set<number>();
  get selectedCount(): number { return this.selectedIds.size; }
  get allSelected(): boolean {
    const a = this.alerts();
    return a.length > 0 && a.every((x) => this.selectedIds.has(x.id));
  }
  get someSelected(): boolean {
    return this.selectedIds.size > 0 && !this.allSelected;
  }

  constructor(
    private attendanceService: AttendanceService,
    private notify: NotifyService,
    public auth: AuthService,
    private dialog: MatDialog,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  private toDateStr(d: Date | null): string | undefined {
    if (!d) return undefined;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  toggleSelectAll(): void {
    if (this.allSelected) {
      this.alerts().forEach((a) => this.selectedIds.delete(a.id));
    } else {
      this.alerts().forEach((a) => this.selectedIds.add(a.id));
    }
  }

  toggleSelect(id: number): void {
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
  }

  async deleteOne(alert: SpoofingAlert): Promise<void> {
    const ok = await this.notify.confirm({
      title: 'ลบรายการ',
      message: `ยืนยันลบเหตุการณ์ #${alert.id} — ${alert.full_name ?? 'ไม่ทราบ'} — ${this.formatDt(alert.detected_at)} ?`,
      confirmText: 'ลบ',
      danger: true,
    });
    if (!ok) return;
    try {
      await firstValueFrom(this.attendanceService.deleteSpoofingAlert(alert.id));
      this.selectedIds.delete(alert.id);
      this.notify.toast('ลบรายการสำเร็จ', 'success');
      this.load();
    } catch {
      this.notify.toast('ลบไม่สำเร็จ', 'error');
    }
  }

  async deleteSelected(): Promise<void> {
    const ids = [...this.selectedIds];
    const ok = await this.notify.confirm({
      title: 'ลบรายการที่เลือก',
      message: `ยืนยันลบ ${ids.length} รายการที่เลือก? ไฟล์ภาพจะถูกลบด้วย`,
      confirmText: `ลบ ${ids.length} รายการ`,
      danger: true,
    });
    if (!ok) return;
    try {
      await firstValueFrom(this.attendanceService.deleteSpoofingAlerts(ids));
      this.selectedIds.clear();
      this.notify.toast(`ลบ ${ids.length} รายการสำเร็จ`, 'success');
      if (this.page > 0 && this.alerts().length === ids.length) this.page = 0;
      this.load();
    } catch {
      this.notify.toast('ลบไม่สำเร็จ', 'error');
    }
  }

  load(): void {
    this.loading.set(true);
    this.attendanceService.listSpoofingAlerts(
      this.page + 1, this.pageSize,
      this.toDateStr(this.dateFrom),
      this.toDateStr(this.dateTo),
    ).subscribe({
      next: (res: SpoofingAlertListResponse) => {
        this.alerts.set(res.data);
        this.total.set(res.total);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notify.toast('โหลดข้อมูลไม่สำเร็จ', 'error');
      },
    });
  }

  onPage(e: PageEvent): void {
    this.page = e.pageIndex;
    this.pageSize = e.pageSize;
    this.load();
  }

  applyFilter(): void {
    this.page = 0;
    this.load();
  }

  openImage(alert: SpoofingAlert): void {
    if (!alert.face_image_path) return;
    this.previewAlt = `ใบหน้าที่ตรวจพบ — ${alert.full_name ?? 'ไม่ทราบ'} — ${this.formatDt(alert.detected_at)}`;
    this.previewUrl = null;
    this.previewLoading = true;
    this.attendanceService.getSpoofingAlertImageBlob(alert.id).subscribe({
      next: (blob) => {
        if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
        this.previewUrl = URL.createObjectURL(blob);
        this.previewLoading = false;
      },
      error: () => {
        this.previewLoading = false;
        this.notify.toast('โหลดภาพไม่สำเร็จ', 'error');
      },
    });
  }

  closePreview(): void {
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = null;
    this.previewLoading = false;
  }

  formatDt(dt: string): string {
    const d = new Date(dt);
    return d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'medium' });
  }
}
