import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NotificationService } from '../../core/services/notification.service';
import { NotifyService } from '../../core/services/notify.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificationHistoryItem, NotifyEventType } from '../../core/models/models';
import { ResponsiveTableComponent, TableColumn } from '../../shared/components/responsive-table/responsive-table.component';

const EVENT_TYPE_TH: Record<NotifyEventType, string> = {
  late: 'มาสาย',
  absent: 'ขาดงาน',
  success: 'ลงเวลาสำเร็จ',
};

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatSelectModule,
    MatTooltipModule,
    ResponsiveTableComponent,
  ],
  templateUrl: './notifications.component.html',
  styleUrl: './notifications.component.scss',
})
export class NotificationsComponent implements OnInit {
  private fb = inject(FormBuilder);
  private notificationService = inject(NotificationService);
  private notify = inject(NotifyService);
  auth = inject(AuthService);

  readonly eventTypeTh = EVENT_TYPE_TH;
  readonly hasEmployee = !!this.auth.employeeId();

  readonly eventTypeOptions: { value: NotifyEventType | ''; label: string }[] = [
    { value: '', label: 'ทุกประเภท' },
    { value: 'late', label: 'มาสาย' },
    { value: 'absent', label: 'ขาดงาน' },
    { value: 'success', label: 'ลงเวลาสำเร็จ' },
  ];
  readonly readStatusOptions: { value: '' | '0' | '1'; label: string }[] = [
    { value: '', label: 'ทั้งหมด' },
    { value: '0', label: 'ยังไม่อ่าน' },
    { value: '1', label: 'อ่านแล้ว' },
  ];

  readonly filterForm = this.fb.group({
    eventType: ['' as NotifyEventType | ''],
    isRead: ['' as '' | '0' | '1'],
    dateFrom: [''],
    dateTo: [''],
  });

  readonly columns: TableColumn[] = [
    { key: 'created_at', label: 'เวลา' },
    { key: 'event_type', label: 'ประเภท' },
    { key: 'title', label: 'หัวข้อ' },
    { key: 'body', label: 'รายละเอียด' },
    { key: 'status', label: 'สถานะ' },
    { key: 'actions', label: 'จัดการ' },
  ];

  items: NotificationHistoryItem[] = [];
  total = 0;
  page = 0; // zero-based for mat-paginator
  pageSize = 20;
  unreadCount = 0;
  loading = false;

  trackById = (_: number, item: NotificationHistoryItem) => item.id;

  ngOnInit(): void {
    if (this.hasEmployee) this.load();
  }

  load(): void {
    this.loading = true;
    const v = this.filterForm.getRawValue();
    this.notificationService
      .listMine({
        eventType: v.eventType || undefined,
        isRead: v.isRead || undefined,
        dateFrom: v.dateFrom || undefined,
        dateTo: v.dateTo || undefined,
        page: this.page + 1,
        pageSize: this.pageSize,
      })
      .subscribe({
        next: (res) => {
          this.items = res.data;
          this.total = res.total;
          this.unreadCount = res.unreadCount;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notify.toast('โหลดประวัติการแจ้งเตือนไม่สำเร็จ', 'error');
        },
      });
  }

  applyFilter(): void {
    this.page = 0;
    this.load();
  }

  resetFilter(): void {
    this.filterForm.reset({ eventType: '', isRead: '', dateFrom: '', dateTo: '' });
    this.applyFilter();
  }

  onPage(event: PageEvent): void {
    this.page = event.pageIndex;
    this.pageSize = event.pageSize;
    this.load();
  }

  toggleRead(item: NotificationHistoryItem): void {
    const nextRead = !item.is_read;
    this.notificationService.setRead(item.id, nextRead).subscribe({
      next: () => {
        item.is_read = nextRead ? 1 : 0;
        this.unreadCount = Math.max(0, this.unreadCount + (nextRead ? -1 : 1));
      },
      error: () => this.notify.toast('ดำเนินการไม่สำเร็จ', 'error'),
    });
  }

  markAllRead(): void {
    this.notificationService.markAllRead().subscribe({
      next: () => {
        this.notify.toast('ทำเครื่องหมายอ่านแล้วทั้งหมด', 'success');
        this.load();
      },
      error: () => this.notify.toast('ดำเนินการไม่สำเร็จ', 'error'),
    });
  }

  async deleteItem(item: NotificationHistoryItem): Promise<void> {
    const ok = await this.notify.confirm({
      title: 'ยืนยันการลบ',
      message: `ลบการแจ้งเตือน "${item.title}" นี้?`,
      confirmText: 'ลบ',
      cancelText: 'ยกเลิก',
      danger: true,
    });
    if (!ok) return;
    this.notificationService.deleteMine(item.id).subscribe({
      next: () => {
        this.notify.toast('ลบการแจ้งเตือนแล้ว', 'success');
        this.load();
      },
      error: () => this.notify.toast('ลบไม่สำเร็จ', 'error'),
    });
  }

  eventTypeText(type: string): string {
    return EVENT_TYPE_TH[type as NotifyEventType] || type;
  }
}
