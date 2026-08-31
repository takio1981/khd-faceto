import { AfterViewInit, Component, ElementRef, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ConfigService } from '../../core/services/config.service';
import { NotifyService } from '../../core/services/notify.service';
import { PinService } from '../../core/services/pin.service';
import { ScanLocationService } from '../../core/services/scan-location.service';
import { PinInputComponent } from '../../shared/components/pin-input/pin-input.component';
import { patchLeafletDefaultIcon } from '../../shared/utils/leaflet-icon-fix';
import { PinSetupDialogComponent } from './pin-setup-dialog/pin-setup-dialog.component';

type LoginMode = 'password' | 'pin';

declare const L: any;

const NAKHON_RATCHASIMA: [number, number] = [14.9799, 102.0978];

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatProgressSpinnerModule,
    PinInputComponent,
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent implements OnInit, AfterViewInit {
  @ViewChild('mapEl') mapEl?: ElementRef<HTMLDivElement>;
  @ViewChild(PinInputComponent) pinInputRef?: PinInputComponent;

  readonly appName = signal('ระบบลงเวลา KHD-FaceTo');
  readonly companyName = signal('สำนักงานสาธารณสุขจังหวัดนครราชสีมา');
  readonly loading = signal(false);
  readonly showPassword = signal(false);

  // PIN login mode: defaults to 'password' so nothing changes for existing
  // users, and the toggle itself only renders once pinLoginAvailable() is
  // confirmed true from /api/config.
  readonly mode = signal<LoginMode>('password');
  readonly pinLoginAvailable = signal(false);

  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private configService = inject(ConfigService);
  private scanLocationService = inject(ScanLocationService);
  private notify = inject(NotifyService);
  private pinService = inject(PinService);
  private dialog = inject(MatDialog);
  private router = inject(Router);

  readonly form = this.fb.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  readonly pinForm = this.fb.group({
    username: ['', Validators.required],
  });

  private map: any;

  constructor() {}

  ngOnInit(): void {
    this.configService.get().subscribe({
      next: (c) => {
        if (c.appName) this.appName.set(c.appName);
        if (c.companyName) this.companyName.set(c.companyName);
        this.pinLoginAvailable.set(!!c.pinLoginEnabled);
      },
      error: () => {},
    });
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  setMode(mode: LoginMode): void {
    this.mode.set(mode);
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { username, password } = this.form.getRawValue();
    this.loading.set(true);
    this.auth.login(username!, password!).subscribe({
      next: () => {
        this.loading.set(false);
        this.afterLoginSuccess();
      },
      error: (err) => {
        this.loading.set(false);
        this.notify.toast(err.error?.error || 'เข้าสู่ระบบไม่สำเร็จ', 'error');
      },
    });
  }

  // Rule: after a successful PASSWORD login, if PIN login is enabled and this
  // user has no PIN yet, offer a skippable "set up PIN?" prompt. Checked here
  // (once, right after the login the rule refers to) rather than via a
  // global guard/app-initializer, which would re-check on every navigation
  // for every session — including PIN-issued ones that already satisfy this.
  private afterLoginSuccess(): void {
    this.pinService.status().subscribe({
      next: (s) => {
        if (s.enabled && !s.configured) {
          this.dialog
            .open(PinSetupDialogComponent, { width: '420px' })
            .afterClosed()
            .subscribe(() => this.router.navigateByUrl('/dashboard'));
        } else {
          this.router.navigateByUrl('/dashboard');
        }
      },
      error: () => this.router.navigateByUrl('/dashboard'),
    });
  }

  onPinComplete(pin: string): void {
    if (this.pinForm.invalid) {
      this.pinForm.markAllAsTouched();
      this.pinInputRef?.reset();
      return;
    }
    const { username } = this.pinForm.getRawValue();
    this.loading.set(true);
    this.auth.loginWithPin(username!, pin).subscribe({
      next: () => {
        this.loading.set(false);
        this.router.navigateByUrl('/dashboard');
      },
      error: (err) => {
        this.loading.set(false);
        this.pinInputRef?.reset();
        this.notify.toast(err.error?.error || 'เข้าสู่ระบบด้วย PIN ไม่สำเร็จ', 'error');
        if (err.error?.code === 'DEVICE_NOT_REGISTERED') {
          this.mode.set('password');
        }
      },
    });
  }

  private initMap(): void {
    if (!this.mapEl || typeof L === 'undefined') return;
    patchLeafletDefaultIcon();

    this.map = L.map(this.mapEl.nativeElement).setView(NAKHON_RATCHASIMA, 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(this.map);

    setTimeout(() => this.map.invalidateSize(), 0);
    window.addEventListener('resize', () => this.map.invalidateSize());

    this.scanLocationService.list().subscribe({
      next: (locations) => {
        if (!Array.isArray(locations) || !locations.length) return;
        const bounds: [number, number][] = [];
        locations.forEach((loc) => {
          L.marker([loc.latitude, loc.longitude]).addTo(this.map).bindPopup(loc.name);
          bounds.push([loc.latitude, loc.longitude]);
        });
        this.map.invalidateSize();
        this.map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
      },
      error: () => {},
    });
  }
}

export default LoginComponent;
