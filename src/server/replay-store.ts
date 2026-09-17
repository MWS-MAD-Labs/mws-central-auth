import type { ReplayStore } from "./types.js";

// Default replay store: fine for a single-instance deployment (matches
// what mws-mtss-system/mws-daily-checkin already ran with via node-cache),
// but doesn't share state across instances behind a load balancer. A
// consumer that scales horizontally should inject its own ReplayStore
// (Postgres row, Redis key, etc.) instead of relying on this default.
export class InMemoryReplayStore implements ReplayStore {
  private readonly seenUntil = new Map<string, number>();

  hasSeen(jti: string): boolean {
    this.sweep();
    return this.seenUntil.has(jti);
  }

  markSeen(jti: string, ttlSeconds: number): void {
    this.seenUntil.set(jti, Date.now() + ttlSeconds * 1000);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [jti, expiresAt] of this.seenUntil) {
      if (expiresAt <= now) this.seenUntil.delete(jti);
    }
  }
}
