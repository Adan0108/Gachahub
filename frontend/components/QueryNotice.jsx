export function QueryNotice({
  isLoading,
  isError,
  isEmpty,
  emptyText = "No results found.",
  errorText = "Backend unavailable. Showing saved local content.",
}) {
  if (isLoading) return <div className="state-card">Loading fresh data...</div>;
  if (isError) return <div className="state-card warning">{errorText}</div>;
  if (isEmpty) return <div className="state-card">{emptyText}</div>;
  return null;
}
