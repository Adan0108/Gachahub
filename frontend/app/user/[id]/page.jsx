"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ProfileState } from "../../../components/profile/ProfileState";
import { ProfileView } from "../../../components/profile/ProfileView";
import { useCurrentUser } from "../../../hooks/useCurrentUser";
import { queries } from "../../../lib/queries";

/** Someone's public profile; your own id goes to your own page instead. */
export default function UserProfilePage() {
  const { id } = useParams();
  const router = useRouter();
  const { user: me, isLoading: isSessionLoading } = useCurrentUser();
  const profile = useQuery(queries.userProfile(id));
  const isSelf = Boolean(me) && me.id === id;

  useEffect(() => {
    if (isSelf) router.replace("/profile");
  }, [isSelf, router]);

  if (isSelf || profile.isLoading || isSessionLoading) {
    return <ProfileState message="Getting this profile..." title="Loading profile" />;
  }
  if (profile.error?.status === 404 || !profile.data) {
    return (
      <ProfileState
        message="This person may have left, or the link is wrong."
        title="User not found"
      />
    );
  }

  return <ProfileView isSelf={false} me={me} profile={profile.data} />;
}
