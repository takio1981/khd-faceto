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
import { MatSliderModule } from '@angular/material/slider';
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
import { RecentScanItem, ScanLocation, ScanResult } from '../../core/models/models';

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

interface PendingMatch {
  count: number;
  scanType: string;
  lastTime: number;
}

const LOCATION_STORAGE_KEY = 'khd_checkin_location_id';
const FEED_POLL_MS = 8000;
const FEED_LIMIT = 20;
const CONFIRM_COUNT = 2;
const PENDING_TIMEOUT_MS = 3000;
const TOAST_GAP_MS = 60 * 1000;
const DEFAULT_DETECTION_INTERVAL_MS = 150;
const MIN_DETECTION_INTERVAL_MS = 80;
const MAX_DETECTION_INTERVAL_MS = 600;
// Exponential smoothing factor applied to drawn face boxes/landmarks each
// frame (0 = frozen/no movement, 1 = no smoothing/instant snap to the raw
// detection — jitters more but tracks with zero lag).
const DEFAULT_BOX_SMOOTHING = 0.45;
const MIN_BOX_SMOOTHING = 0.1;
const MAX_BOX_SMOOTHING = 0.9;
const COUNTDOWN_SECONDS = 5;
const DETECTION_INTERVAL_KEY = 'camDetectionIntervalMs';
const BOX_SMOOTHING_KEY = 'camBoxSmoothing';

