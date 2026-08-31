import { Component, ViewChild, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { NotifyService } from '../../../core/services/notify.service';
import { PinService } from '../../../core/services/pin.service';
import { PinInputComponent } from '../../../shared/components/pin-input/pin-input.component';

// Shown once, right after a successful password login, when PIN login is
// enabled but this user has no PIN yet (see LoginComponent.afterLoginSuccess).
// Also reused by the self-service "PIN & Devices" page for users who skipped
// it here and want to set one up later.
@Component({
  selector: 'app-pin-setup-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatProgressSpinnerModule, PinInputComponent],
  templateUrl: './pin-setup-dialog.component.html',
  styleUrl: './pin-setup-dialog.component.scss',
})
export class PinSetupDialogComponent {
  public dialogRef = inject<MatDialogRef<PinSetupDialogComponent, boolean>>(MatDialogRef);
  private pinService = inject(PinService);
  private notify = inject(NotifyService);

  @ViewChild('newPinInput') private newPinRef?: PinInputComponent;
  @ViewChild('confirmPinInput') private confirmPinRef?: PinInputComponent;

  readonly saving = signal(false);
  readonly step = signal<'new' | 'confirm'>('new');

  private newPinValue = '';
  private confirmPinValue = '';

  onNewComplete(value: string): void {
    this.newPinValue = value;
    this.step.set('confirm');
    queueMicrotask(() => this.confirmPinRef?.focusFirst());
  }

  onConfirmComplete(value: string): void {
    this.confirmPinValue = value;
    if (this.newPinValue !== this.confirmPinValue) {
      this.notify.toast('PIN ใหม่และการยืนยันไม่ตรงกัน กรุณากรอกใหม่อีกครั้ง', 'error');
      this.resetForm();
      return;
    }
    this.save();
  }

  private resetForm(): void {
    this.newPinValue = '';
    this.confirmPinValue = '';
    this.step.set('new');
    this.newPinRef?.reset();
    this.confirmPinRef?.reset();
    queueMicrotask(() => this.newPinRef?.focusFirst());
  }

  private save(): void {
    this.saving.set(true);
    this.pinService.setup(this.newPinValue).subscribe({
      next: () => {
        this.saving.set(false);
        this.notify.toast('ตั้งค่า PIN สำเร็จ', 'success');
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.saving.set(false);
        this.notify.toast(err.error?.error || 'ตั้งค่า PIN ไม่สำเร็จ', 'error');
        this.resetForm();
      },
    });
  }

  skip(): void {
    this.dialogRef.close(false);
  }
}
