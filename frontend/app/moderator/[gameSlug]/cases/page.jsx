import { CaseQueue } from "../../../../components/moderation/CaseQueue";
export default async function Page({ params, searchParams }) {
  const { gameSlug } = await params;
  return <CaseQueue gameSlug={gameSlug} query={await searchParams} />;
}
