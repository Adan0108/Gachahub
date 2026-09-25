import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BoundedEpoch, MAX_EPOCH } from './bounded-epoch.decorator';

class Probe {
  @BoundedEpoch()
  epoch!: number;
}

const errorsFor = (epoch: unknown) =>
  validateSync(plainToInstance(Probe, { epoch }));

describe('BoundedEpoch', () => {
  it.each([0, 7, MAX_EPOCH])('accepts %s', (value) => {
    expect(errorsFor(value)).toHaveLength(0);
  });

  it.each([-1, 1.5, MAX_EPOCH + 1, 'abc', null])('rejects %s', (value) => {
    expect(errorsFor(value)).not.toHaveLength(0);
  });
});
