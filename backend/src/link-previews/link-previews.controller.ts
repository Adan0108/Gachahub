import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { CreateLinkPreviewDto } from './dto/create-link-preview.dto';
import { LinkPreviewService } from './link-preview.service';

@ApiTags('Link previews')
@ApiCookieAuth('better-auth.session_token')
@Controller('link-previews')
export class LinkPreviewsController {
  constructor(private readonly linkPreviewService: LinkPreviewService) {}

  /** A POST because it makes the server fetch something, even though nothing is stored. */
  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Preview a link before sending it',
    description:
      'Fetches the page on the server and returns its title, description and picture. The sender attaches the result to the encrypted message; recipients never contact the linked site.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: [
        'url',
        'domain',
        'resolvedDomain',
        'title',
        'description',
        'siteName',
        'image',
      ],
      properties: {
        url: { type: 'string' },
        domain: { type: 'string' },
        resolvedDomain: {
          type: 'string',
          nullable: true,
          description:
            'Where the link really leads, when it redirects to another site.',
        },
        title: { type: 'string', nullable: true },
        description: { type: 'string', nullable: true },
        siteName: { type: 'string', nullable: true },
        image: {
          type: 'object',
          nullable: true,
          required: ['mime', 'data'],
          properties: {
            mime: {
              type: 'string',
              enum: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
            },
            data: {
              type: 'string',
              description: 'Base64 picture, at most about 1 MB.',
            },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Not a public http(s) link' })
  @ApiUnprocessableEntityResponse({
    description: 'The link has nothing to preview, or could not be fetched',
  })
  @ApiTooManyRequestsResponse({
    description:
      'Too many requests from you, or too many previews loading at once',
  })
  create(@Session() session: UserSession, @Body() dto: CreateLinkPreviewDto) {
    return this.linkPreviewService.getPreview(session.user.id, dto.url);
  }
}
