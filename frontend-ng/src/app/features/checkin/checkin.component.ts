import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import {
  FaceDetectionResult,
  FacePipelineService,
  QualityKey,
} from '../../core/services/face-pipeline.service';
import { AttendanceService } from '../../core/services/attendance.service';
import { AuthService } from '../../core/services/auth.service';
import { ScanLocationService } from '../../core/services/scan-location.service';
import { NotifyService } from '../../core/services/notify.service';
import { ScanLocation, ScanResult, ScanType } from '../../core/models/models';

declare const faceapi: any;

const SCANTYPE_TH: Record<string, string> = {
  check_in: 'เข้างาน',
  check_out: 'ออกงาน',
  ot_in: 'OT-เข้า',
  ot_out: 'OT-ออก',
  ot: 'OT',
};
const STATUS_TH: Record<string, string> = {
  on_time: 'ตรงเวลา',
  late: 'สาย',
  absent: 'ขาด',
  ot: 'OT',
};

interface DetWithResult {
  det: FaceDetectionResult;
  r: (ScanResult & { ignored?: boolean; pendingConfirm?: boolean }) | null;
  imageBase64?: string;
}

interface FeedItem {
  imageBase64?: string;
  name: string;
  scanType?: ScanType;
  status?: string;
  time: string; // ISO
}

interface PendingMatch {
  count: number;
  scanType: string;
  lastTime: number;
}

const LOCATION_STORAGE_KEY = 'khd_checkin_location_id';
const FEED_DATE_KEY = 'khd_checkin_feed_date';
const FEED_ITEMS_KEY = 'khd_checkin_feed_items';
const CONFIRM_COUNT = 2;
const PENDING_TIMEOUT_MS = 3000;
const TOAST_GAP_MS = 60 * 1000;
const DETECTION_INTERVAL_MS = 400;
const COUNTDOWN_SECONDS = 5;

@Component({
  selector: 'app-checkin',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSelectModule,
  ],
  templateUrl: './checkin.component.html',
  styleUrl: './checkin.component.scss',
})
export class CheckinComponent implements AfterViewInit, OnDestroy {
  @ViewChild('video') videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('overlay') overlayRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('camWrap') camWrapRef!: ElementRef<HTMLDivElement>;

  // ===== State =====
  modelsLoading = true;
  modelsLoaded = false;
  loadError = '';

  running = false;
  busy = false;
  starting = false;

  cameras: MediaDeviceInfo[] = [];
  locations: ScanLocation[] = [];
  selectedCameraId = '';
  selectedLocationId = '';
  selectedQuality: QualityKey = 'high';
  qualityOptions: { key: QualityKey; label: string }[] = [];

  // Front/back toggle — mainly for phones/tablets, which have both. Hidden
  // on devices that clearly don't (no touch support = almost certainly a
  // desktop/laptop webcam with only one camera).
  facingMode: 'user' | 'environment' = 'user';
  readonly isTouchDevice = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;

  flipH = false;
  flipV = false;

  isFullscreen = false;

  statusText = 'กดปุ่ม "เริ่มสแกน" เพื่อเริ่มต้น';
  statusType: '' | 'scanning' | 'success' | 'warn' | 'error' = '';

  resultText = '';
  resultType: 'success' | 'error' | 'warn' = 'success';
  showResultBanner = false;

  countdownActive = false;
  countdownValue = 0;

  showDeviceSettings = false;
  showGuide = false;

  feedItems: FeedItem[] = [];

  clockTime = '';
  clockDate = '';

  readonly statusTh = STATUS_TH;
  readonly scanTypeTh = SCANTYPE_TH;

  private stream: MediaStream | null = null;
  private detectionTimer: ReturnType<typeof setTimeout> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private feedResetTimer: ReturnType<typeof setInterval> | null = null;
  private countdownToken = 0;
  private destroyed = false;

  private readonly toasted: Record<number, number> = {};
  private readonly pendingMatch: Record<number, PendingMatch> = {};

  readonly homeLink: string;

