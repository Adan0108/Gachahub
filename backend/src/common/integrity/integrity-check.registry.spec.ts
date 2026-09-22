import { IntegrityCheckRegistry } from './integrity-check.registry';

describe('IntegrityCheckRegistry', () => {
  let registry: IntegrityCheckRegistry;

  beforeEach(() => {
    registry = new IntegrityCheckRegistry();
  });

  const check = (name: string) => ({
    name,
    title: name,
    source: 'mls' as const,
    findViolations: () => Promise.resolve([]),
  });

  it('lists every registered check', () => {
    registry.register(check('a'), check('b'));

    expect(registry.list().map((entry) => entry.name)).toEqual(['a', 'b']);
  });

  // regression: two checks silently sharing a name would each alert under the same dedup key,
  // doubling every notification with no indication anything was wrong.
  it('refuses to register two checks with the same name', () => {
    registry.register(check('duplicate'));

    expect(() => registry.register(check('duplicate'))).toThrow(
      'Integrity check "duplicate" is already registered',
    );
    expect(registry.list()).toHaveLength(1);
  });
});
