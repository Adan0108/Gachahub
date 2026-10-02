export function AdminState({ kind, title, message, onRetry }) {
  const loading = kind === "loading";

  return (
    <section
      aria-live="polite"
      className={`admin-state admin-state-${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {loading ? <span aria-hidden="true" className="admin-spinner" /> : null}
      <div>
        <h2>{title}</h2>
        {message ? <p>{message}</p> : null}
      </div>
      {kind === "error" && onRetry ? (
        <button className="admin-button admin-button-secondary" onClick={onRetry} type="button">
          Try again
        </button>
      ) : null}
    </section>
  );
}
