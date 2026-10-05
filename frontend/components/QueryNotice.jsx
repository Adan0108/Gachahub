import { FiAlertTriangle, FiInbox, FiLoader, FiRefreshCw } from "react-icons/fi";

export function QueryNotice({
  isLoading,
  isError,
  isEmpty,
  emptyText = "No results found.",
  errorText = "We couldn't load this right now.",
  loadingText = "Loading fresh data...",
  onRetry,
}) {
  if (isLoading) {
    return (
      <div aria-live="polite" className="state-card query-state loading" role="status">
        <FiLoader aria-hidden="true" />
        <span>{loadingText}</span>
      </div>
    );
  }
  if (isError) {
    return (
      <div aria-live="assertive" className="state-card query-state warning" role="alert">
        <FiAlertTriangle aria-hidden="true" />
        <span>{errorText}</span>
        {onRetry && (
          <button className="query-retry" onClick={onRetry} type="button">
            <FiRefreshCw aria-hidden="true" /> Retry
          </button>
        )}
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="state-card query-state empty" role="status">
        <FiInbox aria-hidden="true" />
        <span>{emptyText}</span>
      </div>
    );
  }
  return null;
}
