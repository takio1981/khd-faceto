import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { provideNativeDateAdapter } from '@angular/material/core';
import { ChartConfiguration, ChartData, ChartOptions } from 'chart.js';
import { BaseChartDirective, provideCharts, withDefaultRegisterables } from 'ng2-charts';

import { DashboardService } from '../../core/services/dashboard.service';
import { EmployeeService } from '../../core/services/employee.service';
import { AuthService } from '../../core/services/auth.service';
import { DashboardSummary, Employee } from '../../core/models/models';
import { ResponsiveTableComponent, TableColumn } from '../../shared/components/responsive-table/responsive-table.component';

const STATUS_COLORS = {
  on_time: '#16a34a',
  late: '#f59e0b',
  absent: '#dc2626',
  ot: '#2563eb',
};

interface EmployeeHistoryRow {
  d: string;
  first_checkin: string | null;
  status: string;
}

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    BaseChartDirective,
    ResponsiveTableComponent,
  ],
  providers: [provideNativeDateAdapter(), provideCharts(withDefaultRegisterables())],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private readonly dashboardService = inject(DashboardService);
  private readonly employeeService = inject(EmployeeService);
  private readonly authService = inject(AuthService);

  readonly isAdmin = this.authService.isAdmin;

  selectedDate = new Date();
  selectedEmployeeId: number | null = null;
  employees = signal<Employee[]>([]);

  loading = signal(false);
  error = signal<string | null>(null);
  summary = signal<DashboardSummary | null>(null);

  readonly historyColumns: TableColumn[] = [
    { key: 'd', label: 'วันที่' },
    { key: 'first_checkin', label: 'เวลาเข้างาน' },
    { key: 'status', label: 'สถานะ' },
  ];

  readonly historyRows = computed<EmployeeHistoryRow[]>(() => {
    const s = this.summary();
    if (!s || !s.employeeHistory) return [];
    return s.employeeHistory.map((h) => ({
      d: h.d,
      first_checkin: h.first_checkin ?? '-',
      status: this.statusLabel(h.status),
    }));
  });

  readonly isDrilldown = computed(() => this.selectedEmployeeId !== null);

  // Doughnut chart: today's status distribution
  doughnutType: ChartConfiguration<'doughnut'>['type'] = 'doughnut';
  doughnutData = signal<ChartData<'doughnut', number[], string>>({
    labels: ['ตรงเวลา', 'สาย', 'ขาดงาน', 'OT'],
    datasets: [
      {
        data: [0, 0, 0, 0],
        backgroundColor: [
          STATUS_COLORS.on_time,
          STATUS_COLORS.late,
          STATUS_COLORS.absent,
          STATUS_COLORS.ot,
        ],
      },
    ],
  });
  doughnutOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom' },
    },
  };

  // Bar chart: 7-day weekly trend (on_time vs late)
  barType: ChartConfiguration<'bar'>['type'] = 'bar';
  barData = signal<ChartData<'bar', number[], string>>({
    labels: [],
    datasets: [
      { label: 'ตรงเวลา', data: [], backgroundColor: STATUS_COLORS.on_time },
      { label: 'สาย', data: [], backgroundColor: STATUS_COLORS.late },
    ],
  });
  barOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { stacked: false },
      y: { stacked: false, beginAtZero: true, ticks: { precision: 0 } },
    },
    plugins: {
      legend: { position: 'bottom' },
    },
  };

  ngOnInit(): void {
    if (this.isAdmin()) {
      this.employeeService.list().subscribe({
        next: (list) => this.employees.set(list),
        error: () => this.employees.set([]),
      });
    }
    this.loadSummary();
  }

  onFilterApply(): void {
    this.loadSummary();
  }

  onEmployeeChange(): void {
    this.loadSummary();
  }

  private loadSummary(): void {
    this.loading.set(true);
    this.error.set(null);
    const dateStr = toDateInputValue(this.selectedDate);
    const employeeId = this.selectedEmployeeId ?? undefined;

    this.dashboardService.getSummary(dateStr, employeeId).subscribe({
      next: (data) => {
        this.summary.set(data);
        this.updateCharts(data);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('ไม่สามารถโหลดข้อมูลแดชบอร์ดได้');
        this.loading.set(false);
      },
    });
  }

  private updateCharts(data: DashboardSummary): void {
    const counts = data.counts ?? { on_time: 0, late: 0, absent: 0, ot: 0 };
    this.doughnutData.set({
      labels: ['ตรงเวลา', 'สาย', 'ขาดงาน', 'OT'],
      datasets: [
        {
          data: [counts.on_time ?? 0, counts.late ?? 0, counts.absent ?? 0, counts.ot ?? 0],
          backgroundColor: [
            STATUS_COLORS.on_time,
            STATUS_COLORS.late,
            STATUS_COLORS.absent,
            STATUS_COLORS.ot,
          ],
        },
      ],
    });

    const weekly = data.weekly ?? [];
    this.barData.set({
      labels: weekly.map((w) => w.d),
      datasets: [
        { label: 'ตรงเวลา', data: weekly.map((w) => w.on_time ?? 0), backgroundColor: STATUS_COLORS.on_time },
        { label: 'สาย', data: weekly.map((w) => w.late ?? 0), backgroundColor: STATUS_COLORS.late },
      ],
    });
  }

  statusLabel(status: string): string {
    switch (status) {
      case 'on_time':
        return 'ตรงเวลา';
      case 'late':
        return 'สาย';
      case 'absent':
        return 'ขาดงาน';
      case 'ot':
        return 'OT';
      default:
        return status;
    }
  }
}
