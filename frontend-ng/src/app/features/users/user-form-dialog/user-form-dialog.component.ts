import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { UserService } from '../../../core/services/user.service';
import { Employee, UserAccount } from '../../../core/models/models';
import { NotifyService } from '../../../core/services/notify.service';

export interface UserFormDialogData {
  user: UserAccount | null;
  employees: Employee[];
}

export interface UserFormDialogResult {
  saved: boolean;
}

@Component({
  selector: 'app-user-form-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './user-form-dialog.component.html',
  styleUrl: './user-form-dialog.component.scss',
})
export class UserFormDialogComponent implements OnInit {
  public dialogRef = inject<MatDialogRef<UserFormDialogComponent, UserFormDialogResult>>(MatDialogRef);
  public data = inject<UserFormDialogData>(MAT_DIALOG_DATA);
  private fb = inject(FormBuilder);
  private userService = inject(UserService);
  private notify = inject(NotifyService);

  readonly isEdit = !!this.data.user;
  readonly saving = signal(false);

  // Backend rejects (409) if the chosen employee is already linked to a
  // different user, so this just needs to offer active employees — no
  // need to pre-compute "already taken" here.
  readonly employeeOptions = this.data.employees.filter((e) => e.is_active);

  readonly form = this.fb.group({
    username: ['', Validators.required],
    password: ['', this.isEdit ? [] : [Validators.required, Validators.minLength(6)]],
    role: ['user' as 'admin' | 'user', Validators.required],
    employee_id: [null as number | null],
  });

  ngOnInit(): void {
    const u = this.data.user;
    if (u) {
      this.form.patchValue({
        username: u.username,
        role: u.role,
        employee_id: u.employee_id,
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
    this.saving.set(true);

    if (this.isEdit) {
      this.userService
        .update(this.data.user!.id, {
          username: (v.username || '').trim(),
          password: v.password || undefined,
          role: v.role!,
          employee_id: v.employee_id,
        })
        .subscribe({
          next: () => {
            this.saving.set(false);
            this.notify.toast('บันทึกข้อมูลผู้ใช้แล้ว', 'success');
            this.dialogRef.close({ saved: true });
          },
          error: (err) => {
            this.saving.set(false);
            this.notify.toast(err.error?.error || 'บันทึกไม่สำเร็จ', 'error');
          },
        });
    } else {
      this.userService
        .create({
          username: (v.username || '').trim(),
          password: v.password || '',
          role: v.role!,
          employee_id: v.employee_id,
        })
        .subscribe({
          next: () => {
            this.saving.set(false);
            this.notify.toast('สร้างผู้ใช้แล้ว', 'success');
            this.dialogRef.close({ saved: true });
          },
          error: (err) => {
            this.saving.set(false);
            this.notify.toast(err.error?.error || 'สร้างผู้ใช้ไม่สำเร็จ', 'error');
          },
        });
    }
  }
}
