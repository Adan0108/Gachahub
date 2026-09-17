import { BadRequestException } from '@nestjs/common';
import {
  buildTestApplicationMessage,
  buildTestCommitWithWelcome,
} from './test-support/build-test-commit';
import {
  assertIsApplicationMessage,
  assertIsCommitForConversation,
  assertIsWelcomeMessage,
} from './mls-handshake-framing.util';

describe('assertIsCommitForConversation', () => {
  it('accepts a real commit addressed to its own conversation', async () => {
    const { commitPayload, epoch } = await buildTestCommitWithWelcome('conv-1');

    expect(() =>
      assertIsCommitForConversation(commitPayload, 'conv-1', epoch),
    ).not.toThrow();
  });

  it('rejects a commit whose group_id belongs to a different conversation', async () => {
    const { commitPayload, epoch } = await buildTestCommitWithWelcome('conv-1');

    expect(() =>
      assertIsCommitForConversation(commitPayload, 'conv-2', epoch),
    ).toThrow('group_id does not match this conversation');
  });

  it('rejects a commit whose declared epoch does not match its real embedded epoch', async () => {
    const { commitPayload, epoch } = await buildTestCommitWithWelcome('conv-1');

    expect(() =>
      assertIsCommitForConversation(commitPayload, 'conv-1', epoch + 1),
    ).toThrow('epoch does not match the declared epoch');
  });

  it('rejects a Welcome submitted as if it were a commit', async () => {
    const { welcomePayload, epoch } =
      await buildTestCommitWithWelcome('conv-1');

    expect(() =>
      assertIsCommitForConversation(welcomePayload, 'conv-1', epoch),
    ).toThrow('must be an MLS private message');
  });

  it('rejects malformed bytes as a BadRequestException, not an unhandled throw', () => {
    const garbage = new TextEncoder().encode('not an mls message');

    expect(() => assertIsCommitForConversation(garbage, 'conv-1', 0)).toThrow(
      BadRequestException,
    );
  });

  it('rejects a truncated real commit as a BadRequestException', async () => {
    const { commitPayload, epoch } = await buildTestCommitWithWelcome('conv-1');
    const truncated = commitPayload.slice(
      0,
      Math.floor(commitPayload.length * 0.4),
    );

    expect(() =>
      assertIsCommitForConversation(truncated, 'conv-1', epoch),
    ).toThrow(BadRequestException);
  });
});

describe('assertIsWelcomeMessage', () => {
  it('accepts a real Welcome message', async () => {
    const { welcomePayload } = await buildTestCommitWithWelcome('conv-1');

    expect(() => assertIsWelcomeMessage(welcomePayload)).not.toThrow();
  });

  it('rejects a commit submitted as if it were a Welcome', async () => {
    const { commitPayload } = await buildTestCommitWithWelcome('conv-1');

    expect(() => assertIsWelcomeMessage(commitPayload)).toThrow(
      'must be an MLS Welcome message',
    );
  });

  it('rejects malformed bytes as a BadRequestException', () => {
    const garbage = new TextEncoder().encode('not an mls message');

    expect(() => assertIsWelcomeMessage(garbage)).toThrow(BadRequestException);
  });
});

describe('assertIsApplicationMessage', () => {
  it('accepts a real application message', async () => {
    const applicationPayload = await buildTestApplicationMessage('conv-1');

    expect(() => assertIsApplicationMessage(applicationPayload)).not.toThrow();
  });

  it('rejects a commit submitted as if it were a chat message', async () => {
    const { commitPayload } = await buildTestCommitWithWelcome('conv-1');

    expect(() => assertIsApplicationMessage(commitPayload)).toThrow(
      'must have contentType "application"',
    );
  });

  it('rejects a Welcome submitted as if it were a chat message', async () => {
    const { welcomePayload } = await buildTestCommitWithWelcome('conv-1');

    expect(() => assertIsApplicationMessage(welcomePayload)).toThrow(
      'must be an MLS private message',
    );
  });

  it('rejects malformed bytes as a BadRequestException', () => {
    const garbage = new TextEncoder().encode('not an mls message');

    expect(() => assertIsApplicationMessage(garbage)).toThrow(
      BadRequestException,
    );
  });
});
