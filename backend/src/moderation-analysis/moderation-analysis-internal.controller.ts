import {
  BadRequestException,
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { ApiExcludeController } from '@nestjs/swagger';
import { ModerationServiceAuthGuard } from './moderation-service-auth.guard';
import { ModerationAnalysisInputService } from './moderation-analysis-input.service';

@ApiExcludeController()
// Bypass only the Better Auth session requirement. Service guard remains required.
@AllowAnonymous()
@Controller('internal/moderation/analyses')
@UseGuards(ModerationServiceAuthGuard)
export class ModerationAnalysisInternalController {
  constructor(private readonly inputs: ModerationAnalysisInputService) {}

  @Get(':analysisJobId/input')
  getInput(@Param('analysisJobId') analysisJobId: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(analysisJobId)) {
      throw new BadRequestException('Invalid analysis job identifier');
    }
    return this.inputs.getInput(analysisJobId);
  }
}
