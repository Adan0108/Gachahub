import { Inject, Injectable } from '@nestjs/common';
import type { v2 as CloudinaryType } from 'cloudinary';
import { CLOUDINARY } from './cloudinary.constants';

type ResourceType = 'image' | 'video' | 'raw';

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

interface CloudinaryDeleteResult {
  result: string;
}

interface CloudinaryAssetResult {
  asset_id: string;
  public_id: string;
  resource_type: string;
  type: string;
  format?: string;
  bytes?: number;
  width?: number;
  height?: number;
  duration?: number;
  secure_url?: string;
}

@Injectable()
export class CloudinaryService {
  constructor(
    @Inject(CLOUDINARY)
    private readonly cloudinary: typeof CloudinaryType,
  ) {}

  /** Signs an upload authorization; only the returned parameters may be sent to Cloudinary. */
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

  /** Verifies the signature on Cloudinary's upload response. */
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

  /** Deletes one Cloudinary asset, invalidating cached CDN URLs. */
  async deleteAsset(
    publicId: string,
    resourceType: ResourceType,
  ): Promise<CloudinaryDeleteResult> {
    const result: unknown = await this.cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      invalidate: true,
    });

    return result as CloudinaryDeleteResult;
  }

  /** Optional strong verification via a Cloudinary API request; not needed when response signatures are verified. */
  async getAsset(
    publicId: string,
    resourceType: ResourceType,
  ): Promise<CloudinaryAssetResult> {
    const result: unknown = await this.cloudinary.api.resource(publicId, {
      resource_type: resourceType,
    });

    return result as CloudinaryAssetResult;
  }
}
