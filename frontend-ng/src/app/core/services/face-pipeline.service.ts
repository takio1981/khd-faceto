import { Injectable } from '@angular/core';

declare const faceapi: any;

// ===== Object detection (COCO-SSD via TensorFlow.js) =====
// Thai name + emoji for every COCO class (80 classes).
// Unknown classes fall back to the English name + 🔍.
const OBJ_META: Record<string, [string, string]> = {
  person: ['มนุษย์', '👤'],
  bicycle: ['จักรยาน', '🚲'],
  car: ['รถยนต์', '🚗'],
  motorcycle: ['มอเตอร์ไซค์', '🏍️'],
  airplane: ['เครื่องบิน', '✈️'],
  bus: ['รถบัส', '🚌'],
  train: ['รถไฟ', '🚂'],
  truck: ['รถบรรทุก', '🚛'],
  boat: ['เรือ', '⛵'],
  'traffic light': ['สัญญาณไฟ', '🚦'],
  bench: ['ม้านั่ง', '🪑'],
  bird: ['นก', '🐦'],
  cat: ['แมว', '🐈'],
  dog: ['สุนัข', '🐕'],
  horse: ['ม้า', '🐎'],
  sheep: ['แกะ', '🐑'],
  cow: ['วัว', '🐄'],
  elephant: ['ช้าง', '🐘'],
  bear: ['หมี', '🐻'],
  zebra: ['ม้าลาย', '🦓'],
  giraffe: ['ยีราฟ', '🦒'],
  backpack: ['กระเป๋าเป้', '🎒'],
  umbrella: ['ร่ม', '☂️'],
  handbag: ['กระเป๋าถือ', '👜'],
  tie: ['เนคไท', '👔'],
  suitcase: ['กระเป๋าเดินทาง', '🧳'],
  frisbee: ['จานร่อน', '🥏'],
  skis: ['สกี', '⛷️'],
  snowboard: ['สโนว์บอร์ด', '🏂'],
  'sports ball': ['ลูกบอล', '⚽'],
  kite: ['ว่าว', '🪁'],
  'baseball bat': ['ไม้เบสบอล', '⚾'],
  skateboard: ['สเก็ตบอร์ด', '🛹'],
  surfboard: ['เซิร์ฟบอร์ด', '🏄'],
  bottle: ['ขวด', '🍶'],
  'wine glass': ['แก้วไวน์', '🍷'],
  cup: ['แก้ว/ถ้วย', '☕'],
  fork: ['ส้อม', '🍴'],
  knife: ['มีด', '🔪'],
  spoon: ['ช้อน', '🥄'],
  bowl: ['ชาม', '🥣'],
  banana: ['กล้วย', '🍌'],
  apple: ['แอปเปิ้ล', '🍎'],
  sandwich: ['แซนวิช', '🥪'],
  orange: ['ส้ม', '🍊'],
  broccoli: ['บร็อคโคลี', '🥦'],
  carrot: ['แครอท', '🥕'],
  'hot dog': ['ฮอทด็อก', '🌭'],
  pizza: ['พิซซ่า', '🍕'],
  donut: ['โดนัท', '🍩'],
  cake: ['เค้ก', '🎂'],
  chair: ['เก้าอี้', '🪑'],
  couch: ['โซฟา', '🛋️'],
  'potted plant': ['ต้นไม้กระถาง', '🪴'],
  bed: ['เตียง', '🛏️'],
  'dining table': ['โต๊ะ', '🍽️'],
  toilet: ['ชักโครก', '🚽'],
  tv: ['โทรทัศน์', '📺'],
  laptop: ['แล็ปท็อป', '💻'],
  mouse: ['เมาส์', '🖱️'],
  remote: ['รีโมท', '📺'],
  keyboard: ['คีย์บอร์ด', '⌨️'],
  'cell phone': ['โทรศัพท์มือถือ', '📱'],
  microwave: ['ไมโครเวฟ', '📦'],
  oven: ['เตาอบ', '🍳'],
  toaster: ['เครื่องปิ้งขนมปัง', '🍞'],
  sink: ['อ่างล้างจาน', '🚿'],
  refrigerator: ['ตู้เย็น', '🧊'],
  book: ['หนังสือ', '📚'],
  clock: ['นาฬิกา', '🕐'],
  vase: ['แจกัน', '🏺'],
  scissors: ['กรรไกร', '✂️'],
  'teddy bear': ['ตุ๊กตาหมี', '🧸'],
  'hair drier': ['ไดร์เป่าผม', '💇'],
  toothbrush: ['แปรงสีฟัน', '🪥'],
};

