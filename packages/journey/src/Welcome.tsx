import { WATTLE } from "./links";

interface Props {
  reducedMotion: boolean;
  onStart: () => void;
  onChooseDirectly: () => void;
}

export function Welcome({ reducedMotion, onStart, onChooseDirectly }: Props) {
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <p className="kicker mono">Wattle · a two-minute ride</p>
      <h1 className="headline" id="welcome-title">
        Finding care can feel like a mountain. <em>This is the way down.</em>
      </h1>
      <p className="lede">
        A short ride from the deck to the valley. Six signposts on the way each ask one practical
        question — the same questions our finder uses to match a person with a clinician who fits.
        You choose what matters. The ride never chooses for you.
      </p>
      <div className="actions">
        {reducedMotion ? (
          <button type="button" className="btn btn-primary" onClick={onChooseDirectly}>
            Choose what matters
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-primary" onClick={onStart}>
              Start the ride
            </button>
            <button type="button" className="btn" onClick={onChooseDirectly}>
              Skip the ride — choose directly
            </button>
          </>
        )}
      </div>
      {reducedMotion ? (
        <p className="note">
          Reduced motion is on, so the animated ride is off. You can answer the same six questions
          directly and see the same results.
        </p>
      ) : (
        <ul className="controls">
          <li>
            <strong>Move</strong> <kbd>→</kbd> or hold <em>Push</em>. The trail is downhill; you can also just watch.
          </li>
          <li>
            <strong>Slow</strong> <kbd>←</kbd> or hold <em>Slow</em>. There is nothing to crash into.
          </li>
          <li>
            <strong>Hop</strong> <kbd>space</kbd> or tap <em>Hop</em>. For fun. It changes nothing.
          </li>
          <li>
            <strong>Choose</strong> Each signpost stops you and asks. Only <em>Yes</em> records a choice, and every choice can be removed.
          </li>
        </ul>
      )}
      <p className="note">
        Demonstration only. The clinicians at the end are ten invented people with invented suburbs.
        Nothing you choose here is sent anywhere.{" "}
        <a href={WATTLE.ventures}>About the real finder, ADHD.ME</a>.
      </p>
    </section>
  );
}
