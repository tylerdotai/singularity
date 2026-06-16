/**
 * singularity-engine — public surface.
 *
 * Re-exports all types, interfaces, and errors so callers need only
 * import from "singularity-engine".
 */

export * from './errors.js';
export * from './interfaces.js';
export { runSession, SessionRunner } from './session-runner.js';
export type { ApproverTurnEvent } from './turn-executor.js';
export { runTurn } from './turn-executor.js';
export type { Activity } from './types.js';
export * from './types.js';
