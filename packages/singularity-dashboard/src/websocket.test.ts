import { beforeEach, describe, expect, it } from 'bun:test';
import { DashboardWebSocketServer } from './websocket.js';

describe('DashboardWebSocketServer', () => {
  let server: DashboardWebSocketServer;

  beforeEach(() => {
    server = new DashboardWebSocketServer();
  });

  it('connects and tracks clients', () => {
    const client = {
      id: 'client_1',
      send: () => {},
    };
    server.connect(client);
    expect(server.getClientCount()).toBe(1);
  });

  it('disconnects and removes clients', () => {
    const client = {
      id: 'client_2',
      send: () => {},
    };
    server.connect(client);
    expect(server.getClientCount()).toBe(1);

    server.disconnect('client_2');
    expect(server.getClientCount()).toBe(0);
  });

  it('broadcasts events to all connected clients', () => {
    const received: string[] = [];
    const client1 = {
      id: 'c1',
      send: (data: string) => {
        received.push(data);
      },
    };
    const client2 = {
      id: 'c2',
      send: (data: string) => {
        received.push(data);
      },
    };

    server.connect(client1);
    server.connect(client2);

    const event = {
      type: 'session.created',
      sessionId: 'sess_abc',
    };
    server.broadcast(event);

    expect(received.length).toBe(2);
    expect(JSON.parse(received[0]).sessionId).toBe('sess_abc');
    expect(JSON.parse(received[1]).sessionId).toBe('sess_abc');
  });

  it('handles client send errors gracefully', () => {
    const client = {
      id: 'client_3',
      send: () => {
        throw new Error('Connection closed');
      },
    };
    server.connect(client);

    // Should not throw
    expect(() => {
      server.broadcast({ type: 'loop.started', loopId: 'l1', goal: 'test' });
    }).not.toThrow();
  });
});
