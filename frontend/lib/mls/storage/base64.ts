// btoa/atob, not Buffer - this module's real home is the browser, even
// though tests run it under Node via Vitest. Kept as its own leaf module
// (no dependents) so both tsMlsAdapter.ts and deviceIdentityStorage.ts can
// import it without creating a cycle between them.

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
