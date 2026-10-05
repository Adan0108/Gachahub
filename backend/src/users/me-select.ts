/** Every field `session.user` used to expose, plus the profile banner - see UsersService.getMe for why this is a live read instead. */
export const ME_SELECT = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  image: true,
  bannerPresetId: true,
  createdAt: true,
  updatedAt: true,
  role: true,
  status: true,
  messageRequestSetting: true,
  username: true,
  onboarded: true,
} as const;
