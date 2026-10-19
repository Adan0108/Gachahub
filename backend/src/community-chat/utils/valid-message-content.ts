import { BadRequestException } from '@nestjs/common';
import { COMMUNITY_MESSAGE_MAX_CHARS } from '../community-chat.constants';
import { cleanMessageContent } from './clean-message-content';

/** The text to store for a message someone typed, or a 400 saying why it cannot be posted. */
export function validMessageContent(raw: string): string {
  const content = cleanMessageContent(raw);
  if (!content) throw new BadRequestException('Message cannot be empty');
  if (Array.from(content).length > COMMUNITY_MESSAGE_MAX_CHARS) {
    throw new BadRequestException(
      `Message is too long (max ${COMMUNITY_MESSAGE_MAX_CHARS} characters)`,
    );
  }
  return content;
}
