import { AfterViewInit, Component, ElementRef, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ConfigService } from '../../core/services/config.service';
import { NotifyService } from '../../core/services/notify.service';
import { ScanLocationService } from '../../core/services/scan-location.service';
import { patchLeafletDefaultIcon } from '../../shared/utils/leaflet-icon-fix';

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
    MatInputModule,
    MatButtonModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent implements OnInit, AfterViewInit {
  @ViewChild('mapEl') mapEl?: ElementRef<HTMLDivElement>;

  readonly appName = signal('ระบบลงเวลา KHD-FaceTo');
  readonly companyName = signal('สำนักงานสาธารณสุขจังหวัดนครราชสีมา');
  readonly loading = signal(false);

  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private configService = inject(ConfigService);
  private scanLocationService = inject(ScanLocationService);
  private notify = inject(NotifyService);
  private router = inject(Router);

  readonly form = this.fb.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  private map: any;

  constructor() {}

  ngOnInit(): void {
    this.configService.get().subscribe({
      next: (c) => {
        if (c.appName) this.appName.set(c.appName);
        if (c.companyName) this.companyName.set(c.companyName);
      },
      error: () => {},
    });
  }

  ngAfterViewInit(): void {
    this.initMap();
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
        this.router.navigateByUrl('/dashboard');
      },
      error: (err) => {
        this.loading.set(false);
        this.notify.toast(err.error?.error || 'เข้าสู่ระบบไม่สำเร็จ', 'error');
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
