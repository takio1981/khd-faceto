import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';

import { NotificationService } from '../../core/services/notification.service';
import { NotifyService } from '../../core/services/notify.service';
import { ScanLocationService } from '../../core/services/scan-location.service';
import { HolidayService } from '../../core/services/holiday.service';
import { AuditLogService } from '../../core/services/audit-log.service';
import { OrgStructureService } from '../../core/services/org-structure.service';
import { EmployeeService } from '../../core/services/employee.service';
import { patchLeafletDefaultIcon } from '../../shared/utils/leaflet-icon-fix';
import { SettingsService } from '../../core/services/settings.service';
import { AuditLogEntry, CivilServiceLevel, Department, Division, Employee, Holiday, NotificationSettings, Position, ScanLocation } from '../../core/models/models';
import { ResponsiveTableComponent, TableColumn } from '../../shared/components/responsive-table/responsive-table.component';

declare const L: any;

const NAKHON_RATCHASIMA: [number, number] = [14.9799, 102.0978];
const GMAIL_HOST = 'smtp.gmail.com';
const GMAIL_PORT = 465;

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatCheckboxModule,
    MatDividerModule,
    MatTabsModule,
    MatPaginatorModule,
    MatTooltipModule,
    ResponsiveTableComponent,
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent implements OnInit, AfterViewInit {
  @ViewChild('mapEl') mapEl?: ElementRef<HTMLDivElement>;

  private fb = inject(FormBuilder);
  private settingsService = inject(SettingsService);
  private scanLocationService = inject(ScanLocationService);
  private holidayService = inject(HolidayService);
  private auditLogService = inject(AuditLogService);
  private orgStructureService = inject(OrgStructureService);
  private employeeService = inject(EmployeeService);
  private notificationService = inject(NotificationService);
  private notify = inject(NotifyService);

  // ===== 1. Login security =====
  readonly loginForm = this.fb.group({
    loginMaxAttempts: this.fb.control<number>(5, [Validators.required, Validators.min(1), Validators.max(20)]),
    loginLockoutMinutes: this.fb.control<number>(15, [Validators.required, Validators.min(1), Validators.max(1440)]),
  });
  loginSaving = false;

  // ===== 2. Scan locations =====
  readonly locationForm = this.fb.group({
    name: ['', Validators.required],
    latitude: this.fb.control<number | null>(null, Validators.required),
    longitude: this.fb.control<number | null>(null, Validators.required),
  });
  locations: ScanLocation[] = [];
  editingLocationId: number | null = null;
  locationSaving = false;
  locatingGps = false;
  readonly locationColumns: TableColumn[] = [
    { key: 'name', label: 'ชื่อจุดติดตั้ง' },
    { key: 'coords', label: 'พิกัด' },
    { key: 'actions', label: 'จัดการ' },
  ];

  private map: any;
  private pendingMarker: any;
  private readonly markersById = new Map<number, any>();

  // ===== 2b. Holiday calendar =====
  readonly holidayForm = this.fb.group({
    holiday_date: ['', Validators.required],
    name: ['', Validators.required],
  });
  holidays: Holiday[] = [];
  holidaySaving = false;
  holidayYear = new Date().getFullYear();
  editingHolidayId: number | null = null;
  readonly holidayColumns: TableColumn[] = [
    { key: 'holiday_date', label: 'วันที่' },
    { key: 'name', label: 'ชื่อวันหยุด' },
    { key: 'actions', label: 'จัดการ' },
  ];
  trackByHolidayId = (_: number, h: Holiday) => h.id;

  // ===== 2c. Audit log =====
  readonly auditColumns: TableColumn[] = [
    { key: 'created_at', label: 'เวลา' },
    { key: 'username', label: 'ผู้ใช้' },
    { key: 'action', label: 'การกระทำ' },
    { key: 'target', label: 'เป้าหมาย' },
    { key: 'details', label: 'รายละเอียด' },
  ];
  readonly auditActionLabel: Record<string, string> = {
    'employee.update': 'แก้ไขข้อมูลพนักงาน',
    'employee.deactivate': 'ปิดใช้งานพนักงาน',
    'consent.grant': 'บันทึกความยินยอม (PDPA)',
    'consent.withdraw': 'เพิกถอนความยินยอม (PDPA)',
    'attendance.view_image': 'ดูภาพใบหน้าในประวัติลงเวลา',
    'attendance.update': 'แก้ไขประวัติลงเวลา',
    'attendance.delete': 'ลบประวัติลงเวลา',
    'shift.create': 'เพิ่มกะการทำงาน',
    'shift.update': 'แก้ไขกะการทำงาน',
    'shift.delete': 'ลบกะการทำงาน',
    'settings.update': 'แก้ไขการตั้งค่าความปลอดภัย',
    'scan_location.create': 'เพิ่มจุดสแกน',
    'scan_location.update': 'แก้ไขจุดสแกน',
    'scan_location.delete': 'ลบจุดสแกน',
    'notification_settings.update': 'แก้ไขการตั้งค่าแจ้งเตือน',
    'division.create': 'เพิ่มกลุ่มงาน',
    'division.update': 'แก้ไขกลุ่มงาน',
    'division.delete': 'ลบกลุ่มงาน',
    'department.create': 'เพิ่มแผนก',
    'department.update': 'แก้ไขแผนก',
    'department.delete': 'ลบแผนก',
    'position.create': 'เพิ่มตำแหน่ง',
    'position.update': 'แก้ไขตำแหน่ง',
    'position.delete': 'ลบตำแหน่ง',
    'level.create': 'เพิ่มระดับ',
    'level.update': 'แก้ไขระดับ',
    'level.delete': 'ลบระดับ',
    'correction_request.create': 'ยื่นคำขอแก้ไข/อุทธรณ์เวลา',
    'correction_request.supervisor_decision': 'หัวหน้าพิจารณาคำขอแก้ไขเวลา',
    'correction_request.admin_decision': 'admin ยืนยันคำขอแก้ไขเวลา',
  };
  auditLog: AuditLogEntry[] = [];
  auditTotal = 0;
  auditPage = 0; // zero-based for mat-paginator
  auditPageSize = 20;
  auditLoading = false;
  auditUsernameFilter = '';
  trackByAuditId = (_: number, a: AuditLogEntry) => a.id;

  // ===== 2d. Org structure (กลุ่มงาน/แผนก) =====
  readonly divisionForm = this.fb.group({
    name: ['', Validators.required],
    head_employee_id: [null as number | null],
  });
  readonly departmentForm = this.fb.group({
    name: ['', Validators.required],
    division_id: [null as number | null],
    head_employee_id: [null as number | null],
  });
  divisions: Division[] = [];
  departments: Department[] = [];
  allEmployees: Employee[] = [];
  editingDivisionId: number | null = null;
  editingDepartmentId: number | null = null;
  divisionSaving = false;
  departmentSaving = false;
  readonly divisionColumns: TableColumn[] = [
    { key: 'name', label: 'ชื่อกลุ่มงาน' },
    { key: 'head', label: 'หัวหน้ากลุ่มงาน' },
    { key: 'actions', label: 'จัดการ' },
  ];
  readonly departmentColumns: TableColumn[] = [
    { key: 'name', label: 'ชื่อแผนก' },
    { key: 'division', label: 'กลุ่มงาน' },
    { key: 'head', label: 'หัวหน้าแผนก' },
    { key: 'actions', label: 'จัดการ' },
  ];
  trackByDivisionId = (_: number, d: Division) => d.id;
  trackByDepartmentId = (_: number, d: Department) => d.id;

  readonly positionForm = this.fb.group({
    name: ['', Validators.required],
    category: [''],
  });
  positions: Position[] = [];
  editingPositionId: number | null = null;
  positionSaving = false;
  readonly positionColumns: TableColumn[] = [
    { key: 'name', label: 'ชื่อตำแหน่ง' },
    { key: 'category', label: 'หมวด' },
    { key: 'actions', label: 'จัดการ' },
  ];
  trackByPositionId = (_: number, p: Position) => p.id;

  readonly levelForm = this.fb.group({
    name: ['', Validators.required],
    category: [''],
  });
  levels: CivilServiceLevel[] = [];
  editingLevelId: number | null = null;
  levelSaving = false;
  readonly levelColumns: TableColumn[] = [
    { key: 'name', label: 'ชื่อระดับ' },
    { key: 'category', label: 'ประเภท' },
    { key: 'actions', label: 'จัดการ' },
  ];
  trackByLevelId = (_: number, l: CivilServiceLevel) => l.id;

  // ===== 3. Notifications =====
  readonly notifForm = this.fb.group({
    email: this.fb.group({
      enabled: [false],
      useGmail: [true],
      host: [''],
      port: this.fb.control<number>(587),
      secure: [false],
      user: [''],
      pass: [''],
      from: [''],
    }),
    line: this.fb.group({
      enabled: [false],
      channelAccessToken: [''],
    }),
    telegram: this.fb.group({
      enabled: [false],
      botToken: [''],
    }),
    local: this.fb.group({
      enabled: [false],
    }),
    admin: this.fb.group({
      emails: [''],
      lineUserId: [''],
      telegramChatId: [''],
    }),
    events: this.fb.group({
      late: this.fb.group({ employee: [true], admin: [true] }),
      absent: this.fb.group({ employee: [false], admin: [true] }),
      success: this.fb.group({ employee: [true], admin: [false] }),
    }),
  });
  notifSaving = false;

  testTargets: Record<'email' | 'line' | 'telegram', string> = { email: '', line: '', telegram: '' };
  testing: Record<'email' | 'line' | 'telegram' | 'local', boolean> = {
    email: false,
    line: false,
    telegram: false,
    local: false,
  };

  constructor() {}

  ngOnInit(): void {
    this.loadLoginSettings();
    this.loadNotificationSettings();
  }

  ngAfterViewInit(): void {
    this.initMap();
    this.loadLocations();
    this.loadHolidays();
    this.loadAuditLog();
    this.loadOrgStructure();
  }

  // Leaflet computes its tile layout from the container's size at the
  // moment .invalidateSize() runs. The "จุดสแกนใบหน้า" tab (index 1) is
  // hidden behind another active tab when the map first initializes, so it
  // sees a 0×0 container and never recovers on its own — re-measure every
  // time that tab becomes the active one.
  private static readonly SCAN_LOCATIONS_TAB_INDEX = 1;

  onTabChange(event: { index: number }): void {
    if (event.index === SettingsComponent.SCAN_LOCATIONS_TAB_INDEX && this.map) {
      // mat-tab-group's own switch animation (animationDuration="150ms") is
      // still resizing the panel when this event fires — invalidateSize()
      // before that finishes measures a too-small/zero box again. Wait past
      // the animation, then re-check once more for good measure.
      setTimeout(() => this.map.invalidateSize(), 200);
      setTimeout(() => this.map.invalidateSize(), 500);
    }
  }

  // ---- 1. Login security ----

  private loadLoginSettings(): void {
    this.settingsService.get().subscribe({
      next: (s) => this.loginForm.patchValue(s),
      error: () => this.notify.toast('โหลดการตั้งค่าไม่สำเร็จ', 'error'),
    });
  }

  saveLoginSettings(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }
    this.loginSaving = true;
    const v = this.loginForm.getRawValue();
    this.settingsService
      .update({ loginMaxAttempts: v.loginMaxAttempts!, loginLockoutMinutes: v.loginLockoutMinutes! })
      .subscribe({
        next: () => {
          this.loginSaving = false;
          this.notify.toast('บันทึกการตั้งค่าเรียบร้อยแล้ว', 'success');
        },
        error: (err) => {
          this.loginSaving = false;
          this.notify.toast(err.error?.error || 'บันทึกไม่สำเร็จ', 'error');
        },
      });
  }

  // ---- 2. Scan locations ----

  private initMap(): void {
    if (!this.mapEl || typeof L === 'undefined') return;
    patchLeafletDefaultIcon();

    this.map = L.map(this.mapEl.nativeElement).setView(NAKHON_RATCHASIMA, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(this.map);

    setTimeout(() => this.map.invalidateSize(), 0);
    window.addEventListener('resize', () => this.map.invalidateSize());

    this.map.on('click', (e: any) => this.setPendingMarker(e.latlng.lat, e.latlng.lng));
  }

  private setPendingMarker(lat: number, lng: number): void {
    if (this.pendingMarker) this.map.removeLayer(this.pendingMarker);
    this.pendingMarker = L.marker([lat, lng], { draggable: true }).addTo(this.map);
    this.pendingMarker.on('dragend', () => {
      const p = this.pendingMarker.getLatLng();
      this.locationForm.patchValue({ latitude: Number(p.lat.toFixed(7)), longitude: Number(p.lng.toFixed(7)) });
    });
    this.locationForm.patchValue({ latitude: Number(lat.toFixed(7)), longitude: Number(lng.toFixed(7)) });
  }

  locateGps(): void {
    if (!navigator.geolocation) {
      this.notify.toast('อุปกรณ์/เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง GPS', 'error');
      return;
    }
    this.locatingGps = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        this.setPendingMarker(latitude, longitude);
        this.map.setView([latitude, longitude], 17);
        this.locatingGps = false;
      },
      (err) => {
        this.notify.toast(err.message || 'กรุณาอนุญาตการเข้าถึงตำแหน่ง (GPS) ในเบราว์เซอร์', 'error');
        this.locatingGps = false;
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  private loadLocations(): void {
    this.scanLocationService.list().subscribe({
      next: (locations) => {
        this.locations = locations;
        this.markersById.forEach((m) => this.map.removeLayer(m));
        this.markersById.clear();
        locations.forEach((loc) => {
          const marker = L.marker([loc.latitude, loc.longitude]).addTo(this.map).bindPopup(loc.name);
          this.markersById.set(loc.id, marker);
        });
      },
      error: () => this.notify.toast('โหลดจุดสแกนไม่สำเร็จ', 'error'),
    });
  }

  resetLocationForm(): void {
    this.editingLocationId = null;
    this.locationForm.reset({ name: '', latitude: null, longitude: null });
    if (this.pendingMarker) {
      this.map.removeLayer(this.pendingMarker);
      this.pendingMarker = null;
    }
  }

  editLocation(loc: ScanLocation): void {
    this.editingLocationId = loc.id;
    this.locationForm.patchValue({ name: loc.name, latitude: loc.latitude, longitude: loc.longitude });
    this.setPendingMarker(loc.latitude, loc.longitude);
    this.map.setView([loc.latitude, loc.longitude], 16);
  }

  async deleteLocation(loc: ScanLocation): Promise<void> {
    const ok = await this.notify.confirm({
      title: 'ยืนยันการลบ',
      message: `ลบจุดสแกน "${loc.name}" นี้?`,
      confirmText: 'ลบ',
      cancelText: 'ยกเลิก',
      danger: true,
    });
    if (!ok) return;
    this.scanLocationService.delete(loc.id).subscribe({
      next: () => {
        if (this.editingLocationId === loc.id) this.resetLocationForm();
        this.notify.toast('ลบจุดสแกนเรียบร้อยแล้ว', 'success');
        this.loadLocations();
      },
      error: (err) => this.notify.toast(err.error?.error || 'ลบไม่สำเร็จ', 'error'),
    });
  }

  saveLocation(): void {
    if (this.locationForm.invalid) {
      this.locationForm.markAllAsTouched();
      this.notify.toast('กรุณากรอกชื่อจุดติดตั้ง และคลิกบนแผนที่เพื่อเลือกตำแหน่ง', 'error');
      return;
    }
    const v = this.locationForm.getRawValue();
    const body = { name: v.name!.trim(), latitude: v.latitude!, longitude: v.longitude! };
    this.locationSaving = true;
    const obs: Observable<unknown> = this.editingLocationId
      ? this.scanLocationService.update(this.editingLocationId, body)
      : this.scanLocationService.create(body);
    obs.subscribe({
      next: () => {
        this.locationSaving = false;
        this.notify.toast('บันทึกจุดสแกนเรียบร้อยแล้ว', 'success');
        this.resetLocationForm();
        this.loadLocations();
      },
      error: (err: any) => {
        this.locationSaving = false;
        this.notify.toast(err.error?.error || 'บันทึกไม่สำเร็จ', 'error');
      },
    });
  }

  // ---- 2b. Holiday calendar ----

  loadHolidays(): void {
    this.holidayService.list(this.holidayYear).subscribe({
      next: (rows) => (this.holidays = rows),
      error: () => this.notify.toast('โหลดปฏิทินวันหยุดไม่สำเร็จ', 'error'),
    });
  }

  onHolidayYearChange(): void {
    this.loadHolidays();
  }

  editHoliday(h: Holiday): void {
    this.editingHolidayId = h.id;
    this.holidayForm.patchValue({ holiday_date: h.holiday_date, name: h.name });
  }

  cancelEditHoliday(): void {
    this.editingHolidayId = null;
    this.holidayForm.reset({ holiday_date: '', name: '' });
  }

  saveHoliday(): void {
    if (this.holidayForm.invalid) {
      this.holidayForm.markAllAsTouched();
      return;
    }
    const v = this.holidayForm.getRawValue();
    const body = { holiday_date: v.holiday_date!, name: v.name!.trim() };
    this.holidaySaving = true;
    const obs: Observable<unknown> = this.editingHolidayId
      ? this.holidayService.update(this.editingHolidayId, body)
      : this.holidayService.create(body);
    obs.subscribe({
      next: () => {
        this.holidaySaving = false;
        this.notify.toast(this.editingHolidayId ? 'บันทึกการแก้ไขเรียบร้อยแล้ว' : 'เพิ่มวันหยุดเรียบร้อยแล้ว', 'success');
        this.cancelEditHoliday();
        this.loadHolidays();
      },
      error: (err: any) => {
        this.holidaySaving = false;
        this.notify.toast(err.error?.error || 'บันทึกไม่สำเร็จ', 'error');
      },
    });
  }

  async deleteHoliday(h: Holiday): Promise<void> {
    const ok = await this.notify.confirm({
      title: 'ยืนยันการลบ',
      message: `ลบวันหยุด "${h.name}" (${h.holiday_date}) นี้?`,
      confirmText: 'ลบ',
      cancelText: 'ยกเลิก',
      danger: true,
    });
    if (!ok) return;
    this.holidayService.delete(h.id).subscribe({
      next: () => {
        if (this.editingHolidayId === h.id) this.cancelEditHoliday();
        this.notify.toast('ลบวันหยุดเรียบร้อยแล้ว', 'success');
        this.loadHolidays();
      },
      error: (err: any) => this.notify.toast(err.error?.error || 'ลบไม่สำเร็จ', 'error'),
    });
  }

  // ---- 2c. Audit log ----

  loadAuditLog(): void {
    this.auditLoading = true;
    this.auditLogService
      .list({
        page: this.auditPage + 1,
        pageSize: this.auditPageSize,
        username: this.auditUsernameFilter || undefined,
      })
      .subscribe({
        next: (res) => {
          this.auditLog = res.data;
          this.auditTotal = res.total;
          this.auditLoading = false;
        },
        error: () => {
          this.auditLoading = false;
          this.notify.toast('โหลดประวัติการใช้งานไม่สำเร็จ', 'error');
        },
      });
  }

  onAuditPage(event: PageEvent): void {
    this.auditPage = event.pageIndex;
    this.auditPageSize = event.pageSize;
    this.loadAuditLog();
  }

  onAuditFilterApply(): void {
    this.auditPage = 0;
    this.loadAuditLog();
  }

  auditActionText(action: string): string {
    return this.auditActionLabel[action] || action;
  }

  auditTargetText(entry: AuditLogEntry): string {
    if (!entry.target_table) return '-';
    return entry.target_id ? `${entry.target_table} #${entry.target_id}` : entry.target_table;
  }

  // Compact one-line diff for the table; full JSON is in the tooltip.
  auditDetailsText(entry: AuditLogEntry): string {
    if (entry.after_data) return entry.after_data.length > 80 ? entry.after_data.slice(0, 80) + '…' : entry.after_data;
    if (entry.before_data) return 'ลบแล้ว';
    return '-';
  }

  // ---- 2d. Org structure ----

  loadOrgStructure(): void {
    this.employeeService.list().subscribe({
      next: (rows) => (this.allEmployees = rows),
      error: () => {},
    });
    this.loadDivisions();
    this.loadDepartments();
    this.loadPositions();
    this.loadLevels();
  }

  loadLevels(): void {
    this.orgStructureService.listLevels().subscribe({
      next: (rows) => (this.levels = rows),
      error: () => this.notify.toast('โหลดรายชื่อระดับไม่สำเร็จ', 'error'),
    });
  }

  editLevel(l: CivilServiceLevel): void {
    this.editingLevelId = l.id;
    this.levelForm.patchValue({ name: l.name, category: l.category || '' });
  }

  cancelEditLevel(): void {
    this.editingLevelId = null;
    this.levelForm.reset({ name: '', category: '' });
  }

  saveLevel(): void {
    if (this.levelForm.invalid) {
      this.levelForm.markAllAsTouched();
      return;
    }
    const v = this.levelForm.getRawValue();
    const body = { name: v.name!.trim(), category: (v.category || '').trim() || null };
    this.levelSaving = true;
    const obs: Observable<unknown> = this.editingLevelId
      ? this.orgStructureService.updateLevel(this.editingLevelId, body)
      : this.orgStructureService.createLevel(body);
    obs.subscribe({
      next: () => {
        this.levelSaving = false;
        this.notify.toast('บันทึกระดับเรียบร้อยแล้ว', 'success');
        this.cancelEditLevel();
        this.loadLevels();
      },
      error: (err: any) => {
        this.levelSaving = false;
        this.notify.toast(err.error?.error || 'บันทึกไม่สำเร็จ', 'error');
      },
    });
  }

  async deleteLevel(l: CivilServiceLevel): Promise<void> {
    const ok = await this.notify.confirm({
      title: 'ยืนยันการลบ',
      message: `ลบระดับ "${l.name}" นี้? พนักงานที่มีระดับนี้จะไม่ถูกลบ แต่จะไม่ผูกกับระดับใดอีก`,
      confirmText: 'ลบ',
      cancelText: 'ยกเลิก',
      danger: true,
    });
    if (!ok) return;
    this.orgStructureService.deleteLevel(l.id).subscribe({
      next: () => {
        if (this.editingLevelId === l.id) this.cancelEditLevel();
        this.notify.toast('ลบระดับเรียบร้อยแล้ว', 'success');
        this.loadLevels();
      },
      error: (err: any) => this.notify.toast(err.error?.error || 'ลบไม่สำเร็จ', 'error'),
    });
  }

  loadPositions(): void {
    this.orgStructureService.listPositions().subscribe({
      next: (rows) => (this.positions = rows),
      error: () => this.notify.toast('โหลดรายชื่อตำแหน่งไม่สำเร็จ', 'error'),
    });
  }

  editPosition(p: Position): void {
    this.editingPositionId = p.id;
    this.positionForm.patchValue({ name: p.name, category: p.category || '' });
  }

  cancelEditPosition(): void {
    this.editingPositionId = null;
    this.positionForm.reset({ name: '', category: '' });
  }

  savePosition(): void {
    if (this.positionForm.invalid) {
      this.positionForm.markAllAsTouched();
      return;
    }
    const v = this.positionForm.getRawValue();
    const body = { name: v.name!.trim(), category: (v.category || '').trim() || null };
    this.positionSaving = true;
    const obs: Observable<unknown> = this.editingPositionId
      ? this.orgStructureService.updatePosition(this.editingPositionId, body)
      : this.orgStructureService.createPosition(body);
    obs.subscribe({
      next: () => {
        this.positionSaving = false;
        this.notify.toast('บันทึกตำแหน่งเรียบร้อยแล้ว', 'success');
        this.cancelEditPosition();
        this.loadPositions();
      },
      error: (err: any) => {
        this.positionSaving = false;
        this.notify.toast(err.error?.error || 'บันทึกไม่สำเร็จ', 'error');
      },
    });
  }

  async deletePosition(p: Position): Promise<void> {
    const ok = await this.notify.confirm({
      title: 'ยืนยันการลบ',
      message: `ลบตำแหน่ง "${p.name}" นี้? พนักงานที่มีตำแหน่งนี้จะไม่ถูกลบ แต่จะไม่ผูกกับตำแหน่งใดอีก`,
      confirmText: 'ลบ',
      cancelText: 'ยกเลิก',
      danger: true,
    });
    if (!ok) return;
    this.orgStructureService.deletePosition(p.id).subscribe({
      next: () => {
        if (this.editingPositionId === p.id) this.cancelEditPosition();
        this.notify.toast('ลบตำแหน่งเรียบร้อยแล้ว', 'success');
        this.loadPositions();
      },
      error: (err: any) => this.notify.toast(err.error?.error || 'ลบไม่สำเร็จ', 'error'),
    });
  }

  loadDivisions(): void {
    this.orgStructureService.listDivisions().subscribe({
      next: (rows) => (this.divisions = rows),
      error: () => this.notify.toast('โหลดรายชื่อกลุ่มงานไม่สำเร็จ', 'error'),
    });
  }

  loadDepartments(): void {
    this.orgStructureService.listDepartments().subscribe({
      next: (rows) => (this.departments = rows),
      error: () => this.notify.toast('โหลดรายชื่อแผนกไม่สำเร็จ', 'error'),
    });
  }

  editDivision(d: Division): void {
    this.editingDivisionId = d.id;
    this.divisionForm.patchValue({ name: d.name, head_employee_id: d.head_employee_id });
  }

  cancelEditDivision(): void {
    this.editingDivisionId = null;
    this.divisionForm.reset({ name: '', head_employee_id: null });
  }

  saveDivision(): void {
    if (this.divisionForm.invalid) {
      this.divisionForm.markAllAsTouched();
      return;
    }
    const v = this.divisionForm.getRawValue();
    const body = { name: v.name!.trim(), head_employee_id: v.head_employee_id || null };
    this.divisionSaving = true;
    const obs: Observable<unknown> = this.editingDivisionId
      ? this.orgStructureService.updateDivision(this.editingDivisionId, body)
      : this.orgStructureService.createDivision(body);
    obs.subscribe({
      next: () => {
        this.divisionSaving = false;
        this.notify.toast('บันทึกกลุ่มงานเรียบร้อยแล้ว', 'success');
        this.cancelEditDivision();
        this.loadDivisions();
      },
      error: (err: any) => {
        this.divisionSaving = false;
        this.notify.toast(err.error?.error || 'บันทึกไม่สำเร็จ', 'error');
      },
    });
  }

  async deleteDivision(d: Division): Promise<void> {
    const ok = await this.notify.confirm({
      title: 'ยืนยันการลบ',
      message: `ลบกลุ่มงาน "${d.name}" นี้? แผนกที่อยู่ในกลุ่มงานนี้จะไม่ถูกลบ แต่จะไม่ผูกกับกลุ่มงานใดอีก`,
      confirmText: 'ลบ',
      cancelText: 'ยกเลิก',
      danger: true,
    });
    if (!ok) return;
    this.orgStructureService.deleteDivision(d.id).subscribe({
      next: () => {
        if (this.editingDivisionId === d.id) this.cancelEditDivision();
        this.notify.toast('ลบกลุ่มงานเรียบร้อยแล้ว', 'success');
        this.loadDivisions();
        this.loadDepartments();
      },
      error: (err: any) => this.notify.toast(err.error?.error || 'ลบไม่สำเร็จ', 'error'),
    });
  }

  editDepartment(d: Department): void {
    this.editingDepartmentId = d.id;
    this.departmentForm.patchValue({ name: d.name, division_id: d.division_id, head_employee_id: d.head_employee_id });
  }

  cancelEditDepartment(): void {
    this.editingDepartmentId = null;
    this.departmentForm.reset({ name: '', division_id: null, head_employee_id: null });
  }

  saveDepartment(): void {
    if (this.departmentForm.invalid) {
      this.departmentForm.markAllAsTouched();
      return;
    }
    const v = this.departmentForm.getRawValue();
    const body = { name: v.name!.trim(), division_id: v.division_id || null, head_employee_id: v.head_employee_id || null };
    this.departmentSaving = true;
    const obs: Observable<unknown> = this.editingDepartmentId
      ? this.orgStructureService.updateDepartment(this.editingDepartmentId, body)
      : this.orgStructureService.createDepartment(body);
    obs.subscribe({
      next: () => {
        this.departmentSaving = false;
        this.notify.toast('บันทึกแผนกเรียบร้อยแล้ว', 'success');
        this.cancelEditDepartment();
        this.loadDepartments();
      },
      error: (err: any) => {
        this.departmentSaving = false;
        this.notify.toast(err.error?.error || 'บันทึกไม่สำเร็จ', 'error');
      },
    });
  }

  async deleteDepartment(d: Department): Promise<void> {
    const ok = await this.notify.confirm({
      title: 'ยืนยันการลบ',
      message: `ลบแผนก "${d.name}" นี้? พนักงานในแผนกนี้จะไม่ถูกลบ แต่จะไม่ผูกกับแผนกใดอีก`,
      confirmText: 'ลบ',
      cancelText: 'ยกเลิก',
      danger: true,
    });
    if (!ok) return;
    this.orgStructureService.deleteDepartment(d.id).subscribe({
      next: () => {
        if (this.editingDepartmentId === d.id) this.cancelEditDepartment();
        this.notify.toast('ลบแผนกเรียบร้อยแล้ว', 'success');
        this.loadDepartments();
      },
      error: (err: any) => this.notify.toast(err.error?.error || 'ลบไม่สำเร็จ', 'error'),
    });
  }

  // ---- 3. Notifications ----

  onEmailUseGmailChange(): void {
    const emailGroup = this.notifForm.controls.email;
    if (emailGroup.controls.useGmail.value) {
      emailGroup.patchValue({ host: GMAIL_HOST, port: GMAIL_PORT, secure: true });
    }
  }

  private loadNotificationSettings(): void {
    this.notificationService.get().subscribe({
      next: (s) => {
        const useGmail = !s.email.host || s.email.host.trim().toLowerCase() === GMAIL_HOST;
        this.notifForm.patchValue({
          email: { ...s.email, useGmail },
          line: s.line,
          telegram: s.telegram,
          local: s.local,
          admin: s.admin,
          events: s.events,
        });
      },
      error: () => this.notify.toast('โหลดการตั้งค่าแจ้งเตือนไม่สำเร็จ', 'error'),
    });
  }

  private buildNotificationPayload(): NotificationSettings {
    const v = this.notifForm.getRawValue();
    return {
      email: {
        enabled: v.email.enabled!,
        host: (v.email.host || '').trim(),
        port: Number(v.email.port) || 587,
        secure: v.email.secure!,
        user: (v.email.user || '').trim(),
        pass: v.email.pass || '',
        from: (v.email.from || '').trim(),
      },
      line: {
        enabled: v.line.enabled!,
        channelAccessToken: (v.line.channelAccessToken || '').trim(),
      },
      telegram: {
        enabled: v.telegram.enabled!,
        botToken: (v.telegram.botToken || '').trim(),
      },
      local: {
        enabled: v.local.enabled!,
      },
      admin: {
        emails: (v.admin.emails || '').trim(),
        lineUserId: (v.admin.lineUserId || '').trim(),
        telegramChatId: (v.admin.telegramChatId || '').trim(),
      },
      events: {
        late: { employee: !!v.events.late.employee, admin: !!v.events.late.admin },
        absent: { employee: !!v.events.absent.employee, admin: !!v.events.absent.admin },
        success: { employee: !!v.events.success.employee, admin: !!v.events.success.admin },
      },
    };
  }

  saveNotificationSettings(): void {
    this.notifSaving = true;
    this.notificationService.save(this.buildNotificationPayload()).subscribe({
      next: () => {
        this.notifSaving = false;
        this.notify.toast('บันทึกการตั้งค่าแจ้งเตือนเรียบร้อยแล้ว', 'success');
      },
      error: (err) => {
        this.notifSaving = false;
        this.notify.toast(err.error?.error || 'บันทึกไม่สำเร็จ', 'error');
      },
    });
  }

  testChannel(channel: 'email' | 'line' | 'telegram' | 'local'): void {
    const target = channel === 'local' ? '' : this.testTargets[channel];
    if (channel !== 'local' && !target.trim()) {
      this.notify.toast('กรุณากรอกปลายทางสำหรับทดสอบ', 'warning');
      return;
    }
    this.testing[channel] = true;
    // Save current form state first so the test uses the credentials just typed in.
    this.notificationService.save(this.buildNotificationPayload()).subscribe({
      next: () => {
        this.notificationService.test(channel, target.trim()).subscribe({
          next: () => {
            this.testing[channel] = false;
            this.notify.toast('ส่งข้อความทดสอบเรียบร้อยแล้ว', 'success');
          },
          error: (err) => {
            this.testing[channel] = false;
            this.notify.toast(err.error?.error || 'ส่งข้อความทดสอบไม่สำเร็จ', 'error');
          },
        });
      },
      error: (err) => {
        this.testing[channel] = false;
        this.notify.toast(err.error?.error || 'บันทึกการตั้งค่าก่อนทดสอบไม่สำเร็จ', 'error');
      },
    });
  }

  trackByLocationId = (_: number, loc: ScanLocation) => loc.id;

  formatCoord(value: number): string {
    return Number(value).toFixed(6);
  }
}

export default SettingsComponent;
