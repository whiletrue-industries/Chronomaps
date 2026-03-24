import {
  Component,
  ElementRef,
  EventEmitter,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';

interface CropRect {
  x: number; // normalised 0–1
  y: number;
  w: number;
  h: number;
}

type ScannerPhase = 'video' | 'confirming';

/** Minimum luminance (0-255) for a pixel to be counted as white/light-grey paper. */
const PAPER_BRIGHTNESS_THRESHOLD = 175;

/** Minimum fraction of pixels in a row/column that must exceed the brightness threshold
 *  for that row/column to be considered part of the paper document. */
const PAPER_COVERAGE_FRACTION = 0.45;

/** Reject a detected crop if its normalised width or height is below this value
 *  (avoids false-positives from tiny bright specks). */
const MIN_DETECTION_RATIO = 0.1;

/** Reject a detected crop if its normalised width or height exceeds this value
 *  (avoids treating the whole frame as the document when it fills the view). */
const MAX_DETECTION_RATIO = 0.97;

/** Minimum normalised size for either dimension of the crop rectangle during manual dragging. */
const MIN_CROP_SIZE = 0.05;

@Component({
  selector: 'app-scanner',
  templateUrl: './scanner.component.html',
  styleUrls: ['./scanner.component.less'],
  standalone: false,
})
export class ScannerComponent implements OnInit, OnDestroy {
  @Output() imageCaptured = new EventEmitter<Blob>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild('videoEl') videoEl!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasEl') canvasEl!: ElementRef<HTMLCanvasElement>;

  phase: ScannerPhase = 'video';
  cropMode: 'auto' | 'manual' = 'auto';
  cameraError = false;
  isCapturing = false;

  private stream: MediaStream | null = null;
  private imageCapture: any = null;
  private rafId: number | null = null;

  // Detected crop (auto mode) smoothed over time
  private detectedCrop: CropRect = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
  private detectionConfidence = 0; // 0–1, increased each frame we find a crop

  // Active crop shown on screen (manual mode will write here too)
  crop: CropRect = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };

  // Captured image for the confirmation screen
  private capturedBitmap: ImageBitmap | null = null;

  // Drag-handle state
  private activeHandle: string | null = null;
  private handleRadius = 14;
  private pointerStart: { x: number; y: number } | null = null;
  private cropAtPointerStart: CropRect | null = null;

  async ngOnInit() {
    await this.startCamera();
  }

  ngOnDestroy() {
    this.stopCamera();
    this.capturedBitmap?.close();
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  private async startCamera() {
    this.cameraError = false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 4096 },
          height: { ideal: 3072 },
        },
      });

      const video = this.videoEl.nativeElement;
      video.srcObject = this.stream;
      video.setAttribute('playsinline', 'true'); // required on iOS
      await video.play();

      const track = this.stream.getVideoTracks()[0];
      if ('ImageCapture' in window) {
        this.imageCapture = new (window as any).ImageCapture(track);
      }

      this.startLoop();
    } catch (e) {
      console.error('Camera error', e);
      this.cameraError = true;
    }
  }

  private stopCamera() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.imageCapture = null;
  }

  // ── Render loop ────────────────────────────────────────────────────────────

  private startLoop() {
    const loop = () => {
      this.renderFrame();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private renderFrame() {
    const canvas = this.canvasEl?.nativeElement;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== Math.round(rect.width) || canvas.height !== Math.round(rect.height)) {
      canvas.width = Math.round(rect.width);
      canvas.height = Math.round(rect.height);
    }

    const ctx = canvas.getContext('2d')!;
    const { width: w, height: h } = canvas;

    if (this.phase === 'video') {
      const video = this.videoEl?.nativeElement;
      if (!video || video.readyState < 2) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        return;
      }
      ctx.drawImage(video, 0, 0, w, h);

      if (this.cropMode === 'auto') {
        this.runEdgeDetection(video);
        this.crop = { ...this.detectedCrop };
      }
    } else {
      // confirming phase
      if (this.capturedBitmap) {
        ctx.drawImage(this.capturedBitmap, 0, 0, w, h);
      }
    }

    this.drawOverlay(ctx, w, h);
  }

  // ── Edge detection ─────────────────────────────────────────────────────────

  private runEdgeDetection(video: HTMLVideoElement) {
    // Work at reduced resolution for speed
    const SW = 160;
    const SH = Math.round((SW * video.videoHeight) / Math.max(video.videoWidth, 1));

    const tmp = document.createElement('canvas');
    tmp.width = SW;
    tmp.height = SH;
    const tCtx = tmp.getContext('2d', { willReadFrequently: true })!;
    tCtx.drawImage(video, 0, 0, SW, SH);
    const { data } = tCtx.getImageData(0, 0, SW, SH);

    // Grayscale
    const gray = new Float32Array(SW * SH);
    for (let i = 0; i < SW * SH; i++) {
      gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    }

    // Find document boundary by scanning for consistently bright rows/columns.
    const col = (x: number) => {
      let cnt = 0;
      for (let y = 0; y < SH; y++) if (gray[y * SW + x] > PAPER_BRIGHTNESS_THRESHOLD) cnt++;
      return cnt / SH;
    };
    const row = (y: number) => {
      let cnt = 0;
      for (let x = 0; x < SW; x++) if (gray[y * SW + x] > PAPER_BRIGHTNESS_THRESHOLD) cnt++;
      return cnt / SW;
    };

    let left = -1, right = -1, top = -1, bottom = -1;
    for (let x = 0; x < SW; x++) if (col(x) > PAPER_COVERAGE_FRACTION) { left = x; break; }
    for (let x = SW - 1; x >= 0; x--) if (col(x) > PAPER_COVERAGE_FRACTION) { right = x; break; }
    for (let y = 0; y < SH; y++) if (row(y) > PAPER_COVERAGE_FRACTION) { top = y; break; }
    for (let y = SH - 1; y >= 0; y--) if (row(y) > PAPER_COVERAGE_FRACTION) { bottom = y; break; }

    if (left < 0 || right <= left || top < 0 || bottom <= top) {
      this.detectionConfidence = Math.max(0, this.detectionConfidence - 0.05);
      return;
    }

    const nw = (right - left) / SW;
    const nh = (bottom - top) / SH;

    // Reject if the detected area is nearly the whole frame or tiny
    if (nw < MIN_DETECTION_RATIO || nh < MIN_DETECTION_RATIO ||
        nw > MAX_DETECTION_RATIO || nh > MAX_DETECTION_RATIO) {
      this.detectionConfidence = Math.max(0, this.detectionConfidence - 0.05);
      return;
    }

    const target: CropRect = { x: left / SW, y: top / SH, w: nw, h: nh };

    // Exponential moving average – faster when confidence is low
    const alpha = this.detectionConfidence < 0.5 ? 0.35 : 0.12;
    this.detectedCrop = {
      x: lerp(this.detectedCrop.x, target.x, alpha),
      y: lerp(this.detectedCrop.y, target.y, alpha),
      w: lerp(this.detectedCrop.w, target.w, alpha),
      h: lerp(this.detectedCrop.h, target.h, alpha),
    };
    this.detectionConfidence = Math.min(1, this.detectionConfidence + 0.05);
  }

  // ── Draw helpers ───────────────────────────────────────────────────────────

  private drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const { x, y, w: cw, h: ch } = this.crop;
    const px = x * w, py = y * h, pw = cw * w, ph = ch * h;

    // Dim outside
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, w, py);
    ctx.fillRect(0, py + ph, w, h - py - ph);
    ctx.fillRect(0, py, px, ph);
    ctx.fillRect(px + pw, py, w - px - pw, ph);

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px, py, pw, ph);

    // Corner accents
    const L = Math.min(24, pw * 0.15, ph * 0.15);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    [
      { cx: px, cy: py, sx: 1, sy: 1 },
      { cx: px + pw, cy: py, sx: -1, sy: 1 },
      { cx: px + pw, cy: py + ph, sx: -1, sy: -1 },
      { cx: px, cy: py + ph, sx: 1, sy: -1 },
    ].forEach(({ cx, cy, sx, sy }) => {
      ctx.beginPath();
      ctx.moveTo(cx + sx * L, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * L);
      ctx.stroke();
    });

    // Drag handles (confirmation phase or manual mode)
    if (this.phase === 'confirming' || this.cropMode === 'manual') {
      this.drawHandles(ctx, px, py, pw, ph);
    }

    // Auto-detection confidence indicator (video phase, auto mode)
    if (this.phase === 'video' && this.cropMode === 'auto') {
      const barW = pw * this.detectionConfidence;
      ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.4 * this.detectionConfidence})`;
      ctx.fillRect(px, py + ph + 4, barW, 3);
    }
  }

  private drawHandles(
    ctx: CanvasRenderingContext2D,
    px: number, py: number, pw: number, ph: number,
  ) {
    this.handlePositions(px, py, pw, ph).forEach(({ x, y }) => {
      ctx.beginPath();
      ctx.arc(x, y, this.handleRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }

  private handlePositions(px: number, py: number, pw: number, ph: number) {
    return [
      { id: 'tl', x: px,        y: py },
      { id: 'tc', x: px + pw/2, y: py },
      { id: 'tr', x: px + pw,   y: py },
      { id: 'mr', x: px + pw,   y: py + ph/2 },
      { id: 'br', x: px + pw,   y: py + ph },
      { id: 'bc', x: px + pw/2, y: py + ph },
      { id: 'bl', x: px,        y: py + ph },
      { id: 'ml', x: px,        y: py + ph/2 },
    ];
  }

  // ── Capture ────────────────────────────────────────────────────────────────

  async capture() {
    if (this.isCapturing) return;
    this.isCapturing = true;

    try {
      let blob: Blob;

      if (this.imageCapture) {
        // High-resolution still via ImageCapture API
        try {
          blob = await this.imageCapture.takePhoto({ fillLightMode: 'auto' });
        } catch {
          blob = await this.fallbackCapture();
        }
      } else {
        blob = await this.fallbackCapture();
      }

      this.capturedBitmap = await createImageBitmap(blob);
      this.stopCamera();

      // Seed manual crop from the auto-detected crop
      if (this.cropMode === 'auto') {
        this.crop = { ...this.detectedCrop };
      }

      this.phase = 'confirming';
      this.isCapturing = false;
    } catch (e) {
      console.error('Capture failed', e);
      this.isCapturing = false;
    }
  }

  private async fallbackCapture(): Promise<Blob> {
    const video = this.videoEl.nativeElement;
    const cnv = document.createElement('canvas');
    cnv.width = video.videoWidth;
    cnv.height = video.videoHeight;
    cnv.getContext('2d')!.drawImage(video, 0, 0);
    return new Promise<Blob>((resolve, reject) =>
      cnv.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.95),
    );
  }

  switchToManual() {
    this.cropMode = 'manual';
  }

  retake() {
    this.capturedBitmap?.close();
    this.capturedBitmap = null;
    this.phase = 'video';
    this.cropMode = 'auto';
    this.detectionConfidence = 0;
    this.detectedCrop = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
    this.crop = { ...this.detectedCrop };
    this.startCamera();
  }

  confirmCrop() {
    if (!this.capturedBitmap) return;

    const { x, y, w: cw, h: ch } = this.crop;
    const bw = this.capturedBitmap.width;
    const bh = this.capturedBitmap.height;

    const cropX = Math.round(x * bw);
    const cropY = Math.round(y * bh);
    const cropW = Math.round(cw * bw);
    const cropH = Math.round(ch * bh);

    const cnv = document.createElement('canvas');
    cnv.width = cropW;
    cnv.height = cropH;
    cnv.getContext('2d')!.drawImage(this.capturedBitmap, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    cnv.toBlob(
      (blob) => {
        if (blob) this.imageCaptured.emit(blob);
      },
      'image/jpeg',
      0.95,
    );
  }

  cancel() {
    this.stopCamera();
    this.capturedBitmap?.close();
    this.cancelled.emit();
  }

  // ── Pointer / touch drag ───────────────────────────────────────────────────

  onPointerDown(event: PointerEvent) {
    if (this.phase !== 'confirming' && this.cropMode !== 'manual') return;
    const canvas = this.canvasEl.nativeElement;
    const { width: w, height: h } = canvas;
    const { x, y, w: cw, h: ch } = this.crop;
    const px = x * w, py = y * h, pw = cw * w, ph = ch * h;

    const cx = event.offsetX;
    const cy = event.offsetY;

    const hit = this.handlePositions(px, py, pw, ph).find(
      (hp) => Math.hypot(cx - hp.x, cy - hp.y) <= this.handleRadius + 4,
    );

    if (hit) {
      this.activeHandle = hit.id;
      this.pointerStart = { x: cx, y: cy };
      this.cropAtPointerStart = { ...this.crop };
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
  }

  onPointerMove(event: PointerEvent) {
    if (!this.activeHandle || !this.pointerStart || !this.cropAtPointerStart) return;
    const canvas = this.canvasEl.nativeElement;
    const { width: w, height: h } = canvas;

    const dx = (event.offsetX - this.pointerStart.x) / w;
    const dy = (event.offsetY - this.pointerStart.y) / h;
    const c = { ...this.cropAtPointerStart };

    switch (this.activeHandle) {
      case 'tl': c.x += dx; c.y += dy; c.w -= dx; c.h -= dy; break;
      case 'tc':             c.y += dy;              c.h -= dy; break;
      case 'tr':             c.y += dy; c.w += dx;   c.h -= dy; break;
      case 'mr':                         c.w += dx;              break;
      case 'br':                         c.w += dx;   c.h += dy; break;
      case 'bc':                                       c.h += dy; break;
      case 'bl': c.x += dx;             c.w -= dx;   c.h += dy; break;
      case 'ml': c.x += dx;             c.w -= dx;              break;
    }

    // Clamp
    c.x = Math.max(0, Math.min(c.x, 1 - MIN_CROP_SIZE));
    c.y = Math.max(0, Math.min(c.y, 1 - MIN_CROP_SIZE));
    c.w = Math.max(MIN_CROP_SIZE, Math.min(c.w, 1 - c.x));
    c.h = Math.max(MIN_CROP_SIZE, Math.min(c.h, 1 - c.y));

    this.crop = c;
    event.preventDefault();
  }

  onPointerUp(event: PointerEvent) {
    this.activeHandle = null;
    this.pointerStart = null;
    this.cropAtPointerStart = null;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
