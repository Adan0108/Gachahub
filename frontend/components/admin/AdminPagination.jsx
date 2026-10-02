export function AdminPagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;

  return (
    <nav aria-label="Pagination" className="admin-pagination">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)} type="button">
        Previous
      </button>
      <span>
        Page {page} of {totalPages}
      </span>
      <button disabled={page >= totalPages} onClick={() => onChange(page + 1)} type="button">
        Next
      </button>
    </nav>
  );
}
