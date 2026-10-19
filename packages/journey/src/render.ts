// THE PICTURE. Canvas 2D, drawn fresh every frame from the trail and the rider's state. Nothing in
// here decides anything: selection, answers and arrival all live in the ride component, and the
// renderer only shows them. Wattle's ten hues throughout — the valley is gold, green, violet and
// ochre on purpose.
//
// Everything is in metres until the last moment, so the scene scales to any canvas.

import { preference, type PreferenceKey } from "./preferences";
import type { RiderState } from "./physics";
import { CLEARING, DECK_END, FOG, LENGTH, SIGNPOSTS, TUNNEL, heightAt, slopeAt, type FogBank } from "./trail";

const HUE = {
  black: "#000000",
  white: "#ffffff",
  wattle: "#ffc400",
  bloom: "#ffe14d",
  eucalypt: "#00a878",
  lorikeet: "#2e9be0",
  jacaranda: "#6a4ba8",
  ochre: "#cbbfa6",
  blossom: "#ff9fc4",
} as const;

export interface Scene {
  readonly rider: RiderState;
  /** Preferences chosen: their fog is gone and their lantern is lit. */
  readonly chosen: ReadonlySet<PreferenceKey>;
  /** Signposts answered either way: the rider will not stop there again. */
  readonly answered: ReadonlySet<PreferenceKey>;
  readonly fog: FogBank | null;
  /** How many invented clinicians currently fit: the clearing shows one cabin each. */
  readonly fitCount: number;
  /** Seconds since the ride began, for the idle bob. Zero under reduced motion. */
  readonly t: number;
  readonly moving: boolean;
}

export interface Camera {
  x: number;
  y: number;
}

/** Where the camera wants to be: rider a third of the way in, ground a little below centre, looking ahead with speed. */
export function cameraTarget(rider: RiderState): Camera {
  return { x: rider.s + 6 + rider.v * 0.8, y: heightAt(rider.s) };
}

export function settleCamera(cam: Camera, target: Camera, dt: number): Camera {
  const k = 1 - Math.exp(-dt * 3.2);
  return { x: cam.x + (target.x - cam.x) * k, y: cam.y + (target.y - cam.y) * k };
}

interface View {
  readonly w: number;
  readonly h: number;
  /** Pixels per metre. */
  readonly ppm: number;
  readonly cam: Camera;
}

function makeView(w: number, h: number, cam: Camera): View {
  // Enough trail on screen to see the next signpost coming, never so much the rider is a speck.
  const ppm = Math.max(4.2, Math.min(9, w / 95));
  return { w, h, ppm, cam };
}

function sx(v: View, s: number): number {
  return (s - v.cam.x) * v.ppm + v.w * 0.36;
}
function sy(v: View, h: number): number {
  return v.h * 0.66 - (h - v.cam.y) * v.ppm;
}

export function draw(ctx: CanvasRenderingContext2D, w: number, h: number, cam: Camera, scene: Scene): void {
  const v = makeView(w, h, cam);
  ctx.clearRect(0, 0, w, h);
  sky(ctx, v, scene);
  farHills(ctx, v);
  midHills(ctx, v);
  ground(ctx, v);
  deck(ctx, v);
  clearing(ctx, v, scene);
  // The board stands a few metres past where the rider settles, so the two never overlap.
  for (const sp of SIGNPOSTS) signpost(ctx, v, sp.key, sp.s + 9, scene);
  for (const f of FOG) if (!scene.chosen.has(f.clearedBy)) fog(ctx, v, f, scene.t);
  rider(ctx, v, scene);
  tunnel(ctx, v);
}

