import { AfterViewInit, Component, ElementRef, Inject, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { EmployeeService } from '../../../core/services/employee.service';
import { FacePipelineService, QualityKey } from '../../../core/services/face-pipeline.service';
import { NotifyService } from '../../../core/services/notify.service';

export interface FaceEnrollDialogData {
  employeeId: number;
  employeeName: string;
}

interface CapturedShot {
  descriptor: number[];
  thumbnail: string;
}

type BannerType = '' | 'scanning' | 'success' | 'warn' | 'error';

// Capturing a few off-angle poses (not just straight-on) means the enrolled
// descriptors actually cover the head positions a real check-in scan sees
// day to day — straight ahead, turned slightly left/right, and tilted
// slightly down/up — which is what materially improves match success for
// those poses (a confidence-threshold tweak alone only helps find a face
// box; it can't make recognition match an angle nobody enrolled).
export const ENROLL_POSE_LABELS = ['หน้าตรง', 'หันหน้าซ้ายเล็กน้อย', 'หันหน้าขวาเล็กน้อย', 'ก้มหน้าลงเล็กน้อย', 'เงยหน้าขึ้นเล็กน้อย'];
export const ENROLL_SHOT_COUNT = ENROLL_POSE_LABELS.length;

@Component({
  selector: 'app-face-enroll-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatSelectModule, MatCheckboxModule, RouterLink],
  templateUrl: './face-enroll-dialog.component.html',
  styleUrl: './face-enroll-dialog.component.scss',
})
export class FaceEnrollDialogComponent implements AfterViewInit, OnDestroy {
  @ViewChild('video') videoRef?: ElementRef<HTMLVideoElement>;

  public dialogRef = inject<MatDialogRef<FaceEnrollDialogComponent, boolean>>(MatDialogRef);
  public data = inject<FaceEnrollDialogData>(MAT_DIALOG_DATA);
  private facePipeline = inject(FacePipelineService);
  private employeeService = inject(EmployeeService);
  private notify = inject(NotifyService);

  readonly cameras = signal<MediaDeviceInfo[]>([]);
  readonly selectedCamera = signal<string>('');
  readonly qualityKeys: QualityKey[] = ['low', 'medium', 'high', 'ultra'];
  readonly selectedQuality = signal<QualityKey>(this.facePipeline.getQualityKey());
  readonly facingMode = signal<'user' | 'environment'>(this.facePipeline.getPreferredFacingMode());
  readonly isTouchDevice = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  readonly cameraStarted = signal(false);
  readonly capturing = signal(false);
  readonly saving = signal(false);
  readonly statusText = signal('กดปุ่ม "เริ่มกล้อง" เพื่อเริ่มถ่ายภาพ');
  readonly statusType = signal<BannerType>('');
  readonly poseLabels = ENROLL_POSE_LABELS;
  readonly totalShots = ENROLL_SHOT_COUNT;
  readonly shots = signal<(CapturedShot | null)[]>(new Array(ENROLL_SHOT_COUNT).fill(null));
  readonly consentChecked = signal(false);

  private stream: MediaStream | null = null;

  constructor() {}

  ngAfterViewInit(): void {
    this.refreshCameras();
    // Pre-check the box if this employee already has valid consent on file
    // (e.g. re-taking photos after an earlier enrollment) so admin doesn't
    // have to re-confirm something already recorded.
    this.employeeService.getConsent(this.data.employeeId).subscribe({
      next: (status) => this.consentChecked.set(status.hasConsent),
      error: () => {},
    });
  }

  ngOnDestroy(): void {
    this.facePipeline.stopCamera(this.stream);
    this.stream = null;
  }

  get qualityLabel() {
    return (k: QualityKey) => this.facePipeline.QUALITY_PRESETS[k].label;
  }

  get capturedCount(): number {
    return this.shots().filter((s) => !!s).length;
  }

  async refreshCameras(): Promise<void> {
    try {
      const list = await this.facePipeline.listCameras();
      this.cameras.set(list);
      const preferred = this.facePipeline.getPreferredCamera();
      if (preferred && list.some((c) => c.deviceId === preferred)) {
        this.selectedCamera.set(preferred);
      }
    } catch {
      // ignore - permissions not granted yet
    }
  }

  async onCameraChange(deviceId: string): Promise<void> {
    this.selectedCamera.set(deviceId);
    this.facePipeline.setPreferredCamera(deviceId);
    if (this.cameraStarted()) {
      await this.restartCamera();
    }
  }

  async onQualityChange(key: QualityKey): Promise<void> {
    this.selectedQuality.set(key);
    this.facePipeline.setQualityKey(key);
    if (this.cameraStarted()) {
      await this.restartCamera();
    }
  }

  private async restartCamera(): Promise<void> {
    this.facePipeline.stopCamera(this.stream);
    this.stream = await this.facePipeline.startCamera(this.videoRef!.nativeElement, this.selectedCamera() || undefined, this.facingMode());
  }

  async startCamera(): Promise<void> {
    if (!this.consentChecked()) {
      this.setStatus('กรุณายืนยันความยินยอมในการเก็บข้อมูลใบหน้าก่อนเริ่มกล้อง', 'warn');
      return;
    }
    this.setStatus('กำลังโหลดโมเดล AI...', 'scanning');
    try {
      await this.facePipeline.loadModels();
      this.stream = await this.facePipeline.startCamera(this.videoRef!.nativeElement, this.selectedCamera() || undefined, this.facingMode());
      await this.refreshCameras();
      this.setStatus(`พร้อมแล้ว — ภาพที่ 1: ${this.poseLabels[0]} แล้วกดถ่ายภาพ`, 'scanning');
      this.cameraStarted.set(true);
    } catch (e: any) {
      this.setStatus('ผิดพลาด: ' + (e?.message || e), 'error');
    }
  }

  async toggleFacingMode(): Promise<void> {
    const next = this.facingMode() === 'user' ? 'environment' : 'user';
    this.facingMode.set(next);
    this.facePipeline.setPreferredFacingMode(next);
    this.selectedCamera.set('');
    this.facePipeline.setPreferredCamera('');
    if (this.cameraStarted()) {
      await this.restartCamera();
      await this.refreshCameras();
    }
  }

  async capture(): Promise<void> {
    const idx = this.capturedCount;
    if (idx >= this.totalShots || this.capturing()) return;
    this.capturing.set(true);
    this.setStatus(`กำลังถ่ายภาพที่ ${idx + 1} (${this.poseLabels[idx]})...`, 'scanning');
    try {
      const det = await this.facePipeline.getDescriptor(this.videoRef!.nativeElement);
      if (!det) {
        this.setStatus('ไม่พบใบหน้า กรุณาจัดใบหน้าให้อยู่กลางจอแล้วลองใหม่', 'warn');
        this.capturing.set(false);
        return;
      }
      const jpeg = this.facePipeline.captureFaceJpeg(this.videoRef!.nativeElement, det.box, 0.7);
      const shots = [...this.shots()];
      shots[idx] = { descriptor: det.descriptor, thumbnail: jpeg };
      this.shots.set(shots);
      const next = idx + 1;
      if (next < this.totalShots) {
        this.setStatus(`✓ ถ่ายภาพที่ ${next} สำเร็จ (${next}/${this.totalShots}) — ต่อไปภาพที่ ${next + 1}: ${this.poseLabels[next]}`, 'success');
      } else {
        this.setStatus(`✓ ถ่ายภาพที่ ${next} สำเร็จ (${next}/${this.totalShots}) — ครบแล้ว กดบันทึกได้เลย`, 'success');
      }
    } catch (e: any) {
      this.setStatus('ผิดพลาด: ' + (e?.message || e), 'error');
    } finally {
      this.capturing.set(false);
    }
  }

  resetShots(): void {
    this.shots.set(new Array(this.totalShots).fill(null));
    this.setStatus(`เริ่มถ่ายใหม่ — ภาพที่ 1: ${this.poseLabels[0]}`, 'scanning');
  }

  skip(): void {
    this.dialogRef.close(false);
  }

  async saveAll(): Promise<void> {
    const shots = this.shots().filter((s): s is CapturedShot => !!s);
    if (shots.length < this.totalShots) return;
    this.saving.set(true);
    this.setStatus(`กำลังบันทึกใบหน้า ${this.totalShots} ภาพ...`, 'scanning');
    try {
      // Record consent every time enrollment is saved — a fresh, timestamped
      // confirmation rather than relying solely on a possibly-stale earlier
      // record. Extra grant rows are harmless (latest one governs status).
      await new Promise<void>((resolve, reject) => {
        this.employeeService.recordConsent(this.data.employeeId).subscribe({ next: () => resolve(), error: (e) => reject(e) });
      });
      await new Promise<void>((resolve, reject) => {
        this.employeeService.clearFaces(this.data.employeeId).subscribe({ next: () => resolve(), error: (e) => reject(e) });
      });
      for (const s of shots) {
        await new Promise<void>((resolve, reject) => {
          this.employeeService.enrollFace(this.data.employeeId, s.descriptor, s.thumbnail).subscribe({
            next: () => resolve(),
            error: (e) => reject(e),
          });
        });
      }
      this.setStatus(`✓ บันทึกใบหน้าเรียบร้อย (${this.totalShots} ภาพ)`, 'success');
      this.notify.toast(`ลงทะเบียนใบหน้า ${this.totalShots} ภาพเรียบร้อย`, 'success');
      setTimeout(() => this.dialogRef.close(true), 800);
    } catch (e: any) {
      this.setStatus('ผิดพลาด: ' + (e?.error?.error || e?.message || e), 'error');
      this.saving.set(false);
    }
  }

  private setStatus(text: string, type: BannerType): void {
    this.statusText.set(text);
    this.statusType.set(type);
  }
}
