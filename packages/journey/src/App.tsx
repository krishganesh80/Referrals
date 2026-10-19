// Four screens, one selection. The ride and the chooser both write the same `Selection`; the
// results read it. Reduced motion, from the system or the switch in the masthead, removes the ride
// from the routes entirely rather than slowing it down.

import { useEffect, useState } from "react";
import { Chooser } from "./Chooser";
import { Results } from "./Results";
import { Ride } from "./Ride";
import { Welcome } from "./Welcome";
import { WATTLE } from "./links";
import { emptySelection, type Selection } from "./preferences";

type Stage = "welcome" | "ride" | "choose" | "results";

function systemReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function App() {
  const [stage, setStage] = useState<Stage>("welcome");
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const [reduced, setReduced] = useState<boolean>(systemReducedMotion);
  // The ride's internal state resets by remounting it; this key is how.
  const [rideKey, setRideKey] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [stage]);

  const restart = () => {
    setSelection(emptySelection());
    setRideKey((k) => k + 1);
    setStage("welcome");
  };

  return (
    <div className="frame">
      <header className="masthead">
        <a className="wordmark" href={WATTLE.home}>
          <span className="dot" aria-hidden="true" /> Wattle
        </a>
        <div className="masthead-tools">
          <button type="button" className="btn btn-small" aria-pressed={reduced} onClick={() => setReduced((r) => !r)}>
            Reduce motion
          </button>
          {stage !== "welcome" && (
            <button type="button" className="btn btn-quiet btn-small" onClick={restart}>
              Start again
            </button>
          )}
        </div>
      </header>
      <main>
        {stage === "welcome" && <Welcome reducedMotion={reduced} onStart={() => setStage("ride")} onChooseDirectly={() => setStage("choose")} />}
        {stage === "ride" && !reduced && (
          <Ride key={rideKey} selection={selection} onSelection={setSelection} onArrive={() => setStage("results")} onChooseDirectly={() => setStage("choose")} />
        )}
        {stage === "ride" && reduced && (
          <Chooser selection={selection} onSelection={setSelection} onDone={() => setStage("results")} onBack={() => setStage("welcome")} />
        )}
        {stage === "choose" && <Chooser selection={selection} onSelection={setSelection} onDone={() => setStage("results")} onBack={() => setStage("welcome")} />}
        {stage === "results" && <Results selection={selection} onChange={() => setStage("choose")} onRestart={restart} />}
      </main>
    </div>
  );
}
