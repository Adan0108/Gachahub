import { MediaReferenceDto } from '../../media/dto/media-reference.dto';

/**
 * No altText, unlike PostMediaReferenceDto: chat message content (including
 * any caption) is meant to live inside the encrypted payload, not as a
 * plaintext DB column.
 */
export class ChatMediaReferenceDto extends MediaReferenceDto {}
