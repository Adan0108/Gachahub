import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { ChatBackupService } from './chat-backup.service';
import { BackupProofDto } from './dto/backup-proof.dto';
import { DeleteBackupDto } from './dto/delete-backup.dto';
import { ListBlobsQueryDto } from './dto/list-blobs-query.dto';
import { PutBackupKeyDto } from './dto/put-backup-key.dto';
import { UploadBlobsDto } from './dto/upload-blobs.dto';

@ApiTags('Chat Backup')
@ApiCookieAuth('better-auth.session_token')
@Controller('chat-backup')
export class ChatBackupController {
  constructor(private readonly service: ChatBackupService) {}

  @Get()
  @ApiOperation({ summary: 'Whether history backup is on, plus its usage' })
  status(@Session() session: UserSession) {
    return this.service.getStatus(session.user.id);
  }

  @Get('challenge')
  @ApiOperation({ summary: 'Single-use nonce for proving key ownership' })
  challenge(@Session() session: UserSession) {
    return this.service.issueChallenge(session.user.id);
  }

  @Put()
  @ApiOperation({
    summary:
      'Turn backup on; replacing the key needs replace: true and a proof, and deletes existing blobs',
  })
  putKey(@Session() session: UserSession, @Body() dto: PutBackupKeyDto) {
    return this.service.putKey(session.user.id, dto);
  }

  @Delete()
  @ApiOperation({
    summary:
      'Needs confirm: true. With a nonce and proof, turns backup off and deletes every blob at once; without, schedules that deletion',
  })
  disable(@Session() session: UserSession, @Body() dto: DeleteBackupDto) {
    return this.service.disable(session.user.id, dto);
  }

  @Delete('schedule')
  @ApiOperation({
    summary: 'Cancel a scheduled deletion; needs a nonce and proof',
  })
  cancelDeletion(@Session() session: UserSession, @Body() dto: BackupProofDto) {
    return this.service.cancelDeletion(session.user.id, dto);
  }

  @Post('blobs')
  @ApiOperation({ summary: 'Upload a batch of encrypted message backups' })
  uploadBlobs(@Session() session: UserSession, @Body() dto: UploadBlobsDto) {
    return this.service.uploadBlobs(session.user.id, dto.items);
  }

  @Get('blobs')
  @ApiOperation({ summary: 'Page through your encrypted message backups' })
  listBlobs(
    @Session() session: UserSession,
    @Query() query: ListBlobsQueryDto,
  ) {
    return this.service.listBlobs(session.user.id, query.after, query.limit);
  }
}
