import Link from "next/link";
import { Art } from "./Art";
import { artTones } from "./constants";
import type { GameRecord } from "../lib/pageTypes";

export function CommunityGrid({
  communities,
  compact = false,
}: {
  communities: GameRecord[];
  compact?: boolean;
}) {
  return (
    <div className={`community-grid ${compact ? "compact" : ""}`}>
      {communities.map((community, index) => (
        <Link
          className="community-card"
          key={community.id || community.slug}
          href={`/community/${encodeURIComponent(community.slug)}`}
        >
          <Art tone={artTones[index % artTones.length]}>{community.symbol}</Art>
          <div>
            <b>{community.name}</b>
            <span>{community.members} Members</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
