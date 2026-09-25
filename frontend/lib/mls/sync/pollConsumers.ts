/** Counts the mounted users of one polling loop, and drops the count when the loop moves to another owner. */
export class PollConsumers<Owner> {
  private owner: Owner | undefined;
  private count = 0;

  /** True when this consumer is the first for its owner, so a loop must be started for it. */
  acquire(owner: Owner): boolean {
    const fresh = this.owner !== owner;
    if (fresh) {
      this.owner = owner;
      this.count = 0;
    }
    this.count += 1;
    return fresh;
  }

  /** True when the last consumer of the current owner left, so its loop must stop; a stale owner's release is ignored. */
  release(owner: Owner): boolean {
    if (this.owner !== owner) return false;
    this.count = Math.max(0, this.count - 1);
    if (this.count > 0) return false;
    this.owner = undefined;
    return true;
  }
}
