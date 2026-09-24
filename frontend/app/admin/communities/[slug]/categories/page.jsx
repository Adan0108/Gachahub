"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { FiArrowLeft, FiEdit2, FiPlus, FiX } from "react-icons/fi";
import { AdminShell } from "../../../../../components/admin/AdminShell";
import { AdminState } from "../../../../../components/admin/AdminState";
import { useRequireAdmin } from "../../../../../hooks/useRequireAdmin";
import { useToast } from "../../../../../hooks/useToast";
import { api } from "../../../../../lib/api";
import { queries, queryKeys } from "../../../../../lib/queries";

const emptyForm = {
  name: "",
  slug: "",
  description: "",
  icon: "",
  sortOrder: 0,
  isActive: true,
};

function CategoryForm({ category, gameSlug, onClose, onSaved }) {
  const editing = Boolean(category);
  const [form, setForm] = useState(() =>
    editing
      ? {
          name: category.name || "",
          slug: category.slug || "",
          description: category.description || "",
          icon: category.icon || "",
          sortOrder: category.sortOrder ?? 0,
          isActive: category.isActive ?? true,
        }
      : emptyForm,
  );
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: (payload) =>
      editing ? api.updateCategory(category.id, payload) : api.createCategory(gameSlug, payload),
    onSuccess: () => onSaved(editing ? "Category updated" : "Category created"),
    onError: (nextError) => setError(nextError.message || "Could not save category"),
  });

  useEffect(() => {
    const dismiss = (event) => event.key === "Escape" && !mutation.isPending && onClose();
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [mutation.isPending, onClose]);

  const updateField = (event) => {
    const { name, type, checked, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : name === "sortOrder" ? Number(value) : value,
    }));
    setError("");
  };

  const submit = (event) => {
    event.preventDefault();
    if (form.name.trim().length < 2) {
      setError("Category name must contain at least 2 characters.");
      return;
    }
    const payload = Object.fromEntries(
      Object.entries(form).filter(([, value]) => typeof value !== "string" || value.trim()),
    );
    mutation.mutate(payload);
  };

  return (
    <div
      className="admin-dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        aria-labelledby="category-form-title"
        aria-modal="true"
        className="admin-dialog admin-dialog-compact"
        role="dialog"
      >
        <div className="admin-dialog-heading">
          <div>
            <span className="admin-eyebrow">{editing ? "Edit structure" : "New structure"}</span>
            <h2 id="category-form-title">{editing ? "Update category" : "Create category"}</h2>
          </div>
          <button aria-label="Close" disabled={mutation.isPending} onClick={onClose} type="button">
            <FiX />
          </button>
        </div>
        <form className="admin-form" onSubmit={submit}>
          <label>
            <span>Name *</span>
            <input
              autoFocus
              maxLength={100}
              name="name"
              onChange={updateField}
              required
              value={form.name}
            />
          </label>
          <label>
            <span>Slug</span>
            <input
              maxLength={120}
              name="slug"
              onChange={updateField}
              placeholder="Generated from name"
              value={form.slug}
            />
          </label>
          <label>
            <span>Icon key</span>
            <input
              maxLength={50}
              name="icon"
              onChange={updateField}
              placeholder="book"
              value={form.icon}
            />
          </label>
          <label>
            <span>Sort order</span>
            <input
              min="0"
              name="sortOrder"
              onChange={updateField}
              type="number"
              value={form.sortOrder}
            />
          </label>
          <label className="admin-form-wide">
            <span>Description</span>
            <textarea
              maxLength={1000}
              name="description"
              onChange={updateField}
              rows={4}
              value={form.description}
            />
          </label>
          <label className="admin-checkbox admin-form-wide">
            <input checked={form.isActive} name="isActive" onChange={updateField} type="checkbox" />
            <span>Active and available to community posts</span>
          </label>
          {error ? (
            <p className="admin-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="admin-form-actions">
            <button
              className="admin-button admin-button-secondary"
              disabled={mutation.isPending}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="admin-button admin-button-primary"
              disabled={mutation.isPending}
              type="submit"
            >
              {mutation.isPending ? "Saving..." : editing ? "Save changes" : "Create category"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default function AdminCategoriesPage() {
  const { slug: encodedSlug } = useParams();
  const gameSlug = decodeURIComponent(String(encodedSlug || ""));
  const session = useRequireAdmin();
  const queryClient = useQueryClient();
  const { notice, showNotice } = useToast(2400);
  const [active, setActive] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(undefined);
  const community = useQuery({
    ...queries.community(gameSlug),
    enabled: session.isAdmin && Boolean(gameSlug),
  });
  const categories = useQuery({
    ...queries.adminCategories(gameSlug, active),
    enabled: session.isAdmin && Boolean(gameSlug),
  });

  if (session.isLoading || !session.isAdmin)
    return <AdminState kind="loading" title="Checking admin access" />;

  const items = Array.isArray(categories.data) ? categories.data : categories.data?.items || [];
  const closeForm = () => setSelectedCategory(undefined);
  const handleSaved = async (message) => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.adminCategories(gameSlug, active) });
    closeForm();
    showNotice(message);
  };

  return (
    <AdminShell user={session.user}>
      <Link className="admin-back-link" href="/admin/communities">
        <FiArrowLeft /> Communities
      </Link>
      <div className="admin-page-heading">
        <div>
          <span className="admin-eyebrow">Community structure</span>
          <h1>{community.data?.name || gameSlug}</h1>
          <p>Manage the categories members can use when publishing posts.</p>
        </div>
        <button
          className="admin-button admin-button-primary"
          onClick={() => setSelectedCategory(null)}
          type="button"
        >
          <FiPlus /> New category
        </button>
      </div>
      <section aria-label="Category filters" className="admin-toolbar admin-toolbar-compact">
        <select
          aria-label="Filter category status"
          onChange={(event) => setActive(event.target.value)}
          value={active}
        >
          <option value="">All categories</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
        <span>{items.length} categories</span>
      </section>
      {categories.isLoading || community.isLoading ? (
        <AdminState
          kind="loading"
          title="Loading categories"
          message="Retrieving community structure."
        />
      ) : categories.isError || community.isError ? (
        <AdminState
          kind="error"
          title="Categories unavailable"
          message={
            categories.error?.message ||
            community.error?.message ||
            "The category list could not be loaded."
          }
          onRetry={() => {
            categories.refetch();
            community.refetch();
          }}
        />
      ) : !items.length ? (
        <AdminState
          kind="empty"
          title="No categories found"
          message={
            active
              ? "Try changing the status filter."
              : "Create the first category for this community."
          }
        />
      ) : (
        <section className="admin-panel">
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Category</th>
                  <th>Slug</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((category) => (
                  <tr key={category.id}>
                    <td>{category.sortOrder ?? 0}</td>
                    <td>
                      <div className="admin-category-name">
                        <span>{category.icon || "#"}</span>
                        <b>{category.name}</b>
                      </div>
                    </td>
                    <td>
                      <code>{category.slug}</code>
                    </td>
                    <td className="admin-description-cell">{category.description || "—"}</td>
                    <td>
                      <span
                        className={`admin-status ${category.isActive ? "" : "admin-status-archived"}`}
                      >
                        {category.isActive ? "ACTIVE" : "INACTIVE"}
                      </span>
                    </td>
                    <td>
                      <button
                        aria-label={`Edit ${category.name}`}
                        className="admin-icon-button"
                        onClick={() => setSelectedCategory(category)}
                        type="button"
                      >
                        <FiEdit2 />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {selectedCategory !== undefined ? (
        <CategoryForm
          category={selectedCategory}
          gameSlug={gameSlug}
          onClose={closeForm}
          onSaved={handleSaved}
        />
      ) : null}
      {notice ? (
        <div className="toast admin-toast" role="status">
          {notice}
        </div>
      ) : null}
    </AdminShell>
  );
}