function sky(ctx: CanvasRenderingContext2D, v: View, scene: Scene): void {
  const g = ctx.createLinearGradient(0, 0, 0, v.h);
  g.addColorStop(0, "#9fd3f2");
  g.addColorStop(0.55, "#dff0fa");
  g.addColorStop(1, "#fff3c4");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, v.w, v.h);
  // The sun sits still. Nothing in the sky ever flashes or pulses.
  const sunX = v.w * 0.78 - (v.cam.x / LENGTH) * v.w * 0.25;
  const sunY = v.h * 0.16;
  ctx.fillStyle = HUE.wattle;
  ctx.beginPath();
  ctx.arc(sunX, sunY, Math.max(18, v.ppm * 5), 0, Math.PI * 2);
  ctx.fill();
  if (scene.fog) {
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(0, 0, v.w, v.h);
  }
}

function ridge(ctx: CanvasRenderingContext2D, v: View, parallax: number, base: number, amp: number, period: number, colour: string, seed: number): void {
  const offset = v.cam.x * parallax;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(0, v.h);
  for (let x = 0; x <= v.w + 20; x += 20) {
    const m = (x + offset * v.ppm) / (v.ppm * period);
    const y = v.h * base - (Math.sin(m + seed) * 0.6 + Math.sin(m * 2.3 + seed * 1.7) * 0.25 + Math.sin(m * 0.5) * 0.4) * amp;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(v.w + 20, v.h);
  ctx.closePath();
  ctx.fill();
}

function farHills(ctx: CanvasRenderingContext2D, v: View): void {
  ridge(ctx, v, 0.12, 0.42, v.h * 0.16, 90, "#b9a9db", 1.3);
  ridge(ctx, v, 0.2, 0.5, v.h * 0.12, 60, HUE.jacaranda, 4.1);
}

function midHills(ctx: CanvasRenderingContext2D, v: View): void {
  ridge(ctx, v, 0.45, 0.62, v.h * 0.1, 40, "#7fcbb0", 2.2);
  ridge(ctx, v, 0.6, 0.7, v.h * 0.08, 28, HUE.eucalypt, 7.7);
  // Trees: a row of simple triangles on the nearer ridge, spaced by the metre so they scroll with it.
  const offset = v.cam.x * 0.6;
  ctx.fillStyle = "#007a58";
  for (let x = -40; x < v.w + 40; x += 34) {
    const m = (x + offset * v.ppm) / (v.ppm * 28);
    const y = v.h * 0.7 - (Math.sin(m + 7.7) * 0.6 + Math.sin(m * 2.3 + 13.1) * 0.25 + Math.sin(m * 0.5) * 0.4) * v.h * 0.08;
    const k = ((x + offset * v.ppm) * 0.37) % 7;
    const th = 14 + (k < 0 ? -k : k) * 2;
    ctx.beginPath();
    ctx.moveTo(x, y - th);
    ctx.lineTo(x - th * 0.45, y + 2);
    ctx.lineTo(x + th * 0.45, y + 2);
    ctx.closePath();
    ctx.fill();
  }
}

/** The trail surface and the earth under it, from the left edge of the screen to the right. */
function ground(ctx: CanvasRenderingContext2D, v: View): void {
  const from = Math.max(0, v.cam.x - v.w / v.ppm);
  const to = Math.min(LENGTH, v.cam.x + v.w / v.ppm);
  ctx.beginPath();
  ctx.moveTo(sx(v, from), v.h + 10);
  for (let s = from; s <= to; s += 2) ctx.lineTo(sx(v, s), sy(v, heightAt(s)));
  ctx.lineTo(sx(v, to), v.h + 10);
  ctx.closePath();
  ctx.fillStyle = "#e9e0c9";
  ctx.fill();
  ctx.beginPath();
  for (let s = from; s <= to; s += 2) {
    const x = sx(v, s);
    const y = sy(v, heightAt(s));
    if (s === from) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineWidth = Math.max(4, v.ppm * 1.1);
  ctx.strokeStyle = HUE.ochre;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#a89b80";
  ctx.stroke();
  // The shoulder under the trail, and golden wattle in bloom along it: a clump every twenty-odd
  // metres, placed by the metre so it scrolls with the ground and never pops.
  ctx.fillStyle = "#d9cfae";
  ctx.beginPath();
  for (let s = from; s <= to; s += 2) {
    const x = sx(v, s);
    const y = sy(v, heightAt(s)) + v.ppm * 2.2;
    if (s === from) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineTo(sx(v, to), v.h + 10);
  ctx.lineTo(sx(v, from), v.h + 10);
  ctx.closePath();
  ctx.fill();
  for (let s = Math.ceil(from / 23) * 23; s <= to; s += 23) {
    if (s < DECK_END + 10 || (s > TUNNEL.from - 8 && s < TUNNEL.to + 8)) continue;
    const x = sx(v, s + ((s * 7) % 11));
    const y = sy(v, heightAt(s)) + v.ppm * (3.5 + ((s * 3) % 5));
    const r = Math.max(3, v.ppm * (0.9 + ((s * 5) % 3) * 0.3));
    ctx.fillStyle = "#4d8f5a";
    ctx.beginPath();
    ctx.ellipse(x, y, r * 2.4, r * 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = HUE.wattle;
    for (const [dx, dy] of [[-1.4, -0.5], [-0.3, -1.0], [0.9, -0.6], [1.7, -0.1], [0.2, 0.1]] as const) {
      ctx.beginPath();
      ctx.arc(x + dx * r, y + dy * r, r * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function deck(ctx: CanvasRenderingContext2D, v: View): void {
  const x0 = sx(v, -14);
  const x1 = sx(v, DECK_END);
  if (x1 < -10) return;
  const y = sy(v, heightAt(0));
  ctx.fillStyle = "#9c7b4e";
  ctx.fillRect(x0, y - v.ppm * 0.6, x1 - x0, v.ppm * 1.6);
  ctx.fillStyle = "#6f5433";
  for (let x = x0; x < x1; x += v.ppm * 2.4) ctx.fillRect(x, y - v.ppm * 0.6, 2, v.ppm * 1.6);
  // Legs down into the mountain.
  for (const s of [-10, 0, 12]) {
    const x = sx(v, s);
    ctx.fillRect(x - 2, y + v.ppm, 4, v.h);
  }
}

function tunnel(ctx: CanvasRenderingContext2D, v: View): void {
  const x0 = sx(v, TUNNEL.from);
  const x1 = sx(v, TUNNEL.to);
  if (x1 < 0 || x0 > v.w) return;
  // The mountain mass in front of the rider: a soft rock colour with an arch cut out, so the rider
  // passes behind it in the dark with a string of lanterns overhead.
  const yTop = Math.min(sy(v, heightAt(TUNNEL.from)), sy(v, heightAt(TUNNEL.to))) - v.ppm * 11;
  ctx.fillStyle = "rgba(90, 76, 110, 0.85)";
  ctx.beginPath();
  ctx.moveTo(x0 - v.ppm * 6, v.h);
  ctx.lineTo(x0 - v.ppm * 6, yTop + v.ppm * 3);
  ctx.quadraticCurveTo((x0 + x1) / 2, yTop - v.ppm * 4, x1 + v.ppm * 6, yTop + v.ppm * 3);
  ctx.lineTo(x1 + v.ppm * 6, v.h);
  ctx.closePath();
  // Cut the arch out so the trail, rider and lanterns show through.
  const arch = new Path2D();
  for (let s = TUNNEL.from; s <= TUNNEL.to; s += 2) {
    const x = sx(v, s);
    const y = sy(v, heightAt(s)) - v.ppm * 6.5;
    if (s === TUNNEL.from) arch.moveTo(x, y + v.ppm * 20);
    arch.lineTo(x, y);
  }
  arch.lineTo(sx(v, TUNNEL.to), v.h);
  arch.lineTo(sx(v, TUNNEL.from), v.h);
  arch.closePath();
  ctx.save();
  ctx.clip(arch);
  ctx.fillStyle = "rgba(20, 14, 30, 0.55)";
  ctx.fillRect(0, 0, v.w, v.h);
  ctx.restore();
  ctx.fill("evenodd");
  // Lanterns along the ceiling.
  ctx.fillStyle = HUE.bloom;
  for (let s = TUNNEL.from + 6; s < TUNNEL.to; s += 9) {
    ctx.beginPath();
    ctx.arc(sx(v, s), sy(v, heightAt(s)) - v.ppm * 5.6, Math.max(2.5, v.ppm * 0.45), 0, Math.PI * 2);
    ctx.fill();
  }
}

function fog(ctx: CanvasRenderingContext2D, v: View, f: FogBank, t: number): void {
  const x0 = sx(v, f.from);
  const x1 = sx(v, f.to);
  if (x1 < -200 || x0 > v.w + 200) return;
  const mid = (f.from + f.to) / 2;
  const cy = sy(v, heightAt(mid)) - v.ppm * 3;
  const rx = (x1 - x0) * 0.62;
  const ry = v.ppm * 6;
  // Slow drift, a few centimetres a second. Still under reduced motion because t stays at zero.
  const drift = Math.sin(t * 0.6 + mid) * v.ppm * 0.4;
  for (const [dx, dy, k, a] of [[-0.5, 0.2, 0.8, 0.5], [0.3, -0.1, 1, 0.55], [0.9, 0.25, 0.7, 0.45]] as const) {
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.beginPath();
    ctx.ellipse(x0 + rx * (0.6 + dx * 0.5) + drift, cy + ry * dy, rx * 0.55 * k, ry * k, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // The tangle: a few loops of violet line through the fog, the shape of too many forms and
  // too many phone calls. Abstract on purpose; it is never a person or a place.
  ctx.strokeStyle = "rgba(106,75,168,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const x = x0 + rx * 0.35 + (i / 6) * rx * 0.9 + drift;
    const y = cy + Math.sin(i * 1.9 + mid) * ry * 0.5;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.bezierCurveTo(x - rx * 0.1, y - ry * 0.8, x - rx * 0.05, y + ry * 0.7, x, y);
  }
  ctx.stroke();
}

function signpost(ctx: CanvasRenderingContext2D, v: View, key: PreferenceKey, s: number, scene: Scene): void {
  const x = sx(v, s);
  if (x < -160 || x > v.w + 160) return;
  const y = sy(v, heightAt(s));
  const lit = scene.chosen.has(key);
  const done = scene.answered.has(key);
  const postH = v.ppm * 7;
  ctx.fillStyle = "#6f5433";
  ctx.fillRect(x - 2, y - postH, 4, postH);
  // The board.
  const label = preference(key).label;
  ctx.font = `700 ${Math.max(11, v.ppm * 1.7)}px "Inter Variable", Inter, system-ui, sans-serif`;
  const tw = ctx.measureText(label).width + v.ppm * 2.4;
  const bh = Math.max(20, v.ppm * 3);
  const bx = x - tw / 2;
  const by = y - postH + v.ppm * 1.2;
  ctx.fillStyle = lit ? HUE.wattle : done ? HUE.ochre : HUE.white;
  ctx.beginPath();
  ctx.roundRect(bx, by, tw, bh, 6);
  ctx.fill();
  ctx.strokeStyle = HUE.black;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = HUE.black;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, by + bh / 2);
  // The lantern on top: lit once chosen.
  const ly = y - postH - v.ppm * 0.9;
  if (lit) {
    const g = ctx.createRadialGradient(x, ly, 0, x, ly, v.ppm * 4);
    g.addColorStop(0, "rgba(255,225,77,0.65)");
    g.addColorStop(1, "rgba(255,225,77,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, ly, v.ppm * 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = lit ? HUE.bloom : HUE.ochre;
  ctx.beginPath();
  ctx.arc(x, ly, Math.max(4, v.ppm * 0.8), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = HUE.black;
  ctx.stroke();
}

function clearing(ctx: CanvasRenderingContext2D, v: View, scene: Scene): void {
  const x0 = sx(v, CLEARING);
  if (x0 > v.w + 200) return;
  const y = sy(v, heightAt(CLEARING + 10));
  // One cabin per invented clinician who fits what has been chosen so far.
  const n = Math.max(0, scene.fitCount);
  for (let i = 0; i < n; i++) {
    const cx = sx(v, CLEARING + 8 + i * 7.5);
    const w = v.ppm * 4.5;
    const hh = v.ppm * 3.4;
    ctx.fillStyle = i % 2 ? HUE.white : "#f6efdc";
    ctx.fillRect(cx - w / 2, y - hh, w, hh);
    ctx.fillStyle = i % 3 === 0 ? HUE.lorikeet : i % 3 === 1 ? HUE.eucalypt : HUE.blossom;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2 - 3, y - hh);
    ctx.lineTo(cx, y - hh - v.ppm * 2.2);
    ctx.lineTo(cx + w / 2 + 3, y - hh);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = HUE.wattle;
    ctx.fillRect(cx - w * 0.15, y - hh * 0.72, w * 0.3, hh * 0.35);
  }
  // The flag.
  const fx = sx(v, CLEARING + 2);
  ctx.fillStyle = "#6f5433";
  ctx.fillRect(fx - 1.5, y - v.ppm * 9, 3, v.ppm * 9);
  ctx.fillStyle = HUE.wattle;
  ctx.beginPath();
  ctx.moveTo(fx + 1.5, y - v.ppm * 9);
  ctx.lineTo(fx + v.ppm * 4, y - v.ppm * 8);
  ctx.lineTo(fx + 1.5, y - v.ppm * 7);
  ctx.closePath();
  ctx.fill();
}

function rider(ctx: CanvasRenderingContext2D, v: View, scene: Scene): void {
  const r = scene.rider;
  const x = sx(v, r.s);
  const y = sy(v, heightAt(r.s) + r.hopH);
  const lean = -Math.atan(slopeAt(r.s)) * 0.7;
  const bob = scene.moving && r.hopH === 0 ? Math.sin(scene.t * 9) * v.ppm * 0.08 : 0;
  const u = Math.max(5, v.ppm * 1.1); // one unit of rider
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.rotate(lean);
  // Board and wheels.
  ctx.fillStyle = HUE.black;
  ctx.beginPath();
  ctx.roundRect(-u * 2, -u * 0.35, u * 4, u * 0.55, u * 0.3);
  ctx.fill();
  ctx.fillStyle = HUE.wattle;
  for (const wx of [-u * 1.3, u * 1.3]) {
    ctx.beginPath();
    ctx.arc(wx, u * 0.45, u * 0.38, 0, Math.PI * 2);
    ctx.fill();
  }
  // Legs, body, arms, head, cap. A rounded person, no face: anyone can be this rider.
  ctx.strokeStyle = HUE.black;
  ctx.lineCap = "round";
  ctx.lineWidth = u * 0.5;
  ctx.beginPath();
  ctx.moveTo(-u * 0.8, -u * 0.5);
  ctx.lineTo(-u * 0.5, -u * 2.2);
  ctx.moveTo(u * 0.9, -u * 0.5);
  ctx.lineTo(u * 0.4, -u * 2.2);
  ctx.stroke();
  ctx.fillStyle = HUE.lorikeet;
  ctx.beginPath();
  ctx.roundRect(-u * 1.1, -u * 4.6, u * 2.2, u * 2.7, u * 0.8);
  ctx.fill();
  ctx.strokeStyle = HUE.lorikeet;
  ctx.lineWidth = u * 0.55;
  ctx.beginPath();
  ctx.moveTo(-u * 0.9, -u * 4);
  ctx.lineTo(-u * 2.2, -u * 3.2 + (r.hopH > 0 ? -u : 0));
  ctx.moveTo(u * 0.9, -u * 4);
  ctx.lineTo(u * 2.1, -u * 3.4 + (r.hopH > 0 ? -u : 0));
  ctx.stroke();
  ctx.fillStyle = HUE.ochre;
  ctx.beginPath();
  ctx.arc(0, -u * 5.6, u * 1.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = HUE.wattle;
  ctx.beginPath();
  ctx.arc(0, -u * 5.9, u * 1.05, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-u * 0.2, -u * 6.1, u * 1.7, u * 0.4);
  ctx.restore();
}
