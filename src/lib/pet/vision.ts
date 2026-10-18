// ============================================================================
// DRONE PET — Vision (the drone camera "eye")
// Wraps the webcam as a stand-in for the drone's forward camera and runs
// MediaPipe FaceLandmarker to produce a stable face track. On a real build,
// the same interface is fed by a Pi Camera v2/v3 stream instead.
// ============================================================================

import type { FaceLandmarker, HandLandmarker, ObjectDetector } from "@mediapipe/tasks-vision";
import type { Expression, ObjectDetection } from "./types";

/** One face in frame (multi-person aware). */
export interface FaceInfo {
  x: number;
  y: number;
  size: number;
  embedding: number[];
  expression: Expression | null;
}

export interface FaceTrack {
  seen: boolean;
  x: number;
  y: number;
  size: number;
  /**
   * Derived geometric face signature — distances between facial landmarks,
   * normalized by eye spacing. NOT an image; cannot be reversed into a photo.
   * Used for local recognition only.
   */
  embedding: number[];
  /** facial expression read (null while no face) */
  expression: Expression | null;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class DroneVision {
  private landmarker: FaceLandmarker | null = null;
  private detector: ObjectDetector | null = null;
  private handLandmarker: HandLandmarker | null = null;
  private gesturesOn = false;
  private wristHistory: { t: number; x: number; y: number }[] = [];
  private lastWaveAt = 0;
  private scannerOn = false;
  private lastScanAt = 0;
  private lastObjects: ObjectDetection[] = [];
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private sigCanvas: HTMLCanvasElement | null = null;
  private shapeCanvas: HTMLCanvasElement | null = null;
  private raf = 0;
  private last: FaceTrack = { seen: false, x: 0, y: 0, size: 0, embedding: [], expression: null };
  private lastFaces: FaceInfo[] = [];
  private running = false;
  private error: string | null = null;

  onTrack: (t: FaceTrack) => void = () => {};
  onFaces: (faces: FaceInfo[]) => void = () => {};
  onDetections: (d: ObjectDetection[]) => void = () => {};
  onWave: () => void = () => {};
  onGesture: (g: "thumbsUp" | "stop" | "point-left" | "point-right") => void = () => {};
  onError: (msg: string) => void = () => {};

  /** Items visible in the most recent scanner pass. */
  get objects(): ObjectDetection[] { return this.lastObjects; }
  get scanning() { return this.scannerOn; }

  /** All faces currently in frame, biggest (closest) first. */
  get faces(): FaceInfo[] { return this.lastFaces; }

  /** Load the object detector lazily and start scene scanning (~1 pass / 1.2s). */
  async enableScanner(): Promise<boolean> {
    if (this.scannerOn) return true;
    if (!this.detector) {
      try {
        const vision = await import("@mediapipe/tasks-vision");
        const fileset = await vision.FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm"
        );
        this.detector = await vision.ObjectDetector.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          scoreThreshold: 0.3, // catch weak sightings too (reported as "uncertain")
          maxResults: 12,      // see EVERYTHING in the picture, not just 5
        });
      } catch {
        this.onError("SCANNER MODEL FAILED — object learning unavailable");
        return false;
      }
    }
    this.scannerOn = true;
    return true;
  }

  disableScanner() {
    this.scannerOn = false;
    this.lastObjects = [];
  }

  get active() { return this.running; }
  get lastError() { return this.error; }

  /** Latest smoothed track (safe to read from the render loop). */
  get track(): FaceTrack { return this.last; }

  async start(video: HTMLVideoElement): Promise<void> {
    if (this.running) return;
    this.video = video;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
    } catch {
      this.error = "CAMERA DENIED — check browser permissions";
      this.onError(this.error);
      return;
    }
    video.srcObject = this.stream;
    await video.play().catch(() => {});

    try {
      const vision = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm"
      );
      this.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numFaces: 3, // multi-person awareness
        outputFaceBlendshapes: true, // expression understanding
      });
    } catch {
      this.error = "VISION MODEL FAILED — running blind (voice still works)";
      this.onError(this.error);
      // keep running: mic + speech still function without vision
      this.running = true;
      return;
    }

    this.running = true;
    this.error = null;
    const loop = () => {
      if (!this.running || !this.landmarker || !this.video) return;
      this.detect();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private detect() {
    const video = this.video;
    const lm = this.landmarker;
    if (!video || !lm || video.readyState < 2) return;
    const res = lm.detectForVideo(video, performance.now());
    const allFaces = (res.faceLandmarks ?? []).slice(0, 3);
    if (allFaces.length === 0) {
      this.last = { ...this.last, seen: false };
      this.lastFaces = [];
      this.onTrack(this.last);
      this.onFaces([]);
      this.checkForWave();
      this.scan();
      return;
    }

    // per-face: box, embedding, expression — smoothed against the previous
    // frame's nearest face so identities do not jitter between slots
    const faces: FaceInfo[] = allFaces.map((face, faceIdx) => {
      let minX = 1, minY = 1, maxX = 0, maxY = 0;
      for (const pt of face) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
      const box: Box = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
      let prev: FaceInfo | null = null;
      let bestD = 0.35;
      for (const pf of this.lastFaces) {
        const d = Math.hypot(pf.x - (box.x * 2 - 1), pf.y - (box.y * 2 - 1));
        if (d < bestD) { bestD = d; prev = pf; }
      }
      const s = 0.35;
      const smooth = (fallback: number, target: number) => (prev ? prev.x === fallback && false ? target : fallback + (target - fallback) * s : target);
      const x = prev ? prev.x + (box.x * 2 - 1 - prev.x) * s : box.x * 2 - 1;
      const y = prev ? prev.y + (box.y * 2 - 1 - prev.y) * s : box.y * 2 - 1;
      const size = prev ? prev.size + (box.w - prev.size) * s : box.w;
      void smooth;
      const expression = this.readExpression(res.faceBlendshapes?.[faceIdx]?.categories ?? []);
      const fi: FaceInfo = {
        x, y, size,
        embedding: computeFaceEmbedding(face),
        expression: prev?.expression
          ? {
              smile: prev.expression.smile + (expression.smile - prev.expression.smile) * 0.3,
              frown: prev.expression.frown + (expression.frown - prev.expression.frown) * 0.3,
              eyesClosed: prev.expression.eyesClosed + (expression.eyesClosed - prev.expression.eyesClosed) * 0.3,
              browRaise: prev.expression.browRaise + (expression.browRaise - prev.expression.browRaise) * 0.3,
            }
          : expression,
      };
      return fi;
    });
    faces.sort((a, b) => b.size - a.size); // the closest person leads
    this.lastFaces = faces;
    const p = faces[0];
    this.last = { seen: true, x: p.x, y: p.y, size: p.size, embedding: p.embedding, expression: p.expression };
    this.onTrack(this.last);
    this.onFaces(faces);
    this.checkForWave();
    this.scan();
  }

  /** Periodic object pass — the drone "looks around" and learns items. */
  scanIntervalMs = 1200; // tightened to 500 while actively scanning
  private scan() {
    if (!this.scannerOn || !this.detector || !this.video) return;
    const now = performance.now();
    if (now - this.lastScanAt < this.scanIntervalMs) return;
    this.lastScanAt = now;
    const vw = this.video.videoWidth || 640;
    const vh = this.video.videoHeight || 480;
    try {
      const res = this.detector.detectForVideo(this.video, now);
      this.lastObjects = (res.detections ?? []).flatMap((d) => {
        const bb = d.boundingBox;
        if (!bb) return [];
        const cat = d.categories?.[0];
        return [{
          label: cat?.categoryName ?? "object",
          score: cat?.score ?? 0,
          certain: (cat?.score ?? 0) >= 0.5,
          x: bb.originX / vw,
          y: bb.originY / vh,
          w: bb.width / vw,
          h: bb.height / vh,
          sig: this.colorSig({ x: bb.originX / vw, y: bb.originY / vh, w: bb.width / vw, h: bb.height / vh }),
          shape: this.shapeSig({ x: bb.originX / vw, y: bb.originY / vh, w: bb.width / vw, h: bb.height / vh }),
        }];
      });
      this.onDetections(this.lastObjects);
    } catch {
      /* a failed scan pass is harmless; next pass retries */
    }
  }

  /**
   * Shape identity of a detected region: mini-HOG — gradient orientation
   * histograms over a 2x2 cell grid (8 orientations each = 32 dims), L2-
   * normalized. Captures contour character: round vs angular vs elongated.
   * Non-reversible to pixels — privacy-safe.
   */
  private shapeSig(bb: { x: number; y: number; w: number; h: number }): number[] {
    const video = this.video;
    if (!video || !video.videoWidth) return [];
    if (!this.shapeCanvas) {
      this.shapeCanvas = document.createElement("canvas");
      this.shapeCanvas.width = 16;
      this.shapeCanvas.height = 16;
    }
    const ctx = this.shapeCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];
    try {
      ctx.drawImage(
        video,
        bb.x * video.videoWidth, bb.y * video.videoHeight,
        Math.max(4, bb.w * video.videoWidth), Math.max(4, bb.h * video.videoHeight),
        0, 0, 16, 16,
      );
    } catch {
      return [];
    }
    const data = ctx.getImageData(0, 0, 16, 16).data;
    const gray = new Float32Array(256);
    for (let i = 0; i < 256; i++) gray[i] = (data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11) / 255;

    const bins = new Float32Array(32); // 2x2 cells × 8 orientation bins
    for (let y = 1; y < 15; y++) {
      for (let x = 1; x < 15; x++) {
        const gx = gray[y * 16 + x + 1] - gray[y * 16 + x - 1];
        const gy = gray[(y + 1) * 16 + x] - gray[(y - 1) * 16 + x];
        const mag = Math.hypot(gx, gy);
        if (mag < 0.02) continue;
        let ang = Math.atan2(gy, gx);          // -π..π
        if (ang < 0) ang += Math.PI;           // unsigned: 0..π
        const bin = Math.min(7, Math.floor((ang / Math.PI) * 8));
        const cell = (y < 8 ? 0 : 2) + (x < 8 ? 0 : 1);
        bins[cell * 8 + bin] += mag;
      }
    }
    // L2 normalize each cell so lighting/exposure does not dominate
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let b = 0; b < 8; b++) s += bins[c * 8 + b] * bins[c * 8 + b];
      const nrm = Math.sqrt(s) || 1;
      for (let b = 0; b < 8; b++) bins[c * 8 + b] /= nrm;
    }
    return Array.from(bins);
  }

  /**
   * Color identity of a detected region: 2x2 quadrant mean colors, converted
   * to brightness-invariant ratios. Small, private, non-reversible to pixels —
   * this is what lets her tell two cups (or two cats) apart.
   */
  private colorSig(bb: { x: number; y: number; w: number; h: number }): number[] {
    const video = this.video;
    if (!video || !video.videoWidth) return [];
    if (!this.sigCanvas) {
      this.sigCanvas = document.createElement("canvas");
      this.sigCanvas.width = 8;
      this.sigCanvas.height = 8;
    }
    const ctx = this.sigCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];
    try {
      ctx.drawImage(
        video,
        bb.x * video.videoWidth, bb.y * video.videoHeight,
        Math.max(4, bb.w * video.videoWidth), Math.max(4, bb.h * video.videoHeight),
        0, 0, 8, 8,
      );
    } catch {
      return [];
    }
    const data = ctx.getImageData(0, 0, 8, 8).data;
    const sig: number[] = [];
    for (let q = 0; q < 4; q++) {
      const qx = (q % 2) * 4, qy = Math.floor(q / 2) * 4;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < 16; i++) {
        const px = ((qy + (i >> 2)) * 8 + (qx + (i % 2))) * 4;
        r += data[px]; g += data[px + 1]; b += data[px + 2];
      }
      sig.push(r / 16, g / 16, b / 16);
    }
    for (let i = 0; i < sig.length; i += 3) {
      const m = (sig[i] + sig[i + 1] + sig[i + 2]) / 3 || 1; // brightness-invariant
      sig[i] /= m; sig[i + 1] /= m; sig[i + 2] /= m;
    }
    return sig;
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.sigCanvas = null;
    if (this.video) this.video.srcObject = null;
    this.last = { seen: false, x: 0, y: 0, size: 0, embedding: [], expression: null };
  }

  /** Parse blendshape categories into the four expression channels. */
  private readExpression(cats: { categoryName?: string; score: number }[]): Expression {
    const get = (n: string) => cats.find((c) => c.categoryName === n)?.score ?? 0;
    return {
      smile: (get("mouthSmileLeft") + get("mouthSmileRight")) / 2,
      frown: (get("mouthFrownLeft") + get("mouthFrownRight")) / 2,
      eyesClosed: (get("eyeBlinkLeft") + get("eyeBlinkRight")) / 2,
      browRaise: get("browInnerUp"),
    };
  }

  /** Load the hand model on demand and watch for a waving hand. */
  async enableGestures(): Promise<boolean> {
    if (this.gesturesOn) return true;
    try {
      const vision = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm"
      );
      this.handLandmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 1,
      });
      this.gesturesOn = true;
      return true;
    } catch {
      this.onError("GESTURE MODEL FAILED — wave detection unavailable");
      return false;
    }
  }

  disableGestures() {
    this.gesturesOn = false;
    this.handLandmarker?.close();
    this.handLandmarker = null;
    this.wristHistory = [];
  }

  get gestures() { return this.gesturesOn; }

  /** Wave + static gestures (thumbs-up / open palm / pointing). */
  private checkForWave() {
    if (!this.gesturesOn || !this.handLandmarker || !this.video) return;
    const res = this.handLandmarker.detectForVideo(this.video, performance.now());
    const handLm = res.landmarks?.[0];
    if (!handLm) { this.wristHistory = []; return; }
    const hand = handLm[0]; // wrist
    const now = performance.now();
    this.wristHistory.push({ t: now, x: hand.x, y: hand.y });

    // --- static gesture classification (finger extension pattern) --------------
    const fromWrist = (i: number) => Math.hypot(handLm[i].x - hand.x, handLm[i].y - hand.y, (handLm[i].z ?? 0) - (hand.z ?? 0));
    const extended = (tip: number, pip: number) => fromWrist(tip) > fromWrist(pip) * 1.08;
    const thumb = extended(4, 2);
    const index = extended(8, 6);
    const fingersUp = [8, 12, 16, 20].filter((tip, i) => extended(tip, [6, 10, 14, 18][i])).length;
    let g: "thumbsUp" | "stop" | "point-left" | "point-right" | null = null;
    if (thumb && fingersUp === 0 && handLm[4].y < hand.y - 0.04) g = "thumbsUp";
    else if (fingersUp >= 3 && thumb) g = "stop";
    else if (index && fingersUp === 0) {
      const dx = handLm[8].x - hand.x;
      if (dx > 0.06) g = "point-right";
      else if (dx < -0.06) g = "point-left";
    }
    if (g) this.onGesture(g);
    this.wristHistory = this.wristHistory.filter((p) => now - p.t < 1400);
    if (this.wristHistory.length < 6 || now - this.lastWaveAt < 6000) return;
    let crossings = 0;
    let prevDir = 0;
    for (let i = 1; i < this.wristHistory.length; i++) {
      const dx = this.wristHistory[i].x - this.wristHistory[i - 1].x;
      if (Math.abs(dx) < 0.008) continue;
      const dir = Math.sign(dx);
      if (prevDir !== 0 && dir !== prevDir) crossings++;
      prevDir = dir;
    }
    const raised = this.wristHistory[this.wristHistory.length - 1].y < 0.55;
    if (crossings >= 3 && raised) {
      this.lastWaveAt = now;
      this.wristHistory = [];
      this.onWave();
    }
  }

  /**
   * Full sensor-suite overlay: HUD corner brackets, label pills with
   * confidence bars, distance estimates, radar sweep while scanning,
   * and a live tally — everything she perceives, made visible.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, led: string, label?: string, scanning?: boolean) {
    ctx.clearRect(0, 0, w, h);

    // faint reference grid
    ctx.strokeStyle = "rgba(240,185,11,0.12)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo((w / 4) * i, 0); ctx.lineTo((w / 4) * i, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (h / 4) * i); ctx.lineTo(w, (h / 4) * i); ctx.stroke();
    }

    // radar sweep line while she is actively scanning
    if (scanning) {
      const sweepX = ((performance.now() / 2200) % 1) * w;
      const grad = ctx.createLinearGradient(sweepX - 60, 0, sweepX + 8, 0);
      grad.addColorStop(0, "rgba(240,185,11,0)");
      grad.addColorStop(1, "rgba(240,185,11,0.28)");
      ctx.fillStyle = grad;
      ctx.fillRect(Math.max(0, sweepX - 60), 0, 68, h);
      ctx.strokeStyle = "rgba(240,185,11,0.65)";
      ctx.beginPath(); ctx.moveTo(sweepX, 0); ctx.lineTo(sweepX, h); ctx.stroke();
    }

    // HUD corner brackets (much more readable than full rectangles)
    const brackets = (x: number, y: number, bw: number, bh: number, color: string, lw: number) => {
      const len = Math.max(7, Math.min(bw, bh) * 0.22);
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
      ctx.moveTo(x + bw - len, y); ctx.lineTo(x + bw, y); ctx.lineTo(x + bw, y + len);
      ctx.moveTo(x + bw, y + bh - len); ctx.lineTo(x + bw, y + bh); ctx.lineTo(x + bw - len, y + bh);
      ctx.moveTo(x + len, y + bh); ctx.lineTo(x, y + bh); ctx.lineTo(x, y + bh - len);
      ctx.stroke();
    };

    // label pill with confidence bar
    const pill = (x: number, y: number, text: string, color: string, conf?: number) => {
      ctx.font = "9px monospace";
      const tw = ctx.measureText(text).width;
      const pw = tw + 12 + (conf !== undefined ? 26 : 0);
      ctx.fillStyle = "rgba(8,10,16,0.78)";
      ctx.beginPath();
      ctx.roundRect(x, y, pw, 14, 3);
      ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(text, x + 6, y + 10);
      if (conf !== undefined) {
        ctx.fillStyle = "rgba(255,255,255,0.15)";
        ctx.fillRect(x + tw + 10, y + 5, 22, 4);
        ctx.fillRect(x + tw + 10, y + 5, 22 * Math.min(1, conf), 4);
      }
    };

    // faces: primary = LED lock, others = cyan observers
    this.lastFaces.forEach((f, idx) => {
      const cx = (f.x + 1) / 2 * w;
      const cy = (f.y + 1) / 2 * h;
      const bw = Math.max(30, f.size * w);
      const bh = bw * 1.15;
      const bx = cx - bw / 2, by = cy - bh / 2;
      const isPrimary = idx === 0;
      brackets(bx, by, bw, bh, isPrimary ? led : "rgba(90,200,250,0.9)", isPrimary ? 2.2 : 1.4);
      const tag = isPrimary
        ? (label ? `${label}` : `LOCK`)
        : `PERSON ${idx + 1}`;
      pill(bx, Math.max(2, by - 17), tag, isPrimary ? led : "rgba(140,215,255,0.95)");
    });

    // objects: cyan brackets = certain, amber dashed = uncertain guesses
    for (const o of this.lastObjects) {
      const ox = o.x * w, oy = o.y * h, ow = Math.max(10, o.w * w), oh = Math.max(10, o.h * h);
      const distM = 0.55 / Math.max(0.06, o.h); // rough distance from apparent size
      if (o.certain) {
        brackets(ox, oy, ow, oh, "rgba(90,200,250,0.95)", 1.4);
        pill(ox, Math.max(2, oy - 17), `${o.label} ~${distM.toFixed(1)}m`, "rgba(140,215,255,0.95)", o.score);
      } else {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = "rgba(255,159,67,0.7)";
        ctx.lineWidth = 1;
        ctx.strokeRect(ox, oy, ow, oh);
        ctx.setLineDash([]);
        pill(ox, Math.max(2, oy - 17), `${o.label}?`, "rgba(255,190,120,0.95)", o.score);
      }
    }

    // live tally — everything she currently perceives, at a glance
    const tally = `FACES ${this.lastFaces.length} · ITEMS ${this.lastObjects.length}${scanning ? " · SCANNING" : ""}`;
    ctx.font = "10px monospace";
    const tw2 = ctx.measureText(tally).width;
    ctx.fillStyle = "rgba(8,10,16,0.7)";
    ctx.fillRect(6, 6, tw2 + 14, 17);
    ctx.strokeStyle = "rgba(240,185,11,0.4)";
    ctx.strokeRect(6, 6, tw2 + 14, 17);
    ctx.fillStyle = "rgba(240,185,11,0.95)";
    ctx.fillText(tally, 13, 18);

    if (!this.last.seen && this.lastFaces.length === 0) {
      ctx.fillStyle = "rgba(200,204,214,0.75)";
      ctx.font = "10px monospace";
      ctx.fillText("NO TARGET", 8, h - 10);
    }
  }
}

// ---- color identity (objects) ----------------------------------------------
// (the colorSig method lives inside DroneVision below)

// ---- face signature ---------------------------------------------------------

/** MediaPipe canonical face landmark indices: eyes, nose, mouth, chin, brows. */
const KEY_POINTS = [33, 133, 362, 263, 1, 4, 61, 291, 152, 10, 168, 13, 205, 425, 70, 300];

/**
 * Geometric face signature: pairwise distances between key landmarks,
 * normalized by inter-eye distance. Contains no pixels — it cannot be
 * turned back into a face image, which keeps stored memory privacy-safe.
 */
function computeFaceEmbedding(face: { x: number; y: number }[]): number[] {
  const le = face[33], re = face[263];
  if (!le || !re) return [];
  const eyeDist = Math.hypot(le.x - re.x, le.y - re.y) || 1e-6;
  const pts = KEY_POINTS.map((i) => face[i]);
  if (pts.some((p) => !p)) return [];
  const out: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      out.push(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) / eyeDist);
    }
  }
  return out;
}
