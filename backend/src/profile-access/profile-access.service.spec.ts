import { ProfileAccessService } from './profile-access.service';

describe('ProfileAccessService', () => {
  const service = new ProfileAccessService();

  it('lets anyone see any profile for now, signed in or not', async () => {
    await expect(service.canView(undefined, 'bo')).resolves.toBe(true);
    await expect(service.canView('me', 'bo')).resolves.toBe(true);
    await expect(service.canView('me', 'me')).resolves.toBe(true);
  });

  it('does not throw for a profile that can be seen', async () => {
    await expect(service.assertCanView('me', 'bo')).resolves.toBeUndefined();
  });
});
