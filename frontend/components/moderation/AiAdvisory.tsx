import { FiInfo } from "react-icons/fi";
import { advisorySignals, advisoryStates, parseAiAdvisory } from "../../lib/ai-advisory";

export function AiAdvisory({ value, compact = false }: { value: unknown; compact?: boolean }) {
  const advisory = parseAiAdvisory(value);
  const current = advisory?.state === "CURRENT" ? advisory : null;
  const unavailable =
    advisory && advisory.state !== "CURRENT" ? advisoryStates[advisory.state] : null;
  const title = current
    ? `${current.riskLevel[0]}${current.riskLevel.slice(1).toLowerCase()} AI risk`
    : unavailable?.[0] || "AI assessment unavailable";
  const signals = current?.signals.map((signal) => advisorySignals[signal]) || [];
  const summary = signals.length
    ? signals.map((signal) => signal.label).join(" · ")
    : "No signals detected in this assessment. This does not confirm that the content is safe.";
  if (compact)
    return (
      <div className="case-ai-compact" role="group" aria-label="AI advisory">
        <span className="case-ai-label">
          <FiInfo aria-hidden="true" /> AI advisory
        </span>
        <strong
          className={`case-ai-status${current ? ` case-ai-risk-${current.riskLevel.toLowerCase()}` : ""}`}
        >
          {title}
        </strong>
        {current && <p>{summary}</p>}
      </div>
    );
  return (
    <section className="admin-panel case-ai-panel" aria-label="AI advisory">
      <div className="case-section-heading">
        <h2>
          <FiInfo aria-hidden="true" /> AI advisory
        </h2>
        <span
          className={`case-ai-status${current ? ` case-ai-risk-${current.riskLevel.toLowerCase()}` : ""}`}
        >
          {title}
        </span>
      </div>
      {current ? (
        <>
          {signals.length ? (
            <ul className="case-ai-signals">
              {signals.map((signal) => (
                <li key={signal.label}>
                  <strong>{signal.label}</strong>
                  <p>{signal.description}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>{summary}</p>
          )}
          <p className="case-ai-guidance">
            AI findings are advisory, not confirmed violations. Use your judgment and review the
            context, including game dialogue, combat descriptions, character lore, quotations and
            jokes.
          </p>
          <details className="case-ai-details">
            <summary>Assessment details</summary>
            <dl>
              <div>
                <dt>Priority score · internal review indicator</dt>
                <dd>{current.priorityScore} / 100</dd>
              </div>
              <div>
                <dt>Evaluated</dt>
                <dd>
                  <time dateTime={current.evaluatedAt}>
                    {new Date(current.evaluatedAt).toLocaleString()}
                  </time>
                </dd>
              </div>
            </dl>
            <p>
              This score is not a probability or confidence percentage. It does not change the queue
              order.
            </p>
          </details>
        </>
      ) : (
        <p className="case-ai-explanation">
          {unavailable?.[1] ||
            "A current assessment could not be read. Continue reviewing the reports and available context."}
        </p>
      )}
    </section>
  );
}
