import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { AuthService } from '../../core/services/auth.service';
import { CorrectionRequestService } from '../../core/services/correction-request.service';
import { NotifyService } from '../../core/services/notify.service';
import { AttendanceStatus, CorrectionRequest, CorrectionRequestType } from '../../core/models/models';
import { ResponsiveTableComponent, TableColumn } from '../../shared/components/responsive-table/responsive-table.component';

const STATUS_TH: Record<string, string> = {
  on_time: 'ตรงเวลา',
  late: 'สาย',
  absent: 'ขาด',
  ot: 'OT',
};

const WORKFLOW_STATUS_TH: Record<string, string> = {
  pending_supervisor: 'รอหัวหน้าอนุมัติ',
  pending_admin: 'รอ admin ยืนยัน',
  approved: 'อนุมัติแล้ว',
  rejected: 'ไม่อนุมัติ',
};

const REQUEST_TYPE_TH: Record<string, string> = {
  appeal_absent: 'อุทธรณ์ขาดงาน',
  appeal_late: 'อุทธรณ์มาสาย',
  correction: 'ขอแก้ไขเวลา',
};

@Component({
  selector: 'app-correction-requests',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTabsModule,
    ResponsiveTableComponent,
  ],
  providers: [provideNativeDateAdapter()],
  templateUrl: './correction-requests.component.html',
  styleUrl: './correction-requests.component.scss',
})
export class CorrectionRequestsComponent implements OnInit {
  private fb = inject(FormBuilder);
  private correctionRequestService = inject(CorrectionRequestService);
  private notify = inject(NotifyService);
  auth = inject(AuthService);

  readonly statusTh = STATUS_TH;
  readonly workflowStatusTh = WORKFLOW_STATUS_TH;
  readonly requestTypeTh = REQUEST_TYPE_TH;

  readonly canSubmit = !!this.auth.employeeId();

  readonly requestTypeOptions: { value: CorrectionRequestType; label: string }[] = [
    { value: 'appeal_absent', label: 'อุทธรณ์ขาดงาน (มาทำงานจริงแต่ระบบไม่มีการลงเวลา)' },
    { value: 'appeal_late', label: 'อุทธรณ์มาสาย (มีเหตุสุดวิสัย/ระบบจับเวลาผิดพลาด)' },
  ];
  readonly statusOptions: { value: AttendanceStatus; label: string }[] = [
    { value: 'on_time', label: 'ตรงเวลา' },
    { value: 'late', label: 'สาย' },
    { value: 'ot', label: 'OT' },
  ];

  readonly form = this.fb.group({
    requestType: ['appeal_absent' as CorrectionRequestType, Validators.required],
    targetDate: [new Date(), Validators.required],
    requestedTime: ['08:00', Validators.required],
    requestedStatus: ['on_time' as AttendanceStatus, Validators.required],
    reason: ['', Validators.required],
  });
  submitting = signal(false);

  readonly myColumns: TableColumn[] = [
    { key: 'target_date', label: 'วันที่' },
    { key: 'request_type', label: 'ประเภท' },
    { key: 'reason', label: 'เหตุผล' },
    { key: 'status', label: 'สถานะ' },
  ];
  readonly approvalColumns: TableColumn[] = [
    { key: 'target_date', label: 'วันที่' },
    { key: 'employee', label: 'พนักงาน' },
    { key: 'request_type', label: 'ประเภท' },
    { key: 'reason', label: 'เหตุผล' },
    { key: 'actions', label: 'จัดการ' },
  ];
  readonly allColumns: TableColumn[] = [
    { key: 'target_date', label: 'วันที่' },
    { key: 'employee', label: 'พนักงาน' },
    { key: 'request_type', label: 'ประเภท' },
    { key: 'status', label: 'สถานะ' },
    { key: 'actions', label: 'จัดการ' },
  ];

  myRequests: CorrectionRequest[] = [];
  approvingRequests: CorrectionRequest[] = [];
  allRequests: CorrectionRequest[] = [];
  loadingMy = false;
  loadingApproving = false;
  loadingAll = false;

  trackById = (_: number, r: CorrectionRequest) => r.id;

  ngOnInit(): void {
    this.loadMine();
    this.loadApproving();
    if (this.auth.isAdmin()) this.loadAll();
  }

  loadMine(): void {
    this.loadingMy = true;
    this.correctionRequestService.list('mine').subscribe({
      next: (rows) => {
        this.myRequests = rows;
        this.loadingMy = false;
      },
      error: () => {
        this.loadingMy = false;
      },
    });
  }

