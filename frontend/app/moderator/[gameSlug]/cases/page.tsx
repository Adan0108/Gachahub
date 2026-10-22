import { CaseQueue } from "../../../../components/moderation/CaseQueue";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ gameSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { gameSlug } = await params;
  return <CaseQueue gameSlug={gameSlug} query={await searchParams} />;
}
