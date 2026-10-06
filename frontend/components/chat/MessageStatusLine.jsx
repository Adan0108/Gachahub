import { AvatarFace } from "../AvatarFace";

const LABELS = { sent: "Sent", delivered: "Delivered", seen: "Seen" };

/**
 * Under a message you sent: Sent, Delivered or Seen, and in a group the people who have read up to
 * there. `readers` are users ({ id, name, image }).
 */
export function MessageStatusLine({ status, readers = [] }) {
  if (!status && readers.length === 0) return null;

  return (
    <div className="chat-message-receipts">
      {readers.length > 0 && (
        <span aria-label={`Seen by ${readers.map((reader) => reader.name).join(", ")}`} className="chat-message-readers" role="img">
          {readers.map((reader) => (
            <span className="chat-avatar tiny" key={reader.id} title={reader.name}>
              <AvatarFace image={reader.image} name={reader.name} />
            </span>
          ))}
        </span>
      )}
      {status && <small className={`chat-message-status ${status}`}>{LABELS[status]}</small>}
    </div>
  );
}
