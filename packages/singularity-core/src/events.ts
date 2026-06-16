/**
 * Event system for Phase 9 WebSocket live updates.
 * Provides a central event emitter that components can subscribe to.
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

export class EventHub {
  private listeners: Map<EventType, Set<(event: Event) => void>> = new Map();

  subscribe(type: EventType, listener: (event: Event) => void): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)?.add(listener);
    return () => this.listeners.get(type)?.delete(listener);
  }

  emit(event: Event): void {
    const listeners = this.listeners.get(event.type as EventType);
    if (listeners) {
      for (const listener of listeners) {
        listener(event);
      }
    }
  }

  getListeners(type: EventType): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

export const globalEventHub = new EventHub();
