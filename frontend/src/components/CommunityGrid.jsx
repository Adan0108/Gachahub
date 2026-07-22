function CommunityGrid({ communities }) {
  return (
    <section className="community-grid">
      {communities.map((item) => (
        <div className="community-card" key={item.name}>

          <img src={item.image} alt={item.name} />

          <div className="overlay">
            <h3>{item.name}</h3>
            <span>{item.members}</span>
          </div>

        </div>
      ))}
    </section>
  );
}

export default CommunityGrid;