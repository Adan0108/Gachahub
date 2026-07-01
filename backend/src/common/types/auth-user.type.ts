export type AuthUser = {
  id: string;
  name?: string | null;
  email: string;
  emailVerified?: boolean;
  image?: string | null;
};
