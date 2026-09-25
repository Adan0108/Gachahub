import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
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
import {
  cloudinaryResourceTypeFor,
  MAX_PENDING_OPAQUE_UPLOADS,
  opaqueFolder,
  opaqueKindOf,
  OPAQUE_MAX_BYTES,
  rawDeliveryUrl,
  type OpaqueBlobKind,
} from './opaque-blob';

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
    await this.enforceSignatureRateLimit(userId, dto.items.length);
    await this.enforcePendingOpaqueCap(userId, dto);

    const items = await Promise.all(
      dto.items.map(async (item) => {
        const opaqueKind = item.opaqueKind as OpaqueBlobKind | undefined;
        // opaque rows have no schema value of their own; IMAGE is never read for them
        const resourceType = (item.resourceType ??
          'IMAGE') as MediaResourceType;
        const purpose = dto.purpose as MediaPurpose;

        /*
         * The backend owns the complete public ID.
         *
         * A browser cannot upload into another user's folder by replacing
         * this value because folder/public_id are included in the signature.
         */
        const folder = opaqueKind
          ? opaqueFolder(opaqueKind, userId)
          : this.createFolder(purpose, userId);
        const generatedName = randomUUID();
        const publicId = `${folder}/${generatedName}`;

        const upload = await this.mediaRepository.createInitiatedUpload({
          userId,
          purpose,
          resourceType,
          publicId,
          opaqueKind,
        });

        // size caps: preset in the Cloudinary console + getAsset check at confirm
        const uploadPreset = this.uploadPresetFor(resourceType, opaqueKind);

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
          resourceType: cloudinaryResourceTypeFor({
            publicId,
            resourceType,
            opaqueKind,
          }),
          uploadUrl: this.createCloudinaryUploadUrl(
            publicId,
            resourceType,
            opaqueKind,
          ),
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

    const verifiedBytes = await this.validateUploadedAsset(upload, dto);

    try {
      const confirmed = await this.mediaRepository.markUploaded({
        id: upload.id,
        assetId: dto.assetId,
        secureUrl: dto.secureUrl,
        version: dto.version,
        format: (dto.format ?? 'bin').toLowerCase(),
        bytes: verifiedBytes,
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
      await this.destroyCloudinaryAsset(upload);
    }

    await this.mediaRepository.markDeleted(upload.id);

    return {
      message: 'Unused media upload deleted successfully',
    };
  }

  /**
   * Deletes the Cloudinary asset and marks an already-attached upload as
   * deleted, for callers whose parent record (e.g. a chat message) was just
   * deleted. No ownership check: the caller already verified it can modify
   * whatever this upload was attached to.
   *
   * No-op if the upload is missing or not ATTACHED, so a caller can safely
   * retry without needing to track whether a prior attempt partially ran.
   */
  async releaseAttachedUpload(mediaUploadId: string): Promise<void> {
    const released = await this.destroyAttachedCloudinaryAsset(mediaUploadId);

    if (released) {
      await this.mediaRepository.markDeleted(mediaUploadId);
    }
  }

  /**
   * Destroys the Cloudinary asset for an upload that still needs releasing
   * (ATTACHED, or RELEASE_FAILED from a previous failed attempt) without
   * touching its row. Returns false (no-op) if the upload is missing or
   * already released.
   *
   * For a caller that must also drop its own link row (e.g. ChatMessageMedia)
   * atomically with marking the upload DELETED - so a crash between the two
   * writes can never leave a link row pointing at a dead upload - call this
   * first, then do both DB writes together in one transaction.
   */
  async destroyAttachedCloudinaryAsset(
    mediaUploadId: string,
  ): Promise<boolean> {
    const upload = await this.mediaRepository.findById(mediaUploadId);

    if (
      !upload ||
      (upload.status !== 'ATTACHED' && upload.status !== 'RELEASE_FAILED')
    ) {
      return false;
    }

    await this.destroyCloudinaryAsset(upload);

    return true;
  }

  /**
   * Flags an upload whose release failed so a retry job can pick it back up
   * on a backoff, instead of it sitting ATTACHED - permanently excluded from
   * cleanup - forever. Callers call this from their own catch block and
   * should treat it as best-effort too: a failure here shouldn't block
   * whatever they were already handling.
   */
  async markReleaseFailed(mediaUploadId: string): Promise<void> {
    await this.mediaRepository.markReleaseFailed(mediaUploadId);
  }

  /**
   * Shared tail for removePendingUpload/releaseAttachedUpload: only the
   * Cloudinary call, callers decide when it's needed and always follow up
   * with their own markDeleted.
   */
  private async destroyCloudinaryAsset(upload: {
    publicId: string;
    resourceType: MediaResourceType;
    opaqueKind?: OpaqueBlobKind | null;
  }): Promise<void> {
    await this.cloudinaryService.deleteAsset(
      upload.publicId,
      cloudinaryResourceTypeFor(upload),
    );
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

  /**
   * getAttachableUploads plus the count/mix policy every attach flow needs:
   * every id must resolve, and images/video can't exceed the caller's limits
   * or mix. Shared by PostsService and ChatService so the two don't drift.
   *
   * Callers still do their own final mapping to whatever shape their
   * PostMedia/ChatMessageMedia row needs - that part isn't shared since the
   * two genuinely differ (e.g. posts distinguish GIF, chat doesn't have
   * altText).
   */
  async resolveAttachableMedia(params: {
    ids: string[];
    userId: string;
    purpose: MediaPurpose;
    maxImages: number;
    maxVideos: number;
    entityLabel: string;
    // omit to reject opaque blobs for callers that don't support them
    maxOpaqueBlobs?: number;
  }) {
    if (params.ids.length === 0) {
      return [];
    }

    const uploads = await this.getAttachableUploads({
      ids: params.ids,
      userId: params.userId,
      purpose: params.purpose,
    });

    if (uploads.length !== params.ids.length) {
      const resolved = new Set(uploads.map((upload) => upload.id));
      const missing = params.ids.filter((id) => !resolved.has(id));

      throw new BadRequestException(
        `Media uploads cannot be attached: ${missing.join(', ')}`,
      );
    }

    const opaqueKinds = uploads.map((upload) => opaqueKindOf(upload));

    if (opaqueKinds.some((kind) => kind !== null)) {
      this.assertOpaquePolicy(opaqueKinds, params);

      return uploads;
    }

    const imageCount = uploads.filter(
      (upload) => upload.resourceType === 'IMAGE',
    ).length;
    const videoCount = uploads.filter(
      (upload) => upload.resourceType === 'VIDEO',
    ).length;

    if (imageCount > params.maxImages) {
      throw new BadRequestException(
        `A ${params.entityLabel} supports at most ${params.maxImages} image${params.maxImages === 1 ? '' : 's'}`,
      );
    }

    if (videoCount > params.maxVideos) {
      throw new BadRequestException(
        `A ${params.entityLabel} supports at most ${params.maxVideos} video${params.maxVideos === 1 ? '' : 's'}`,
      );
    }

    if (imageCount > 0 && videoCount > 0) {
      throw new BadRequestException(
        `A ${params.entityLabel} cannot mix images and video`,
      );
    }

    return uploads;
  }

  private assertOpaquePolicy(
    kinds: Array<OpaqueBlobKind | null>,
    params: { maxOpaqueBlobs?: number; entityLabel: string },
  ) {
    if (kinds.some((kind) => kind === null)) {
      throw new BadRequestException(
        `A ${params.entityLabel} cannot mix encrypted and plain media`,
      );
    }

    if (!params.maxOpaqueBlobs) {
      throw new BadRequestException(
        `A ${params.entityLabel} does not support encrypted attachments`,
      );
    }

    const blobs = kinds.filter((kind) => kind === 'BLOB').length;
    const thumbs = kinds.length - blobs;

    if (blobs > params.maxOpaqueBlobs) {
      throw new BadRequestException(
        `A ${params.entityLabel} supports at most ${params.maxOpaqueBlobs} encrypted attachments`,
      );
    }

    if (thumbs > blobs) {
      throw new BadRequestException(
        'Encrypted thumbnails cannot outnumber their attachments',
      );
    }
  }

  private validateBatchPolicy(dto: CreateUploadSignaturesDto) {
    for (const item of dto.items) {
      if (!item.resourceType === !item.opaqueKind) {
        throw new BadRequestException(
          'Each item needs exactly one of resourceType or opaqueKind',
        );
      }

      if (item.opaqueKind && dto.purpose !== MediaPurposeDto.CHAT) {
        throw new BadRequestException(
          'Opaque uploads are only allowed for chat',
        );
      }
    }

    // opaque counts are enforced at attach time
    const opaqueItems = dto.items.filter((item) => item.opaqueKind).length;

    if (opaqueItems > 0 && opaqueItems < dto.items.length) {
      throw new BadRequestException(
        'A batch cannot mix encrypted and plain media',
      );
    }

    if (opaqueItems > 0) {
      return;
    }

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

  /** Returns the byte size to store: Cloudinary's own figure for opaque blobs. */
  private async validateUploadedAsset(
    upload: {
      publicId: string;
      resourceType: MediaResourceType;
      opaqueKind?: OpaqueBlobKind | null;
    },
    dto: ConfirmMediaUploadDto,
  ): Promise<number> {
    const opaqueKind = opaqueKindOf(upload);

    if (opaqueKind) {
      await this.verifyOpaqueAsset(opaqueKind, upload.publicId, dto);

      return dto.bytes;
    }

    const resourceType = upload.resourceType;

    if (!dto.format) {
      throw new BadRequestException('Media format is required');
    }

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

    return dto.bytes;
  }

  private async verifyOpaqueAsset(
    kind: OpaqueBlobKind,
    publicId: string,
    dto: ConfirmMediaUploadDto,
  ): Promise<void> {
    const cap = OPAQUE_MAX_BYTES[kind];
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;

    if (!cloudName) {
      throw new Error('CLOUDINARY_CLOUD_NAME is not configured');
    }

    // the response signature only covers public_id+version, so pin the URL
    const expectedUrl = rawDeliveryUrl({
      cloudName,
      version: dto.version,
      publicId,
    });

    if (dto.secureUrl !== expectedUrl) {
      throw new BadRequestException(
        'Opaque upload URL does not match its asset',
      );
    }

    if (dto.bytes > cap) {
      throw new BadRequestException(
        `Encrypted upload exceeds the ${cap / 1024} KB limit`,
      );
    }

    // client-asserted bytes/assetId are untrusted; ask Cloudinary
    let asset: Awaited<ReturnType<CloudinaryService['getAsset']>>;

    try {
      asset = await this.cloudinaryService.getAsset(publicId, 'raw');
    } catch {
      throw new ServiceUnavailableException('Could not verify the upload');
    }

    if (
      asset.resource_type !== 'raw' ||
      asset.asset_id !== dto.assetId ||
      typeof asset.bytes !== 'number' ||
      asset.bytes > cap
    ) {
      throw new BadRequestException('Encrypted upload failed verification');
    }
  }

  private async enforcePendingOpaqueCap(
    userId: string,
    dto: CreateUploadSignaturesDto,
  ) {
    const requested = dto.items.filter((item) => item.opaqueKind).length;

    if (requested === 0) {
      return;
    }

    const pending = await this.mediaRepository.countPendingOpaque(userId);

    if (pending + requested > MAX_PENDING_OPAQUE_UPLOADS) {
      throw new HttpException(
        'Too many unattached encrypted uploads',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  // counts items, not requests, so a full batch costs what its uploads cost
  private async enforceSignatureRateLimit(userId: string, items: number) {
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

    for (let i = 0; i < items; i++) {
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
  }

  private createFolder(purpose: MediaPurpose, userId: string): string {
    return `gachahub/${purpose.toLowerCase()}/${userId}`;
  }

  private createCloudinaryUploadUrl(
    publicId: string,
    resourceType: MediaResourceType,
    opaqueKind?: OpaqueBlobKind,
  ): string {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const kind = cloudinaryResourceTypeFor({
      publicId,
      resourceType,
      opaqueKind,
    });

    return `https://api.cloudinary.com/v1_1/${cloudName}/${kind}/upload`;
  }

  private uploadPresetFor(
    resourceType: MediaResourceType,
    opaqueKind?: OpaqueBlobKind,
  ): string {
    const [name, preset] = opaqueKind
      ? ['CHAT_BLOB', process.env.CLOUDINARY_CHAT_BLOB_UPLOAD_PRESET]
      : resourceType === 'IMAGE'
        ? ['IMAGE', process.env.CLOUDINARY_IMAGE_UPLOAD_PRESET]
        : ['VIDEO', process.env.CLOUDINARY_VIDEO_UPLOAD_PRESET];

    if (!preset) {
      throw new Error(`Missing Cloudinary upload preset for ${name}`);
    }

    return preset;
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
