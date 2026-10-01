// constant-content comparison isn't needed here (these aren't secrets being
// compared against a guess, just structural equality checks), so a plain
// early-exit loop is fine
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
