import { BadRequestException } from '@nestjs/common';
import { decodeMlsMessage } from 'ts-mls';
import { bytesEqual } from '../common/utils/bytes';

/**
 * A GroupInfo is the public snapshot a device joins from, so what the server
 * hands out must at least be one, for this conversation, at the epoch it says.
 * It is signed by a member, but the server does not judge that: a joining
 * device checks the tree inside it against the server's roster before it acts.
 */
export function assertIsGroupInfoFor(
  payload: Uint8Array,
  conversationId: string,
  epoch: number,
): void {
  let decoded: ReturnType<typeof decodeMlsMessage>;
  try {
    decoded = decodeMlsMessage(payload, 0);
  } catch {
    throw new BadRequestException('GroupInfo is not a valid MLS message');
  }

  const message = decoded?.[0];
  if (message?.wireformat !== 'mls_group_info') {
    throw new BadRequestException('Expected an MLS GroupInfo message');
  }

  const { groupContext } = message.groupInfo;
  if (
    !bytesEqual(groupContext.groupId, new TextEncoder().encode(conversationId))
  ) {
    throw new BadRequestException(
      'GroupInfo group_id does not match this conversation',
    );
  }
  if (groupContext.epoch !== BigInt(epoch)) {
    throw new BadRequestException(
      'GroupInfo epoch is not the epoch this commit creates',
    );
  }
}
