import { CaseQueue } from "../../../components/moderation/CaseQueue";
export default async function Page({ searchParams }) {
  return <CaseQueue query={await searchParams} />;
}
