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
          <div>
            <b>{post.title}</b>
            <small>
              {post.gameName ? `${post.gameName} - ` : ""}
              {post.author} - {post.time}
            </small>
          </div>
          <span className="tag">{post.tag}</span>
        </article>
      ))}
    </div>
  );
}
