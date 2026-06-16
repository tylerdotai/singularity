/**
 * Production server with auth, rate limiting, metrics, encryption
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { createHealthCheck, Metrics } from './metrics.js';
import { DashboardWebSocketServer } from './websocket.js';

// Auth
export class JWTSigner {
  constructor(private secret: string) {}
  sign(payload: Record<string, unknown>, ttlSeconds = 3600): string {
    const now = Math.floor(Date.now() / 1000);
    const full = { ...payload, iat: now, exp: now + ttlSeconds };
    const header = { alg: 'HS256', typ: 'JWT' };
    const h = Buffer.from(JSON.stringify(header)).toString('base64url');
    const p = Buffer.from(JSON.stringify(full)).toString('base64url');
    const s = createHmac('sha256', this.secret)
      .update(`${h}.${p}`)
      .digest('base64url');
    return `${h}.${p}.${s}`;
  }
  verify(token: string): Record<string, unknown> {
    const [h, p, sig] = token.split('.');
    const exp = createHmac('sha256', this.secret)
      .update(`${h}.${p}`)
      .digest('base64url');
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(exp)))
      throw new Error('Invalid signature');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Expired');
    return payload;
  }
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function verifyApiKey(provided: string, stored: string): boolean {
  const h = hashApiKey(provided);
  return timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(stored, 'hex'));
}

export function generateApiKey(): { key: string; hash: string; id: string } {
  const key = `sk_${randomBytes(32).toString('base64url')}`;
  const id = `key_${Date.now()}_${randomBytes(8).toString('hex')}`;
  return { key, hash: hashApiKey(key), id };
}

// Rate limiter
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number
  ) {}
  check(key: string) {
    const now = Date.now();
    const start = now - this.windowMs;
    const arr = (this.hits.get(key) ?? []).filter((t) => t > start);
    arr.push(now);
    this.hits.set(key, arr);
    return {
      allowed: arr.length <= this.max,
      remaining: Math.max(0, this.max - arr.length),
      resetMs: this.windowMs,
    };
  }
}

// Encryption
export class SecretEncryption {
  private key: Buffer;
  constructor(passphrase: string, salt: string) {
    this.key = scryptSync(passphrase, salt, 32);
  }
  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
  }
  decrypt(ciphertext: string): string {
    const [iv, tag, enc] = ciphertext.split(':');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(enc, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }
}

// Production server
export class ProductionServer {
  private metrics = new Metrics();
  private rateLimiter: RateLimiter;
  private apiKeys = new Map<string, string>();
  private jwtSigner: JWTSigner;
  private encryption: SecretEncryption;
  private wsServer = new DashboardWebSocketServer();

  constructor(
    private port: number,
    private jwtSecret: string,
    private encryptionKey: string
  ) {
    this.rateLimiter = new RateLimiter(100, 60000);
    this.jwtSigner = new JWTSigner(jwtSecret);
    this.encryption = new SecretEncryption(
      encryptionKey,
      'singularity-salt-v1'
    );
  }

  generateApiKey(userId: string): string {
    const { key, hash, id } = generateApiKey();
    this.apiKeys.set(id, hash);
    this.metrics.increment('apikeys.created');
    return key;
  }

  start() {
    const healthCheck = createHealthCheck({
      websocket: async () => ({
        ok: true,
        detail: `${this.wsServer.getClientCount()} clients`,
      }),
      ratelimit: async () => ({ ok: true, detail: 'operational' }),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const server = (Bun as any).serve({
      port: this.port,
      websocket: {
        open: (ws: any) => {
          const clientId = `ws_${Date.now()}`;
          this.wsServer.connect({
            id: clientId,
            send: (d: string) => ws.send(d),
          });
          this.metrics.increment('websocket.connects');
        },
        close: (ws: any) => {
          this.wsServer.disconnect(ws.data?.clientId ?? 'unknown');
          this.metrics.increment('websocket.disconnects');
        },
        message: (_ws: any, msg: unknown) => {
          this.metrics.increment('websocket.messages');
          this.wsServer.broadcast(JSON.parse(String(msg)));
        },
      },
      routes: {
        '/health': async () => {
          const status = await healthCheck();
          return Response.json(status, {
            status: status.status === 'healthy' ? 200 : 503,
          });
        },
        '/metrics': () => {
          this.metrics.increment('metrics.exports');
          return new Response(this.metrics.export(), {
            headers: { 'Content-Type': 'text/plain' },
          });
        },
        '/api/keys': async (req: Request) => {
          const clientId =
            req.headers.get('x-forwarded-for') ??
            req.headers.get('cf-connecting-ip') ??
            'unknown';
          const { allowed, resetMs } = this.rateLimiter.check(clientId);
          if (!allowed) {
            return Response.json(
              { error: 'Rate limit exceeded', remaining: 0, resetMs },
              { status: 429 }
            );
          }
          if (req.method === 'POST') {
            const body = (await req.json()) as { userId?: string };
            return Response.json({
              key: this.generateApiKey(body.userId ?? 'anon'),
              userId: body.userId,
            });
          }
          return new Response('Method not allowed', { status: 405 });
        },
        '/api/token': async (req: Request) => {
          const clientId =
            req.headers.get('x-forwarded-for') ??
            req.headers.get('cf-connecting-ip') ??
            'unknown';
          const { allowed, resetMs } = this.rateLimiter.check(clientId);
          if (!allowed) {
            return Response.json(
              { error: 'Rate limit exceeded', remaining: 0, resetMs },
              { status: 429 }
            );
          }
          if (req.method === 'POST') {
            const body = (await req.json()) as {
              userId?: string;
              scopes?: string[];
            };
            this.metrics.increment('tokens.created');
            return Response.json({
              token: this.jwtSigner.sign({
                sub: body.userId ?? 'anon',
                scopes: body.scopes ?? ['read'],
              }),
            });
          }
          return new Response('Method not allowed', { status: 405 });
        },
        '/api/encrypt': async (req: Request) => {
          const clientId =
            req.headers.get('x-forwarded-for') ??
            req.headers.get('cf-connecting-ip') ??
            'unknown';
          const { allowed, resetMs } = this.rateLimiter.check(clientId);
          if (!allowed) {
            return Response.json(
              { error: 'Rate limit exceeded', remaining: 0, resetMs },
              { status: 429 }
            );
          }
          if (req.method === 'POST') {
            const body = (await req.json()) as { secret?: string };
            this.metrics.increment('encrypt.calls');
            return Response.json({
              encrypted: this.encryption.encrypt(body.secret ?? ''),
            });
          }
          return new Response('Method not allowed', { status: 405 });
        },
        '/api/decrypt': async (req: Request) => {
          const clientId =
            req.headers.get('x-forwarded-for') ??
            req.headers.get('cf-connecting-ip') ??
            'unknown';
          const { allowed, resetMs } = this.rateLimiter.check(clientId);
          if (!allowed) {
            return Response.json(
              { error: 'Rate limit exceeded', remaining: 0, resetMs },
              { status: 429 }
            );
          }
          if (req.method === 'POST') {
            this.metrics.increment('decrypt.calls');
            const body = (await req.json()) as { ciphertext?: string };
            try {
              return Response.json({
                decrypted: this.encryption.decrypt(body.ciphertext ?? ''),
              });
            } catch {
              return Response.json(
                { error: 'Decryption failed' },
                { status: 400 }
              );
            }
          }
          return new Response('Method not allowed', { status: 405 });
        },
        '/*': () => new Response('Singularity Dashboard', { status: 200 }),
      },
    });
    return { port: server.port, stop: () => server.stop() };
  }
}
