import { CaseDetail } from "../../../../components/moderation/CaseDetail";
const queueOf = (query: Record<string, string | string[] | undefined>) =>
  typeof query?.queue === "string" ? query.queue : undefined;

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { caseId } = await params;
  return <CaseDetail caseId={caseId} queue={queueOf(await searchParams)} />;
}
