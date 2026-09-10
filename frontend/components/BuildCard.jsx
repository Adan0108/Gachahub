import { FiCompass, FiHeart } from "react-icons/fi";
import { Art } from "./Art";
import { builds } from "./constants";

export function BuildCard({ build, index = 0 }) {
  return (
    <article className="build-card">
      <Art tone={build.tone}>{build.icon || builds[index % builds.length].icon}</Art>
      <Link
        className="build-content-link"
        href={`/studio?character=${encodeURIComponent(build.name)}`}
      >
        <b>{build.name}</b>
        <span>{build.role}</span>
        <small>
          <FiHeart /> {build.likes} - <FiCompass /> {build.views}
        </small>
      </Link>
    </article>
  );
}
import Link from "next/link";
