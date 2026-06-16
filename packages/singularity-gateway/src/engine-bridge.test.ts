import { beforeEach, describe, expect, test } from 'bun:test';
import type { Activity, TurnResult } from 'singularity-engine';
import {
  GatewaySessionBridge,
  isSteerCommand,
  textToActivity,
} from './engine-bridge';

// ─── Mock EngineRunner ──────────────────────────────────────────────────────────

function makeMockRunner(yields: TurnResult[] = []) {
  return {
    run: async function* (
      _activity: Activity,
      _sessionID: string,
      _signal?: AbortSignal
    ): AsyncGenerator<TurnResult> {
      for (const r of yields) {
        yield r;
      }
    },
  };
}

function makeTurnResult(
  partial: Partial<TurnResult> & { textBuffer: string }
): TurnResult {
  return {
    needsContinuation: false,
    toolResults: [],
    ...partial,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('GatewaySessionBridge', () => {
  let bridge: GatewaySessionBridge;

  beforeEach(() => {
    bridge = new GatewaySessionBridge({ engineRunner: makeMockRunner([]) });
  });

  test('getSession returns undefined for unknown session', () => {
    expect(bridge.getSession('telegram', 12345)).toBeUndefined();
  });

  test('registerSession + getSession round-trips', () => {
    bridge.registerSession('telegram', 12345, 'session-abc');
    expect(bridge.getSession('telegram', 12345)).toBe('session-abc');
  });

  test('getSession is platform-specific', () => {
    bridge.registerSession('telegram', 12345, 'tg-session');
    bridge.registerSession('discord', 12345, 'dc-session');
    expect(bridge.getSession('telegram', 12345)).toBe('tg-session');
    expect(bridge.getSession('discord', 12345)).toBe('dc-session');
  });

  test('receive() yields textBuffer as OutgoingMessage', async () => {
    const runner = makeMockRunner([
      makeTurnResult({ textBuffer: 'hello world', toolResults: [] }),
    ]);
    bridge = new GatewaySessionBridge({ engineRunner: runner });

    const messages: Array<{ text: string }> = [];
    for await (const msg of bridge.receive(
      'telegram',
      12345,
      null,
      'hi',
      'session-1'
    )) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('hello world');
  });

  test('receive() yields tool results as OutgoingMessage', async () => {
    const runner = makeMockRunner([
      makeTurnResult({
        textBuffer: '',
        toolResults: [
          {
            id: '1',
            name: 'Read',
            input: {},
            result: { lines: 10, path: '/tmp/foo' },
            wallClockMs: 1,
          },
        ],
      }),
    ]);
    bridge = new GatewaySessionBridge({ engineRunner: runner });

    const messages: Array<{ text: string }> = [];
    for await (const msg of bridge.receive(
      'telegram',
      12345,
      null,
      'list files',
      'session-2'
    )) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('[Read] {"lines":10,"path":"/tmp/foo"}');
  });

  test('receive() yields mixed text then tool in order', async () => {
    const runner = makeMockRunner([
      makeTurnResult({ textBuffer: 'Reading files...', toolResults: [] }),
      makeTurnResult({
        textBuffer: '',
        toolResults: [
          { id: '2', name: 'Bash', input: {}, result: 'done', wallClockMs: 1 },
        ],
      }),
    ]);
    bridge = new GatewaySessionBridge({ engineRunner: runner });

    const texts: string[] = [];
    for await (const msg of bridge.receive(
      'discord',
      999,
      null,
      'run',
      'session-3'
    )) {
      texts.push(msg.text);
    }

    expect(texts).toEqual(['Reading files...', '[Bash] done']);
  });

  test('receive() uses steer activity when isSteer=true', async () => {
    const receivedActivity: Activity[] = [];
    const runner = {
      run: async function* (
        activity: Activity,
        _sessionID: string,
        _signal?: AbortSignal
      ): AsyncGenerator<TurnResult> {
        receivedActivity.push(activity);
        yield makeTurnResult({ textBuffer: 'ok', toolResults: [] });
      },
    };
    bridge = new GatewaySessionBridge({ engineRunner: runner });

    const msgs: Array<{ text: string }> = [];
    for await (const msg of bridge.receive(
      'telegram',
      12345,
      null,
      '/steer change the config',
      'session-4',
      true
    )) {
      msgs.push(msg);
    }

    expect(receivedActivity).toHaveLength(1);
    expect(receivedActivity[0].type).toBe('steer');
    if (receivedActivity[0].type === 'steer') {
      expect(receivedActivity[0].input).toBe('change the config');
    }
    expect(msgs[0].text).toBe('ok');
  });

  test('receive() uses queue activity when isSteer=false', async () => {
    const receivedActivity: Activity[] = [];
    const runner = {
      run: async function* (
        activity: Activity,
        _sessionID: string,
        _signal?: AbortSignal
      ): AsyncGenerator<TurnResult> {
        receivedActivity.push(activity);
        yield makeTurnResult({ textBuffer: 'queued', toolResults: [] });
      },
    };
    bridge = new GatewaySessionBridge({ engineRunner: runner });

    const msgs: Array<{ text: string }> = [];
    for await (const msg of bridge.receive(
      'discord',
      111,
      null,
      'do something',
      'session-5',
      false
    )) {
      msgs.push(msg);
    }

    expect(receivedActivity).toHaveLength(1);
    expect(receivedActivity[0].type).toBe('queue');
    if (receivedActivity[0].type === 'queue') {
      expect(receivedActivity[0].input).toBe('do something');
    }
  });

  test('receive() passes sessionID to engine runner', async () => {
    const seenSessionIDs: string[] = [];
    const runner = {
      run: async function* (
        _activity: Activity,
        sessionID: string,
        _signal?: AbortSignal
      ): AsyncGenerator<TurnResult> {
        seenSessionIDs.push(sessionID);
        yield makeTurnResult({ textBuffer: 'ok', toolResults: [] });
      },
    };
    bridge = new GatewaySessionBridge({ engineRunner: runner });

    for await (const _ of bridge.receive(
      'telegram',
      1,
      null,
      'hi',
      'my-session-id'
    )) {
      // consume
    }

    expect(seenSessionIDs).toContain('my-session-id');
  });

  test('cancel() aborts active run', async () => {
    let abortSignal: AbortSignal | undefined;
    const runner = {
      run: async function* (
        _activity: Activity,
        _sessionID: string,
        signal?: AbortSignal
      ): AsyncGenerator<TurnResult> {
        abortSignal = signal;
        await new Promise<void>((resolve) => {
          signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        yield makeTurnResult({ textBuffer: 'never', toolResults: [] });
      },
    };
    bridge = new GatewaySessionBridge({ engineRunner: runner });

    const iter = bridge.receive(
      'telegram',
      1,
      null,
      'long running',
      'session-6'
    );
    const prom = iter.next();
    await new Promise<void>((r) => setTimeout(r, 0));

    bridge.cancel('session-6');

    expect(abortSignal?.aborted).toBe(true);

    await prom;
  });
});

describe('textToActivity', () => {
  test('returns steer activity for /steer prefix', () => {
    const a = textToActivity('/steer fix the bug');
    expect(a.type).toBe('steer');
    if (a.type === 'steer') {
      expect(a.input).toBe('fix the bug');
    }
  });

  test('returns queue activity for plain text', () => {
    const a = textToActivity('run the tests');
    expect(a.type).toBe('queue');
    if (a.type === 'queue') {
      expect(a.input).toBe('run the tests');
    }
  });
});

describe('isSteerCommand', () => {
  test('true for /steer prefix', () => {
    expect(isSteerCommand('/steer do something')).toBe(true);
  });

  test('false for plain text', () => {
    expect(isSteerCommand('just chat')).toBe(false);
  });
});
