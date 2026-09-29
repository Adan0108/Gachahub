import { EncryptedIndexedDbMembershipEventStorage } from '../storage/membershipEventStorage';
import { MembershipEventLog } from './membershipEventLog';

/** One per tab: the sync engine writes to it, the thread reads and subscribes; tabs notify each other. */
export const membershipEventLog = new MembershipEventLog(
  new EncryptedIndexedDbMembershipEventStorage(),
  'gachahub-membership-events',
);
