import { api } from '../../api';
import type { Epoch } from '../contract/types';
import { readPage } from './pagedResponse';

// Mirrors the backend's per-request handshake cap
export const HANDSHAKE_PAGE_SIZE = 100;
export const WELCOME_PAGE_SIZE = 50;

/** Whether the server's own log holds exactly these bytes at their epoch (the first Commit at an epoch is on the first page). */
export async function serverLogHolds(
  conversationId: string,
  sent: { epoch: Epoch; payload: string },
): Promise<boolean> {
  const page = readPage<{ epoch: Epoch; payload: string }>(
    await api.getMlsHandshakesSince(conversationId, sent.epoch),
    'handshakes',
    HANDSHAKE_PAGE_SIZE,
  );
  return page.items.some(
    (handshake) => handshake.epoch === sent.epoch && handshake.payload === sent.payload,
  );
}
