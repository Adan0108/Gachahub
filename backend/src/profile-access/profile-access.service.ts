import { ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Who may see a person's profile details and their follower lists. Everyone may today; a
 * private-profile setting would change the answer here and nowhere else.
 */
@Injectable()
export class ProfileAccessService {
  canView(viewerId: string | undefined, ownerId: string): Promise<boolean> {
    void viewerId;
    void ownerId;
    return Promise.resolve(true);
  }

  async assertCanView(
    viewerId: string | undefined,
    ownerId: string,
  ): Promise<void> {
    if (!(await this.canView(viewerId, ownerId))) {
      throw new ForbiddenException('This profile is private');
    }
  }
}
