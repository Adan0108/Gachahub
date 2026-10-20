import { CaseDetail } from "../../../../components/moderation/CaseDetail";
export default async function Page({ params }) {
  const { caseId } = await params;
  return <CaseDetail caseId={caseId} />;
}
