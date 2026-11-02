"use client";

import { useQuery } from "@tanstack/react-query";
import { ProfileState } from "../../components/profile/ProfileState";
import { ProfileView } from "../../components/profile/ProfileView";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { queries } from "../../lib/queries";

/** Your own profile. */
export default function ProfilePage() {
  const { user, isLoading: isSessionLoading } = useRequireAuth();
  const profile = useQuery(queries.userProfile(user?.id));

  if (!user) {
    return (
      <ProfileState
        message={
          isSessionLoading
            ? "Checking your GachaHub session..."
            : "Redirecting you to the login page..."
        }
        title={isSessionLoading ? "Loading your profile" : "Sign in required"}
      />
    );
  }
  if (!profile.data) {
    return profile.isError ? (
      <ProfileState
        message="Could not load your profile. Try again in a moment."
        title="Profile unavailable"
      />
    ) : (
      <ProfileState message="Getting your profile..." title="Loading your profile" />
    );
  }

  return <ProfileView isSelf me={user} profile={profile.data} />;
}
