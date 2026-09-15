"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FiFileText, FiImage, FiSend, FiTrash2 } from "react-icons/fi";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { api } from "../../lib/api";
import {
  buildPostPayload,
  getPostMediaError,
  getPostTagError,
  parsePostTags,
} from "../../lib/postComposer";
import { queries } from "../../lib/queries";
import { QueryNotice } from "../../components/QueryNotice";

const postTypes = [
  "GENERAL",
  "GUIDE",
  "BUILD",
  "TEAM",
  "LORE",
  "THEORY",
  "QUESTION",
  "NEWS",
  "MEME",
];

export default function CreatePostPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading: isSessionLoading } = useRequireAuth();
  const games = useQuery(queries.games(""));
  const [form, setForm] = useState({
    gameId: "",
    categoryId: "",
    title: "",
    content: "",
    type: "GENERAL",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    isSpoiler: false,
    tags: "",
  });
  const [files, setFiles] = useState([]);
  const [confirmedUploads, setConfirmedUploads] = useState([]);
  const [fileError, setFileError] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const selectedGame = games.data?.items.find((game) => game.id === form.gameId);
  const categories = useQuery({
    ...queries.categories(selectedGame?.slug),
    enabled: Boolean(selectedGame?.slug),
  });
  const parsedTags = useMemo(() => parsePostTags(form.tags), [form.tags]);
  const tagError = getPostTagError(parsedTags);
  const gameError = submitAttempted && !form.gameId ? "Choose a game before publishing." : "";
  const titleError =
    submitAttempted && form.title.trim().length < 3
      ? "Title must contain at least 3 characters."
      : "";
  const contentError =
    submitAttempted && !form.content.trim() ? "Write some content before publishing." : "";
  const canSubmit =
    Boolean(form.gameId) &&
    form.title.trim().length >= 3 &&
    form.content.trim().length > 0 &&
    !tagError &&
    !fileError;
  const publish = useMutation({
    mutationFn: async () => {
      let uploadResult;
      try {
        uploadResult = await api.uploadPostMedia(files);
      } catch (error) {
        return {
          ok: false,
          error,
          failedFiles: files,
          successfulUploads: confirmedUploads,
        };
      }
      const uploads = [...confirmedUploads, ...uploadResult.successful];

      if (uploadResult.failed.length) {
        return {
          ok: false,
          error: new Error(
            `${uploadResult.failed.length} file${uploadResult.failed.length === 1 ? "" : "s"} failed. Retry the remaining upload${uploadResult.failed.length === 1 ? "" : "s"}.`,
          ),
          failedFiles: uploadResult.failed.map(({ file }) => file),
          successfulUploads: uploads,
        };
      }

      try {
        const post = await api.createPost(buildPostPayload(form, parsedTags, uploads));
        return { ok: true, post };
      } catch (error) {
        return {
          ok: false,
          error,
          failedFiles: [],
          successfulUploads: uploads,
        };
      }
    },
    onSuccess: async (result) => {
      if (!result.ok) {
        setConfirmedUploads(result.successfulUploads);
        setFiles(result.failedFiles);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["posts"] });
      router.push("/profile");
    },
  });
  const publishError =
    publish.data?.ok === false ? publish.data.error : publish.isError ? publish.error : null;

  const updateField = (field) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "gameId" ? { categoryId: "" } : {}),
    }));
  };

  const selectFiles = (event) => {
    const selected = Array.from(event.target.files || []);
    const next = [...files, ...selected];
    const nextError = getPostMediaError(next, confirmedUploads);

    if (nextError) setFileError(nextError);
    else {
      setFileError("");
      setFiles(next);
    }
    event.target.value = "";
  };

  if (isSessionLoading || !isAuthenticated) {
    return (
      <div className="page create-post-page">
        <div className="state-card">Checking your session...</div>
      </div>
    );
  }

  return (
    <div className="page create-post-page">
      <section className="welcome hero-polish create-post-hero">
        <div>
          <span className="eyebrow">Publish</span>
          <h1>Create a community post</h1>
          <p>Share a guide, build, theory, question, or update with your game community.</p>
        </div>
        <FiFileText aria-hidden="true" />
      </section>

      <form
        className="panel create-post-form"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitAttempted(true);
          if (canSubmit && !publish.isPending) publish.mutate();
        }}
      >
        <div className="create-post-grid">
          <label className={gameError ? "field-invalid" : ""}>
            Game
            <select
              aria-describedby={gameError ? "game-error" : undefined}
              value={form.gameId}
              onChange={updateField("gameId")}
            >
              <option value="">Select a community</option>
              {(games.data?.items || []).map((game) => (
                <option key={game.id} value={game.id}>
                  {game.name}
                </option>
              ))}
            </select>
            {gameError && (
              <small className="field-error" id="game-error">
                {gameError}
              </small>
            )}
          </label>
          <label>
            Category <small>(optional)</small>
            <select
              value={form.categoryId}
              onChange={updateField("categoryId")}
              disabled={!form.gameId}
            >
              <option value="">No category</option>
              {(categories.data || []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Post type
            <select value={form.type} onChange={updateField("type")}>
              {postTypes.map((type) => (
                <option key={type} value={type}>
                  {type.charAt(0) + type.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label>
            Visibility
            <select value={form.visibility} onChange={updateField("visibility")}>
              <option value="PUBLIC">Public</option>
              <option value="FOLLOWERS_ONLY">Followers only</option>
              <option value="PRIVATE">Private</option>
            </select>
          </label>
        </div>

        <label className={titleError ? "field-invalid" : ""}>
          <span className="field-label-row">
            <span>Title</span>
            <small className={form.title.length === 255 ? "limit-reached" : ""}>
              {form.title.length}/255
            </small>
          </span>
          <input
            aria-describedby="title-limit"
            maxLength={255}
            minLength={3}
            onChange={updateField("title")}
            placeholder="Give your post a clear title"
            required
            value={form.title}
          />
          <small
            id="title-limit"
            className={
              titleError
                ? "field-error"
                : form.title.length === 255
                  ? "field-warning"
                  : "field-hint"
            }
          >
            {titleError ||
              (form.title.length === 255
                ? "Maximum title length reached."
                : "Keep it clear and specific.")}
          </small>
        </label>
        <label className={contentError ? "field-invalid" : ""}>
          Content
          <textarea
            maxLength={30000}
            onChange={updateField("content")}
            placeholder="Write your post..."
            required
            rows={10}
            value={form.content}
          />
          {contentError && <small className="field-error">{contentError}</small>}
        </label>
        <label className={tagError ? "field-invalid" : ""}>
          Tags
          <input
            onChange={updateField("tags")}
            placeholder="Jinhsi, Beginner, Build"
            value={form.tags}
          />
          <small className={tagError ? "field-error" : ""}>
            {tagError || "Separate up to 10 tags with commas; 80 characters maximum per tag."}
          </small>
        </label>

        <div className="create-post-options">
          <label className="create-post-check">
            <input checked={form.isSpoiler} onChange={updateField("isSpoiler")} type="checkbox" />
            Mark as spoiler
          </label>
          <label>
            Publish state
            <select value={form.status} onChange={updateField("status")}>
              <option value="PUBLISHED">Publish now</option>
              <option value="DRAFT">Save as draft</option>
            </select>
          </label>
        </div>

        <section className="create-post-media" aria-label="Post media">
          <div>
            <b>Media</b>
            <small>Up to 10 images (10 MB each) or one video (50 MB).</small>
          </div>
          <label className="soft-btn create-post-upload">
            <FiImage /> Add media
            <input
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
              multiple
              onChange={selectFiles}
              type="file"
            />
          </label>
          {files.length > 0 && (
            <ul className="create-post-files">
              {files.map((file, index) => (
                <li key={`${file.name}-${file.lastModified}`}>
                  <span>{file.name}</span>
                  <button
                    aria-label={`Remove ${file.name}`}
                    onClick={() => {
                      setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
                      setFileError("");
                    }}
                    type="button"
                  >
                    <FiTrash2 />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {confirmedUploads.length > 0 && (
            <>
              <small className="upload-progress">
                {confirmedUploads.length} file{confirmedUploads.length === 1 ? "" : "s"} uploaded
                and ready.
              </small>
              <ul className="create-post-files confirmed-upload-list">
                {confirmedUploads.map((upload, index) => (
                  <li key={upload.mediaUploadId}>
                    <span>
                      {upload.fileName || `Uploaded ${upload.resourceType.toLowerCase()}`}
                    </span>
                    <button
                      aria-label={`Remove ${upload.fileName || `uploaded ${upload.resourceType.toLowerCase()}`}`}
                      onClick={() => {
                        setConfirmedUploads((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        );
                        setFileError("");
                      }}
                      type="button"
                    >
                      <FiTrash2 />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {fileError && <small className="post-action-error">{fileError}</small>}
        </section>

        <QueryNotice
          isLoading={games.isLoading || categories.isLoading}
          isError={games.isError || categories.isError}
        />
        {!publish.isPending && publishError && (
          <div className="auth-message error">{publishError.message}</div>
        )}
        <button className="primary create-post-submit" disabled={publish.isPending} type="submit">
          <FiSend />{" "}
          {publish.isPending
            ? "Publishing..."
            : form.status === "DRAFT"
              ? "Save draft"
              : "Publish post"}
        </button>
      </form>
    </div>
  );
}
