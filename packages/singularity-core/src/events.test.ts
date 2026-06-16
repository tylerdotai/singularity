import { beforeEach, describe, expect, it } from 'bun:test';
import { EventHub } from './events.js';

describe('EventHub', () => {
  let hub: EventHub;

  beforeEach(() => {
    hub = new EventHub();
  });

  it('emits session events to subscribers', () => {
    let received: any = null;
    hub.subscribe('session.created', (event) => {
      received = event;
    });

    hub.emit({ type: 'session.created', sessionId: 'sess_test123' });

    expect(received).not.toBeNull();
    expect(received.type).toBe('session.created');
    expect(received.sessionId).toBe('sess_test123');
  });

  it('returns unsubscribe function that removes listener', () => {
    let count = 0;
    const unsub = hub.subscribe('session.updated', () => {
      count++;
    });

    hub.emit({ type: 'session.updated', sessionId: 'sess_1' });
    expect(count).toBe(1);

    unsub();
    hub.emit({ type: 'session.updated', sessionId: 'sess_2' });
    expect(count).toBe(1); // Still 1 after unsubscribe
  });

  it('tracks listener counts per event type', () => {
    hub.subscribe('loop.started', () => {});
    hub.subscribe('loop.started', () => {});
    hub.subscribe('loop.completed', () => {});

    expect(hub.getListeners('loop.started')).toBe(2);
    expect(hub.getListeners('loop.completed')).toBe(1);
    expect(hub.getListeners('session.created')).toBe(0);
  });

  it('emits loop events with iteration metadata', () => {
    let received: any = null;
    hub.subscribe('loop.iterated', (event) => {
      received = event;
    });

    hub.emit({
      type: 'loop.iterated',
      loopId: 'loop_abc',
      goal: 'Test goal',
      iteration: 5,
    });

    expect(received.loopId).toBe('loop_abc');
    expect(received.iteration).toBe(5);
  });

  it('emits fact events with subject/predicate', () => {
    let received: any = null;
    hub.subscribe('fact.created', (event) => {
      received = event;
    });

    hub.emit({
      type: 'fact.created',
      factId: 'fact_xyz',
      subject: 'test',
      predicate: 'value',
    });

    expect(received.factId).toBe('fact_xyz');
    expect(received.subject).toBe('test');
  });
});
