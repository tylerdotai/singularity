/**
 * WebSocket server for Phase 9 live dashboard updates.
 * Broadcasts events from the global EventHub to connected clients.
 */

export type EventType =
  | 'session.created'
  | 'session.updated'
  | 'session.completed'
  | 'loop.started'
  | 'loop.iterated'
  | 'loop.completed'
  | 'fact.created'
  | 'approval.requested'
  | 'approval.granted'
  | 'approval.denied';

export interface SessionEvent {
  type: 'session.created' | 'session.updated' | 'session.completed';
  sessionId: string;
  profileId?: string;
  metadata?: Record<string, unknown>;
}

export interface LoopEvent {
  type: 'loop.started' | 'loop.iterated' | 'loop.completed';
  loopId: string;
  goal: string;
  iteration?: number;
  success?: boolean;
  metadata?: Record<string, unknown>;
}

export interface FactEvent {
  type: 'fact.created';
  factId: string;
  sessionId?: string;
  subject: string;
  predicate: string;
}

export interface ApprovalEvent {
  type: 'approval.requested' | 'approval.granted' | 'approval.denied';
  approvalId: string;
  sessionId?: string;
  action: string;
}

export type Event = SessionEvent | LoopEvent | FactEvent | ApprovalEvent;

export interface WebSocketClient {
  id: string;
  send(data: string): void;
}

export class DashboardWebSocketServer {
  private clients: Map<string, WebSocketClient> = new Map();
  private unsubscribes: Array<() => void> = [];

  constructor(eventHub?: {
    subscribe: (
      type: EventType,
      listener: (event: Event) => void
    ) => () => void;
    emit: (event: Event) => void;
  }) {
    if (eventHub) {
      const allTypes: EventType[] = [
        'session.created',
        'session.updated',
        'session.completed',
        'loop.started',
        'loop.iterated',
        'loop.completed',
        'fact.created',
        'approval.requested',
        'approval.granted',
        'approval.denied',
      ];
      for (const type of allTypes) {
        this.unsubscribes.push(
          eventHub.subscribe(type, (event) => {
            this.broadcast(event);
          })
        );
      }
    }
  }

  connect(client: WebSocketClient): void {
    this.clients.set(client.id, client);
  }

  disconnect(clientId: string): void {
    this.clients.delete(clientId);
  }

  broadcast(event: Event): void {
    const data = JSON.stringify(event);
    for (const client of this.clients.values()) {
      try {
        client.send(data);
      } catch {
        // Client disconnected, will be cleaned up
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }
}