  constructor(
    private facePipeline: FacePipelineService,
    private attendanceService: AttendanceService,
    private scanLocationService: ScanLocationService,
    private notify: NotifyService,
    private auth: AuthService,
  ) {
    // Checkin is reachable both as a logged-out kiosk page and via the
    // navbar (admin checking it from the dashboard) - send each back to
    // wherever makes sense for them.
    this.homeLink = this.auth.isLoggedIn() ? '/dashboard' : '/login';
    this.qualityOptions = Object.entries(this.facePipeline.QUALITY_PRESETS).map(([key, preset]) => ({
      key: key as QualityKey,
      label: preset.label,
    }));
    this.selectedQuality = this.facePipeline.getQualityKey();
    this.facingMode = this.facePipeline.getPreferredFacingMode();
    this.flipH = localStorage.getItem('camFlipH') === '1';
    this.flipV = localStorage.getItem('camFlipV') === '1';
    this.selectedLocationId = localStorage.getItem(LOCATION_STORAGE_KEY) || '';
  }

  async ngAfterViewInit(): Promise<void> {
    this.tickClock();
    this.clockTimer = setInterval(() => this.tickClock(), 1000);

    this.resetFeedIfNewDay();
    this.restoreFeedItems();
    this.feedResetTimer = setInterval(() => this.resetFeedIfNewDay(), 60 * 1000);

    await this.loadLocations();
    await this.loadCameras();
    await this.start();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.running = false;
    this.countdownToken++;
    if (this.detectionTimer) clearTimeout(this.detectionTimer);
    if (this.clockTimer) clearInterval(this.clockTimer);
    if (this.feedResetTimer) clearInterval(this.feedResetTimer);
    this.facePipeline.stopCamera(this.stream);
  }

  @HostListener('window:beforeunload')
  onBeforeUnload(): void {
    this.facePipeline.stopCamera(this.stream);
  }

  @HostListener('document:fullscreenchange')
  async onFullscreenChange(): Promise<void> {
    this.isFullscreen = !!document.fullscreenElement;
    if (this.isFullscreen && this.running) {
      this.facePipeline.stopCamera(this.stream);
      this.stream = await this.facePipeline.startCamera(this.videoRef.nativeElement, this.selectedCameraId, this.facingMode);
    }
  }

