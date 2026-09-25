import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ScopeQueryDto } from './scope-query.dto';

const errorsFor = (query: Record<string, unknown>) =>
  validateSync(plainToInstance(ScopeQueryDto, query));

describe('ScopeQueryDto', () => {
  it.each([{}, { scope: 'pending' }, { scope: 'full' }])(
    'accepts %j',
    (query) => {
      expect(errorsFor(query)).toHaveLength(0);
    },
  );

  it.each(['everything', 'FULL', ''])(
    'rejects the unknown scope %j',
    (scope) => {
      expect(errorsFor({ scope })).not.toHaveLength(0);
    },
  );
});
