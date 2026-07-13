import { FaSearch } from "react-icons/fa";
import { FaBell } from "react-icons/fa";
function Header({ searchTerm, setSearchTerm }) {
  return (
    <header className="topbar">
      <div className="search-wrapper">
  <FaSearch className="search-icon" />

  <input
    className="search"
    placeholder="Search games, characters, posts..."
    value={searchTerm}
    onChange={(e) => setSearchTerm(e.target.value)}
  />
</div>
      <div className="top-actions">
        <button>Create</button>
  <div className="notification">
  <FaBell />
  </div>
        <div className="avatar"></div>
      </div>
    </header>
  );
}

export default Header;

