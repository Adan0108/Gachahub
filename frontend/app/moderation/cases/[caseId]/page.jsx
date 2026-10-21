import { CaseDetail } from "../../../../components/moderation/CaseDetail";
export default async function Page({ params, searchParams }) {
  const { caseId } = await params;
  return <CaseDetail caseId={caseId} queue={(await searchParams)?.queue} />;
}
