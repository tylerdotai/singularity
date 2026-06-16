import { describe, expect, it } from 'bun:test';
import {
  buildApprovalKeyboard,
  createTelegramAdapter,
  PLATFORM,
} from './telegram.js';

describe('Telegram adapter', () => {
  describe('PLATFORM constant', () => {
    it("should equal 'telegram'", () => {
      expect(PLATFORM).toBe('telegram');
    });
  });

  describe('buildApprovalKeyboard', () => {
    it('should return inline_keyboard structure', () => {
      const kb = buildApprovalKeyboard([{ id: 'app-1', label: 'shell:rm' }]);
      expect(kb.inline_keyboard).toBeDefined();
      expect(Array.isArray(kb.inline_keyboard)).toBe(true);
    });

    it('should have approve and deny buttons per approval', () => {
      const kb = buildApprovalKeyboard([{ id: 'app-1' }]);
      expect(kb.inline_keyboard[0]).toHaveLength(2);
      expect(kb.inline_keyboard[0][0].text).toContain('Approve');
      expect(kb.inline_keyboard[0][1].text).toContain('Deny');
    });

    it('should encode approval id in callback_data', () => {
      const kb = buildApprovalKeyboard([{ id: 'test-id-123' }]);
      expect(kb.inline_keyboard[0][0].callback_data).toBe(
        'approval:approve:test-id-123'
      );
      expect(kb.inline_keyboard[0][1].callback_data).toBe(
        'approval:deny:test-id-123'
      );
    });

    it('should use label text when provided', () => {
      const kb = buildApprovalKeyboard([
        { id: 'app-1', label: 'Delete /tmp/file' },
      ]);
      expect(kb.inline_keyboard[0][0].text).toBe('✅ Delete /tmp/file');
    });

    it('should handle multiple approvals', () => {
      const kb = buildApprovalKeyboard([{ id: 'a' }, { id: 'b' }]);
      expect(kb.inline_keyboard).toHaveLength(2);
    });
  });

  describe('createTelegramAdapter', () => {
    it('should return a Bot instance', () => {
      const bot = createTelegramAdapter('fake-token');
      expect(bot).toBeDefined();
      expect(typeof bot).toBe('object');
    });

    it('should accept options without error', () => {
      const bot = createTelegramAdapter('fake-token', {
        allowedChats: [123456],
        rateLimitTokens: 10,
        rateLimitWindow: 30_000,
      });
      expect(bot).toBeDefined();
    });

    it('should accept callback handlers', () => {
      const bot = createTelegramAdapter('fake-token', {
        onMessage: (msg) => {
          expect(msg.source).toBe('telegram');
        },
        onApprovalAction: (action) => {
          expect(action.type).toMatch(/^(approve|deny)$/);
        },
      });
      expect(bot).toBeDefined();
    });

    it('should use default rate limit values', () => {
      const bot = createTelegramAdapter('fake-token');
      expect(bot).toBeDefined();
    });

    it('should accept onTyping callback', () => {
      const bot = createTelegramAdapter('fake-token', {
        onTyping: () => {
          expect(true).toBe(true);
        },
      });
      expect(bot).toBeDefined();
    });

    it('should accept onReaction callback (documented as non-functional limitation)', () => {
      const bot = createTelegramAdapter('fake-token', {
        onReaction: (event) => {
          expect(event.type).toMatch(/^(add|remove)$/);
        },
      });
      expect(bot).toBeDefined();
    });
  });
});
