import { Component, Inject, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { EmployeeService } from '../../../core/services/employee.service';
import { Employee, EmployeeCreateRequest, Shift } from '../../../core/models/models';
import { NotifyService } from '../../../core/services/notify.service';

export interface EmployeeFormDialogData {
  employee: Employee | null;
  shifts: Shift[];
  employees: Employee[];
}

export interface EmployeeFormDialogResult {
  /** Newly created employee id, only set when this was a "create" (so the caller can move on to face enrollment). */
  createdId?: number;
  /** Name of the created/edited employee, handed back so the caller doesn't need to re-fetch the list before opening a follow-up dialog. */
  employeeName?: string;
  saved: boolean;
}

@Component({
  selector: 'app-employee-form-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatButtonModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './employee-form-dialog.component.html',
  styleUrl: './employee-form-dialog.component.scss',
})
export class EmployeeFormDialogComponent implements OnInit {
  public dialogRef = inject<MatDialogRef<EmployeeFormDialogComponent, EmployeeFormDialogResult>>(MatDialogRef);
  public data = inject<EmployeeFormDialogData>(MAT_DIALOG_DATA);
  private fb = inject(FormBuilder);
  private employeeService = inject(EmployeeService);
  private notify = inject(NotifyService);

  readonly isEdit = !!this.data.employee;
  readonly saving = signal(false);

  // Anyone except the employee being edited (can't supervise themselves) and
  // anyone already inactive (soft-deleted staff shouldn't be a supervisor).
  readonly supervisorOptions = this.data.employees.filter(
    (e) => e.is_active && e.id !== this.data.employee?.id
  );

  readonly form = this.fb.group({
    employee_code: ['', Validators.required],
    full_name: ['', Validators.required],
    department: [''],
    position: [''],
    shift_id: [null as number | null],
    supervisor_id: [null as number | null],
    is_active: [true],
    notify_enabled: [true],
    notify_email: [''],
    notify_line_user_id: [''],
    notify_telegram_chat_id: [''],
    create_login: [false],
    login_username: [''],
    login_password: [''],
    login_role: ['user'],
  });

  constructor() {}

  ngOnInit(): void {
    const e = this.data.employee;
    if (e) {
      this.form.patchValue({
        employee_code: e.employee_code,
        full_name: e.full_name,
        department: e.department || '',
        position: e.position || '',
        shift_id: e.shift_id,
        supervisor_id: e.supervisor_id ?? null,
        is_active: !!e.is_active,
        notify_enabled: e.notify_enabled !== 0,
        notify_email: e.notify_email || '',
        notify_line_user_id: e.notify_line_user_id || '',
        notify_telegram_chat_id: e.notify_telegram_chat_id || '',
      });
    }
  }

  cancel(): void {
    this.dialogRef.close({ saved: false });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const body: EmployeeCreateRequest = {
      employee_code: (v.employee_code || '').trim(),
      full_name: (v.full_name || '').trim(),
      department: (v.department || '').trim(),
      position: (v.position || '').trim(),
      shift_id: v.shift_id || null,
      supervisor_id: v.supervisor_id || null,
      notify_enabled: !!v.notify_enabled,
      notify_email: (v.notify_email || '').trim(),
      notify_line_user_id: (v.notify_line_user_id || '').trim(),
      notify_telegram_chat_id: (v.notify_telegram_chat_id || '').trim(),
    };

    this.saving.set(true);

    if (this.isEdit) {
      const updateBody: Partial<EmployeeCreateRequest> = { ...body, is_active: !!v.is_active };
      this.employeeService.update(this.data.employee!.id, updateBody).subscribe({
        next: () => {
          this.saving.set(false);
          this.notify.toast('บันทึกข้อมูลพนักงานแล้ว', 'success');
          this.dialogRef.close({ saved: true });
        },
        error: (err) => {
          this.saving.set(false);
          this.notify.toast(err.error?.error || 'บันทึกข้อมูลไม่สำเร็จ', 'error');
        },
      });
    } else {
      if (v.create_login) {
        body.create_login = true;
        body.login_username = (v.login_username || '').trim();
        body.login_password = v.login_password || '';
        body.login_role = (v.login_role as 'admin' | 'user') || 'user';
      }
      this.employeeService.create(body).subscribe({
        next: (result) => {
          this.saving.set(false);
          this.notify.toast('สร้างพนักงานแล้ว — กรุณาลงทะเบียนใบหน้า', 'success');
          this.dialogRef.close({ saved: true, createdId: result.id, employeeName: body.full_name });
        },
        error: (err) => {
          this.saving.set(false);
          this.notify.toast(err.error?.error || 'สร้างพนักงานไม่สำเร็จ', 'error');
        },
      });
    }
  }
}
