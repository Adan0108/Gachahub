"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FiArrowLeft } from "react-icons/fi";
import { PostItem } from "../../../components/PostList";
import { queries } from "../../../lib/queries";

export default function PostDetailPage() {
  const params = useParams();
  const postId = Array.isArray(params.id) ? params.id[0] : params.id;
  const post = useQuery(queries.post(postId));

  return (
    <div className="page post-detail-page">
      <Link className="soft-btn post-back-link" href="/explore">
        <FiArrowLeft /> Back to Explore
      </Link>

      {post.isLoading && <div className="state-card">Loading post...</div>}
      {post.isError && (
        <section className="panel state-panel">
          <h1>Post unavailable</h1>
          <p>{post.error.message || "This post could not be loaded."}</p>
          <button className="soft-btn" onClick={() => post.refetch()} type="button">
            Try again
          </button>
        </section>
      )}
      {post.data && (
        <section className="panel post-detail-panel">
          <PostItem detail post={post.data} />
        </section>
      )}
    </div>
  );
}
