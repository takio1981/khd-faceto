import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { UserService } from '../../core/services/user.service';
import { EmployeeService } from '../../core/services/employee.service';
import { NotifyService } from '../../core/services/notify.service';
import { AuthService } from '../../core/services/auth.service';
import { Employee, Role, UserAccount } from '../../core/models/models';
import { ResponsiveTableComponent, TableColumn } from '../../shared/components/responsive-table/responsive-table.component';
import { UserFormDialogComponent, UserFormDialogResult } from './user-form-dialog/user-form-dialog.component';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    ResponsiveTableComponent,
  ],
  templateUrl: './users.component.html',
  styleUrl: './users.component.scss',
})
export class UsersComponent implements OnInit {
  private fb = inject(FormBuilder);
  private userService = inject(UserService);
  private employeeService = inject(EmployeeService);
  private notify = inject(NotifyService);
  private dialog = inject(MatDialog);
  auth = inject(AuthService);

  readonly columns: TableColumn[] = [
    { key: 'username', label: 'ชื่อผู้ใช้' },
    { key: 'role', label: 'สิทธิ์' },
    { key: 'employee', label: 'ผูกกับพนักงาน' },
    { key: 'status', label: 'สถานะ' },
    { key: 'actions', label: 'จัดการ' },
  ];

  readonly filterForm = this.fb.group({
    role: ['' as Role | ''],
    search: [''],
    unlinkedOnly: [false],
    lockedOnly: [false],
  });

  readonly users = signal<UserAccount[]>([]);
  readonly employees = signal<Employee[]>([]);
  readonly loading = signal(false);

  trackById = (_: number, u: UserAccount) => u.id;

  ngOnInit(): void {
    this.loadEmployees();
    this.load();
  }

  loadEmployees(): void {
    this.employeeService.list().subscribe({
      next: (rows) => this.employees.set(rows),
      error: () => {},
    });
  }

  load(): void {
    this.loading.set(true);
    const v = this.filterForm.getRawValue();
    this.userService
      .list({
        role: v.role || undefined,
        search: v.search || undefined,
        unlinkedOnly: !!v.unlinkedOnly,
        lockedOnly: !!v.lockedOnly,
      })
      .subscribe({
        next: (rows) => {
          this.users.set(rows);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.notify.toast(err.error?.error || 'โหลดข้อมูลผู้ใช้ไม่สำเร็จ', 'error');
        },
      });
  }

  applyFilter(): void {
    this.load();
  }

  resetFilter(): void {
    this.filterForm.reset({ role: '', search: '', unlinkedOnly: false, lockedOnly: false });
    this.load();
  }

  isSelf(u: UserAccount): boolean {
    return u.username === this.auth.username();
  }

  openAddDialog(): void {
    const ref = this.dialog.open(UserFormDialogComponent, {
      width: '560px',
      maxWidth: '95vw',
      data: { user: null, employees: this.employees() },
    });
    ref.afterClosed().subscribe((result: UserFormDialogResult | undefined) => {
      if (result?.saved) this.load();
    });
  }

  openEditDialog(u: UserAccount): void {
    const ref = this.dialog.open(UserFormDialogComponent, {
      width: '560px',
      maxWidth: '95vw',
      data: { user: u, employees: this.employees() },
    });
    ref.afterClosed().subscribe((result: UserFormDialogResult | undefined) => {
      if (result?.saved) this.load();
    });
  }

  unlock(u: UserAccount): void {
    this.userService.unlock(u.id).subscribe({
      next: () => {
        this.notify.toast('ปลดล็อกบัญชีแล้ว', 'success');
        this.load();
      },
      error: (err) => this.notify.toast(err.error?.error || 'ดำเนินการไม่สำเร็จ', 'error'),
    });
  }

  async deleteUser(u: UserAccount): Promise<void> {
    const ok = await this.notify.confirm({
      title: 'ยืนยันการลบ',
      message: `ลบผู้ใช้ "${u.username}" นี้? การลงชื่อเข้าใช้ของบัญชีนี้จะใช้ไม่ได้อีกทันที`,
      confirmText: 'ลบ',
      cancelText: 'ยกเลิก',
      danger: true,
    });
    if (!ok) return;
    this.userService.delete(u.id).subscribe({
      next: () => {
        this.notify.toast('ลบผู้ใช้แล้ว', 'success');
        this.load();
      },
      error: (err) => this.notify.toast(err.error?.error || 'ลบไม่สำเร็จ', 'error'),
    });
  }
}
