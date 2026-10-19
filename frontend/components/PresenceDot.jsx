/** A small status dot: green when online; a grey ring for yourself while you appear offline; nothing otherwise, like Messenger. */
export function PresenceDot({ status, own = false, className = "" }) {
  if (status === "ONLINE") {
    return <span aria-label="Online" className={`presence-dot online ${className}`} role="img" />;
  }
  if (own && status === "INVISIBLE") {
    return <span aria-label="Appearing offline" className={`presence-dot hidden ${className}`} role="img" />;
  }
  return null;
}
