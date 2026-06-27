import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { EmployeeService } from '../../core/services/employee.service';
import { NotifyService } from '../../core/services/notify.service';
import { ReportRow } from '../../core/models/models';
import { ReportService, ReportType } from '../../core/services/report.service';
import { TableColumn, ResponsiveTableComponent } from '../../shared/components/responsive-table/responsive-table.component';

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const SCANTYPE_TH: Record<string, string> = {
  check_in: 'เข้างาน',
  check_out: 'ออกงาน',
  ot_in: 'OT-เข้า',
  ot_out: 'OT-ออก',
};

const STATUS_TH: Record<string, string> = {
  on_time: 'ตรงเวลา',
  late: 'สาย',
  absent: 'ขาด',
  ot: 'OT',
};

// Keys we don't want to surface as standalone table columns (already shown elsewhere,
// or purely internal identifiers not meant for display).
const HIDDEN_KEYS = new Set(['id', 'employee_id', 'scan_location_id', 'face_image_path']);

const LABELS_TH: Record<string, string> = {
  employee_code: 'รหัส',
  full_name: 'ชื่อ-นามสกุล',
  department: 'แผนก',
  employee_type: 'ประเภทบุคลากร',
  scan_time: 'วันที่/เวลา',
  scan_type: 'ประเภท',
  status: 'สถานะ',
  scan_location_name: 'จุดสแกน',
};

const EMPLOYEE_TYPE_TH: Record<string, string> = {
  civil_servant: 'ข้าราชการ',
  government_employee: 'พนักงานราชการ',
  temp_employee: 'ลูกจ้าง',
};

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDatepickerModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ResponsiveTableComponent,
  ],
  providers: [provideNativeDateAdapter()],
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.scss',
})
export class ReportsComponent implements OnInit {
  readonly months = THAI_MONTHS.map((label, i) => ({ value: i + 1, label }));
  readonly years: number[];

  readonly reportType = signal<ReportType>('daily');
  readonly date = signal<Date>(new Date());
  readonly year = signal<number>(new Date().getFullYear());
  readonly month = signal<number>(new Date().getMonth() + 1);

  readonly department = signal<string>('');
  readonly employeeType = signal<string>('');
  readonly employeeTypeOptions = Object.entries(EMPLOYEE_TYPE_TH).map(([value, label]) => ({ value, label }));
  readonly scanType = signal<string>('');
  readonly status = signal<string>('');
  readonly search = signal<string>('');

  readonly departments = signal<string[]>([]);
  readonly title = signal<string>('ตัวอย่างรายงาน');
  readonly rows = signal<ReportRow[]>([]);
  readonly columns = signal<TableColumn[]>([]);
  readonly loading = signal(false);
  readonly exporting = signal<'xlsx' | 'pdf' | null>(null);

  constructor(
    private reportService: ReportService,
    private employeeService: EmployeeService,
    private notify: NotifyService,
  ) {
    const currentYear = new Date().getFullYear();
    this.years = Array.from({ length: 10 }, (_, i) => currentYear - 5 + i);
  }

  ngOnInit(): void {
    this.loadDepartments();
    this.preview();
  }

  setReportType(type: ReportType): void {
    this.reportType.set(type);
  }

  private loadDepartments(): void {
    this.employeeService.list().subscribe({
      next: (employees) => {
        const depts = [...new Set(employees.map((e) => e.department).filter((d): d is string => !!d))].sort();
        this.departments.set(depts);
      },
      error: () => {},
    });
  }

  private buildParams(): Record<string, string | number | undefined> {
    const type = this.reportType();
    const params: Record<string, string | number | undefined> = {};
    if (type === 'daily') {
      params['date'] = this.formatDate(this.date());
    } else if (type === 'monthly') {
      params['year'] = this.year();
      params['month'] = this.month();
    } else {
      params['year'] = this.year();
    }
    if (this.department()) params['department'] = this.department();
    if (this.employeeType()) params['employeeType'] = this.employeeType();
    if (this.scanType()) params['scanType'] = this.scanType();
    if (this.status()) params['status'] = this.status();
    if (this.search().trim()) params['search'] = this.search().trim();
    return params;
  }

  private formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  preview(): void {
    this.loading.set(true);
    this.reportService.get(this.reportType(), this.buildParams()).subscribe({
      next: (res) => {
        this.title.set(res.title);
        this.rows.set(res.rows || []);
        this.columns.set(this.buildColumns(res.rows || []));
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.notify.toast(err.error?.error || 'ไม่สามารถโหลดรายงานได้', 'error');
      },
    });
  }

  private buildColumns(rows: ReportRow[]): TableColumn[] {
    if (!rows.length) return [];
    return Object.keys(rows[0])
      .filter((key) => !HIDDEN_KEYS.has(key))
      .map((key) => ({ key, label: LABELS_TH[key] || key }));
  }

  displayValue(row: ReportRow, key: string): string {
    const value = row[key];
    if (value === null || value === undefined || value === '') return '-';
    if (key === 'scan_time') return this.formatDateTime(value);
    if (key === 'scan_type') return SCANTYPE_TH[value] || value;
    if (key === 'status') return STATUS_TH[value] || value;
    if (key === 'employee_type') return EMPLOYEE_TYPE_TH[value] || value;
    return String(value);
  }

  statusClass(row: ReportRow, key: string): string {
    return key === 'status' ? `badge ${row[key]}` : '';
  }

  private formatDateTime(value: string): string {
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
  }

  exportFile(format: 'xlsx' | 'pdf'): void {
    this.exporting.set(format);
    const type = this.reportType();
    this.reportService.export(type, format, this.buildParams()).subscribe({
      next: (blob) => {
        this.exporting.set(null);
        const ext = format === 'pdf' ? 'pdf' : 'xlsx';
        const filename = `report-${type}.${ext}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        this.notify.toast('ดาวน์โหลดรายงานแล้ว', 'success');
      },
      error: (err) => {
        this.exporting.set(null);
        this.notify.toast(err.error?.error || 'ส่งออกรายงานไม่สำเร็จ', 'error');
      },
    });
  }
}

export default ReportsComponent;