export interface ObjectDetection {
  class: string;
  classTh: string;
  emoji: string;
  score: number;
  bbox: [number, number, number, number]; // [x, y, width, height] in video pixels
  isHuman: boolean;
}

export interface QualityPreset {
  label: string;
  width: number;
  height: number;
  inputSize: number;
  subdivisions: number;
}

export type QualityKey = 'low' | 'medium' | 'high' | 'ultra';

export interface FaceDetectionResult {
  descriptor: number[];
  box: { x: number; y: number; width: number; height: number };
  landmarks?: any;
}

// Quality presets bundle camera resolution, detector inputSize, and landmark
// point density together so they always stay consistent with each other —
// picking one level adjusts all three at once instead of letting them drift
// out of sync (e.g. high point density with a low-res camera feed).
const QUALITY_PRESETS: Record<QualityKey, QualityPreset> = {
  low: { label: 'ต่ำ (เร็วสุด)', width: 640, height: 480, inputSize: 224, subdivisions: 0 },
  medium: { label: 'ปานกลาง', width: 1280, height: 720, inputSize: 416, subdivisions: 1 },
  high: { label: 'สูง', width: 1280, height: 720, inputSize: 512, subdivisions: 2 },
  ultra: { label: 'สูงพิเศษ (ช้าสุด)', width: 1920, height: 1080, inputSize: 608, subdivisions: 3 },
};
const DEFAULT_QUALITY: QualityKey = 'high';

// TinyFaceDetector's confidence score drops for non-frontal poses (head
// tilted down/up, turned left/right) and partial occlusion (mask over
// nose/mouth) since it's trained mostly on near-frontal faces — those are
// exactly the cases that used to get silently dropped by the old fixed 0.5
// threshold. Lowering the default trades a little more sensitivity to
// false positives (filtered out anyway by the checkin page's multi-frame
// confirmation) for catching more of these off-angle/occluded detections.
const DEFAULT_SCORE_THRESHOLD = 0.35;
const MIN_SCORE_THRESHOLD = 0.2;
const MAX_SCORE_THRESHOLD = 0.7;
const SCORE_THRESHOLD_KEY = 'faceScoreThreshold';

@Injectable({ providedIn: 'root' })
export class FacePipelineService {
  modelsLoaded = false;
  readonly QUALITY_PRESETS = QUALITY_PRESETS;

  // ===== Object detector (COCO-SSD) =====
  // Shared across all instances; loaded lazily only when enabled.
  private static _objModel: any = null;
  private static _objModelLoading = false;
  objectDetectorReady = false;

  private static getObjMeta(cls: string): [string, string] {
    return OBJ_META[cls] ?? [cls, '🔍'];
  }

  // Dynamic import keeps TF.js (~1.5 MB) out of the initial bundle and loads
  // it only when this feature is explicitly enabled by the operator.
  // Model weights (~3 MB lite_mobilenet_v2) are fetched from Google CDN on
  // first use and cached by the browser thereafter.
  async loadObjectDetector(): Promise<void> {
    if (FacePipelineService._objModel) {
      this.objectDetectorReady = true;
      return;
    }
    if (FacePipelineService._objModelLoading) {
      while (FacePipelineService._objModelLoading) {
        await new Promise((r) => setTimeout(r, 200));
      }
      this.objectDetectorReady = !!FacePipelineService._objModel;
      return;
    }
    FacePipelineService._objModelLoading = true;
    try {
      // Import COCO-SSD only — it brings its own TF.js peer deps.
      // Importing @tensorflow/tfjs separately would register TF.js kernels
      // a second time (face-api.js already loaded TF.js) causing WebGL
      // "already registered" warnings and potential backend conflicts.
      const cocoMod = await import('@tensorflow-models/coco-ssd');
      // esbuild wraps CJS modules: the actual exports land on .default in the
      // ESM namespace; fall back to the raw module object if .default is absent.
      const cocoSsd: { load: (cfg?: object) => Promise<any> } =
        (cocoMod as any).default ?? (cocoMod as any);
      FacePipelineService._objModel = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      this.objectDetectorReady = true;
    } catch (e) {
      console.warn('[FacePipeline] object detector failed to load:', e);
      this.objectDetectorReady = false;
    } finally {
      FacePipelineService._objModelLoading = false;
    }
  }

  async detectObjects(video: HTMLVideoElement): Promise<ObjectDetection[]> {
    if (!FacePipelineService._objModel) return [];
    const raw: { class: string; score: number; bbox: [number, number, number, number] }[] =
      await FacePipelineService._objModel.detect(video);
    return raw.map((d) => {
      const [classTh, emoji] = FacePipelineService.getObjMeta(d.class);
      return { class: d.class, classTh, emoji, score: d.score, bbox: d.bbox, isHuman: d.class === 'person' };
    });
  }