  loadApproving(): void {
    this.loadingApproving = true;
    this.correctionRequestService.list('approving').subscribe({
      next: (rows) => {
        this.approvingRequests = rows;
        this.loadingApproving = false;
      },
      error: () => {
        this.loadingApproving = false;
      },
    });
  }

  loadAll(): void {
    this.loadingAll = true;
    this.correctionRequestService.list('all').subscribe({
      next: (rows) => {
        this.allRequests = rows;
        this.loadingAll = false;
      },
      error: () => {
        this.loadingAll = false;
      },
    });
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const targetDate = this.formatDate(v.targetDate!);
    const requestedScanTime = `${targetDate} ${v.requestedTime}:00`;

    this.submitting.set(true);
    this.correctionRequestService
      .create({
        requestType: v.requestType!,
        targetDate,
        requestedScanTime,
        requestedStatus: v.requestedStatus,
        reason: v.reason!.trim(),
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.notify.toast('ยื่นคำขอเรียบร้อยแล้ว รอการพิจารณา', 'success');
          this.form.reset({
            requestType: 'appeal_absent',
            targetDate: new Date(),
            requestedTime: '08:00',
            requestedStatus: 'on_time',
            reason: '',
          });
          this.loadMine();
        },
        error: (err) => {
          this.submitting.set(false);
          this.notify.toast(err.error?.error || 'ยื่นคำขอไม่สำเร็จ', 'error');
        },
      });
  }

  async approve(req: CorrectionRequest): Promise<void> {
    this.correctionRequestService.supervisorDecision(req.id, 'approved').subscribe({
      next: () => {
        this.notify.toast('อนุมัติคำขอแล้ว — รอ admin ยืนยันขั้นสุดท้าย', 'success');
        this.loadApproving();
        if (this.auth.isAdmin()) this.loadAll();
      },
      error: (err) => this.notify.toast(err.error?.error || 'ดำเนินการไม่สำเร็จ', 'error'),
    });
  }

  async reject(req: CorrectionRequest): Promise<void> {
    const ok = await this.notify.confirm({
      title: 'ยืนยันการไม่อนุมัติ',
      message: `ไม่อนุมัติคำขอของ "${req.full_name}" วันที่ ${req.target_date}?`,
      confirmText: 'ไม่อนุมัติ',
      cancelText: 'ยกเลิก',
      danger: true,
    });
    if (!ok) return;
    this.correctionRequestService.supervisorDecision(req.id, 'rejected').subscribe({
      next: () => {
        this.notify.toast('ไม่อนุมัติคำขอแล้ว', 'success');
        this.loadApproving();
        if (this.auth.isAdmin()) this.loadAll();
      },
      error: (err) => this.notify.toast(err.error?.error || 'ดำเนินการไม่สำเร็จ', 'error'),
    });
  }

  confirmAdmin(req: CorrectionRequest): void {
    this.correctionRequestService.adminDecision(req.id, 'approved').subscribe({
      next: () => {
        this.notify.toast('ยืนยันคำขอแล้ว — ระบบปรับปรุงประวัติลงเวลาเรียบร้อย', 'success');
        this.loadAll();
      },
      error: (err) => this.notify.toast(err.error?.error || 'ดำเนินการไม่สำเร็จ', 'error'),
    });
  }

  async rejectAdmin(req: CorrectionRequest): Promise<void> {
    const ok = await this.notify.confirm({
      title: 'ยืนยันการไม่อนุมัติ',
      message: `ไม่อนุมัติคำขอของ "${req.full_name}" วันที่ ${req.target_date}?`,
      confirmText: 'ไม่อนุมัติ',
      cancelText: 'ยกเลิก',
      danger: true,
    });
    if (!ok) return;
    this.correctionRequestService.adminDecision(req.id, 'rejected').subscribe({
      next: () => {
        this.notify.toast('ไม่อนุมัติคำขอแล้ว', 'success');
        this.loadAll();
      },
      error: (err) => this.notify.toast(err.error?.error || 'ดำเนินการไม่สำเร็จ', 'error'),
    });
  }

  requestTypeText(type: string): string {
    return REQUEST_TYPE_TH[type] || type;
  }

  statusText(status: string | null): string {
    return status ? STATUS_TH[status] || status : '-';
  }

  workflowStatusText(status: string): string {
    return WORKFLOW_STATUS_TH[status] || status;
  }

  formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

export default CorrectionRequestsComponent;
