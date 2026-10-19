// THE DIRECT PATH. The same six questions as the signposts, as a form. Reduced motion lands here,
// "Skip the ride" lands here, and "Change what matters" from the results lands here. Nothing the
// ride can do is missing from this page.

import { LANGUAGES, PREFERENCES, isChosen, withChoice, type Language, type Selection } from "./preferences";

interface Props {
  selection: Selection;
  onSelection: (next: Selection) => void;
  onDone: () => void;
  onBack: () => void;
}

export function Chooser({ selection, onSelection, onDone, onBack }: Props) {
  return (
    <form
      className="chooser"
      onSubmit={(e) => {
        e.preventDefault();
        onDone();
      }}
    >
      <fieldset>
        <legend>What matters to you?</legend>
        {PREFERENCES.map((p) =>
          p.key === "language" ? (
            <label key={p.key} className="option">
              <input
                type="checkbox"
                checked={selection.language !== null}
                onChange={(e) => onSelection(withChoice(selection, "language", e.target.checked ? LANGUAGES[0] : null))}
              />
              <div>
                <strong>{p.question}</strong>
                <span>{p.why}</span>
                {selection.language !== null && (
                  <div>
                    <select aria-label="Which language" value={selection.language} onChange={(e) => onSelection(withChoice(selection, "language", e.target.value as Language))}>
                      {LANGUAGES.map((l) => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </label>
          ) : (
            <label key={p.key} className="option">
              <input type="checkbox" checked={isChosen(selection, p.key)} onChange={(e) => onSelection(withChoice(selection, p.key, e.target.checked))} />
              <div>
                <strong>{p.question}</strong>
                <span>{p.why}</span>
              </div>
            </label>
          ),
        )}
      </fieldset>
      <div className="actions">
        <button type="submit" className="btn btn-primary">See who fits</button>
        <button type="button" className="btn btn-quiet" onClick={onBack}>Back</button>
      </div>
    </form>
  );
}
