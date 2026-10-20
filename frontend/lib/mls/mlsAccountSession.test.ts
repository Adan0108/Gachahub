import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindSignedInAccount } from './mlsAccountSession';
import { resetMlsDatabaseForTests } from './storage/mlsEncryptedStore';

beforeEach(() => resetMlsDatabaseForTests());

describe('bindSignedInAccount', () => {
  it('does nothing for nobody signed in', () => {
    const reload = vi.fn();

    bindSignedInAccount(null, reload);
    bindSignedInAccount(undefined, reload);

    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload for the first account, or the same one again', () => {
    const reload = vi.fn();

    bindSignedInAccount('a', reload);
    bindSignedInAccount('a', reload);

    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads the page when a different account signs in', () => {
    const reload = vi.fn();
    bindSignedInAccount('a', reload);

    bindSignedInAccount('b', reload);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps the first account until the reload happens', () => {
    const reload = vi.fn();
    bindSignedInAccount('a', reload);
    bindSignedInAccount('b', reload);

    bindSignedInAccount('a', reload);

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
