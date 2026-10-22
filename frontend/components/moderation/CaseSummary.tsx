import Image from "next/image";
import { FiFileText, FiMessageCircle } from "react-icons/fi";

export type CaseReason = { reasonCode: string; count: number };
export type CasePreviewItem = {
  targetType: string;
  targetState?: string;
  targetPreview?: {
    title?: string | null;
    excerpt?: string | null;
    thumbnailUrl?: string | null;
    author?: { name?: string | null; username?: string | null } | null;
  } | null;
  game?: { name?: string | null; slug?: string } | null;
};
export type CaseListItem = CasePreviewItem & {
  id: string;
  status: string;
  reasonSummary?: CaseReason[];
  uniqueReporterCount: number;
  assignedModerator?: { id: string; name?: string | null; role?: string | null } | null;
  currentRiskLevel?: string | null;
  lastReportedAt: string;
};

const REASON_LABELS: Record<string, string> = {
    UNMARKED_SPOILERS: "Spoilers",
    HARASSMENT: "Harassment",
    HATE: "Hate speech",
    VIOLENCE: "Violence",
    COMMERCIAL_SPAM: "Spam",
    SPAM: "Spam",
    SCAM: "Scam",
    IMPERSONATION: "Impersonation",
    MISINFORMATION: "Misinformation",
    NSFW: "Explicit content",
    OTHER: "Other concern",
};
export const reasonLabel = (reason: string) => REASON_LABELS[reason] || "Other concern";

export function ReasonSummary({
  reasons = [],
  compact = false,
}: {
  reasons?: CaseReason[];
  compact?: boolean;
}) {
  const visible = compact ? reasons.slice(0, 2) : reasons;
  return reasons.length ? (
    <div className="case-reasons">
      {visible.map((reason) => (
        <span className="case-reason" key={reason.reasonCode}>
          {reasonLabel(reason.reasonCode)} <b>×{reason.count}</b>
        </span>
      ))}
      {compact && reasons.length > 2 && <small>+{reasons.length - 2} more</small>}
    </div>
  ) : (
    <span className="case-muted">No reports available</span>
  );
}

export function previewTitle(item: CasePreviewItem) {
  if (item.targetState === "deleted") return "Content deleted";
  if (!item.targetPreview) return "Content unavailable";
  return (
    item.targetPreview.title ||
    item.targetPreview.excerpt ||
    (item.targetType === "COMMENT" ? "Comment without text" : "Post without text")
  );
}

export function ContentPreview({ item }: { item: CasePreviewItem }) {
  const preview = item.targetPreview;
  const hasImage =
    typeof preview?.thumbnailUrl === "string" && /^https?:\/\//i.test(preview.thumbnailUrl);
  return (
    <div className="case-content-preview">
      <span className="case-thumbnail">
        {hasImage ? (
          <Image
            unoptimized
            src={preview?.thumbnailUrl ?? ""}
            width={56}
            height={56}
            alt="Reported post thumbnail"
          />
        ) : item.targetType === "COMMENT" ? (
          <FiMessageCircle aria-hidden="true" />
        ) : (
          <FiFileText aria-hidden="true" />
        )}
      </span>
      <div>
        <strong className="case-preview-title">{previewTitle(item)}</strong>
        {preview?.title && preview.excerpt && (
          <span className="case-preview-excerpt">{preview.excerpt}</span>
        )}
        <small>
          {item.game?.name || "Outside a community"} ·{" "}
          {preview?.author?.name ||
            (preview?.author?.username ? `@${preview.author.username}` : "Author unavailable")}
        </small>
        <small>{item.targetType === "COMMENT" ? "Comment" : "Post"}</small>
      </div>
    </div>
  );
}
