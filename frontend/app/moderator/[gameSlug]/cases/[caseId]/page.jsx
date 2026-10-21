import { CaseDetail } from "../../../../../components/moderation/CaseDetail";
export default async function Page({ params, searchParams }) {
  const { gameSlug, caseId } = await params;
  return <CaseDetail gameSlug={gameSlug} caseId={caseId} queue={(await searchParams)?.queue} />;
}
