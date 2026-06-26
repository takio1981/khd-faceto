import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TableColumn, ResponsiveTableComponent } from '../../shared/components/responsive-table/responsive-table.component';
import { Shift } from '../../core/models/models';
import { NotifyService } from '../../core/services/notify.service';
import { ShiftService } from '../../core/services/shift.service';
import { ShiftFormDialogComponent, ShiftFormDialogResult } from './shift-form-dialog/shift-form-dialog.component';

/** Truncate a HH:MM:SS string (as stored/returned by the backend) down to HH:MM for display. */
function hhmm(t?: string | null): string {
  return t ? t.slice(0, 5) : '-';
}

@Component({
  selector: 'app-shifts',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatTooltipModule,
    ResponsiveTableComponent,
  ],
  templateUrl: './shifts.component.html',
  styleUrl: './shifts.component.scss',
})
export class ShiftsComponent implements OnInit {
  readonly columns: TableColumn[] = [
    { key: 'name', label: 'ชื่อกะ' },
    { key: 'checkin', label: 'เข้างาน (เริ่ม-ตรงเวลา)' },
    { key: 'late_cutoff', label: 'สายได้ถึง' },
    { key: 'checkout', label: 'ออกงาน (เริ่ม-สิ้นสุด)' },
    { key: 'ot', label: 'OT (เริ่ม-สิ้นสุด)' },
    { key: 'actions', label: 'จัดการ' },
  ];

  readonly shifts = signal<Shift[]>([]);
  readonly loading = signal(false);

  constructor(
    private shiftService: ShiftService,
    private notify: NotifyService,
    private dialog: MatDialog,
  ) {}

  ngOnInit(): void {
    this.loadShifts();
  }

  trackById = (_: number, s: Shift) => s.id;

  hhmm = hhmm;

  window(start?: string | null, end?: string | null): string {
    return `${hhmm(start)} - ${hhmm(end)}`;
  }

  loadShifts(): void {
    this.loading.set(true);
    this.shiftService.list().subscribe({
      next: (rows) => {
        this.shifts.set(rows);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.notify.toast(err.error?.error || 'โหลดข้อมูลกะการทำงานไม่สำเร็จ', 'error');
      },
    });
  }

  openAddDialog(): void {
    const ref = this.dialog.open(ShiftFormDialogComponent, {
      width: '640px',
      maxWidth: '95vw',
      data: { shift: null },
    });
    ref.afterClosed().subscribe((result: ShiftFormDialogResult | undefined) => {
      if (result?.saved) this.loadShifts();
    });
  }

  openEditDialog(shift: Shift): void {
    const ref = this.dialog.open(ShiftFormDialogComponent, {
      width: '640px',
      maxWidth: '95vw',
      data: { shift },
    });
    ref.afterClosed().subscribe((result: ShiftFormDialogResult | undefined) => {
      if (result?.saved) this.loadShifts();
    });
  }

  async deleteShift(shift: Shift): Promise<void> {
    const ok = await this.notify.confirm({
      title: 'ยืนยันการลบ',
      message: `กะการทำงาน "${shift.name}" จะถูกลบออกจากระบบ`,
      confirmText: 'ลบ',
      cancelText: 'ยกเลิก',
      danger: true,
    });
    if (!ok) return;

    this.shiftService.delete(shift.id).subscribe({
      next: () => {
        this.notify.toast('ลบกะแล้ว', 'success');
        this.loadShifts();
      },
      error: (err) => this.notify.toast(err.error?.error || 'ลบไม่สำเร็จ', 'error'),
    });
  }
}
