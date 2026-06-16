import { describe, expect, test } from 'bun:test';
import { resolveReferences } from './context.js';

describe('resolveReferences', () => {
  test('returns empty array for empty string', () => {
    const result = resolveReferences('');
    expect(result).toEqual([]);
  });

  test('returns empty array when no references present', () => {
    const result = resolveReferences('Hello world, this is a normal message.');
    expect(result).toEqual([]);
  });

  test('parses @file: reference', () => {
    const result = resolveReferences('Read @file:src/index.ts for me');
    expect(result).toEqual([
      {
        kind: 'file',
        value: 'src/index.ts',
        description: 'file: src/index.ts',
      },
    ]);
  });

  test('parses @session: reference', () => {
    const result = resolveReferences('Continue from @session:sess_abc123');
    expect(result).toEqual([
      {
        kind: 'session',
        value: 'sess_abc123',
        description: 'session: sess_abc123',
      },
    ]);
  });

  test('parses @url: reference with https', () => {
    const result = resolveReferences('Fetch @url:https://example.com/api');
    expect(result).toEqual([
      {
        kind: 'url',
        value: 'https://example.com/api',
        description: 'URL: https://example.com/api',
      },
    ]);
  });

  test('parses @url: reference with http', () => {
    const result = resolveReferences('Fetch @url:http://example.com/api');
    expect(result).toEqual([
      {
        kind: 'url',
        value: 'http://example.com/api',
        description: 'URL: http://example.com/api',
      },
    ]);
  });

  test('skips @url: reference without http prefix', () => {
    const result = resolveReferences('Fetch @url:example.com/api');
    expect(result).toEqual([]);
  });

  test('skips @url: reference with invalid protocol', () => {
    const result = resolveReferences('Fetch @url:ftp://example.com/file');
    expect(result).toEqual([]);
  });

  test('parses @profile: reference', () => {
    const result = resolveReferences('Use @profile:default settings');
    expect(result).toEqual([
      {
        kind: 'profile',
        value: 'default',
        description: 'profile: default',
      },
    ]);
  });

  test('parses @artifact: reference', () => {
    const result = resolveReferences('Show me @artifact:art_xyz789');
    expect(result).toEqual([
      {
        kind: 'artifact',
        value: 'art_xyz789',
        description: 'artifact: art_xyz789',
      },
    ]);
  });

  test('strips trailing period from value', () => {
    const result = resolveReferences('Read @file:src/index.ts.');
    expect(result[0].value).toBe('src/index.ts');
  });

  test('strips trailing semicolon from value', () => {
    const result = resolveReferences('Read @file:src/index.ts;');
    expect(result[0].value).toBe('src/index.ts');
  });

  test('strips trailing colon from value', () => {
    const result = resolveReferences('Read @file:src/index.ts:');
    expect(result[0].value).toBe('src/index.ts');
  });

  test('strips multiple trailing punctuation characters', () => {
    const result = resolveReferences('Read @file:src/index.ts,:!?');
    expect(result[0].value).toBe('src/index.ts');
  });

  test('parses multiple references in one string', () => {
    const result = resolveReferences(
      'Use @profile:default and read @file:src/index.ts then check @session:sess_abc123'
    );
    expect(result).toEqual([
      {
        kind: 'profile',
        value: 'default',
        description: 'profile: default',
      },
      {
        kind: 'file',
        value: 'src/index.ts',
        description: 'file: src/index.ts',
      },
      {
        kind: 'session',
        value: 'sess_abc123',
        description: 'session: sess_abc123',
      },
    ]);
  });

  test('parses all reference kinds in one string', () => {
    const result = resolveReferences(
      '@file:path @session:id @url:https://x.com @profile:name @artifact:art'
    );
    expect(result).toHaveLength(5);
    expect(result.map((r) => r.kind)).toEqual([
      'file',
      'session',
      'url',
      'profile',
      'artifact',
    ]);
  });

  test('handles reference at start of string', () => {
    const result = resolveReferences('@file:src/index.ts is the main file');
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('file');
  });

  test('handles reference at end of string', () => {
    const result = resolveReferences('The main file is @file:src/index.ts');
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('file');
  });

  test('handles reference with underscores and hyphens in value', () => {
    const result = resolveReferences('Check @session:sess_abc-123_def');
    expect(result[0].value).toBe('sess_abc-123_def');
  });

  test('description field is human-readable', () => {
    const result = resolveReferences('Read @file:src/index.ts');
    expect(result[0].description).toBe('file: src/index.ts');
    expect(typeof result[0].description).toBe('string');
  });
});
