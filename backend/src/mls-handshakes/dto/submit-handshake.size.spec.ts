import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ExternalJoinDto } from './external-join.dto';
import { SubmitHandshakeDto } from './submit-handshake.dto';

// Mirrors the json body limit in app.module.ts (AuthModule.forRoot bodyParser).
const BODY_LIMIT_BYTES = 2 * 1024 * 1024;

const base64Of = (length: number) => 'A'.repeat(length);
const id = (n: number) => `device-${String(n).padStart(57, '0')}`;

function largestSubmit() {
  const ids = Array.from({ length: 50 }, (_, i) => id(i));
  return {
    deviceId: id(999),
    epoch: 2_147_483_647,
    payload: base64Of(20000),
    groupInfo: base64Of(60000),
    addedDeviceIds: ids,
    removedDeviceIds: ids.map((_, i) => id(100 + i)),
    welcome: { recipientDeviceIds: ids, payload: base64Of(20000) },
  };
}

describe('MLS handshake body size', () => {
  it('the largest body the DTO accepts fits under the json body limit', async () => {
    const body = largestSubmit();

    const errors = await validate(plainToInstance(SubmitHandshakeDto, body));

    expect(errors).toHaveLength(0);
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(
      BODY_LIMIT_BYTES,
    );
  });

  it('a 50-device add carries the Welcome once, far under the limit', () => {
    const size = Buffer.byteLength(JSON.stringify(largestSubmit()));

    expect(size).toBeLessThan(BODY_LIMIT_BYTES / 10);
  });

  it('refuses a body one step past any DTO cap', async () => {
    const tooBigCommit = { ...largestSubmit(), payload: base64Of(20004) };
    const tooBigInfo = { ...largestSubmit(), groupInfo: base64Of(60004) };
    const tooBigWelcome = {
      ...largestSubmit(),
      welcome: { ...largestSubmit().welcome, payload: base64Of(20004) },
    };
    const tooManyRecipients = {
      ...largestSubmit(),
      welcome: {
        ...largestSubmit().welcome,
        recipientDeviceIds: [...largestSubmit().addedDeviceIds, id(500)],
      },
    };

    for (const body of [
      tooBigCommit,
      tooBigInfo,
      tooBigWelcome,
      tooManyRecipients,
    ]) {
      const errors = await validate(plainToInstance(SubmitHandshakeDto, body));
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('the largest external join fits under the json body limit too', async () => {
    const body = {
      deviceId: id(1),
      epoch: 2_147_483_647,
      payload: base64Of(20000),
      groupInfo: base64Of(60000),
    };

    const errors = await validate(plainToInstance(ExternalJoinDto, body));

    expect(errors).toHaveLength(0);
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(
      BODY_LIMIT_BYTES,
    );
  });
});
