import { Inject, Injectable } from '@nestjs/common';
import type { v2 as CloudinaryType } from 'cloudinary';
import { CLOUDINARY } from './cloudinary.constants';

type ResourceType = 'image' | 'video';

interface GenerateUploadSignatureParams {
  publicId: string;
  folder: string;
  uploadPreset: string;
}

interface VerifyUploadResponseParams {
  publicId: string;
  version: number;
  signature: string;
}

@Injectable()
export class CloudinaryService {
  constructor(
    @Inject(CLOUDINARY)
    private readonly cloudinary: typeof CloudinaryType,
  ) {}

  /**
   * Generates a signed upload authorization.
   *
   * Only parameters returned here should be sent by the frontend to
   * Cloudinary. Changing any signed parameter invalidates the signature.
   */
  generateUploadSignature(params: GenerateUploadSignatureParams) {
    const timestamp = Math.floor(Date.now() / 1000);

    const paramsToSign = {
      timestamp,
      folder: params.folder,
      public_id: params.publicId,
      upload_preset: params.uploadPreset,
      overwrite: false,
    };

    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!apiSecret) {
      throw new Error('CLOUDINARY_API_SECRET is not configured');
    }

    const signature = this.cloudinary.utils.api_sign_request(
      paramsToSign,
      apiSecret,
    );

    return {
      timestamp,
      signature,
      paramsToSign,
    };
  }

  /**
   * Verifies the signature included in Cloudinary's successful upload
   * response.
   *
   * This prevents the backend from trusting arbitrary metadata submitted
   * by the browser without requiring another Cloudinary Admin API request.
   */
  verifyUploadResponse(params: VerifyUploadResponseParams): boolean {
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!apiSecret) {
      throw new Error('CLOUDINARY_API_SECRET is not configured');
    }

    const expectedSignature = this.cloudinary.utils.api_sign_request(
      {
        public_id: params.publicId,
        version: params.version,
      },
      apiSecret,
    );

    return expectedSignature === params.signature;
  }

  /**
   * Deletes one Cloudinary asset.
   *
   * invalidate=true requests CDN invalidation for already-cached derived
   * URLs. Asset deletion remains server-side because it requires signing.
   */
  async deleteAsset(publicId: string, resourceType: ResourceType) {
    return this.cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      invalidate: true,
    });
  }

  /**
   * Optional strong verification.
   *
   * This makes a network request to Cloudinary and should not be required
   * for every successful upload when response signatures are verified.
   * It can be used for auditing or suspicious uploads.
   */
  async getAsset(publicId: string, resourceType: ResourceType) {
    return this.cloudinary.api.resource(publicId, {
      resource_type: resourceType,
    });
  }
}
