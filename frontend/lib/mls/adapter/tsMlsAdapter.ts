import type { MlsClientCandidate } from '../contract/contractTests';
import { TsMlsDeviceIdentityStore } from './tsMlsDeviceIdentityStore';
import { TsMlsGroupSessionFactory } from './tsMlsGroupSessionFactory';

export { CIPHERSUITE_NAME } from './tsMlsShared';
export { SESSION_LINK_LABEL, TsMlsDeviceIdentityStore } from './tsMlsDeviceIdentityStore';
export { TsMlsGroupSessionFactory } from './tsMlsGroupSessionFactory';

export const tsMlsCandidate: MlsClientCandidate = {
  name: 'ts-mls',
  createDeviceIdentityStore: () => new TsMlsDeviceIdentityStore(),
  createGroupSessionFactory: (store) =>
    new TsMlsGroupSessionFactory(store as TsMlsDeviceIdentityStore),
};
