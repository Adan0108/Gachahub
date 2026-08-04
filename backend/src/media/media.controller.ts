import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { ConfirmMediaUploadsDto } from './dto/confirm-media-uploads.dto';
import { CreateUploadSignaturesDto } from './dto/create-upload-signatures.dto';
import { MediaService } from './media.service';

@ApiTags('Media')
@ApiCookieAuth('better-auth.session_token')
@Controller('media/uploads')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('signatures')
  @ApiOperation({
    summary: 'Create signed Cloudinary upload authorizations',
  })
  createSignatures(
    @Body() dto: CreateUploadSignaturesDto,
    @Session() session: UserSession,
  ) {
    return this.mediaService.createUploadSignatures(dto, session.user.id);
  }

  @Post('confirm')
  @ApiOperation({
    summary: 'Confirm and register one or more successful Cloudinary uploads',
  })
  confirmUploads(
    @Body() dto: ConfirmMediaUploadsDto,
    @Session() session: UserSession,
  ) {
    return this.mediaService.confirmUploads(dto, session.user.id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete an unused media upload owned by the current user',
  })
  removePendingUpload(
    @Param('id') id: string,
    @Session() session: UserSession,
  ) {
    return this.mediaService.removePendingUpload(id, session.user.id);
  }
}
