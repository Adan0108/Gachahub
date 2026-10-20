import { CaseQueue } from "../../../../components/moderation/CaseQueue";
export default async function Page({ params }) {
  const { gameSlug } = await params;
  return <CaseQueue gameSlug={gameSlug} />;
}
