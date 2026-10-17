import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { isOwnEmoteAssetUrl } from '../chat/utils/emote-asset-url';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/** Small flat pictures, drawn here so there is nothing to host: a circle with a white shape on it. */
const SAMPLE_EMOTES: Array<{
  shortcode: string;
  background: string;
  shape: string;
}> = [
  {
    shortcode: 'pity',
    background: '#8b6cff',
    shape:
      '<path d="M32 46 L18 32 a8 8 0 0 1 14 -9 a8 8 0 0 1 14 9 Z" fill="#fff"/>',
  },
  {
    shortcode: 'lucky',
    background: '#2fbf71',
    shape:
      '<polygon points="32,14 37,26 50,27 40,36 43,49 32,42 21,49 24,36 14,27 27,26" fill="#fff"/>',
  },
  {
    shortcode: 'salty',
    background: '#ff7ac8',
    shape: '<rect x="20" y="20" width="24" height="24" rx="4" fill="#fff"/>',
  },
  {
    shortcode: 'roll',
    background: '#3a9aff',
    shape:
      '<circle cx="32" cy="32" r="12" fill="none" stroke="#fff" stroke-width="5"/>',
  },
];

const SAMPLE_EMOTE_FOLDER = 'dev-emotes';

function sampleEmoteImage(background: string, shape: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="30" fill="${background}"/>${shape}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

@Injectable()
export class DevEmotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
  ) {
    // Same fail-closed guard as DevService: this uploads to our Cloudinary account
    if (env.nodeEnv !== 'development') {
      throw new InternalServerErrorException(
        'DevEmotesService must never be instantiated outside development',
      );
    }
  }

  /**
   * Adds a few global emotes for trying reactions without an upload; safe to run again.
   * The pictures go to our own Cloudinary account so they look and load like real ones.
   */
  async seedGlobalEmotes() {
    const created: string[] = [];
    const existing: string[] = [];
    const updated: string[] = [];

    for (const sample of SAMPLE_EMOTES) {
      const found = await this.prisma.chatEmote.findFirst({
        where: {
          scope: 'GLOBAL',
          shortcode: sample.shortcode,
          deletedAt: null,
        },
        select: { id: true, imageUrl: true },
      });
      // An earlier seed stored the picture inline; those are moved onto Cloudinary
      const needsPicture = !found || found.imageUrl?.startsWith('data:');
      if (found && !needsPicture) {
        existing.push(sample.shortcode);
        continue;
      }

      const upload = await this.uploadSamplePicture(sample);
      const picture = {
        imageUrl: upload.secureUrl,
        width: 64,
        height: 64,
        mimeType: 'image/svg+xml',
        fileSize: upload.bytes,
      };

      if (found) {
        await this.prisma.chatEmote.update({
          where: { id: found.id },
          data: picture,
        });
        updated.push(sample.shortcode);
      } else {
        await this.prisma.chatEmote.create({
          data: { scope: 'GLOBAL', shortcode: sample.shortcode, ...picture },
        });
        created.push(sample.shortcode);
      }
    }

    return { created, existing, updated };
  }

  private async uploadSamplePicture(sample: (typeof SAMPLE_EMOTES)[number]) {
    const upload = await this.cloudinaryService.uploadGeneratedImage({
      dataUri: sampleEmoteImage(sample.background, sample.shape),
      folder: SAMPLE_EMOTE_FOLDER,
      publicId: sample.shortcode,
    });

    // Same rule real emotes go through, so the seed can never hold a picture the app would refuse
    if (
      !isOwnEmoteAssetUrl(upload.secureUrl, this.cloudinaryService.cloudName)
    ) {
      throw new InternalServerErrorException(
        'Seeded emote picture did not land on our Cloudinary account',
      );
    }
    return upload;
  }
}
