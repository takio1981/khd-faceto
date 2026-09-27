import { Component, Inject, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Shift } from '../../../core/models/models';
import { NotifyService } from '../../../core/services/notify.service';
import { ShiftService } from '../../../core/services/shift.service';
import { TimePickerComponent } from '../../../shared/components/time-picker/time-picker.component';

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

const DAY_FIELDS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_DEFAULTS: Record<(typeof DAY_FIELDS)[number], boolean> = {
  mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: true,
};

/** Truncate a HH:MM:SS string (as stored/returned by the backend) down to HH:MM for the <input type="time"> control. */
function hhmm(t?: string | null): string {
  return t ? t.slice(0, 5) : '';
}

const FIELD_LABELS: Record<(typeof TIME_FIELDS)[number], string> = {
  checkin_start: 'เริ่มเข้างาน',
  checkin_end: 'ตรงเวลาถึง',
  late_cutoff: 'สายได้ถึง',
  checkout_start: 'เริ่มออกงาน',
  checkout_end: 'สิ้นสุดออกงาน',
  ot_start: 'เริ่ม OT',
  ot_end: 'สิ้นสุด OT',
};

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Live mirror of the backend's validateShiftOrder (shift.service.ts) —
// surfaces an ordering problem immediately as the admin adjusts a time,
// instead of only after a failed save. Without this, an admin who hits the
// backend's rejection has no clue WHICH field to fix, and can end up
// dragging several time-pickers down toward 00:00 just trying to make the
// error go away — which technically satisfies "non-decreasing order" but
// leaves the shift's check-in/checkout window degenerate (unusable).
function orderCheck(
  v: Partial<Record<(typeof TIME_FIELDS)[number], string | null>> & {
    flexible_time?: boolean | null;
    flexible_min_hours?: number | string | null;
  }
): string | null {
  if (v.flexible_time) {
    // Flexible-time shift: only the cutoff (checkout_end) and the minimum-
    // hours-before-checkout guard matter — the other fields are unused, so
    // skip the fixed-window ordering checks entirely.
    if (!v.checkout_end) return 'กรุณากรอกเวลาตัดยอด';
    const minHours = Number(v.flexible_min_hours);
    if (!Number.isFinite(minHours) || minHours < 0 || minHours > 24) {
      return 'ชั่วโมงขั้นต่ำก่อนออกงานต้องเป็นตัวเลข 0-24';
    }
    return null;
  }
  for (let i = 1; i < TIME_FIELDS.length; i++) {
    const prevKey = TIME_FIELDS[i - 1];
    const curKey = TIME_FIELDS[i];
    const prev = v[prevKey];
    const cur = v[curKey];
    if (!prev || !cur) continue;
    if (timeToMinutes(cur) < timeToMinutes(prev)) {
      return `ลำดับเวลาไม่ถูกต้อง: "${FIELD_LABELS[curKey]}" (${cur}) ต้องไม่น้อยกว่า "${FIELD_LABELS[prevKey]}" (${prev})`;
    }
  }
  if (v.checkin_start && v.late_cutoff && timeToMinutes(v.late_cutoff) <= timeToMinutes(v.checkin_start)) {
    return `ช่วงเข้างานว่างเปล่า: "สายได้ถึง" (${v.late_cutoff}) ต้องมากกว่า "เริ่มเข้างาน" (${v.checkin_start}) — ไม่อย่างนั้นจะสแกนเข้างานไม่ได้เลย`;
  }
  if (v.checkout_start && v.checkout_end && timeToMinutes(v.checkout_end) <= timeToMinutes(v.checkout_start)) {
    return `ช่วงออกงานว่างเปล่า: "สิ้นสุดออกงาน" (${v.checkout_end}) ต้องมากกว่า "เริ่มออกงาน" (${v.checkout_start}) — ไม่อย่างนั้นจะสแกนออกงานไม่ได้เลย`;
  }
  return null;
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
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    TimePickerComponent,
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
  readonly orderError = signal<string | null>(null);

  readonly form = this.fb.group({
    name: ['', Validators.required],
    flexible_time: [false],
    flexible_min_hours: [0],
    mon: [true],
    tue: [true],
    wed: [true],
    thu: [true],
    fri: [true],
    sat: [true],
    sun: [true],
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
      const days = Object.fromEntries(DAY_FIELDS.map((f) => [f, !!s[f]])) as Record<(typeof DAY_FIELDS)[number], boolean>;
      this.form.patchValue({
        name: s.name,
        flexible_time: !!s.flexible_time,
        flexible_min_hours: s.flexible_min_hours ?? 0,
        ...days,
        checkin_start: hhmm(s.checkin_start),
        checkin_end: hhmm(s.checkin_end),
        late_cutoff: hhmm(s.late_cutoff),
        checkout_start: hhmm(s.checkout_start),
        checkout_end: hhmm(s.checkout_end),
        ot_start: hhmm(s.ot_start),
        ot_end: hhmm(s.ot_end),
      });
    } else {
      this.form.patchValue({ ...DAY_DEFAULTS, ...DEFAULTS });
    }

    this.orderError.set(orderCheck(this.form.getRawValue()));
    this.form.valueChanges.subscribe(() => this.orderError.set(orderCheck(this.form.getRawValue())));
  }

  cancel(): void {
    this.dialogRef.close({ saved: false });
  }

  save(): void {
    this.errorMessage.set('');
    if (this.form.invalid || this.orderError()) {
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

    const toBit = (b: boolean | null | undefined): 0 | 1 => (b ? 1 : 0);
    const body = {
      name: (v.name || '').trim(),
      flexible_time: toBit(v.flexible_time),
      flexible_min_hours: Number(v.flexible_min_hours) || 0,
      mon: toBit(v.mon),
      tue: toBit(v.tue),
      wed: toBit(v.wed),
      thu: toBit(v.thu),
      fri: toBit(v.fri),
      sat: toBit(v.sat),
      sun: toBit(v.sun),
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
