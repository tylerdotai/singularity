// Phase 11 — `AgentSkillAuthor`: LLM-driven skill drafting.
//
// Responsibilities:
//   - Accept an `AgentSkillAuthorInput` (goal, session history, tool
//     calls, failures and fixes, skill examples) and produce an
//     `AgentSkillDraftResult` via an LLM.
//   - The LLM is instructed to output Markdown with YAML frontmatter.
//   - The author parses the Markdown into structured data.
//   - Validation ensures required fields are present.
//   - Provenance records `draftedBy: 'agent'` to distinguish from
//     template-based drafts.
//
// Out of scope for this phase:
//   - LLM SDK dependencies — the caller supplies the `llm.chat()`.
//   - Filesystem writing — the draft is returned as a string.
//   - Registry integration — `SkillAuthoringPipeline` handles that.

export interface AgentSkillAuthorOptions {
  llm: {
    chat(
      messages: ReadonlyArray<{ role: string; content: string }>
    ): AsyncGenerator<{ type: string; text?: string }>;
  };
  model?: string;
}

export interface AgentSkillAuthorInput {
  goal: string;
  sessionHistory?: string;
  toolCalls?: Array<{ tool: string; args: unknown; result: unknown }>;
  failuresAndFixes?: string;
  skillExamples?: string[];
}

export interface AgentSkillDraftResult {
  name: string;
  description: string;
  whenToUse: string;
  implementation: string;
  failuresAndFixes: string;
  verificationCommands: string;
  provenance: {
    draftedBy: 'agent';
    model: string;
    draftedAt: number;
    input: AgentSkillAuthorInput;
  };
}

function buildSystemPrompt(): string {
  return `You are a skill author. Your task is to draft a skill file in Markdown format.

Output a complete skill draft with YAML frontmatter followed by Markdown body sections.

## Frontmatter requirements
The frontmatter MUST include:
- \`name\`: a unique skill identifier (e.g., \`git/commit-msg\`)
- \`description\`: a concise one-line description (max 200 chars)

## Body section requirements
The body MUST include these Markdown headings:
- \`## When to use\` — describe when to apply this skill
- \`## Implementation\` — provide the skill implementation or instructions
- \`## Failures and fixes\` — common failures and how to resolve them
- \`## Verification\` — shell commands that verify the skill works

## Example skill structure
\`\`\`yaml
---
name: example/skill
description: A brief description of what this skill does
---

## When to use

Use this skill when you need to accomplish X.

## Implementation

Describe how to implement X here.

## Failures and fixes

Common failure: Y
Fix: Z

## Verification

\`\`\`sh
bun run typecheck
\`\`\`
\`\`\`

## Output format
- Always output valid YAML frontmatter at the top (between \`---\` markers)
- Follow with a blank line, then the Markdown body
- Use \`\`\`\`sh\` for verification command blocks
- Do not include any additional explanation outside the skill draft`;
}

function parseFrontmatter(markdown: string): Record<string, string> {
  const result: Record<string, string> = {};
  const match = markdown.match(/^---\n([\s\S]*?)\n---/m);
  if (!match) return result;

  const lines = match[1].split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

function extractSection(
  markdown: string,
  sectionName: string
): string | undefined {
  const pattern = new RegExp(
    `^##\\s+${sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n([\\s\\S]*?)(?=^##\\s+|\\Z)`,
    'm'
  );
  const match = markdown.match(pattern);
  return match ? match[1].trim() : undefined;
}

export class AgentSkillAuthor {
  private readonly llm: AgentSkillAuthorOptions['llm'];
  private readonly model: string;

  constructor(options: AgentSkillAuthorOptions) {
    this.llm = options.llm;
    this.model = options.model ?? 'unknown';
  }

  async draftSkill(
    input: AgentSkillAuthorInput
  ): Promise<AgentSkillDraftResult> {
    const messages = this.buildMessages(input);
    const raw = await this.streamToString(messages);
    const partial = this.parseDraft(raw);
    return this.validateDraft(partial, input);
  }

  private buildMessages(input: AgentSkillAuthorInput) {
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: buildSystemPrompt() },
    ];

    let userContent = `## Goal\n${input.goal}\n`;

    if (input.sessionHistory) {
      userContent += `\n## Session history\n${input.sessionHistory}\n`;
    }

    if (input.toolCalls && input.toolCalls.length > 0) {
      userContent += '\n## Tool calls\n';
      for (const tc of input.toolCalls) {
        userContent += `- \`${tc.tool}\`: ${JSON.stringify(tc.args)} => ${JSON.stringify(tc.result)}\n`;
      }
      userContent += '\n';
    }

    if (input.failuresAndFixes) {
      userContent += `\n## Failures and fixes\n${input.failuresAndFixes}\n`;
    }

    if (input.skillExamples && input.skillExamples.length > 0) {
      userContent += '\n## Example skills\n';
      for (const ex of input.skillExamples) {
        userContent += `---\n${ex}\n---\n\n`;
      }
    }

    messages.push({ role: 'user', content: userContent });
    return messages;
  }

  private async streamToString(
    messages: ReadonlyArray<{ role: string; content: string }>
  ): Promise<string> {
    let fullText = '';
    for await (const chunk of this.llm.chat(messages)) {
      if (chunk.type === 'text' && chunk.text) {
        fullText += chunk.text;
      }
    }
    return fullText;
  }

  parseDraft(raw: string): Partial<AgentSkillDraftResult> {
    const fm = parseFrontmatter(raw);

    const name = fm.name ?? '';
    const description = fm.description ?? '';
    const whenToUse = extractSection(raw, 'When to use');
    const implementation = extractSection(raw, 'Implementation');
    const failuresAndFixes = extractSection(raw, 'Failures and fixes') ?? '';

    const verificationBlocks: string[] = [];
    const codeBlockPattern = /```sh\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null = null;
    do {
      match = codeBlockPattern.exec(raw);
      if (match) {
        const commands = match[1]
          .split('\n')
          .map((c) => c.trim())
          .filter((c) => c.length > 0);
        verificationBlocks.push(...commands);
      }
    } while (match !== null);
    const verificationCommands = verificationBlocks.join('\n');

    return {
      name,
      description,
      whenToUse,
      implementation,
      failuresAndFixes,
      verificationCommands,
    };
  }

  validateDraft(
    draft: Partial<AgentSkillDraftResult>,
    input: AgentSkillAuthorInput
  ): AgentSkillDraftResult {
    const missing: string[] = [];

    if (!draft.name?.trim()) missing.push('name');
    if (!draft.description?.trim()) missing.push('description');
    if (!draft.whenToUse?.trim()) missing.push('whenToUse');
    if (!draft.implementation?.trim()) missing.push('implementation');
    if (!draft.verificationCommands?.trim())
      missing.push('verificationCommands');

    if (missing.length > 0) {
      throw new Error(
        `draft validation failed: missing required fields: ${missing.join(', ')}`
      );
    }

    // At this point, we know all required fields are defined (we would have thrown above)
    const name = draft.name as string;
    const description = draft.description as string;
    const whenToUse = draft.whenToUse as string;
    const implementation = draft.implementation as string;
    const failuresAndFixes = draft.failuresAndFixes ?? '';
    const verificationCommands = draft.verificationCommands as string;

    return {
      name: name.trim(),
      description: description.trim(),
      whenToUse: whenToUse.trim(),
      implementation: implementation.trim(),
      failuresAndFixes: failuresAndFixes.trim(),
      verificationCommands: verificationCommands.trim(),
      provenance: {
        draftedBy: 'agent',
        model: this.model,
        draftedAt: Date.now(),
        input,
      },
    };
  }
}
