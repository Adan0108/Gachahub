import { describe, expect, it } from 'vitest';
import { runMlsClientContractTests } from './contractTests';

/**
 * The real contract suite only runs once a step 2 candidate exists - each
 * candidate's own test file calls runMlsClientContractTests(candidate)
 * directly. This just proves the module itself loads and is well-typed
 * (tsc already checks the bodies against the MlsClient interfaces) so step
 * 1's deliverable isn't silently broken before step 2 ever touches it.
 */
describe('MlsClient contract module', () => {
  it('exports a callable contract-test runner', () => {
    expect(typeof runMlsClientContractTests).toBe('function');
  });
});
