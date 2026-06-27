import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TableColumn, ResponsiveTableComponent } from '../../shared/components/responsive-table/responsive-table.component';
import { EmployeeService } from '../../core/services/employee.service';
import { ShiftService } from '../../core/services/shift.service';
import { NotifyService } from '../../core/services/notify.service';
import { Employee, Shift } from '../../core/models/models';
import { EmployeeFormDialogComponent, EmployeeFormDialogResult } from './employee-form-dialog/employee-form-dialog.component';
import { FaceEnrollDialogComponent } from './face-enroll-dialog/face-enroll-dialog.component';
import { FaceGalleryDialogComponent, FaceGalleryDialogResult } from './face-gallery-dialog/face-gallery-dialog.component';

@Component({
  selector: 'app-employees',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatSlideToggleModule,
    MatTooltipModule,
    ResponsiveTableComponent,
  ],
  templateUrl: './employees.component.html',
  styleUrl: './employees.component.scss',
})
export class EmployeesComponent implements OnInit {
  readonly columns: TableColumn[] = [
    { key: 'code', label: 'รหัส' },
    { key: 'name', label: 'ชื่อ-นามสกุล' },
    { key: 'department', label: 'แผนก' },
    { key: 'supervisor', label: 'ผู้บังคับบัญชา' },
    { key: 'shift', label: 'กะ' },
    { key: 'faces', label: 'ใบหน้า' },
    { key: 'status', label: 'สถานะ' },
    { key: 'actions', label: 'จัดการ' },
  ];

  readonly employees = signal<Employee[]>([]);
  readonly shifts = signal<Shift[]>([]);
  readonly showInactive = signal(false);
  readonly loading = signal(false);

  constructor(
    private employeeService: EmployeeService,
    private shiftService: ShiftService,
    private notify: NotifyService,
    private dialog: MatDialog,
  ) {}

  ngOnInit(): void {
    this.loadShifts();
    this.loadEmployees();
  }

  trackById = (_: number, e: Employee) => e.id;

  private readonly employeeTypeLabel: Record<string, string> = {
    civil_servant: 'ข้าราชการ',
    government_employee: 'พนักงานราชการ',
    temp_employee: 'ลูกจ้าง',
  };

  employeeTypeText(type: Employee['employee_type']): string {
    return type ? this.employeeTypeLabel[type] || type : '-';
  }

  loadShifts(): void {
    this.shiftService.list().subscribe({
      next: (shifts) => this.shifts.set(shifts),
      error: () => {},
    });
  }

  loadEmployees(): void {
    this.loading.set(true);
    this.employeeService.list(this.showInactive()).subscribe({
      next: (rows) => {
        this.employees.set(rows);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.notify.toast(err.error?.error || 'โหลดข้อมูลพนักงานไม่สำเร็จ', 'error');
      },
    });
  }

  onToggleInactive(checked: boolean): void {
    this.showInactive.set(checked);
    this.loadEmployees();
  }

  openAddDialog(): void {
    const ref = this.dialog.open(EmployeeFormDialogComponent, {
      width: '640px',
      maxWidth: '95vw',
      data: { employee: null, shifts: this.shifts(), employees: this.employees() },
    });
    ref.afterClosed().subscribe((result: EmployeeFormDialogResult | undefined) => {
      if (!result?.saved) return;
      this.loadEmployees();
      if (result.createdId) {
        this.openFaceEnrollDialog(result.createdId, result.employeeName || '');
      }
    });
  }

  openEditDialog(emp: Employee): void {
    const ref = this.dialog.open(EmployeeFormDialogComponent, {
      width: '640px',
      maxWidth: '95vw',
      data: { employee: emp, shifts: this.shifts(), employees: this.employees() },
    });
    ref.afterClosed().subscribe((result: EmployeeFormDialogResult | undefined) => {
      if (result?.saved) this.loadEmployees();
    });
  }

  async deleteEmployee(emp: Employee): Promise<void> {
    const ok = await this.notify.confirm({
      title: 'ยืนยันการปิดใช้งาน',
      message: `พนักงาน "${emp.full_name}" จะถูกปิดใช้งาน (ข้อมูลการลงเวลายังคงอยู่)`,
      confirmText: 'ปิดใช้งาน',
      cancelText: 'ยกเลิก',
      danger: true,
    });
    if (!ok) return;

    this.employeeService.delete(emp.id).subscribe({
      next: () => {
        this.notify.toast('ปิดใช้งานพนักงานแล้ว', 'success');
        this.loadEmployees();
      },
      error: (err) => this.notify.toast(err.error?.error || 'ดำเนินการไม่สำเร็จ', 'error'),
    });
  }

  openFaceEnrollDialog(employeeId: number, employeeName: string): void {
    const ref = this.dialog.open(FaceEnrollDialogComponent, {
      width: '560px',
      maxWidth: '95vw',
      data: { employeeId, employeeName },
    });
    ref.afterClosed().subscribe((saved: boolean | undefined) => {
      if (saved) this.loadEmployees();
    });
  }

  // PDPA: withdrawing consent also wipes any already-collected face data
  // server-side (no remaining legal basis to keep it — see employee.routes.ts).
  async withdrawConsent(emp: Employee): Promise<void> {
    const ok = await this.notify.confirm({
      title: 'ยืนยันการเพิกถอนความยินยอม',
      message: `เพิกถอนความยินยอมการเก็บข้อมูลใบหน้าของ "${emp.full_name}"? ระบบจะลบข้อมูลใบหน้าที่บันทึกไว้ทั้งหมด พนักงานจะลงเวลาด้วยการสแกนหน้าไม่ได้จนกว่าจะให้ความยินยอมใหม่`,
      confirmText: 'เพิกถอนและลบข้อมูลใบหน้า',
      cancelText: 'ยกเลิก',
      danger: true,
    });
    if (!ok) return;

    this.employeeService.withdrawConsent(emp.id).subscribe({
      next: () => {
        this.notify.toast('เพิกถอนความยินยอมและลบข้อมูลใบหน้าแล้ว', 'success');
        this.loadEmployees();
      },
      error: (err) => this.notify.toast(err.error?.error || 'ดำเนินการไม่สำเร็จ', 'error'),
    });
  }

  openFaceGallery(emp: Employee): void {
    const ref = this.dialog.open(FaceGalleryDialogComponent, {
      width: '640px',
      maxWidth: '95vw',
      data: { employeeId: emp.id, employeeName: emp.full_name },
    });
    ref.afterClosed().subscribe((result: FaceGalleryDialogResult | undefined) => {
      if (result?.reenroll) {
        this.openFaceEnrollDialog(emp.id, emp.full_name);
      } else {
        this.loadEmployees();
      }
    });
  }
}
