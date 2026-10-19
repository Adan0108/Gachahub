/** A profile page that has nothing to show yet: loading, not found, or a failure. */
export function ProfileState({ title, message }) {
  return (
    <div className="page profile-page">
      <div className="state-card profile-empty-state">
        <b>{title}</b>
        <span>{message}</span>
      </div>
    </div>
  );
}
