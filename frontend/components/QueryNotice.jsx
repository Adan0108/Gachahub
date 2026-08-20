export function QueryNotice({ isLoading, isError, isEmpty, emptyText = "No results found." }) {
  if (isLoading) return <div className="state-card">Loading fresh data...</div>;
  if (isError)
    return (
      <div className="state-card warning">Backend unavailable. Showing saved local content.</div>
    );
  if (isEmpty) return <div className="state-card">{emptyText}</div>;
  return null;
}
