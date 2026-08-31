import { Component, ViewChild, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { NotifyService } from '../../../core/services/notify.service';
import { PinService } from '../../../core/services/pin.service';
import { PinInputComponent } from '../../../shared/components/pin-input/pin-input.component';

type Step = 'password' | 'new' | 'confirm';

// "Forgot PIN" flow — re-authenticates with the PASSWORD (never the old
// PIN, which is the whole point of a reset) before allowing a new PIN to be
// set. Existing registered devices are left untouched by the backend.
@Component({
  selector: 'app-pin-reset-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    PinInputComponent,
  ],
  templateUrl: './pin-reset-dialog.component.html',
  styleUrl: './pin-reset-dialog.component.scss',
})
export class PinResetDialogComponent {
  public dialogRef = inject<MatDialogRef<PinResetDialogComponent, boolean>>(MatDialogRef);
  private fb = inject(FormBuilder);
  private pinService = inject(PinService);
  private notify = inject(NotifyService);

  @ViewChild('newPinInput') private newRef?: PinInputComponent;
  @ViewChild('confirmPinInput') private confirmRef?: PinInputComponent;

  readonly saving = signal(false);
  readonly step = signal<Step>('password');
  readonly showPassword = signal(false);

  readonly passwordForm = this.fb.group({
    password: ['', Validators.required],
  });

  private newPin = '';

  submitPassword(): void {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    this.step.set('new');
    queueMicrotask(() => this.newRef?.focusFirst());
  }

  onNewComplete(value: string): void {
    this.newPin = value;
    this.step.set('confirm');
    queueMicrotask(() => this.confirmRef?.focusFirst());
  }

  onConfirmComplete(value: string): void {
    if (value !== this.newPin) {
      this.notify.toast('PIN ใหม่และการยืนยันไม่ตรงกัน กรุณากรอกใหม่อีกครั้ง', 'error');
      this.resetPinSteps();
      return;
    }
    this.save();
  }

  private resetPinSteps(): void {
    this.newPin = '';
    this.step.set('new');
    this.newRef?.reset();
    this.confirmRef?.reset();
    queueMicrotask(() => this.newRef?.focusFirst());
  }

  private save(): void {
    this.saving.set(true);
    const password = this.passwordForm.getRawValue().password!;
    this.pinService.reset(password, this.newPin).subscribe({
      next: () => {
        this.saving.set(false);
        this.notify.toast('รีเซ็ต PIN สำเร็จ', 'success');
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.saving.set(false);
        this.notify.toast(err.error?.error || 'รีเซ็ต PIN ไม่สำเร็จ', 'error');
        this.newPin = '';
        this.step.set('password');
        this.newRef?.reset();
        this.confirmRef?.reset();
      },
    });
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
