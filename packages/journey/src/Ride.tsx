// THE RIDE. One canvas, one loop, and a DOM layer for everything that matters: the chips that show
// what has been chosen, the prompt a signpost opens, and the buttons a thumb or a keyboard drives.
//
// Three rules, enforced here rather than hoped for:
//  - Nothing is chosen by touching it. A signpost stops the rider and asks; only the Yes button
//    records a preference, and every chip has a remove button.
//  - No time pressure. The world waits while a prompt is open, and the rider who presses nothing
//    still arrives (physics.test.ts proves it).
//  - The loop stops when it has no business running: a prompt open, the tab hidden, or unmounted.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { REST, rollOff, step, type Inputs, type RiderState } from "./physics";
import { LANGUAGES, PREFERENCES, chipText, chosenKeys, isChosen, preference, withChoice, withoutChoice, type Language, type PreferenceKey, type Selection } from "./preferences";
import { cameraTarget, draw, settleCamera, type Camera } from "./render";
import { CLEARING, SIGNPOSTS } from "./trail";
import { match } from "./matching";

interface Props {
  selection: Selection;
  onSelection: (next: Selection) => void;
  onArrive: () => void;
  onChooseDirectly: () => void;
}

type Prompt = { key: PreferenceKey } | null;

export function Ride({ selection, onSelection, onArrive, onChooseDirectly }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const riderRef = useRef<RiderState>(REST);
  const camRef = useRef<Camera>(cameraTarget(REST));
  // Keys and the on-screen pad are tracked apart: losing keyboard focus must drop a held arrow
  // key, and must not drop a thumb that is still on the Push button.
  const keysRef = useRef<{ push: boolean; brake: boolean; hop: boolean }>({ push: false, brake: false, hop: false });
  const padRef = useRef<{ push: boolean; brake: boolean; hop: boolean }>({ push: false, brake: false, hop: false });
  const clockRef = useRef(0);
  const [answered, setAnswered] = useState<ReadonlySet<PreferenceKey>>(() => new Set());
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [atClearing, setAtClearing] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pendingLanguage, setPendingLanguage] = useState<Language>(LANGUAGES[0]);
  const promptRef = useRef<HTMLDivElement>(null);

  const chosen = useMemo(() => new Set(chosenKeys(selection)), [selection]);
  const fitCount = useMemo(() => match(selection).fits.length, [selection]);
  const nextSignpost = useMemo(() => SIGNPOSTS.find((sp) => !answered.has(sp.key)) ?? null, [answered]);
  const running = prompt === null && !atClearing;

  // Latest props for the loop without restarting it.
  const live = useRef({ chosen, answered, fitCount, nextSignpost, running });
  live.current = { chosen, answered, fitCount, nextSignpost, running };

  // Size the canvas to its box at device resolution, and redraw on resize so a paused frame is never stale.
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { chosen: c, answered: a, fitCount: n, running: r } = live.current;
    const rider = riderRef.current;
    const fogNow = step(rider, { push: false, brake: false, hop: false }, 0, { cleared: c, stopAt: null }).fog;
    draw(ctx, canvas.width, canvas.height, camRef.current, {
      rider,
      chosen: c,
      answered: a,
      fog: fogNow,
      fitCount: n,
      t: clockRef.current,
      moving: r && rider.v > 0.2,
    });
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = stage.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      ctx?.setTransform(1, 0, 0, 1, 0, 0);
      drawFrame();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [drawFrame]);

  // The loop.
  useEffect(() => {
    if (!running) {
      drawFrame();
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!document.hidden) {
        clockRef.current += dt;
        const { chosen: c, nextSignpost: sp } = live.current;
        const inputs: Inputs = {
          push: keysRef.current.push || padRef.current.push,
          brake: keysRef.current.brake || padRef.current.brake,
          hop: keysRef.current.hop || padRef.current.hop,
        };
        keysRef.current.hop = false; // edge-triggered
        padRef.current.hop = false;
        const stopAt = sp ? sp.s : null;
        const r = step(riderRef.current, inputs, dt, { cleared: c, stopAt });
        riderRef.current = r.state;
        camRef.current = settleCamera(camRef.current, cameraTarget(r.state), dt);
        if (r.arrived && sp) {
          setPrompt({ key: sp.key });
          return; // the effect re-runs when the prompt closes
        }
        if (r.state.s >= CLEARING + 4) {
          riderRef.current = { ...r.state, v: Math.max(0, r.state.v - 10 * dt) };
          if (riderRef.current.v === 0) {
            setAtClearing(true);
            drawFrame();
            return;
          }
        }
        drawFrame();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, drawFrame]);

  // Keyboard while the stage has focus. Space and arrows must not scroll the page.
  const onKey = (down: boolean) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    if (k === "ArrowRight" || k === "d" || k === "D") keysRef.current.push = down;
    else if (k === "ArrowLeft" || k === "a" || k === "A" || k === "s" || k === "S") keysRef.current.brake = down;
    else if (k === " " || k === "ArrowUp" || k === "w" || k === "W") {
      if (down && !e.repeat) keysRef.current.hop = true;
    } else return;
    e.preventDefault();
  };

  // Focus the prompt when it opens, and the stage again when it closes.
  useEffect(() => {
    if (prompt) promptRef.current?.querySelector<HTMLElement>("button, select")?.focus();
    else stageRef.current?.focus({ preventScroll: true });
  }, [prompt]);

  const answer = (key: PreferenceKey, value: boolean | Language | null) => {
    onSelection(withChoice(selection, key, value));
    setAnswered((a) => new Set([...a, key]));
    riderRef.current = rollOff(riderRef.current);
    setPrompt(null);
  };

  const hold = (name: "push" | "brake", on: boolean) => () => {
    padRef.current[name] = on;
  };

  const progress = answered.size;

  return (
    <section className="ride" aria-label="The ride">
      <div className="ride-top">
        <p className="mono" aria-live="polite">
          {atClearing ? "At the clearing" : `Signpost ${Math.min(progress + 1, SIGNPOSTS.length)} of ${SIGNPOSTS.length}`}
        </p>
        <button type="button" className="btn btn-quiet btn-small" onClick={onChooseDirectly}>
          Skip the ride — choose directly
        </button>
      </div>

      <div className="stage-wrap">
      <div
        ref={stageRef}
        className="stage"
        tabIndex={0}
        role="img"
        aria-label="A rider on a trail from a mountain deck down to a valley clearing. Arrow keys or the buttons below move the rider."
        data-focused={focused}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          keysRef.current = { push: false, brake: false, hop: false };
        }}
        onKeyDown={onKey(true)}
        onKeyUp={onKey(false)}
      >
        <canvas ref={canvasRef} />
      </div>
      {prompt && (
        <div ref={promptRef} className="prompt" role="dialog" aria-modal="false" aria-labelledby="prompt-title">
          <p className="mono">Signpost · {preference(prompt.key).label}</p>
          <h2 id="prompt-title">{preference(prompt.key).question}</h2>
          <p>{preference(prompt.key).why}</p>
          {prompt.key === "language" ? (
            <>
              <label>
                Which language?
                <select value={pendingLanguage} onChange={(e) => setPendingLanguage(e.target.value as Language)}>
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </label>
              <div className="actions">
                <button type="button" className="btn btn-primary" onClick={() => answer("language", pendingLanguage)}>
                  Yes, {pendingLanguage}
                </button>
                <button type="button" className="btn" onClick={() => answer("language", null)}>
                  English is fine
                </button>
              </div>
            </>
          ) : (
            <div className="actions">
              <button type="button" className="btn btn-primary" onClick={() => answer(prompt.key, true)}>
                Yes, this matters
              </button>
              <button type="button" className="btn" onClick={() => answer(prompt.key, isChosen(selection, prompt.key))}>
                Not for me
              </button>
            </div>
          )}
        </div>
      )}
      {atClearing && (
        <div className="prompt" role="region" aria-labelledby="clearing-title">
          <p className="mono">The clearing</p>
          <h2 id="clearing-title">You made it down.</h2>
          <p>
            {fitCount === 0
              ? "No invented clinician fits everything you chose. The results still show who comes close."
              : `${fitCount} of the ten invented clinicians fit everything you chose.`}
          </p>
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={onArrive}>See who fits</button>
          </div>
        </div>
      )}
      </div>

      <div>
        <p className="sr-only" id="chips-label">What matters to you so far</p>
        <ul className="chips" aria-labelledby="chips-label">
          {chosenKeys(selection).length === 0 && <li className="chips-empty">Nothing chosen yet. Each signpost asks one question.</li>}
          {chosenKeys(selection).map((key) => (
            <li key={key} className="chip">
              {chipText(selection, key)}
              <button type="button" aria-label={`Remove ${chipText(selection, key)}`} onClick={() => onSelection(withoutChoice(selection, key))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="pad">
        <div className="pad-keys" aria-label="Ride controls">
          <button type="button" className="btn" onPointerDown={hold("push", true)} onPointerUp={hold("push", false)} onPointerLeave={hold("push", false)} onPointerCancel={hold("push", false)} disabled={!running}>
            Push
          </button>
          <button type="button" className="btn" onPointerDown={hold("brake", true)} onPointerUp={hold("brake", false)} onPointerLeave={hold("brake", false)} onPointerCancel={hold("brake", false)} disabled={!running}>
            Slow
          </button>
          <button type="button" className="btn" onClick={() => { padRef.current.hop = true; }} disabled={!running}>
            Hop
          </button>
        </div>
        <p className="note">
          <span className="keys-hint"><kbd>→</kbd> push · <kbd>←</kbd> slow · <kbd>space</kbd> hop. </span>
          The trail is downhill: a rider who presses nothing still arrives.
        </p>
      </div>

      <p className="sr-only" aria-live="polite">
        {PREFERENCES.filter((p) => answered.has(p.key)).length} of {PREFERENCES.length} signposts answered.
      </p>
    </section>
  );
}
