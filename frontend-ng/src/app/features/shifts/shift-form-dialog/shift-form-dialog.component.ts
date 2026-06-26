import { Component, Inject, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Shift } from '../../../core/models/models';
import { NotifyService } from '../../../core/services/notify.service';
import { ShiftService } from '../../../core/services/shift.service';

export interface ShiftFormDialogData {
  shift: Shift | null;
}

export interface ShiftFormDialogResult {
  saved: boolean;
}

const TIME_FIELDS = [
  'checkin_start',
  'checkin_end',
  'late_cutoff',
  'checkout_start',
  'checkout_end',
  'ot_start',
  'ot_end',
] as const;

/** Sensible defaults mirrored from the original vanilla-JS shifts.js "add" flow. */
const DEFAULTS: Record<(typeof TIME_FIELDS)[number], string> = {
  checkin_start: '07:30',
  checkin_end: '08:00',
  late_cutoff: '10:00',
  checkout_start: '16:00',
  checkout_end: '18:00',
  ot_start: '18:00',
  ot_end: '22:00',
};

/** Truncate a HH:MM:SS string (as stored/returned by the backend) down to HH:MM for the <input type="time"> control. */
function hhmm(t?: string | null): string {
  return t ? t.slice(0, 5) : '';
}

@Component({
  selector: 'app-shift-form-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './shift-form-dialog.component.html',
  styleUrl: './shift-form-dialog.component.scss',
})
export class ShiftFormDialogComponent implements OnInit {
  public dialogRef = inject<MatDialogRef<ShiftFormDialogComponent, ShiftFormDialogResult>>(MatDialogRef);
  public data = inject<ShiftFormDialogData>(MAT_DIALOG_DATA);
  private fb = inject(FormBuilder);
  private shiftService = inject(ShiftService);
  private notify = inject(NotifyService);

  readonly isEdit = !!this.data.shift;
  readonly saving = signal(false);
  readonly errorMessage = signal('');

  readonly form = this.fb.group({
    name: ['', Validators.required],
    checkin_start: [''],
    checkin_end: [''],
    late_cutoff: [''],
    checkout_start: [''],
    checkout_end: [''],
    ot_start: [''],
    ot_end: [''],
  });

  constructor() {}

  ngOnInit(): void {
    const s = this.data.shift;
    if (s) {
      this.form.patchValue({
        name: s.name,
        checkin_start: hhmm(s.checkin_start),
        checkin_end: hhmm(s.checkin_end),
        late_cutoff: hhmm(s.late_cutoff),
        checkout_start: hhmm(s.checkout_start),
        checkout_end: hhmm(s.checkout_end),
        ot_start: hhmm(s.ot_start),
        ot_end: hhmm(s.ot_end),
      });
    } else {
      this.form.patchValue(DEFAULTS);
    }
  }

  cancel(): void {
    this.dialogRef.close({ saved: false });
  }

  save(): void {
    this.errorMessage.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();

    // Ensure HH:MM:SS, matching the backend's expected time format (original JS appended ':00' to 5-char values).
    const toHms = (t: string | null) => {
      const val = (t || '').trim();
      if (!val) return '';
      return val.length === 5 ? `${val}:00` : val;
    };

    const body = {
      name: (v.name || '').trim(),
      checkin_start: toHms(v.checkin_start),
      checkin_end: toHms(v.checkin_end),
      late_cutoff: toHms(v.late_cutoff),
      checkout_start: toHms(v.checkout_start),
      checkout_end: toHms(v.checkout_end),
      ot_start: toHms(v.ot_start),
      ot_end: toHms(v.ot_end),
    };

    this.saving.set(true);

    const onSuccess = () => {
      this.saving.set(false);
      this.notify.toast('บันทึกกะแล้ว', 'success');
      this.dialogRef.close({ saved: true });
    };
    const onError = (err: any) => {
      this.saving.set(false);
      const message = err.error?.error || 'บันทึกไม่สำเร็จ';
      this.errorMessage.set(message);
      this.notify.toast(message, 'error');
      // Keep the dialog open so the user can fix the time ordering.
    };

    if (this.isEdit) {
      this.shiftService.update(this.data.shift!.id, body).subscribe({ next: onSuccess, error: onError });
    } else {
      this.shiftService.create(body).subscribe({ next: onSuccess, error: onError });
    }
  }
}
