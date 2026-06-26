import { CommonModule } from '@angular/common';
import { Component, Inject, OnDestroy, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatNativeDateModule, provideNativeDateAdapter } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';

import { AttendanceService, AttendanceFilter } from '../../core/services/attendance.service';
import { EmployeeService } from '../../core/services/employee.service';
import { AuthService } from '../../core/services/auth.service';
import { NotifyService } from '../../core/services/notify.service';
import { AttendanceRecord, AttendanceStatus, Employee, ScanType } from '../../core/models/models';
import { ResponsiveTableComponent, TableColumn } from '../../shared/components/responsive-table/responsive-table.component';

const SCANTYPE_TH: Record<ScanType, string> = {
  check_in: 'เข้างาน',
  check_out: 'ออกงาน',
  ot_in: 'OT-เข้า',
  ot_out: 'OT-ออก',
};

const STATUS_TH: Record<AttendanceStatus, string> = {
  on_time: 'ตรงเวลา',
  late: 'สาย',
  absent: 'ขาด',
  ot: 'OT',
};

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ===== Image viewer dialog =====
@Component({
  selector: 'app-attendance-image-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>ภาพใบหน้าขณะลงเวลา</h2>
    <mat-dialog-content class="img-dialog-content">
      @if (data.imageUrl) {
        <img [src]="data.imageUrl" alt="face" class="face-img" />
      } @else {
        <p>กำลังโหลดภาพ...</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">ปิด</button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .img-dialog-content {
        display: flex;
        justify-content: center;
        align-items: center;
        min-width: 240px;
        min-height: 160px;
      }
      .face-img {
        max-width: 420px;
        max-height: 70vh;
        border-radius: 8px;
      }
    `,
  ],
})
export class AttendanceImageDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<AttendanceImageDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { imageUrl: string | null },
  ) {}
}

// ===== Edit record dialog (admin only) =====
export interface AttendanceEditDialogData {
  id: number;
  scanTime: string;
  scanType: ScanType;
  status: AttendanceStatus;
}

@Component({
  selector: 'app-attendance-edit-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatSelectModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>แก้ไขประวัติการลงเวลา</h2>
    <mat-dialog-content [formGroup]="form">
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>วันที่/เวลา</mat-label>
        <input matInput type="datetime-local" formControlName="scan_time" />
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>ประเภท</mat-label>
        <mat-select formControlName="scan_type">
          <mat-option value="check_in">เข้างาน</mat-option>
          <mat-option value="check_out">ออกงาน</mat-option>
          <mat-option value="ot_in">OT-เข้า</mat-option>
          <mat-option value="ot_out">OT-ออก</mat-option>
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>สถานะ</mat-label>
        <mat-select formControlName="status">
          <mat-option value="on_time">ตรงเวลา</mat-option>
          <mat-option value="late">สาย</mat-option>
          <mat-option value="absent">ขาด</mat-option>
          <mat-option value="ot">OT</mat-option>
        </mat-select>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">ยกเลิก</button>
      <button mat-flat-button color="primary" (click)="save()">บันทึก</button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .full-width {
        width: 100%;
        margin-bottom: 4px;
      }
      mat-dialog-content {
        display: flex;
        flex-direction: column;
        min-width: 280px;
      }
    `,
  ],
})
export class AttendanceEditDialogComponent {
  public dialogRef = inject<MatDialogRef<AttendanceEditDialogComponent, AttendanceEditDialogData | undefined>>(MatDialogRef);
  public data = inject<AttendanceEditDialogData>(MAT_DIALOG_DATA);
  private fb = inject(FormBuilder);

  readonly form = this.fb.group({
    scan_time: [toDatetimeLocal(this.data.scanTime)],
    scan_type: [this.data.scanType],
    status: [this.data.status],
  });

  constructor() {}

  save(): void {
    const v = this.form.getRawValue();
    if (!v.scan_time) return;
    this.dialogRef.close({
      id: this.data.id,
      scanTime: v.scan_time,
      scanType: v.scan_type as ScanType,
      status: v.status as AttendanceStatus,
    });
  }
}

