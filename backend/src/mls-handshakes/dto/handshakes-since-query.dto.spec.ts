import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { HandshakesSinceQueryDto } from './handshakes-since-query.dto';

const errorsFor = (query: Record<string, unknown>) =>
  validateSync(plainToInstance(HandshakesSinceQueryDto, query));

describe('HandshakesSinceQueryDto', () => {
  it('defaults to epoch 0 when omitted', () => {
    const dto = plainToInstance(HandshakesSinceQueryDto, {});

    expect(errorsFor({})).toHaveLength(0);
    expect(dto.sinceEpoch).toBe(0);
  });

  it('accepts a non-negative integer sent as a query string', () => {
    expect(errorsFor({ sinceEpoch: '12' })).toHaveLength(0);
  });

  it.each(['-1', '1.5', 'abc', '99999999999'])('rejects %s', (value) => {
    expect(errorsFor({ sinceEpoch: value })).not.toHaveLength(0);
  });
});
