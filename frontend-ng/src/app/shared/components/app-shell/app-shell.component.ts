import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { ConfigService } from '../../../core/services/config.service';
import { NotificationService } from '../../../core/services/notification.service';
import { NotifyService } from '../../../core/services/notify.service';

interface NavLink {
  path: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
}

const NAV_LINKS: NavLink[] = [
  { path: '/dashboard', label: 'แดชบอร์ด', icon: 'dashboard' },
  { path: '/checkin', label: 'ลงเวลา (สแกน)', icon: 'face', adminOnly: true },
  { path: '/attendance', label: 'ประวัติการลงเวลา', icon: 'history' },
  { path: '/reports', label: 'รายงาน', icon: 'summarize' },
  { path: '/correction-requests', label: 'คำขอแก้ไข/อุทธรณ์เวลา', icon: 'gavel' },
  { path: '/notifications', label: 'ประวัติการแจ้งเตือน', icon: 'notifications' },
  { path: '/employees', label: 'พนักงาน', icon: 'badge', adminOnly: true },
  { path: '/users', label: 'จัดการผู้ใช้งาน', icon: 'manage_accounts', adminOnly: true },
  { path: '/shifts', label: 'กะการทำงาน', icon: 'schedule', adminOnly: true },
  { path: '/settings', label: 'ตั้งค่า', icon: 'settings', adminOnly: true },
];

const NOTIFY_LAST_ID_KEY = 'khd_notify_last_id';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive,
    MatSidenavModule, MatToolbarModule, MatListModule, MatIconModule, MatButtonModule,
  ],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss',
})
export class AppShellComponent implements OnInit, OnDestroy {
  readonly isHandset = signal(false);
  readonly appName = signal('ระบบลงเวลา KHD-FaceTo');
  readonly companyName = signal('สำนักงานสาธารณสุขจังหวัดนครราชสีมา');

  private breakpointSub?: Subscription;
  private pollTimer?: ReturnType<typeof setInterval>;

  links: NavLink[] = [];

  constructor(
    private breakpointObserver: BreakpointObserver,
    public auth: AuthService,
    private configService: ConfigService,
    private notificationService: NotificationService,
    private notify: NotifyService,
  ) {}

  ngOnInit(): void {
    this.links = NAV_LINKS.filter((l) => !l.adminOnly || this.auth.isAdmin());

    this.breakpointSub = this.breakpointObserver
      .observe([Breakpoints.Handset, Breakpoints.Tablet])
      .subscribe((result) => this.isHandset.set(result.matches));

    this.configService.get().subscribe({
      next: (c) => {
        if (c.appName) this.appName.set(c.appName);
        if (c.companyName) this.companyName.set(c.companyName);
      },
      error: () => {},
    });

    if (this.auth.isAdmin()) {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
      this.pollNotifications();
      this.pollTimer = setInterval(() => this.pollNotifications(), 15000);
    }
  }

  ngOnDestroy(): void {
    this.breakpointSub?.unsubscribe();
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  logout(): void {
    this.auth.logout();
  }

  private pollNotifications(): void {
    const lastId = Number(localStorage.getItem(NOTIFY_LAST_ID_KEY)) || 0;
    this.notificationService.recent(lastId).subscribe({
      next: (rows) => {
        if (!rows.length) return;
        rows.forEach((row) => {
          this.notify.toast(`${row.title}: ${row.body}`, 'info');
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification(row.title, { body: row.body });
          }
        });
        localStorage.setItem(NOTIFY_LAST_ID_KEY, String(rows[rows.length - 1].id));
      },
      error: () => {},
    });
  }
}
