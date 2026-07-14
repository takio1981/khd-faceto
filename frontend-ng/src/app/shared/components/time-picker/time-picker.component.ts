import { Component, Input, forwardRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-time-picker',
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TimePickerComponent),
      multi: true,
    },
  ],
  templateUrl: './time-picker.component.html',
  styleUrl: './time-picker.component.scss',
})
export class TimePickerComponent implements ControlValueAccessor {
  @Input() label = 'เวลา';

  hour = 8;
  minute = 0;
  disabled = false;

  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};

  get h(): string { return String(this.hour).padStart(2, '0'); }
  get m(): string { return String(this.minute).padStart(2, '0'); }

  stepHour(delta: number): void {
    if (this.disabled) return;
    this.hour = (this.hour + delta + 24) % 24;
    this.emit();
  }

  stepMinute(delta: number): void {
    if (this.disabled) return;
    this.minute = (this.minute + delta + 60) % 60;
    this.emit();
  }

  onHourWheel(e: WheelEvent): void {
    e.preventDefault();
    this.stepHour(e.deltaY < 0 ? 1 : -1);
  }

  onMinuteWheel(e: WheelEvent): void {
    e.preventDefault();
    this.stepMinute(e.deltaY < 0 ? 1 : -1);
  }

  onHourEdit(e: Event): void {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    if (!isNaN(v)) this.hour = Math.max(0, Math.min(23, v));
    (e.target as HTMLInputElement).value = this.h;
    this.emit();
  }

  onMinuteEdit(e: Event): void {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    if (!isNaN(v)) this.minute = Math.max(0, Math.min(59, v));
    (e.target as HTMLInputElement).value = this.m;
    this.emit();
  }

  private emit(): void {
    this.onChange(`${this.h}:${this.m}`);
    this.onTouched();
  }

  writeValue(val: string): void {
    if (val && /^\d{1,2}:\d{2}/.test(val)) {
      const [hh, mm] = val.split(':').map(Number);
      this.hour = isNaN(hh) ? 8 : Math.max(0, Math.min(23, hh));
      this.minute = isNaN(mm) ? 0 : Math.max(0, Math.min(59, mm));
    }
  }

  registerOnChange(fn: (v: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(d: boolean): void { this.disabled = d; }
}
