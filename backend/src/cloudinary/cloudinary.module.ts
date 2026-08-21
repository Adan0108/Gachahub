import { Global, Module } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { CLOUDINARY } from './cloudinary.constants';
import { CloudinaryService } from './cloudinary.service';

/**
 * Provides a single configured Cloudinary SDK instance.
 *
 * API secrets remain server-side. Feature modules use CloudinaryService
 * instead of importing/configuring the Cloudinary SDK independently.
 */
@Global()
@Module({
  providers: [
    {
      provide: CLOUDINARY,
      useFactory: () => {
        const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
        const apiKey = process.env.CLOUDINARY_API_KEY;
        const apiSecret = process.env.CLOUDINARY_API_SECRET;

        if (!cloudName || !apiKey || !apiSecret) {
          throw new Error(
            'Missing CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY or CLOUDINARY_API_SECRET',
          );
        }

        cloudinary.config({
          cloud_name: cloudName,
          api_key: apiKey,
          api_secret: apiSecret,
          secure: true,
        });

        return cloudinary;
      },
    },
    CloudinaryService,
  ],
  exports: [CloudinaryService],
})
export class CloudinaryModule {}
