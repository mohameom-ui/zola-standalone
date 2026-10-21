// ADVANCED SENSORS — the unified Eye + Ear facade (v3.3)
// ONE Eye: object recognition + face/emotion reading + text reading (OCR
// via her VLM) — all through one camera, all feeding ONE recognition
// library that grows with every scan.
// ONE Ear: speech + sound-level tracking — one mic, one pipeline.
//
// Wraps the existing DroneVision / DeepEyes / LocalEars modules (they stay
// the engines); this facade adds the emotion classification, the
// library-confidence adaptation, and the reading-aloud path.
//
// The hardware destiny: every reading here maps 1:1 to the physical
// sensors on her real frame (Pi Camera 3 wide → the same pipeline runs on
// the Pi; the USB mini mic → the same ear).

import type { FaceTrack } from "./vision";

// the emotion classification — from the MediaPipe blendshape readings
export interface EmotionReading {
  emotion: "happy" | "focused" | "stressed" | "surprised" | "neutral";
  confidence: number;      // 0..1
  stress: number;          // 0..1 (her existing composite)
  detail: {
    smile: number;
    browRaise: number;
    browDown: number;
    eyeSquint: number;
    jawClench: number;
  };
}

interface BlendCategories {
  categoryName: string;
  score: number;
}

/**
 * The emotion classifier — maps her face tracker's blendshape readings to
 * a named emotion. Pure function: fully testable, no dependencies.
 *
 * The mapping (from her own measured composites):
 *   smile high + browRaise moderate        → happy
 *   browDown + eyeSquint + jawClench high  → stressed (her stress composite)
 *   browRaise high + eyes wide, no smile   → surprised
 *   everything low                          → neutral/focused
 */
export function classifyEmotion(
  get: (name: string) => number,
): EmotionReading {
  const smile = get("mouthSmileLeft") + get("mouthSmileRight");
  const browRaise = get("browOuterUpLeft") + get("browOuterUpRight");
  const browDown = get("browDownLeft") + get("browDownRight");
  const eyeSquint = get("eyeSquintLeft") + get("eyeSquintRight");
  const jawClench = get("jawOpen") > 0.3 ? 0 : get("mouthPressLeft") + get("mouthPressRight");

  const stress = Math.min(1, (browDown + eyeSquint * 0.5 + jawClench) / 3);
  const happyScore = Math.min(1, smile / 1.2);
  const surpriseScore = Math.min(1, browRaise / 1.5) * (1 - smile);

  let emotion: EmotionReading["emotion"] = "neutral";
  let confidence = 0.3;

  if (happyScore > 0.45 && happyScore > stress && happyScore > surpriseScore) {
    emotion = "happy";
    confidence = Math.min(0.95, 0.5 + happyScore * 0.5);
  } else if (stress > 0.55 && stress > surpriseScore) {
    emotion = "stressed";
    confidence = Math.min(0.9, 0.4 + stress * 0.5);
  } else if (surpriseScore > 0.5) {
    emotion = "surprised";
    confidence = Math.min(0.85, 0.4 + surpriseScore * 0.4);
  } else if (eyeSquint > 0.4 && happyScore < 0.3) {
    emotion = "focused";
    confidence = Math.min(0.8, 0.35 + eyeSquint * 0.3);
  }

  return {
    emotion,
    confidence,
    stress: Math.round(stress * 100) / 100,
    detail: { smile, browRaise, browDown, eyeSquint, jawClench },
  };
}

/** Extract the emotion reading from her existing FaceTrack expression. */
export function emotionFromTrack(track: FaceTrack): EmotionReading | null {
  if (!track.seen || !track.expression) return null;
  const e = track.expression;
  return classifyEmotion((name) => {
    switch (name) {
      case "mouthSmileLeft":
      case "mouthSmileRight": return (e as unknown as Record<string, number>)[name] ?? (e as unknown as Record<string, number>)["smile"] ?? 0;
      case "browOuterUpLeft":
      case "browOuterUpRight": return (e as unknown as Record<string, number>)["browRaise"] ?? 0;
      case "browDownLeft":
      case "browDownRight": return (e as unknown as Record<string, number>)["browDown"] ?? 0;
      case "eyeSquintLeft":
      case "eyeSquintRight": return (e as unknown as Record<string, number>)["eyeSquint"] ?? 0;
      case "mouthPressLeft":
      case "mouthPressRight": return (e as unknown as Record<string, number>)["jawClench"] ?? 0;
      case "jawOpen": return (e as unknown as Record<string, number>)["jawOpen"] ?? 0;
      default: return 0;
    }
  });
}

/**
 * The recognition-library adaptation — she recognizes FASTER the more she
 * sees something. Given a detection confidence and the item's sighting
 * count, returns the effective confidence (familiar items get boosted).
 */
export function adaptConfidence(rawConfidence: number, sightings: number): number {
  // every sighting adds ~3% effective confidence, capped at +0.25
  const boost = Math.min(0.25, sightings * 0.03);
  return Math.min(1, rawConfidence + boost);
}