// Face "distance" can't be measured directly from a 2D image, but the
// detected face box height as a % of the frame height is a reliable proxy
// (closer face = bigger box). minFaceSizePct is effectively "how far away
// can a face still be detected" (lower = farther), maxFaceSizePct is "how
// close can a face get before we stop counting it" (lower = must stay
// farther back — useful to reject something pressed right up against the
// lens).
const DEFAULT_MIN_FACE_SIZE_PCT = 8;
const DEFAULT_MAX_FACE_SIZE_PCT = 90;
const FACE_SIZE_PCT_FLOOR = 2;
const FACE_SIZE_PCT_CEIL = 100;
const MIN_FACE_SIZE_KEY = 'camMinFaceSizePct';
const MAX_FACE_SIZE_KEY = 'camMaxFaceSizePct';

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
    MatSliderModule,
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
  showLandmarks = true;
  soundEnabled = true;

  detectionIntervalMs = DEFAULT_DETECTION_INTERVAL_MS;
  boxSmoothing = DEFAULT_BOX_SMOOTHING;
  readonly minDetectionIntervalMs = MIN_DETECTION_INTERVAL_MS;
  readonly maxDetectionIntervalMs = MAX_DETECTION_INTERVAL_MS;
  readonly minBoxSmoothing = MIN_BOX_SMOOTHING;
  readonly maxBoxSmoothing = MAX_BOX_SMOOTHING;

  minFaceSizePct = DEFAULT_MIN_FACE_SIZE_PCT;
  maxFaceSizePct = DEFAULT_MAX_FACE_SIZE_PCT;
  readonly faceSizePctFloor = FACE_SIZE_PCT_FLOOR;
  readonly faceSizePctCeil = FACE_SIZE_PCT_CEIL;

  // Detector confidence threshold — lower = catches more tilted/turned/
  // masked faces (at the cost of more false-positive detections), higher =
  // stricter, frontal-only detection. Real value comes from FacePipelineService
  // in the constructor body below (class field initializers run before
  // constructor-parameter-property assignment, so `this.facePipeline` isn't
  // available yet up here).
  scoreThreshold = 0.35;
  minScoreThreshold = 0.2;
  maxScoreThreshold = 0.7;

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

  feedItems: RecentScanItem[] = [];

  clockTime = '';
  clockDate = '';

  readonly statusTh = STATUS_TH;
  readonly scanTypeTh = SCANTYPE_TH;

  private stream: MediaStream | null = null;
  private detectionTimer: ReturnType<typeof setTimeout> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private feedPollTimer: ReturnType<typeof setInterval> | null = null;
  private resultBannerTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownToken = 0;
  private destroyed = false;

  // Camera watchdog: if the video stream silently freezes (track ends
  // without an event, OS suspends the camera, driver hiccup, etc.) the
  // detector keeps "running" against a static frame forever — no faces
  // ever match, with no error to catch. Track currentTime advancing; if
  // it's stuck for a few checks in a row while we should be scanning,
  // assume the stream died and reacquire it automatically instead of
  // requiring the user to refresh the page.
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lastVideoTime = -1;
  private staleFrameChecks = 0;
  private recovering = false;
  private static readonly WATCHDOG_INTERVAL_MS = 4000;
  private static readonly STALE_CHECKS_BEFORE_RECOVERY = 2;

  private readonly toasted: Record<number, number> = {};
  private readonly pendingMatch: Record<number, PendingMatch> = {};
  // Previous frame's smoothed boxes, matched to this frame's detections by
  // nearest center (not array index — face-api.js detection order isn't
  // stable across frames) so each face's box/landmarks/name label glides
  // continuously instead of jumping or latching onto the wrong face.
  private smoothedBoxes: { x: number; y: number; width: number; height: number }[] = [];

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
    this.showLandmarks = localStorage.getItem('camShowLandmarks') !== '0';
    this.soundEnabled = localStorage.getItem('camSoundEnabled') !== '0';
    this.detectionIntervalMs = this.clampNumber(
      Number(localStorage.getItem(DETECTION_INTERVAL_KEY)) || DEFAULT_DETECTION_INTERVAL_MS,
      MIN_DETECTION_INTERVAL_MS,
      MAX_DETECTION_INTERVAL_MS
    );
    this.boxSmoothing = this.clampNumber(
      Number(localStorage.getItem(BOX_SMOOTHING_KEY)) || DEFAULT_BOX_SMOOTHING,
      MIN_BOX_SMOOTHING,
      MAX_BOX_SMOOTHING
    );
    this.minScoreThreshold = this.facePipeline.minScoreThreshold;
    this.maxScoreThreshold = this.facePipeline.maxScoreThreshold;
    this.scoreThreshold = this.facePipeline.getScoreThreshold();
    this.minFaceSizePct = this.clampNumber(
      Number(localStorage.getItem(MIN_FACE_SIZE_KEY)) || DEFAULT_MIN_FACE_SIZE_PCT,
      FACE_SIZE_PCT_FLOOR,
      FACE_SIZE_PCT_CEIL
    );
    this.maxFaceSizePct = this.clampNumber(
      Number(localStorage.getItem(MAX_FACE_SIZE_KEY)) || DEFAULT_MAX_FACE_SIZE_PCT,
      FACE_SIZE_PCT_FLOOR,
      FACE_SIZE_PCT_CEIL
    );
    this.selectedLocationId = localStorage.getItem(LOCATION_STORAGE_KEY) || '';
  }

  async ngAfterViewInit(): Promise<void> {
    this.tickClock();
    this.clockTimer = setInterval(() => this.tickClock(), 1000);

    this.loadFeed();
    this.feedPollTimer = setInterval(() => this.loadFeed(), FEED_POLL_MS);

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
    if (this.feedPollTimer) clearInterval(this.feedPollTimer);
    if (this.resultBannerTimer) clearTimeout(this.resultBannerTimer);
    this.stopWatchdog();
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
      this.attachStreamWatchers(this.stream);
      this.lastVideoTime = -1;
      this.staleFrameChecks = 0;
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
    this.loadFeed();
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
      this.attachStreamWatchers(this.stream);
      this.lastVideoTime = -1;
      this.staleFrameChecks = 0;
    }
  }

  async refreshCameras(): Promise<void> {
    await this.loadCameras();
    if (this.running) {
      this.facePipeline.stopCamera(this.stream);
      this.stream = await this.facePipeline.startCamera(this.videoRef.nativeElement, this.selectedCameraId, this.facingMode);
      this.attachStreamWatchers(this.stream);
      this.lastVideoTime = -1;
      this.staleFrameChecks = 0;
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
      this.attachStreamWatchers(this.stream);
      this.lastVideoTime = -1;
      this.staleFrameChecks = 0;
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
      this.attachStreamWatchers(this.stream);
      this.lastVideoTime = -1;
      this.staleFrameChecks = 0;
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

  toggleLandmarks(): void {
    this.showLandmarks = !this.showLandmarks;
    localStorage.setItem('camShowLandmarks', this.showLandmarks ? '1' : '0');
  }

  toggleSound(): void {
    this.soundEnabled = !this.soundEnabled;
    localStorage.setItem('camSoundEnabled', this.soundEnabled ? '1' : '0');
  }

  // ===== Scan-success sound =====
  // Synthesized via Web Audio (no asset file, works offline on a LAN
  // kiosk) instead of an <audio> tag. Created lazily on the first call
  // from start() — that's a real user click/tap, which satisfies
  // browsers' autoplay-gesture requirement for AudioContext.
  private audioCtx: AudioContext | null = null;

  private ensureAudioContext(): void {
    if (this.audioCtx) return;
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.audioCtx = new Ctor();
    } catch {
      // Web Audio unavailable — sound is a nice-to-have, scanning still works
    }
  }

  private playSuccessBeep(): void {
    if (!this.soundEnabled) return;
    const ctx = this.audioCtx;
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    try {
      const startAt = ctx.currentTime;
      const playTone = (freq: number, offset: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, startAt + offset);
        gain.gain.linearRampToValueAtTime(0.35, startAt + offset + 0.02);
        gain.gain.linearRampToValueAtTime(0, startAt + offset + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startAt + offset);
        osc.stop(startAt + offset + duration + 0.02);
      };
      // Short two-note ascending chime ("ding-ding") for "saved successfully".
      playTone(880, 0, 0.12);
      playTone(1320, 0.12, 0.14);
    } catch {
      // non-critical
    }
  }

  private clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  onDetectionIntervalChange(value: number): void {
    this.detectionIntervalMs = this.clampNumber(value, MIN_DETECTION_INTERVAL_MS, MAX_DETECTION_INTERVAL_MS);
    localStorage.setItem(DETECTION_INTERVAL_KEY, String(this.detectionIntervalMs));
  }

  onBoxSmoothingChange(value: number): void {
    this.boxSmoothing = this.clampNumber(value, MIN_BOX_SMOOTHING, MAX_BOX_SMOOTHING);
    localStorage.setItem(BOX_SMOOTHING_KEY, String(this.boxSmoothing));
  }

  onMinFaceSizeChange(value: number): void {
    this.minFaceSizePct = this.clampNumber(value, FACE_SIZE_PCT_FLOOR, this.maxFaceSizePct);
    localStorage.setItem(MIN_FACE_SIZE_KEY, String(this.minFaceSizePct));
  }

  onMaxFaceSizeChange(value: number): void {
    this.maxFaceSizePct = this.clampNumber(value, this.minFaceSizePct, FACE_SIZE_PCT_CEIL);
    localStorage.setItem(MAX_FACE_SIZE_KEY, String(this.maxFaceSizePct));
  }

  onScoreThresholdChange(value: number): void {
    this.facePipeline.setScoreThreshold(value);
    this.scoreThreshold = this.facePipeline.getScoreThreshold();
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

  private static readonly RESULT_BANNER_MS = 3500;

  private showResult(text: string, type: 'success' | 'error' | 'warn'): void {
    if (this.resultBannerTimer) clearTimeout(this.resultBannerTimer);

    const display = () => {
      this.resultText = text;
      this.resultType = type;
      this.showResultBanner = true;
      this.resultBannerTimer = setTimeout(() => {
        this.showResultBanner = false;
      }, CheckinComponent.RESULT_BANNER_MS);
    };

    if (this.showResultBanner) {
      // Re-trigger the pop-in animation even if a banner is already showing
      // (e.g. two scans in quick succession) by remounting the element.
      this.showResultBanner = false;
      setTimeout(display, 0);
    } else {
      display();
    }
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

    // face-api.js doesn't guarantee detection order is stable between
    // frames — with 2+ faces, index i can refer to a different physical
    // face on every call. Matching by nearest previous box center (instead
    // of by array index) keeps each face's smoothing target — and so its
    // drawn box/name label — locked onto the right person.
    const pool = [...this.smoothedBoxes];
    const nextSmoothedBoxes: typeof this.smoothedBoxes = [];
    const matchRadius = Math.max(overlay.width, overlay.height) * 0.25;

    results.forEach(({ det, r }) => {
      const b = det.box;
      const color = this.colorFor(r);
      const label = this.labelFor(r);

      const rawXFull = b.x * sx;
      const rawYFull = b.y * sy;
      const wFull = b.width * sx;
      const hFull = b.height * sy;
      const cx = rawXFull + wFull / 2;
      const cy = rawYFull + hFull / 2;

      let bestIdx = -1;
      let bestDist = matchRadius;
      pool.forEach((p, idx) => {
        const pcx = p.x + p.width / 2;
        const pcy = p.y + p.height / 2;
        const dist = Math.hypot(cx - pcx, cy - pcy);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = idx;
        }
      });

      const prev = bestIdx >= 0 ? pool.splice(bestIdx, 1)[0] : undefined;
      const factor = this.boxSmoothing;
      const smoothed = prev
        ? {
            x: prev.x + (rawXFull - prev.x) * factor,
            y: prev.y + (rawYFull - prev.y) * factor,
            width: prev.width + (wFull - prev.width) * factor,
            height: prev.height + (hFull - prev.height) * factor,
          }
        : { x: rawXFull, y: rawYFull, width: wFull, height: hFull };
      nextSmoothedBoxes.push(smoothed);

      const rawX = smoothed.x;
      const rawY = smoothed.y;
      const w = smoothed.width;
      const h = smoothed.height;
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

      if (det.landmarks && this.showLandmarks) {
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
    });

    this.smoothedBoxes = nextSmoothedBoxes;
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
  // Backed by the real attendance_records table (via /api/attendance/recent,
  // a public endpoint scoped to today + this kiosk's scan location) instead
  // of a local-only cache — so if a record shown here is edited or deleted
  // from the Attendance admin page, the next poll picks up the change. The
  // box no longer needs day-rollover bookkeeping either: "today" is enforced
  // server-side.
  loadFeed(): void {
    this.attendanceService.recent(this.getScanLocationId(), FEED_LIMIT).subscribe({
      next: (items) => (this.feedItems = items),
      error: () => {
        // transient network hiccup — keep showing the last good list
      },
    });
  }

  feedTime(iso: string): string {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  trackByFeedId(_: number, item: RecentScanItem): number {
    return item.id;
  }

  // ===== Detection loop =====
  //
  // face-api.js's detectAllFaces() call can hang forever with no error and
  // no rejection — typically a TensorFlow.js WebGL backend stall (lost GPU
  // context, browser throttling a backgrounded tab mid-inference, driver
  // hiccup). When that happens `busy` never resets, so `loop()`'s
  // `if (!this.busy)` guard silently stops ever calling the detector again
  // — exactly the "ค้าง, ต้อง refresh" symptom. A bare camera-stream
  // watchdog (see checkStreamHealth) doesn't catch this case because the
  // <video> element itself is usually still playing fine; only the
  // inference call is stuck. Racing each call against a timeout, and
  // forcing a full reload after several hangs in a row, is the only
  // reliable way to recover (we can't actually cancel a stuck TF.js op).
  private static readonly DETECTION_TIMEOUT_MS = 6000;
  private static readonly MAX_CONSECUTIVE_TIMEOUTS = 3;
  private detectionAttemptId = 0;
  private consecutiveDetectionTimeouts = 0;

  private loop(): void {
    if (!this.running) return;
    if (!this.busy) {
      this.busy = true;
      const attemptId = ++this.detectionAttemptId;

      const detectPromise = this.facePipeline.getAllDescriptors(this.videoRef.nativeElement);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('face detection timed out')), CheckinComponent.DETECTION_TIMEOUT_MS);
      });

      Promise.race([detectPromise, timeoutPromise])
        .then((dets) => {
          if (attemptId !== this.detectionAttemptId) return; // a later attempt already started/finished
          this.consecutiveDetectionTimeouts = 0;
          return this.handleDetections(dets as FaceDetectionResult[]);
        })
        .catch((e) => {
          if (attemptId !== this.detectionAttemptId) return;
          console.error(e);
          this.consecutiveDetectionTimeouts++;
          if (this.consecutiveDetectionTimeouts >= CheckinComponent.MAX_CONSECUTIVE_TIMEOUTS) {
            this.recoverFromStuckDetection();
          }
        })
        .finally(() => {
          if (attemptId === this.detectionAttemptId) this.busy = false;
        });
    }
    this.detectionTimer = setTimeout(() => this.loop(), this.detectionIntervalMs);
  }

  // The detector itself is stuck (not just the camera stream) — restarting
  // just the camera won't reset a wedged TF.js/WebGL backend. A full page
  // reload is the only thing that reliably clears it (it's also exactly
  // what manually refreshing the page already does today), so do that
  // automatically instead of leaving the kiosk stuck until someone notices.
  private recoverFromStuckDetection(): void {
    if (this.destroyed) return;
    this.running = false;
    this.setStatus('ระบบตรวจจับใบหน้าค้าง — กำลังรีเฟรชหน้าอัตโนมัติ...', 'error');
    setTimeout(() => location.reload(), 1200);
  }

  // Face "distance" can't be measured from a single 2D camera, but the
  // detected box height as a % of the frame height is a reliable stand-in
  // (closer face = taller box) — lets the device-settings range slider
  // reject faces that are too far away or pressed too close to the lens.
  private filterByFaceSize(dets: FaceDetectionResult[]): { kept: FaceDetectionResult[]; hadOutOfRange: boolean } {
    const frameHeight = this.videoRef.nativeElement.videoHeight || 480;
    let hadOutOfRange = false;
    const kept = dets.filter((d) => {
      const pct = (d.box.height / frameHeight) * 100;
      const ok = pct >= this.minFaceSizePct && pct <= this.maxFaceSizePct;
      if (!ok) hadOutOfRange = true;
      return ok;
    });
    return { kept, hadOutOfRange };
  }

  private async handleDetections(rawDets: FaceDetectionResult[]): Promise<void> {
    if (!this.running) return;
    if (!rawDets.length) {
      this.drawAll([]);
      this.setStatus('กำลังค้นหาใบหน้า... กรุณาหันหน้าเข้ากล้อง', 'scanning');
      return;
    }

    const { kept: dets, hadOutOfRange } = this.filterByFaceSize(rawDets);
    if (!dets.length) {
      this.drawAll([]);
      this.setStatus(
        hadOutOfRange
          ? 'ตรวจพบใบหน้าแต่อยู่ไกล/ใกล้เกินระยะที่ตั้งไว้ — กรุณาขยับระยะให้อยู่ในช่วงที่กำหนด'
          : 'กำลังค้นหาใบหน้า... กรุณาหันหน้าเข้ากล้อง',
        'scanning'
      );
      return;
    }

    const now = Date.now();

    // Step 1: cheap preview (descriptor only) for every detected face.
    const previews: { det: FaceDetectionResult; r: ScanResult | null }[] = await Promise.all(
      dets.map(async (det) => {
        try {
          const r = await firstValueFrom(this.attendanceService.preview(det.descriptor, this.getScanLocationId()));
          if (!r?.matched && r?.unknownFaceAlert) {
            // Server-debounced (~once/5min/location): fire-and-forget a
            // follow-up image capture so admin can review the unrecognized
            // face, without uploading an image on every preview tick.
            try {
              const imageBase64 = this.facePipeline.captureFaceJpeg(this.videoRef.nativeElement, det.box, 0.8);
              this.attendanceService.reportUnknownFace(imageBase64, this.getScanLocationId()).subscribe();
            } catch { /* best-effort, never block the preview loop */ }
          }
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

    for (const { r } of results) {
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
      this.playSuccessBeep();
      this.loadFeed();
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
      script.src = 'lib/face-api.min.js'; // relative — resolves against <base href>, see index.html
      script.setAttribute('data-face-api', '1');
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('โหลด face-api.js ไม่สำเร็จ'));
      document.head.appendChild(script);
    });
  }

  async start(): Promise<void> {
    if (this.starting || this.running) return;
    this.starting = true;
    this.ensureAudioContext(); // must happen on a real user gesture (this click)
    this.setStatus('กำลังโหลดโมเดล AI...', 'scanning');
    try {
      await this.ensureFaceApiLoaded();
      await this.facePipeline.loadModels();
      this.modelsLoaded = true;
      this.modelsLoading = false;

      this.setStatus('กำลังเปิดกล้อง...', 'scanning');
      this.stream = await this.facePipeline.startCamera(this.videoRef.nativeElement, this.selectedCameraId, this.facingMode);
      this.attachStreamWatchers(this.stream);
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
      this.consecutiveDetectionTimeouts = 0;
      this.setStatus('พร้อมสแกน — รองรับหลายคนพร้อมกัน', 'scanning');
      this.loop();
      this.startWatchdog();
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
    this.stopWatchdog();
    this.facePipeline.stopCamera(this.stream);
    this.drawAll([]); // clear overlay immediately
    this.setStatus('หยุดสแกนแล้ว — กดเริ่มสแกนเพื่อเริ่มใหม่', '');
  }

  // ===== Camera watchdog =====
  private attachStreamWatchers(stream: MediaStream): void {
    stream.getVideoTracks().forEach((track) => {
      track.onended = () => this.recoverCamera();
    });
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    this.lastVideoTime = -1;
    this.staleFrameChecks = 0;
    this.watchdogTimer = setInterval(() => this.checkStreamHealth(), CheckinComponent.WATCHDOG_INTERVAL_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private checkStreamHealth(): void {
    if (!this.running || this.recovering) return;
    const video = this.videoRef?.nativeElement;
    if (!video) return;

    const t = video.currentTime;
    if (t === this.lastVideoTime) {
      this.staleFrameChecks++;
    } else {
      this.staleFrameChecks = 0;
      this.lastVideoTime = t;
    }

    if (this.staleFrameChecks >= CheckinComponent.STALE_CHECKS_BEFORE_RECOVERY) {
      this.recoverCamera();
    }
  }

  private async recoverCamera(): Promise<void> {
    if (!this.running || this.recovering) return;
    this.recovering = true;
    this.setStatus('กล้องไม่ตอบสนอง กำลังเชื่อมต่อใหม่อัตโนมัติ...', 'warn');
    try {
      this.facePipeline.stopCamera(this.stream);
      this.stream = await this.facePipeline.startCamera(this.videoRef.nativeElement, this.selectedCameraId, this.facingMode);
      this.attachStreamWatchers(this.stream);
      this.lastVideoTime = -1;
      this.staleFrameChecks = 0;
      if (this.running) {
        this.setStatus('เชื่อมต่อกล้องใหม่สำเร็จ — พร้อมสแกน', 'scanning');
      }
    } catch (e: any) {
      this.setStatus('เชื่อมต่อกล้องใหม่ไม่สำเร็จ: ' + (e?.message || e) + ' — กรุณากดเริ่มสแกนใหม่', 'error');
      this.running = false;
      this.stopWatchdog();
    } finally {
      this.recovering = false;
    }
  }
}
