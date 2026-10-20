import { FiCheck } from "react-icons/fi";
import { AvatarFace } from "../AvatarFace";

/** One person or chat to pick: a round picture with the name under it, and a tick once chosen. */
export function ShareTile({ tile, selected, disabled, onToggle }) {
  const label = tile.reason ? `${tile.name}, ${tile.reason}` : tile.name;
  return (
    <button
      aria-checked={selected}
      aria-label={label}
      className={`share-post-tile ${selected ? "selected" : ""}`}
      disabled={disabled}
      onClick={() => onToggle(tile)}
      role="checkbox"
      title={tile.reason || undefined}
      type="button"
    >
      <span className="share-post-tile-avatar">
        <AvatarFace image={tile.image} name={tile.name} />
        {selected && (
          <span aria-hidden="true" className="share-post-tile-check">
            <FiCheck />
          </span>
        )}
      </span>
      <span className="share-post-tile-name">{tile.name}</span>
      {tile.reason && <small className="share-post-tile-reason">{tile.reason}</small>}
    </button>
  );
}