  getQualityKey(): QualityKey {
    const key = localStorage.getItem('faceQuality') as QualityKey | null;
    return key && QUALITY_PRESETS[key] ? key : DEFAULT_QUALITY;
  }

  setQualityKey(key: QualityKey): void {
    localStorage.setItem('faceQuality', QUALITY_PRESETS[key] ? key : DEFAULT_QUALITY);
  }

  getQualityPreset(): QualityPreset {
    return QUALITY_PRESETS[this.getQualityKey()];
  }

  readonly minScoreThreshold = MIN_SCORE_THRESHOLD;
  readonly maxScoreThreshold = MAX_SCORE_THRESHOLD;

  getScoreThreshold(): number {
    const raw = Number(localStorage.getItem(SCORE_THRESHOLD_KEY));
    if (!raw || raw < MIN_SCORE_THRESHOLD || raw > MAX_SCORE_THRESHOLD) return DEFAULT_SCORE_THRESHOLD;
    return raw;
  }

  setScoreThreshold(value: number): void {
    const clamped = Math.min(MAX_SCORE_THRESHOLD, Math.max(MIN_SCORE_THRESHOLD, value));
    localStorage.setItem(SCORE_THRESHOLD_KEY, String(clamped));
  }

  // face-api.js (~1.4MB) is intentionally NOT bundled into the global script
  // tags — it's only needed on the checkin kiosk and the employee face-enroll
  // dialog, so loading it everywhere would blow the initial bundle budget for
  // every other page. Inject it on demand instead.
  private ensureScriptLoaded(): Promise<void> {
    if (typeof faceapi !== 'undefined') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-face-api]');
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

