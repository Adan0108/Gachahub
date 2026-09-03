import Link from "next/link";
import { artTones, glyph } from "./constants";

export function PostList({ posts }) {
  return (
    <div className="post-list">
      {posts.map((post, index) => (
        <article className="post" key={post.id}>
          <span className="rank">{index + 1}</span>
          <div className={`post-thumb art-${artTones[index % artTones.length]}`}>
            {glyph.sparkle}
          </div>
          <Link className="post-content-link" href={`/explore?q=${encodeURIComponent(post.title)}`}>
            <b>{post.title}</b>
            <small>
              {post.gameName ? `${post.gameName} - ` : ""}
              {post.author} - {post.time}
            </small>
          </Link>
          <span className="tag">{post.tag}</span>
        </article>
      ))}
    </div>
  );
}
