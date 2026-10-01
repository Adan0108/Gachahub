/** In-memory LRU keyed by string, bounded by total bytes so opening many large attachments can't grow forever. */
export class BlobCache {
  private readonly entries = new Map<string, Blob>();
  private totalBytes = 0;

  constructor(private readonly maxBytes: number) {}

  get(key: string): Blob | undefined {
    const blob = this.entries.get(key);
    if (blob) {
      // re-insert to mark as most recently used
      this.entries.delete(key);
      this.entries.set(key, blob);
    }
    return blob;
  }

  set(key: string, blob: Blob): void {
    if (blob.size > this.maxBytes) return;
    this.delete(key);
    this.entries.set(key, blob);
    this.totalBytes += blob.size;
    for (const [oldest, value] of this.entries) {
      if (this.totalBytes <= this.maxBytes) break;
      this.entries.delete(oldest);
      this.totalBytes -= value.size;
    }
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  private delete(key: string): void {
    const existing = this.entries.get(key);
    if (!existing) return;
    this.entries.delete(key);
    this.totalBytes -= existing.size;
  }
}
