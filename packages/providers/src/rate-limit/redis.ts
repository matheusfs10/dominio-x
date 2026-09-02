import type { Redis } from "ioredis";

/**
 * Redis-backed global rate limiter for paid providers: a token bucket (requests/second)
 * plus a concurrency semaphore shared by every worker replica.
 *
 * Both structures are implemented with Lua scripts so that check-and-decrement is atomic.
 */
export interface RedisRateLimiterOptions {
  key: string;
  rps: number;
  concurrency: number;
  /** Safety TTL for semaphore slots (seconds) so crashed workers do not leak slots forever. */
  slotTtlSeconds?: number;
  burst?: number;
}

const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local rate = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then tokens = burst; ts = now end
local elapsed = math.max(0, now - ts) / 1000
tokens = math.min(burst, tokens + elapsed * rate)
local allowed = 0
local wait = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  wait = math.ceil(((1 - tokens) / rate) * 1000)
end
redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, 60000)
return {allowed, wait}
`;

const SEMAPHORE_ACQUIRE_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - ttl * 1000)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, ttl * 1000)
  return 1
end
return 0
`;

export class RedisRateLimiter {
  private readonly options: Required<RedisRateLimiterOptions>;
  constructor(
    private readonly redis: Redis,
    options: RedisRateLimiterOptions,
  ) {
    this.options = {
      slotTtlSeconds: 120,
      burst: Math.max(1, Math.ceil(options.rps)),
      ...options,
    };
  }

  private get bucketKey() {
    return `ratelimit:${this.options.key}:bucket`;
  }
  private get semaphoreKey() {
    return `ratelimit:${this.options.key}:sem`;
  }

  /** Attempts to take one token; returns the suggested wait (ms) when denied. */
  async tryTakeToken(): Promise<{ allowed: boolean; waitMs: number }> {
    const result = (await this.redis.eval(
      TOKEN_BUCKET_LUA,
      1,
      this.bucketKey,
      this.options.rps,
      this.options.burst,
      Date.now(),
    )) as [number, number];
    return { allowed: result[0] === 1, waitMs: result[1] };
  }

  async tryAcquireSlot(member: string): Promise<boolean> {
    const result = await this.redis.eval(
      SEMAPHORE_ACQUIRE_LUA,
      1,
      this.semaphoreKey,
      this.options.concurrency,
      Date.now(),
      this.options.slotTtlSeconds,
      member,
    );
    return result === 1;
  }

  async releaseSlot(member: string): Promise<void> {
    await this.redis.zrem(this.semaphoreKey, member);
  }

  /**
   * Blocks until both a concurrency slot and a token are available (or the deadline passes).
   * Returns a release function.
   */
  async acquire(
    options: { maxWaitMs?: number; signal?: AbortSignal } = {},
  ): Promise<() => Promise<void>> {
    const deadline = Date.now() + (options.maxWaitMs ?? 30_000);
    const member = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    for (;;) {
      if (options.signal?.aborted) throw new Error("aborted");
      if (await this.tryAcquireSlot(member)) {
        for (;;) {
          const token = await this.tryTakeToken();
          if (token.allowed) return async () => this.releaseSlot(member);
          if (Date.now() + token.waitMs > deadline) {
            await this.releaseSlot(member);
            throw new RateLimitTimeoutError("rate limiter wait exceeded deadline");
          }
          await sleep(Math.max(5, token.waitMs));
        }
      }
      if (Date.now() > deadline)
        throw new RateLimitTimeoutError("concurrency slot wait exceeded deadline");
      await sleep(25);
    }
  }

  async snapshot(): Promise<{ activeSlots: number }> {
    await this.redis.zremrangebyscore(
      this.semaphoreKey,
      "-inf",
      Date.now() - this.options.slotTtlSeconds * 1000,
    );
    return { activeSlots: await this.redis.zcard(this.semaphoreKey) };
  }
}

export class RateLimitTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitTimeoutError";
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
