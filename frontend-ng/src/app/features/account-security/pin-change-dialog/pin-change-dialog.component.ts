import { Component, ViewChild, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { NotifyService } from '../../../core/services/notify.service';
import { PinService } from '../../../core/services/pin.service';
import { PinInputComponent } from '../../../shared/components/pin-input/pin-input.component';

type Step = 'current' | 'new' | 'confirm';

// Self-service PIN change — requires knowing the CURRENT PIN (unlike
// pin-reset-dialog, which requires the password instead).
@Component({
  selector: 'app-pin-change-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatProgressSpinnerModule, PinInputComponent],
  templateUrl: './pin-change-dialog.component.html',
  styleUrl: './pin-change-dialog.component.scss',
})
export class PinChangeDialogComponent {
  public dialogRef = inject<MatDialogRef<PinChangeDialogComponent, boolean>>(MatDialogRef);
  private pinService = inject(PinService);
  private notify = inject(NotifyService);

  @ViewChild('currentPinInput') private currentRef?: PinInputComponent;
  @ViewChild('newPinInput') private newRef?: PinInputComponent;
  @ViewChild('confirmPinInput') private confirmRef?: PinInputComponent;

  readonly saving = signal(false);
  readonly step = signal<Step>('current');

  private currentPin = '';
  private newPin = '';

  onCurrentComplete(value: string): void {
    this.currentPin = value;
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
      this.resetFrom('new');
      return;
    }
    this.save();
  }

  private resetFrom(step: Step): void {
    this.newPin = '';
    this.step.set(step);
    this.newRef?.reset();
    this.confirmRef?.reset();
    if (step === 'current') {
      this.currentPin = '';
      this.currentRef?.reset();
      queueMicrotask(() => this.currentRef?.focusFirst());
    } else {
      queueMicrotask(() => this.newRef?.focusFirst());
    }
  }

  private save(): void {
    this.saving.set(true);
    this.pinService.change(this.currentPin, this.newPin).subscribe({
      next: () => {
        this.saving.set(false);
        this.notify.toast('เปลี่ยน PIN สำเร็จ', 'success');
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.saving.set(false);
        this.notify.toast(err.error?.error || 'เปลี่ยน PIN ไม่สำเร็จ', 'error');
        if (err.error?.code === 'PIN_LOCKED') {
          this.dialogRef.close(false);
          return;
        }
        this.resetFrom('current');
      },
    });
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
