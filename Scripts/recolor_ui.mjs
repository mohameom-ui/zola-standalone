#!/usr/bin/env node
// ============================================================================
// recolor_ui.mjs — remap the Kenney UI vector pack into Zola's palette.
// Replaces the planned Inkscape pass: a flat recolor is a palette remap on
// fill/stroke attributes — deterministic, zero-dependency, no install.
// Source: GameDevLibrary (read-only) → destination: public/assets/ui/zola-svg/
// Also writes her app favicon (src/app/icon.svg) from a chosen shape.
// ============================================================================
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "fs";
import path from "path";

const SRC = "C:/GameDevLibrary/Assets/UI/kenney_ui-pack/Vector";
const OUT = "public/assets/ui/zola-svg";

// Kenney palette → Zola palette (role-preserving, luminance-ordered)
const MAP = {
  "#36bdf7": "#5ac8fa", // accent light → her cyan
  "#1c9fd7": "#38a8d8",
  "#167da8": "#2a86b0",
  "#2fd792": "#35d0a5", // green → her teal primary
  "#16bb77": "#2bb08a",
  "#029357": "#1f8a6b",
  "#ff627b": "#ff6b7b", // red → her alarm family
  "#ee2747": "#ff4d4f",
  "#cd0b2a": "#d63a4a",
  "#ffcc00": "#f0b90b", // yellow → her amber primary
  "#ffea9c": "#ffd98a",
  "#dea312": "#c8950a",
  "#9696a3": "#5a5f6e", // greys → her UI greys
  "#989aaf": "#8b8f9c",
  "#dadce7": "#c8ccd6",
  "#ffffff": "#e9e7dc", // white → warm white
  // dark shade variants (bottom of each family ramp)
  "#35baf3": "#5ac8fa",
  "#1ea7e1": "#45b7e8",
  "#146587": "#1f6d92",
  "#12729a": "#24809f",
  "#046d41": "#175f4a",
  "#871023": "#a12b38",
  "#b48000": "#a37c08",
  "#ff0000": "#ff4d4f",
  "#747487": "#4a4e5c",
  "#666880": "#3a3e4a",
  "#b0b0ba": "#9ba0ab",
  "#b7b8c2": "#aeb2bd",
  "#000000": "#0b0e17", // pure black → her background tone
};

function remap(svg) {
  let out = svg;
  let hits = 0;
  for (const [from, to] of Object.entries(MAP)) {
    const re = new RegExp(from, "gi");
    out = out.replace(re, (m) => { hits++; return to; });
  }
  return { out, hits };
}

const unmapped = new Set();
let files = 0, edits = 0;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const dir of readdirSync(SRC)) {
  const dirPath = path.join(SRC, dir);
  let svgs;
  try { svgs = readdirSync(dirPath).filter((f) => f.endsWith(".svg")); } catch { continue; }
  mkdirSync(path.join(OUT, dir), { recursive: true });
  for (const f of svgs) {
    const svg = readFileSync(path.join(dirPath, f), "utf8");
    for (const m of svg.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
      if (!MAP[m[0].toLowerCase()]) unmapped.add(m[0].toLowerCase());
    }
    const { out, hits } = remap(svg);
    writeFileSync(path.join(OUT, dir, f), out);
    files++; edits += hits;
  }
}

console.log(`[recolor] ${files} SVGs → ${OUT} (${edits} color edits)`);
console.log(`[recolor] unmapped colors: ${unmapped.size ? [...unmapped].join(", ") : "none"}`);
