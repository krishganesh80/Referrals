// THE CLEARING, in words. Cards show only what the demo roster holds — name, kind of clinician,
// invented suburb, and which of the chosen things each one meets. The group a card sits in is
// the whole of the claim; inside a group the order is alphabetical and means nothing.

import { WATTLE } from "./links";
import { match, missingLine, reasonLines } from "./matching";
import { chipText, chosenKeys, type Selection } from "./preferences";

interface Props {
  selection: Selection;
  onChange: () => void;
  onRestart: () => void;
}

export function Results({ selection, onChange, onRestart }: Props) {
  const r = match(selection);
  const chosen = chosenKeys(selection);
  return (
    <section className="results" aria-labelledby="results-title">
      <div className="demo-banner" role="note">
        <strong>Demonstration data.</strong>
        <span>
          These ten clinicians, their suburbs and their details are invented. The real finder matches
          against clinicians who have confirmed their own entries. Nothing here is a clinical
          judgement, a guarantee of availability, or advice about treatment.
        </span>
      </div>

      <div>
        <p className="mono">{chosen.length === 0 ? "Nothing chosen" : `${chosen.length} thing${chosen.length === 1 ? "" : "s"} that matter`}</p>
        <h2 id="results-title">
          {r.fits.length === 0 ? "Nobody fits everything — yet." : r.fits.length === 1 ? "One clinician fits everything you chose." : `${r.fits.length} clinicians fit everything you chose.`}
        </h2>
        <ul className="chips" aria-label="What you chose">
          {chosen.length === 0 && <li className="chips-empty">With nothing chosen, everyone is shown.</li>}
          {chosen.map((key) => (
            <li key={key} className="chip">{chipText(selection, key)}</li>
          ))}
        </ul>
        <div className="actions">
          <button type="button" className="btn" onClick={onChange}>Change what matters</button>
          <button type="button" className="btn btn-quiet" onClick={onRestart}>Start again</button>
        </div>
      </div>

      {r.fits.length > 0 && (
        <div className="group">
          <h3>Fit everything you chose <span className="mono">{r.fits.length}</span></h3>
          <ul className="cards">
            {r.fits.map((m) => (
              <li key={m.clinician.id} className="card">
                <span className="tag mono">Demo</span>
                <h4>{m.clinician.name}</h4>
                <p className="meta">{m.clinician.profession} · {m.clinician.suburb}</p>
                {m.meets.length > 0 ? (
                  <ul className="reasons" aria-label="Why this clinician is here">
                    {reasonLines(m, selection).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="meta">Shown because nothing was chosen.</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {r.close.length > 0 && (
        <div className="group">
          <h3>Close — one thing missing <span className="mono">{r.close.length}</span></h3>
          <ul className="cards">
            {r.close.map((m) => (
              <li key={m.clinician.id} className="card card-close">
                <span className="tag mono">Demo</span>
                <h4>{m.clinician.name}</h4>
                <p className="meta">{m.clinician.profession} · {m.clinician.suburb}</p>
                <ul className="reasons" aria-label="What this clinician meets">
                  {reasonLines(m, selection).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="missing">{missingLine(m, selection)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {r.hidden > 0 && (
        <p className="hidden-note">
          {r.hidden} other invented clinician{r.hidden === 1 ? "" : "s"} {r.hidden === 1 ? "misses" : "miss"} two or more of the things you chose and {r.hidden === 1 ? "is" : "are"} not shown.
        </p>
      )}

      <div className="next">
        <h3>Next</h3>
        <p>
          The real finder asks these same questions, and more, against clinicians who confirmed their
          own entries. It is in build and has no public address yet.
        </p>
        <div className="actions">
          <a className="btn btn-primary" href={WATTLE.ventures}>About ADHD.ME</a>
          <a className="btn" href={WATTLE.contact}>Get in touch with Wattle</a>
        </div>
      </div>
    </section>
  );
}
