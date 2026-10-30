import { AppealsQueue } from "../../../../components/moderation/Appeals";
export default async function Page({ params }: { params: Promise<{ gameSlug: string }> }) { return <AppealsQueue gameSlug={(await params).gameSlug} />; }
