import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type {
  MediaPurpose,
  MediaResourceType,
} from '../generated/prisma/client';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { RedisService } from '../redis/redis.service';
import {
  CreateUploadSignaturesDto,
  MediaPurposeDto,
  MediaResourceTypeDto,
} from './dto/create-upload-signatures.dto';
import { ConfirmMediaUploadsDto } from './dto/confirm-media-uploads.dto';
import { ConfirmMediaUploadDto } from './dto/confirm-media-upload.dto';
import { MediaRepository } from './media.repository';

const IMAGE_FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const VIDEO_FORMATS = new Set(['mp4', 'webm', 'mov']);

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

@Injectable()
export class MediaService {
  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly cloudinaryService: CloudinaryService,
    private readonly redisService: RedisService,
  ) {}

  async createUploadSignatures(dto: CreateUploadSignaturesDto, userId: string) {
    this.validateBatchPolicy(dto);
    await this.enforceSignatureRateLimit(userId);

    const items = await Promise.all(
      dto.items.map(async (item) => {
        const resourceType = item.resourceType as MediaResourceType;
        const purpose = dto.purpose as MediaPurpose;

        /*
         * The backend owns the complete public ID.
         *
         * A browser cannot upload into another user's folder by replacing
         * this value because folder/public_id are included in the signature.
         */
        const folder = this.createFolder(purpose, userId);
        const generatedName = randomUUID();
        const publicId = `${folder}/${generatedName}`;

        const upload = await this.mediaRepository.createInitiatedUpload({
          userId,
          purpose,
          resourceType,
          publicId,
        });

        const uploadPreset =
          resourceType === 'IMAGE'
            ? process.env.CLOUDINARY_IMAGE_UPLOAD_PRESET
            : process.env.CLOUDINARY_VIDEO_UPLOAD_PRESET;

        if (!uploadPreset) {
          throw new Error(
            `Missing Cloudinary upload preset for ${resourceType}`,
          );
        }

        /*
         * We include folder and public_id consistently in the signature.
         *
         * Because publicId already contains the folder path, the frontend
         * should send exactly the returned parameters and must not derive or
         * replace them independently.
         */
        const folderOnly = folder;
        const filenameOnly = generatedName;

        const signed = this.cloudinaryService.generateUploadSignature({
          folder: folderOnly,
          publicId: filenameOnly,
          uploadPreset,
        });

        return {
          uploadId: upload.id,
          cloudName: process.env.CLOUDINARY_CLOUD_NAME,
          apiKey: process.env.CLOUDINARY_API_KEY,
          resourceType: resourceType === 'IMAGE' ? 'image' : 'video',
          uploadUrl: this.createCloudinaryUploadUrl(resourceType),
          uploadPreset,
          folder: folderOnly,
          publicId: filenameOnly,
          fullPublicId: publicId,
          timestamp: signed.timestamp,
          signature: signed.signature,
          overwrite: false,
        };
      }),
    );

    return { items };
  }

  async confirmUploads(dto: ConfirmMediaUploadsDto, userId: string) {
    const uploadIds = dto.items.map((item) => item.uploadId);

    if (new Set(uploadIds).size !== uploadIds.length) {
      throw new BadRequestException(
        'Duplicate uploadId values are not allowed',
      );
    }

    const successful: Array<{
      uploadId: string;
      result: ReturnType<MediaService['formatUpload']>;
    }> = [];

    const failed: Array<{
      uploadId: string;
      statusCode: number;
      error: string;
    }> = [];

    /*
     * Process confirmations sequentially.
     *
     * This keeps database operations predictable and avoids issuing multiple
     * Prisma operations against the same adapter at the same time.
     * A maximum batch size of 10 keeps sequential processing reasonable.
     */
    for (const item of dto.items) {
      try {
        const result = await this.confirmUpload(item, userId);

        successful.push({
          uploadId: item.uploadId,
          result,
        });
      } catch (error: unknown) {
        if (error instanceof HttpException) {
          const response = error.getResponse();

          failed.push({
            uploadId: item.uploadId,
            statusCode: error.getStatus(),
            error:
              typeof response === 'string'
                ? response
                : this.getHttpExceptionMessage(response),
          });

          continue;
        }

        failed.push({
          uploadId: item.uploadId,
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Media upload confirmation failed',
        });
      }
    }

    return {
      total: dto.items.length,
      successfulCount: successful.length,
      failedCount: failed.length,
      successful,
      failed,
    };
  }

  private async confirmUpload(dto: ConfirmMediaUploadDto, userId: string) {
    const upload = await this.mediaRepository.findById(dto.uploadId);

    if (!upload) {
      throw new NotFoundException('Media upload not found');
    }

    if (upload.userId !== userId) {
      throw new ForbiddenException('You do not own this media upload');
    }

    if (upload.status === 'UPLOADED') {
      /*
       * Confirm is idempotent for a successful upload.
       */
      if (upload.assetId === dto.assetId && upload.publicId === dto.publicId) {
        return this.formatUpload(upload);
      }

      throw new ConflictException(
        'Media upload was already confirmed with different metadata',
      );
    }

    if (upload.status !== 'INITIATED') {
      throw new ConflictException(
        `Cannot confirm media upload in ${upload.status} state`,
      );
    }

    if (dto.publicId !== upload.publicId) {
      throw new BadRequestException(
        'Cloudinary public ID does not match the authorized upload',
      );
    }

    if (!this.isCloudinarySecureUrl(dto.secureUrl)) {
      throw new BadRequestException('Invalid Cloudinary secure URL');
    }

    const responseIsValid = this.cloudinaryService.verifyUploadResponse({
      publicId: dto.publicId,
      version: dto.version,
      signature: dto.signature,
    });

    if (!responseIsValid) {
      throw new BadRequestException(
        'Invalid Cloudinary upload response signature',
      );
    }

    this.validateUploadedAsset(upload.resourceType, dto);

    try {
      const confirmed = await this.mediaRepository.markUploaded({
        id: upload.id,
        assetId: dto.assetId,
        secureUrl: dto.secureUrl,
        version: dto.version,
        format: dto.format.toLowerCase(),
        bytes: dto.bytes,
        width: dto.width,
        height: dto.height,
        duration: dto.duration,
        responseSignature: dto.signature,
      });

      return this.formatUpload(confirmed);
    } catch (error) {
      /*
       * assetId is unique. This prevents confirming one Cloudinary asset
       * into multiple MediaUpload records.
       */
      console.log(error);
      throw new ConflictException(
        'This Cloudinary asset has already been registered',
      );
    }
  }

  async removePendingUpload(uploadId: string, userId: string) {
    const upload = await this.mediaRepository.findById(uploadId);

    if (!upload) {
      throw new NotFoundException('Media upload not found');
    }

    if (upload.userId !== userId) {
      throw new ForbiddenException('You do not own this media upload');
    }

    if (!['INITIATED', 'UPLOADED'].includes(upload.status)) {
      throw new ConflictException('Only unused media uploads can be removed');
    }

    if (upload.status === 'UPLOADED') {
      const resourceType = upload.resourceType === 'IMAGE' ? 'image' : 'video';

      await this.cloudinaryService.deleteAsset(upload.publicId, resourceType);
    }

    await this.mediaRepository.markDeleted(upload.id);

    return {
      message: 'Unused media upload deleted successfully',
    };
  }

  /**
   * Used by PostsService, CommentsService and ChatService before attaching
   * media.
   */
  async getAttachableUploads(params: {
    ids: string[];
    userId: string;
    purpose: MediaPurpose;
  }) {
    const uniqueIds = [...new Set(params.ids)];

    if (uniqueIds.length !== params.ids.length) {
      throw new BadRequestException(
        'Duplicate mediaUploadId values are not allowed',
      );
    }

    const uploads = await this.mediaRepository.findManyByIds(uniqueIds);

    if (uploads.length !== uniqueIds.length) {
      throw new BadRequestException('One or more media uploads do not exist');
    }

    for (const upload of uploads) {
      if (upload.userId !== params.userId) {
        throw new ForbiddenException(
          'One or more media uploads belong to another user',
        );
      }

      if (upload.purpose !== params.purpose) {
        throw new BadRequestException(
          `Media upload was created for ${upload.purpose}, not ${params.purpose}`,
        );
      }

      if (upload.status !== 'UPLOADED') {
        throw new BadRequestException(
          'Every media upload must be confirmed before attachment',
        );
      }

      if (
        !upload.assetId ||
        !upload.secureUrl ||
        !upload.format ||
        !upload.bytes
      ) {
        throw new BadRequestException('Media upload metadata is incomplete');
      }
    }

    return uploads;
  }

  private validateBatchPolicy(dto: CreateUploadSignaturesDto) {
    const images = dto.items.filter(
      (item) => item.resourceType === MediaResourceTypeDto.IMAGE,
    ).length;

    const videos = dto.items.filter(
      (item) => item.resourceType === MediaResourceTypeDto.VIDEO,
    ).length;

    if (dto.purpose === MediaPurposeDto.POST) {
      if (videos > 0 && images > 0) {
        throw new BadRequestException(
          'A post cannot mix images and video in the MVP',
        );
      }

      if (images > 10) {
        throw new BadRequestException('A post supports at most 10 images');
      }

      if (videos > 1) {
        throw new BadRequestException('A post supports at most one video');
      }
    }

    if (dto.purpose === MediaPurposeDto.COMMENT) {
      if (dto.items.length > 1) {
        throw new BadRequestException(
          'A comment supports at most one media attachment',
        );
      }
    }

    if (dto.purpose === MediaPurposeDto.CHAT) {
      if (videos > 1 || images > 4) {
        throw new BadRequestException(
          'A chat message supports up to four images or one video',
        );
      }

      if (videos > 0 && images > 0) {
        throw new BadRequestException(
          'A chat message cannot mix images and video',
        );
      }
    }

    if (
      [MediaPurposeDto.AVATAR, MediaPurposeDto.BANNER].includes(dto.purpose) &&
      (dto.items.length !== 1 || videos > 0)
    ) {
      throw new BadRequestException(
        'Avatar and banner uploads require exactly one image',
      );
    }
  }

  private validateUploadedAsset(
    resourceType: MediaResourceType,
    dto: ConfirmMediaUploadDto,
  ) {
    const format = dto.format.toLowerCase();

    if (resourceType === 'IMAGE') {
      if (!IMAGE_FORMATS.has(format)) {
        throw new BadRequestException(`Unsupported image format: ${format}`);
      }

      if (dto.bytes > MAX_IMAGE_BYTES) {
        throw new BadRequestException('Image exceeds the 10 MB limit');
      }

      if (!dto.width || !dto.height) {
        throw new BadRequestException('Image width and height are required');
      }
    }

    if (resourceType === 'VIDEO') {
      if (!VIDEO_FORMATS.has(format)) {
        throw new BadRequestException(`Unsupported video format: ${format}`);
      }

      if (dto.bytes > MAX_VIDEO_BYTES) {
        throw new BadRequestException('Video exceeds the 50 MB limit');
      }

      if (dto.duration === undefined) {
        throw new BadRequestException('Video duration is required');
      }
    }
  }

  private async enforceSignatureRateLimit(userId: string) {
    const limit = Number(process.env.MEDIA_SIGNATURE_RATE_LIMIT ?? 30);

    const windowSeconds = Number(
      process.env.MEDIA_SIGNATURE_RATE_WINDOW_SECONDS ?? 600,
    );

    if (!Number.isFinite(limit) || limit <= 0) {
      throw new Error('MEDIA_SIGNATURE_RATE_LIMIT must be a positive number');
    }

    if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
      throw new Error(
        'MEDIA_SIGNATURE_RATE_WINDOW_SECONDS must be a positive number',
      );
    }

    const key = `media:signature-rate:${userId}`;

    const count = await this.redisService.incrementWithExpiry(
      key,
      windowSeconds,
    );

    if (count > limit) {
      throw new HttpException(
        'Too many upload authorization requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private createFolder(purpose: MediaPurpose, userId: string): string {
    return `gachahub/${purpose.toLowerCase()}/${userId}`;
  }

  private createCloudinaryUploadUrl(resourceType: MediaResourceType): string {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;

    return `https://api.cloudinary.com/v1_1/${cloudName}/${
      resourceType === 'IMAGE' ? 'image' : 'video'
    }/upload`;
  }

  private isCloudinarySecureUrl(value: string): boolean {
    try {
      const url = new URL(value);

      return url.protocol === 'https:' && url.hostname === 'res.cloudinary.com';
    } catch {
      return false;
    }
  }

  private getHttpExceptionMessage(response: object): string {
    if ('message' in response && typeof response.message === 'string') {
      return response.message;
    }

    if ('message' in response && Array.isArray(response.message)) {
      return response.message.join(', ');
    }

    return 'Media upload confirmation failed';
  }

  private formatUpload(upload: {
    id: string;
    purpose: MediaPurpose;
    resourceType: MediaResourceType;
    status: string;
    secureUrl: string | null;
    width: number | null;
    height: number | null;
    duration: number | null;
  }) {
    return {
      mediaUploadId: upload.id,
      purpose: upload.purpose,
      resourceType: upload.resourceType,
      status: upload.status,
      secureUrl: upload.secureUrl,
      width: upload.width,
      height: upload.height,
      duration: upload.duration,
    };
  }
}
