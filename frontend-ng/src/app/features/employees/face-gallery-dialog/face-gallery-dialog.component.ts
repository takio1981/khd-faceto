import { CommonModule } from '@angular/common';
import { Component, Inject, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { EmployeeService } from '../../../core/services/employee.service';
import { FaceRecord } from '../../../core/models/models';
import { NotifyService } from '../../../core/services/notify.service';

export interface FaceGalleryDialogData {
  employeeId: number;
  employeeName: string;
}

export interface FaceGalleryDialogResult {
  /** true if the user chose to re-enroll (caller should open the face-enroll-dialog). */
  reenroll: boolean;
}

@Component({
  selector: 'app-face-gallery-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './face-gallery-dialog.component.html',
  styleUrl: './face-gallery-dialog.component.scss',
})
export class FaceGalleryDialogComponent implements OnInit {
  readonly loading = signal(true);
  readonly faces = signal<FaceRecord[]>([]);
  readonly clearing = signal(false);

  constructor(
    public dialogRef: MatDialogRef<FaceGalleryDialogComponent, FaceGalleryDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: FaceGalleryDialogData,
    private employeeService: EmployeeService,
    private notify: NotifyService,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.employeeService.listFaces(this.data.employeeId).subscribe({
      next: (faces) => {
        this.faces.set(faces);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notify.toast('โหลดข้อมูลใบหน้าไม่สำเร็จ', 'error');
      },
    });
  }

  async clearAll(): Promise<void> {
    const ok = await this.notify.confirm({
      title: 'ยืนยันการลบใบหน้าทั้งหมด',
      message: `ลบข้อมูลใบหน้าทั้งหมดของ "${this.data.employeeName}" ใช่หรือไม่? จะต้องลงทะเบียนใบหน้าใหม่ก่อนใช้งานสแกนหน้า`,
      confirmText: 'ลบทั้งหมด',
      cancelText: 'ยกเลิก',
      danger: true,
    });
    if (!ok) return;

    this.clearing.set(true);
    this.employeeService.clearFaces(this.data.employeeId).subscribe({
      next: () => {
        this.clearing.set(false);
        this.faces.set([]);
        this.notify.toast('ลบข้อมูลใบหน้าทั้งหมดแล้ว', 'success');
      },
      error: (err) => {
        this.clearing.set(false);
        this.notify.toast(err.error?.error || 'ลบไม่สำเร็จ', 'error');
      },
    });
  }

  reenroll(): void {
    this.dialogRef.close({ reenroll: true });
  }

  close(): void {
    this.dialogRef.close({ reenroll: false });
  }
}
