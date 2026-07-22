import { posts } from "../data/posts";

function TrendingPosts() {
  return (
    <div className="trending">
      <div className="panel-header">
  <h3>Trending Posts</h3>

  <div className="post-tabs">
    <span className="active-tab">Hot</span>
    <span>New</span>
    <span>Top</span>
  </div>
</div>

      {posts.map((post) => (
        <div className="post" key={post.id}>
          <span className="score">{post.likes}</span>

          <div>
            <h4>{post.title}</h4>
            <p>
              {post.author} • {post.time}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default TrendingPosts;