  async loadModels(): Promise<void> {
    if (this.modelsLoaded) return;
    await this.ensureScriptLoaded();
    if (typeof faceapi === 'undefined') {
      throw new Error('face-api.js ยังไม่ถูกโหลด');
    }
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('models'),
      faceapi.nets.faceRecognitionNet.loadFromUri('models'),
    ]);
    this.modelsLoaded = true;
  }

  // TinyFaceDetector is far faster than SSD MobileNet for live webcam scanning
  // (runs every frame in the detection loop). inputSize comes from the
  // selected quality preset so it always matches the camera resolution.
  detectorOptions(): any {
    return new faceapi.TinyFaceDetectorOptions({
      inputSize: this.getQualityPreset().inputSize,
      scoreThreshold: this.getScoreThreshold(),
    });
  }

  // ===== Device / camera management =====

  // navigator.mediaDevices is only defined in a "secure context" — localhost
  // or HTTPS. Opening the app via a LAN IP over plain http:// (e.g.
  // http://192.168.x.x:3000) leaves it `undefined`, which otherwise surfaces
  // as a cryptic "Cannot read properties of undefined" deep in a vendor
  // chunk. Fail fast here with a clear Thai message instead.
  private ensureMediaDevicesSupported(): void {
    if (!navigator.mediaDevices) {
      throw new Error(
        'ไม่สามารถเข้าถึงกล้องได้ — เบราว์เซอร์อนุญาตการใช้กล้องเฉพาะผ่าน localhost หรือ HTTPS เท่านั้น ' +
          'กรุณาเปิดผ่าน http://localhost:3000 บนเครื่องที่ต่อกล้องอยู่ (ไม่ใช่ผ่าน IP เครื่องอื่นด้วย http ธรรมดา)'
      );
    }
  }

  async listCameras(): Promise<MediaDeviceInfo[]> {
    this.ensureMediaDevicesSupported();
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  }

  getPreferredCamera(): string {
    return localStorage.getItem('preferredCamera') || '';
  }

  setPreferredCamera(id: string): void {
    localStorage.setItem('preferredCamera', id || '');
  }

  // Front/back camera preference — only meaningful on phones/tablets, which
  // usually have one of each. Selecting by deviceId works on desktop but on
  // mobile the standard, reliable way to flip is the `facingMode` constraint
  // (device labels are often generic/unhelpful, e.g. "Camera 0, facing back").
  getPreferredFacingMode(): 'user' | 'environment' {
    return localStorage.getItem('preferredFacingMode') === 'environment' ? 'environment' : 'user';
  }

  setPreferredFacingMode(mode: 'user' | 'environment'): void {
    localStorage.setItem('preferredFacingMode', mode);
  }

  // deviceId takes priority (explicit pick from the device dropdown — mainly
  // a desktop/webcam flow); otherwise fall back to the facingMode constraint
  // (mainly a phone/tablet flow, via the front/back toggle).
  async startCamera(videoEl: HTMLVideoElement, deviceId?: string, facingMode?: 'user' | 'environment'): Promise<MediaStream> {
    this.ensureMediaDevicesSupported();
    const { width, height } = this.getQualityPreset();
    const video: MediaTrackConstraints = deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: width }, height: { ideal: height } }
      : { width: { ideal: width }, height: { ideal: height }, facingMode: { ideal: facingMode || 'user' } };
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    videoEl.srcObject = stream;
    await videoEl.play();
    return stream;
  }

  stopCamera(stream: MediaStream | null | undefined): void {
    if (stream) stream.getTracks().forEach((t) => t.stop());
  }

  // ===== Detection =====

  async getDescriptor(input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): Promise<FaceDetectionResult | null> {
    const detection = await faceapi
      .detectSingleFace(input, this.detectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (!detection) return null;
    return { descriptor: Array.from(detection.descriptor), box: detection.detection.box };
  }

  async getAllDescriptors(input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): Promise<FaceDetectionResult[]> {
    const detections = await faceapi
      .detectAllFaces(input, this.detectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptors();
    return detections.map((d: any) => ({
      descriptor: Array.from(d.descriptor),
      box: d.detection.box,
      landmarks: d.landmarks,
    }));
  }

  // Draw face landmarks on a canvas context. Beyond the raw 68 points, this
  // interpolates extra points along each facial feature's contour (jaw,
  // eyebrows, eyes, nose, mouth) for a denser dot-grid look, without
  // drawing stray lines between unrelated features.
  drawLandmarks(ctx: CanvasRenderingContext2D, landmarks: any, color: string, scaleX = 1, scaleY = 1): void {
    if (!landmarks || !landmarks.positions) return;
    ctx.fillStyle = color || '#4ade80';

    const drawPoint = (p: { x: number; y: number }, r: number) => {
      ctx.beginPath();
      ctx.arc(p.x * scaleX, p.y * scaleY, r, 0, 2 * Math.PI);
      ctx.fill();
    };

    const drawContour = (pts: { x: number; y: number }[], closed: boolean, subdivisions: number) => {
      if (!pts || !pts.length) return;
      pts.forEach((p) => drawPoint(p, 2.5));
      const segCount = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < segCount; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        for (let s = 1; s <= subdivisions; s++) {
          const t = s / (subdivisions + 1);
          drawPoint({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, 1.5);
        }
      }
    };

    if (typeof landmarks.getJawOutline === 'function') {
      const d = this.getQualityPreset().subdivisions;
      drawContour(landmarks.getJawOutline(), false, d);
      drawContour(landmarks.getLeftEyeBrow(), false, d);
      drawContour(landmarks.getRightEyeBrow(), false, d);
      drawContour(landmarks.getNose(), false, Math.max(0, d - 1));
      drawContour(landmarks.getLeftEye(), true, d);
      drawContour(landmarks.getRightEye(), true, d);
      drawContour(landmarks.getMouth(), true, d);
    } else {
      landmarks.positions.forEach((p: any) => drawPoint(p, 2.5));
    }
  }

  // ===== Image capture =====

  captureJpeg(videoEl: HTMLVideoElement, quality = 0.8): string {
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth || 640;
    canvas.height = videoEl.videoHeight || 480;
    canvas.getContext('2d')!.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  // The server re-compresses/resizes every saved image anyway (see
  // saveFaceImage in shift.service.ts), but capping the capture here too
  // keeps the upload itself small — relevant on slower/cellular kiosk links.
  private static readonly CAPTURE_MAX_DIM = 480;

  captureFaceJpeg(videoEl: HTMLVideoElement, box: { x: number; y: number; width: number; height: number }, quality = 0.8): string {
    const pad = 0.25;
    const vw = videoEl.videoWidth || 640;
    const vh = videoEl.videoHeight || 480;
    const x = Math.max(0, box.x - box.width * pad);
    const y = Math.max(0, box.y - box.height * pad);
    const w = Math.min(vw - x, box.width * (1 + 2 * pad));
    const h = Math.min(vh - y, box.height * (1 + 2 * pad));

    const maxDim = FacePipelineService.CAPTURE_MAX_DIM;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const outW = Math.max(1, Math.round(w * scale));
    const outH = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    canvas.getContext('2d')!.drawImage(videoEl, x, y, w, h, 0, 0, outW, outH);
    return canvas.toDataURL('image/jpeg', quality);
  }

  averageDescriptors(list: number[][]): number[] | null {
    if (!list.length) return null;
    const len = list[0].length;
    const out = new Array(len).fill(0);
    for (const d of list) for (let i = 0; i < len; i++) out[i] += d[i];
    return out.map((v) => v / list.length);
  }
}