  // ===== Clock =====
  private tickClock(): void {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    this.clockTime = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    this.clockDate = d.toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  // ===== Locations =====
  private async loadLocations(): Promise<void> {
    try {
      this.locations = await firstValueFrom(this.scanLocationService.list());
      const saved = localStorage.getItem(LOCATION_STORAGE_KEY) || '';
      if (saved && this.locations.some((loc) => String(loc.id) === saved)) {
        this.selectedLocationId = saved;
      }
    } catch {
      // public endpoint failure shouldn't block the kiosk from scanning
    }
  }

  onLocationChange(newId: string): void {
    this.selectedLocationId = newId;
    localStorage.setItem(LOCATION_STORAGE_KEY, newId);
  }

  private getScanLocationId(): number | null {
    return this.selectedLocationId ? Number(this.selectedLocationId) : null;
  }

  // ===== Cameras =====
  private async loadCameras(): Promise<void> {
    try {
      this.cameras = await this.facePipeline.listCameras();
      const preferred = this.facePipeline.getPreferredCamera();
      if (preferred && this.cameras.some((c) => c.deviceId === preferred)) {
        this.selectedCameraId = preferred;
      } else if (!this.selectedCameraId && this.cameras.length && !this.isTouchDevice) {
        // On touch devices (phone/tablet), leave no deviceId selected so the
        // facingMode constraint (front/back toggle) governs which camera
        // opens — auto-picking "camera 0" here would silently override it.
        this.selectedCameraId = this.cameras[0].deviceId;
      }
    } catch (e) {
      console.error(e);
    }
  }

  async onCameraChange(newId: string): Promise<void> {
    this.selectedCameraId = newId;
    this.facePipeline.setPreferredCamera(newId);
    if (this.running) {
      this.facePipeline.stopCamera(this.stream);
      this.stream = await this.facePipeline.startCamera(this.videoRef.nativeElement, newId, this.facingMode);
    }
  }

  async refreshCameras(): Promise<void> {
    await this.loadCameras();
    if (this.running) {
      this.facePipeline.stopCamera(this.stream);
      this.stream = await this.facePipeline.startCamera(this.videoRef.nativeElement, this.selectedCameraId, this.facingMode);
    }
  }

  // ===== Front/back camera toggle (phones/tablets) =====
  async toggleFacingMode(): Promise<void> {
    this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
    this.facePipeline.setPreferredFacingMode(this.facingMode);
    // Clear any explicit device pick so the new facingMode actually takes
    // effect — an exact deviceId constraint would otherwise override it.
    this.selectedCameraId = '';
    this.facePipeline.setPreferredCamera('');
    if (this.running) {
      this.facePipeline.stopCamera(this.stream);
      this.stream = await this.facePipeline.startCamera(this.videoRef.nativeElement, this.selectedCameraId, this.facingMode);
      await this.loadCameras();
    }
  }

  // ===== Quality =====
  async onQualityChange(newKey: QualityKey): Promise<void> {
    this.selectedQuality = newKey;
    this.facePipeline.setQualityKey(newKey);
    if (this.running) {
      this.facePipeline.stopCamera(this.stream);
      this.stream = await this.facePipeline.startCamera(this.videoRef.nativeElement, this.selectedCameraId, this.facingMode);
    }
  }

  // ===== Flip =====
  toggleFlipH(): void {
    this.flipH = !this.flipH;
    localStorage.setItem('camFlipH', this.flipH ? '1' : '0');
  }

  toggleFlipV(): void {
    this.flipV = !this.flipV;
    localStorage.setItem('camFlipV', this.flipV ? '1' : '0');
  }

  // ===== Collapsible panels =====
  toggleDeviceSettings(): void {
    this.showDeviceSettings = !this.showDeviceSettings;
  }

  toggleGuide(): void {
    this.showGuide = !this.showGuide;
  }

  // ===== Fullscreen =====
  toggleFullscreen(): void {
    const el = this.camWrapRef?.nativeElement;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  }

  // ===== Status / result helpers =====
  private setStatus(text: string, type: typeof this.statusType): void {
    this.statusText = text;
    this.statusType = type;
  }

  private showResult(text: string, type: 'success' | 'error' | 'warn'): void {
    this.resultText = text;
    this.resultType = type;
    this.showResultBanner = true;
  }

  // ===== Drawing =====
  private drawAll(results: DetWithResult[]): void {
    const video = this.videoRef.nativeElement;
    const overlay = this.overlayRef.nativeElement;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    overlay.width = video.videoWidth || 640;
    overlay.height = video.videoHeight || 480;
    const sx = overlay.width / (video.videoWidth || 640);
    const sy = overlay.height / (video.videoHeight || 480);
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const flipH = this.flipH;
    const flipV = this.flipV;

    for (const { det, r } of results) {
      const b = det.box;
      const color = this.colorFor(r);
      const label = this.labelFor(r);

      const rawX = b.x * sx;
      const rawY = b.y * sy;
      const w = b.width * sx;
      const h = b.height * sy;
      const x = flipH ? overlay.width - rawX - w : rawX;
      const y = flipV ? overlay.height - rawY - h : rawY;

      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.strokeRect(x, y, w, h);

      ctx.font = 'bold 17px Tahoma';
      const tw = ctx.measureText(label).width;
      const labelY = flipV ? y + h + 4 : y - 26;
      ctx.fillStyle = color;
      ctx.fillRect(x, labelY, Math.max(w, tw + 16), 26);
      ctx.fillStyle = '#06281b';
      ctx.fillText(label, x + 8, labelY + 18);

      if (det.landmarks) {
        ctx.save();
        if (flipH) {
          ctx.translate(overlay.width, 0);
          ctx.scale(-1, 1);
        }
        if (flipV) {
          ctx.translate(0, overlay.height);
          ctx.scale(1, -1);
        }
        this.facePipeline.drawLandmarks(ctx, det.landmarks, color, sx, sy);
        ctx.restore();
      }
    }
  }

  private colorFor(r: DetWithResult['r']): string {
    if (!r) return '#38bdf8';
    if (!r.matched) return '#f87171';
    if (r.ignored) return '#fbbf24';
    if (r.scan_type) return '#4ade80';
    return '#fbbf24';
  }

  private labelFor(r: DetWithResult['r']): string {
    if (!r) return 'กำลังตรวจสอบ...';
    if (!r.matched || !r.employee) return 'ไม่รู้จัก';
    const name = r.employee.full_name;
    if (r.scan_type) return `${name} • ${SCANTYPE_TH[r.scan_type] || r.scan_type}`;
    return name;
  }

  // ===== Feed (live scan list) =====
  private todayKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  private loadFeedItemsFromStorage(): FeedItem[] {
    try {
      return JSON.parse(localStorage.getItem(FEED_ITEMS_KEY) || '[]') || [];
    } catch {
      return [];
    }
  }

  private saveFeedItemsToStorage(items: FeedItem[]): void {
    try {
      localStorage.setItem(FEED_ITEMS_KEY, JSON.stringify(items));
    } catch {
      // storage full — keep in-memory list, just stop persisting
    }
  }

  private addFeedEntry(data: FeedItem): void {
    this.feedItems.unshift(data);
    const items = this.loadFeedItemsFromStorage();
    items.unshift(data);
    this.saveFeedItemsToStorage(items);
  }

  private restoreFeedItems(): void {
    this.feedItems = this.loadFeedItemsFromStorage();
  }

  private resetFeedIfNewDay(): void {
    const today = this.todayKey();
    if (localStorage.getItem(FEED_DATE_KEY) !== today) {
      this.feedItems = [];
      localStorage.setItem(FEED_DATE_KEY, today);
      localStorage.removeItem(FEED_ITEMS_KEY);
    }
  }

  feedTime(iso: string): string {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  // ===== Detection loop =====
  private loop(): void {
    if (!this.running) return;
    if (!this.busy) {
      this.busy = true;
      this.facePipeline
        .getAllDescriptors(this.videoRef.nativeElement)
        .then((dets) => this.handleDetections(dets))
        .catch((e) => console.error(e))
        .finally(() => {
          this.busy = false;
        });
    }
    this.detectionTimer = setTimeout(() => this.loop(), DETECTION_INTERVAL_MS);
  }

  private async handleDetections(dets: FaceDetectionResult[]): Promise<void> {
    if (!this.running) return;
    if (!dets.length) {
      this.drawAll([]);
      this.setStatus('กำลังค้นหาใบหน้า... กรุณาหันหน้าเข้ากล้อง', 'scanning');
      return;
    }

    const now = Date.now();

    // Step 1: cheap preview (descriptor only) for every detected face.
    const previews: { det: FaceDetectionResult; r: ScanResult | null }[] = await Promise.all(
      dets.map(async (det) => {
        try {
          const r = await firstValueFrom(this.attendanceService.preview(det.descriptor));
          return { det, r };
        } catch {
          return { det, r: null };
        }
      }),
    );

    // Step 2: confirm + save only after CONFIRM_COUNT consecutive matching frames.
    const results: DetWithResult[] = await Promise.all(
      previews.map(async ({ det, r }) => {
        if (!r || !r.matched || (r as any).ignored || !r.scan_type || !r.employee) {
          return { det, r };
        }

        const key = r.employee.id;
        const pending = this.pendingMatch[key];
        if (pending && pending.scanType === r.scan_type && now - pending.lastTime <= PENDING_TIMEOUT_MS) {
          pending.count += 1;
          pending.lastTime = now;
        } else {
          this.pendingMatch[key] = { count: 1, scanType: r.scan_type, lastTime: now };
        }

        if (this.pendingMatch[key].count < CONFIRM_COUNT) {
          return { det, r: { ...r, scan_type: undefined, pendingConfirm: true } };
        }

        // Confirmed: capture image now and commit the real scan.
        delete this.pendingMatch[key];
        const imageBase64 = this.facePipeline.captureFaceJpeg(this.videoRef.nativeElement, det.box, 0.8);
        try {
          const saved = await firstValueFrom(
            this.attendanceService.scan(det.descriptor, imageBase64, this.getScanLocationId()),
          );
          return { det, r: saved, imageBase64 };
        } catch {
          return { det, r };
        }
      }),
    );

    if (!this.running) return;
    this.drawAll(results);

    let recorded = 0;
    let known = 0;
    let unknown = 0;
    let confirming = 0;
    const names: string[] = [];

    for (const { r, imageBase64 } of results) {
      if (!r) continue;
      if (!r.matched || !r.employee) {
        unknown++;
        continue;
      }
      known++;
      if ((r as any).pendingConfirm) {
        confirming++;
        continue;
      }
      if (r.scan_type) {
        recorded++;
        names.push(`${r.employee.full_name} (${SCANTYPE_TH[r.scan_type] || r.scan_type})`);
        this.addFeedEntry({
          imageBase64,
          name: r.employee.full_name,
          scanType: r.scan_type,
          status: r.status,
          time: new Date().toISOString(),
        });
        if (!this.toasted[r.employee.id] || now - this.toasted[r.employee.id] > TOAST_GAP_MS) {
          this.toasted[r.employee.id] = now;
          this.notify.toast(
            `${r.employee.full_name} • ${SCANTYPE_TH[r.scan_type] || r.scan_type} • ${
              STATUS_TH[r.status || ''] || r.status
            }`,
            'success',
          );
        }
      }
    }

    if (recorded > 0) {
      this.setStatus(`✓ บันทึก ${recorded} คน: ${names.join(', ')}`, 'success');
      this.showResult(`✓ บันทึกสำเร็จ ${recorded} คน — ${names.join(', ')}`, 'success');
    } else if (confirming > 0) {
      this.setStatus(`กำลังยืนยันใบหน้า ${confirming} คน...`, 'scanning');
    } else if (unknown > 0 && known === 0) {
      this.setStatus(`❌ พบ ${unknown} ใบหน้า — ไม่พบข้อมูลในระบบ`, 'error');
    } else if (known > 0) {
      this.setStatus(`พบ ${dets.length} คน — บันทึกไปแล้ว/รออยู่ในช่วงคูลดาวน์`, 'warn');
    }
  }

  // ===== Countdown =====
  private async runCountdown(seconds: number, token: number): Promise<boolean> {
    this.countdownActive = true;
    for (let i = seconds; i >= 1; i--) {
      if (token !== this.countdownToken) return false;
      this.countdownValue = i;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    this.countdownActive = false;
    return token === this.countdownToken;
  }

  // ===== Start / stop =====
  private async ensureFaceApiLoaded(): Promise<void> {
    if (typeof faceapi !== 'undefined') return;
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector('script[data-face-api]');
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('โหลด face-api.js ไม่สำเร็จ')));
        return;
      }
      const script = document.createElement('script');
      script.src = '/lib/face-api.min.js';
      script.setAttribute('data-face-api', '1');
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('โหลด face-api.js ไม่สำเร็จ'));
      document.head.appendChild(script);
    });
  }

  async start(): Promise<void> {
    if (this.starting || this.running) return;
    this.starting = true;
    this.setStatus('กำลังโหลดโมเดล AI...', 'scanning');
    try {
      await this.ensureFaceApiLoaded();
      await this.facePipeline.loadModels();
      this.modelsLoaded = true;
      this.modelsLoading = false;

      this.setStatus('กำลังเปิดกล้อง...', 'scanning');
      this.stream = await this.facePipeline.startCamera(this.videoRef.nativeElement, this.selectedCameraId, this.facingMode);
      await this.loadCameras(); // labels become available after permission is granted

      this.setStatus('เตรียมตัว... กำลังจะเริ่มสแกน', 'scanning');

      const token = ++this.countdownToken;
      const completed = await this.runCountdown(COUNTDOWN_SECONDS, token);
      if (!completed || this.destroyed) {
        this.starting = false;
        return;
      }

      this.running = true;
      this.starting = false;
      this.setStatus('พร้อมสแกน — รองรับหลายคนพร้อมกัน', 'scanning');
      this.loop();
    } catch (e: any) {
      this.modelsLoading = false;
      this.loadError = e?.message || String(e);
      this.setStatus('เกิดข้อผิดพลาด: ' + this.loadError, 'error');
      this.notify.toast('ผิดพลาด: ' + this.loadError, 'error');
      this.starting = false;
    }
  }

  stop(): void {
    this.running = false;
    this.starting = false;
    this.countdownToken++; // cancel any in-progress countdown
    this.countdownActive = false;
    this.facePipeline.stopCamera(this.stream);
    this.drawAll([]); // clear overlay immediately
    this.setStatus('หยุดสแกนแล้ว — กดเริ่มสแกนเพื่อเริ่มใหม่', '');
  }
}