// ===== Main page =====
@Component({
  selector: 'app-attendance',
  standalone: true,
  providers: [provideNativeDateAdapter()],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatExpansionModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatPaginatorModule,
    MatTooltipModule,
    ResponsiveTableComponent,
  ],
  templateUrl: './attendance.component.html',
  styleUrl: './attendance.component.scss',
})
export class AttendanceComponent implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private attendanceService = inject(AttendanceService);
  private employeeService = inject(EmployeeService);
  private auth = inject(AuthService);
  private notify = inject(NotifyService);
  private dialog = inject(MatDialog);

  readonly isAdmin = this.auth.isAdmin();

  readonly filterForm = this.fb.group({
    dateFrom: this.fb.control<Date | null>(null),
    dateTo: this.fb.control<Date | null>(null),
    employeeId: this.fb.control<number | null>(null),
    department: this.fb.control<string | null>(null),
    scanType: this.fb.control<ScanType | null>(null),
    status: this.fb.control<AttendanceStatus | null>(null),
    search: this.fb.control<string>(''),
  });

  employees: Employee[] = [];
  departments: string[] = [];

  records: AttendanceRecord[] = [];
  total = 0;
  page = 0; // zero-based for mat-paginator
  pageSize = 20;
  loading = false;

  readonly scanTypeLabel = SCANTYPE_TH;
  readonly statusLabel = STATUS_TH;
  readonly fmtDateTime = fmtDateTime;

  scanTypeText(scanType: ScanType): string {
    return SCANTYPE_TH[scanType] || scanType;
  }

  statusText(status: AttendanceStatus): string {
    return STATUS_TH[status] || status;
  }

  columns: TableColumn[] = [
    { key: 'employee_code', label: 'รหัส' },
    { key: 'full_name', label: 'ชื่อ-นามสกุล' },
    { key: 'department', label: 'แผนก' },
    { key: 'scan_time', label: 'วันที่/เวลา' },
    { key: 'scan_type', label: 'ประเภท' },
    { key: 'status', label: 'สถานะ' },
    { key: 'confidence', label: 'ความมั่นใจ' },
    { key: 'image', label: 'ภาพ' },
    { key: 'scan_location_name', label: 'จุดสแกน' },
  ];

  private objectUrls = new Set<string>();

  constructor() {
    if (this.isAdmin) {
      this.columns = [...this.columns, { key: 'actions', label: 'จัดการ' }];
    }
  }

  ngOnInit(): void {
    if (this.isAdmin) {
      this.loadEmployeeOptions();
    }
    this.search();
  }

  ngOnDestroy(): void {
    this.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.objectUrls.clear();
  }

  private loadEmployeeOptions(): void {
    this.employeeService.list().subscribe({
      next: (rows) => {
        this.employees = rows;
        const depts = new Set<string>();
        rows.forEach((e) => {
          if (e.department) depts.add(e.department);
        });
        this.departments = Array.from(depts).sort();
      },
      error: () => {},
    });
  }

  private buildFilter(pageOneBased: number): AttendanceFilter {
    const v = this.filterForm.getRawValue();
    return {
      dateFrom: v.dateFrom ? this.toDateStr(v.dateFrom) : undefined,
      dateTo: v.dateTo ? this.toDateStr(v.dateTo) : undefined,
      employeeId: v.employeeId ?? undefined,
      department: v.department ?? undefined,
      scanType: v.scanType ?? undefined,
      status: v.status ?? undefined,
      search: v.search?.trim() || undefined,
      page: pageOneBased,
      pageSize: this.pageSize,
    };
  }

  private toDateStr(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  search(): void {
    this.page = 0;
    this.load();
  }

  reset(): void {
    this.filterForm.reset({
      dateFrom: null,
      dateTo: null,
      employeeId: null,
      department: null,
      scanType: null,
      status: null,
      search: '',
    });
    this.search();
  }

  load(): void {
    this.loading = true;
    this.attendanceService.list(this.buildFilter(this.page + 1)).subscribe({
      next: (res) => {
        this.records = res.data;
        this.total = res.total;
        this.pageSize = res.pageSize;
        this.page = res.page - 1;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.notify.toast('ไม่สามารถโหลดข้อมูลประวัติการลงเวลาได้', 'error');
      },
    });
  }

  onPage(event: PageEvent): void {
    this.page = event.pageIndex;
    this.pageSize = event.pageSize;
    this.load();
  }

  trackById = (_: number, row: AttendanceRecord) => row.id;

  confidenceLabel(row: AttendanceRecord): string {
    return row.confidence != null ? `${(row.confidence * 100).toFixed(1)}%` : '-';
  }

  viewImage(row: AttendanceRecord): void {
    if (!row.face_image_path) return;
    const ref = this.dialog.open(AttendanceImageDialogComponent, {
      data: { imageUrl: null },
      width: '480px',
    });
    this.attendanceService.getImageBlob(row.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        this.objectUrls.add(url);
        ref.componentInstance.data.imageUrl = url;
      },
      error: () => {
        this.notify.toast('ไม่สามารถโหลดภาพได้', 'error');
        ref.close();
      },
    });
    // Object URLs created here are revoked together on component destroy
    // (see ngOnDestroy) rather than per-dialog-close, to keep things simple.
  }

  editRecord(row: AttendanceRecord): void {
    const ref = this.dialog.open<AttendanceEditDialogComponent, AttendanceEditDialogData, AttendanceEditDialogData>(
      AttendanceEditDialogComponent,
      {
        data: {
          id: row.id,
          scanTime: row.scan_time,
          scanType: row.scan_type,
          status: row.status,
        },
        width: '420px',
      },
    );
    ref.afterClosed().subscribe((result) => {
      if (!result) return;
      this.attendanceService
        .update(result.id, { scan_time: result.scanTime, scan_type: result.scanType, status: result.status })
        .subscribe({
          next: () => {
            this.notify.toast('แก้ไขประวัติการลงเวลาแล้ว', 'success');
            this.load();
          },
          error: (err) => {
            this.notify.toast(err.error?.error || 'แก้ไขไม่สำเร็จ', 'error');
          },
        });
    });
  }

  async deleteRecord(row: AttendanceRecord): Promise<void> {
    const ok = await this.notify.confirm({
      title: 'ยืนยันการลบ',
      message: 'ข้อมูลประวัติการลงเวลานี้จะถูกลบอย่างถาวร ไม่สามารถเรียกคืนได้',
      confirmText: 'ลบ',
      cancelText: 'ยกเลิก',
      danger: true,
    });
    if (!ok) return;
    this.attendanceService.delete(row.id).subscribe({
      next: () => {
        this.notify.toast('ลบประวัติการลงเวลาแล้ว', 'success');
        this.load();
      },
      error: (err) => {
        this.notify.toast(err.error?.error || 'ลบไม่สำเร็จ', 'error');
      },
    });
  }
}

export default AttendanceComponent;
