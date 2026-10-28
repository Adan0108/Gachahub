import { FiAlertCircle, FiCheck, FiClock } from "react-icons/fi";
import { SHARE_RESULT } from "../../hooks/chat/usePostShare";
import { AvatarFace } from "../AvatarFace";
import type { ShareOutcome } from "../../hooks/chat/usePostShare";
import type { ShareResultEntry } from "../../hooks/chat/useSharePost";

function resultText(result: ShareOutcome) {
  switch (result.status) {
    case SHARE_RESULT.SENT:
      return "Sent";
    case SHARE_RESULT.REQUESTED:
      return "Message request sent. Share again once they accept.";
    case SHARE_RESULT.WAITING:
      return result.reason || "Can't send here yet";
    default:
      return result.reason || "Could not send";
  }
}

function ResultIcon({ status }: { status: string }) {
  if (status === SHARE_RESULT.SENT) return <FiCheck aria-hidden="true" />;
  if (status === SHARE_RESULT.FAILED) return <FiAlertCircle aria-hidden="true" />;
  return <FiClock aria-hidden="true" />;
}

/** What happened to each send: who, and whether it went. */
export function ShareResults({ results }: { results: Record<string, ShareResultEntry> }) {
  return (
    <ul aria-label="Results" className="share-post-results" role="status">
      {Object.entries(results).map(([key, { name, image, result }]) => (
        <li className={result.status} key={key}>
          <span className="share-post-result-avatar">
            <AvatarFace image={image} name={name} />
          </span>
          <span className="share-post-result-text">
            <b>{name}</b>
            <small>{resultText(result)}</small>
          </span>
          <ResultIcon status={result.status} />
        </li>
      ))}
    </ul>
  );
}
