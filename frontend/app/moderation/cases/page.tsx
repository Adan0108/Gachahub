import { CaseQueue } from "../../../components/moderation/CaseQueue";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <CaseQueue query={await searchParams} />;
}
