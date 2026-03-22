/**
 * Codex Provider — LLMProvider implementation backed by @openai/codex-sdk.
 *
 * Maps Codex SDK thread events to the SSE stream format consumed by
 * the bridge conversation engine, making Codex a drop-in alternative
 * to the Claude Code SDK backend.
 *
 * Requires `@openai/codex-sdk` to be installed (optionalDependency).
 * The provider lazily imports the SDK at first use and throws a clear
 * error if it is not available.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

import type { LLMProvider, StreamChatParams } from 'claude-to-im/src/lib/bridge/host.js';
import type { PendingPermissions } from './permission-gateway.js';
import { sseEvent } from './sse-utils.js';

/** MIME → file extension for temp image files. */
const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

// All SDK types kept as `any` because @openai/codex-sdk is optional.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CodexModule = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CodexInstance = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ThreadInstance = any;

/**
 * Map bridge permission modes to Codex approval policies.
 * - 'acceptEdits' (code mode) → 'on-failure' (auto-approve most things)
 * - 'plan' → 'on-request' (ask before executing)
 * - 'default' (ask mode) → 'on-request'
 */
function toApprovalPolicy(permissionMode?: string): string {
  switch (permissionMode) {
    case 'acceptEdits': return 'on-failure';
    case 'plan': return 'on-request';
    case 'default': return 'on-request';
    default: return 'on-request';
  }
}

/** Whether to forward bridge model to Codex CLI. Default: false (use Codex current/default model). */
function shouldPassModelToCodex(): boolean {
  return process.env.CTI_CODEX_PASS_MODEL === 'true';
}

function looksLikeClaudeModel(model?: string): boolean {
  return !!model && /^claude[-_]/i.test(model);
}

function shouldRetryFreshThread(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('resuming session with different model') ||
    lower.includes('no such session') ||
    (lower.includes('resume') && lower.includes('session'))
  );
}

function shouldFallbackToCLI(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('reading prompt from stdin') ||
    lower.includes('no prompt provided via stdin') ||
    lower.includes('codex exec exited with code 1') ||
    lower.includes('missing environment variable')
  );
}

export class CodexProvider implements LLMProvider {
  private sdk: CodexModule | null = null;
  private codex: CodexInstance | null = null;
  private threadIds = new Map<string, string>();

  constructor(private pendingPerms: PendingPermissions) {}

  private async ensureSDK(): Promise<{ sdk: CodexModule; codex: CodexInstance }> {
    if (this.sdk && this.codex) {
      return { sdk: this.sdk, codex: this.codex };
    }

    try {
      this.sdk = await (Function('return import("@openai/codex-sdk")')() as Promise<CodexModule>);
    } catch {
      throw new Error(
        '[CodexProvider] @openai/codex-sdk is not installed. ' +
        'Install it with: npm install @openai/codex-sdk'
      );
    }

    const apiKey = process.env.CTI_CODEX_API_KEY
      || process.env.CODEX_API_KEY
      || process.env.OPENAI_API_KEY
      || undefined;
    const baseUrl = process.env.CTI_CODEX_BASE_URL || undefined;

    const CodexClass = this.sdk.Codex;
    this.codex = new CodexClass({
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
    });

    return { sdk: this.sdk, codex: this.codex };
  }

  streamChat(params: StreamChatParams): ReadableStream<string> {
    const self = this;

    return new ReadableStream<string>({
      start(controller) {
        (async () => {
          const tempFiles: string[] = [];
          try {
            try {
              await self.runViaSDK(params, controller, tempFiles);
            } catch (sdkErr) {
              const sdkMessage = sdkErr instanceof Error ? sdkErr.message : String(sdkErr);
              if (!shouldFallbackToCLI(sdkMessage)) {
                throw sdkErr;
              }
              await self.runViaCLI(params, controller, tempFiles);
            }
            controller.close();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[codex-provider] Error:', err instanceof Error ? err.stack || err.message : err);
            try {
              controller.enqueue(sseEvent('error', message));
              controller.close();
            } catch {
              // Controller already closed
            }
          } finally {
            // Clean up temp image files
            for (const tmp of tempFiles) {
              try { fs.unlinkSync(tmp); } catch { /* ignore */ }
            }
          }
        })();
      },
    });
  }

  private async runViaSDK(
    params: StreamChatParams,
    controller: ReadableStreamDefaultController<string>,
    tempFiles: string[],
  ): Promise<void> {
    const { codex } = await this.ensureSDK();

    let savedThreadId = params.sdkSessionId
      ? this.threadIds.get(params.sessionId) || params.sdkSessionId
      : undefined;

    if (savedThreadId && looksLikeClaudeModel(params.model)) {
      console.warn('[codex-provider] Ignoring stale Claude-like sdkSessionId in Codex runtime; starting fresh thread');
      savedThreadId = undefined;
    }

    const approvalPolicy = toApprovalPolicy(params.permissionMode);
    const passModel = shouldPassModelToCodex();

    const threadOptions: Record<string, unknown> = {
      ...(passModel && params.model ? { model: params.model } : {}),
      ...(params.workingDirectory ? { workingDirectory: params.workingDirectory } : {}),
      approvalPolicy,
    };

    const imageFiles = params.files?.filter(
      f => f.type.startsWith('image/')
    ) ?? [];

    let input: string | Array<Record<string, string>>;
    if (imageFiles.length > 0) {
      const parts: Array<Record<string, string>> = [
        { type: 'text', text: params.prompt },
      ];
      for (const file of imageFiles) {
        const ext = MIME_EXT[file.type] || '.png';
        const tmpPath = path.join(os.tmpdir(), `cti-img-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
        fs.writeFileSync(tmpPath, Buffer.from(file.data, 'base64'));
        tempFiles.push(tmpPath);
        parts.push({ type: 'local_image', path: tmpPath });
      }
      input = parts;
    } else {
      input = params.prompt;
    }

    let retryFresh = false;

    while (true) {
      let thread: ThreadInstance;
      if (savedThreadId) {
        try {
          thread = codex.resumeThread(savedThreadId, threadOptions);
        } catch {
          thread = codex.startThread(threadOptions);
        }
      } else {
        thread = codex.startThread(threadOptions);
      }

      let sawAnyEvent = false;
      try {
        const { events } = await thread.runStreamed(input);

        for await (const event of events) {
          sawAnyEvent = true;
          if (params.abortController?.signal.aborted) {
            break;
          }

          switch (event.type) {
            case 'thread.started': {
              const threadId = event.thread_id as string;
              this.threadIds.set(params.sessionId, threadId);
              controller.enqueue(sseEvent('status', {
                session_id: threadId,
              }));
              break;
            }

            case 'item.completed': {
              const item = event.item as Record<string, unknown>;
              this.handleCompletedItem(controller, item);
              break;
            }

            case 'turn.completed': {
              const usage = event.usage as Record<string, unknown> | undefined;
              const threadId = this.threadIds.get(params.sessionId);
              controller.enqueue(sseEvent('result', {
                usage: usage ? {
                  input_tokens: usage.input_tokens ?? 0,
                  output_tokens: usage.output_tokens ?? 0,
                  cache_read_input_tokens: usage.cached_input_tokens ?? 0,
                } : undefined,
                ...(threadId ? { session_id: threadId } : {}),
              }));
              break;
            }

            case 'turn.failed': {
              const error = (event as { message?: string }).message;
              controller.enqueue(sseEvent('error', error || 'Turn failed'));
              break;
            }

            case 'error': {
              const error = (event as { message?: string }).message;
              controller.enqueue(sseEvent('error', error || 'Thread error'));
              break;
            }
          }
        }
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (savedThreadId && !retryFresh && !sawAnyEvent && shouldRetryFreshThread(message)) {
          console.warn('[codex-provider] Resume failed, retrying with a fresh thread:', message);
          savedThreadId = undefined;
          retryFresh = true;
          continue;
        }
        throw err;
      }
    }
  }

  private async runViaCLI(
    params: StreamChatParams,
    controller: ReadableStreamDefaultController<string>,
    tempFiles: string[],
  ): Promise<void> {
    const approvalPolicy = toApprovalPolicy(params.permissionMode);
    const passModel = shouldPassModelToCodex();
    const commandArgs = ['exec', '--experimental-json'];
    const env = { ...process.env } as Record<string, string>;

    if (passModel && params.model) {
      commandArgs.push('--model', params.model);
    }
    if (params.workingDirectory) {
      commandArgs.push('--cd', params.workingDirectory);
    }
    commandArgs.push('--config', `approval_policy="${approvalPolicy}"`);

    if (process.env.CTI_CODEX_BASE_URL) {
      env.OPENAI_BASE_URL = process.env.CTI_CODEX_BASE_URL;
    }
    if (process.env.CTI_CODEX_API_KEY) {
      env.CODEX_API_KEY = process.env.CTI_CODEX_API_KEY;
    }

    const imageFiles = params.files?.filter(
      f => f.type.startsWith('image/')
    ) ?? [];
    for (const file of imageFiles) {
      const ext = MIME_EXT[file.type] || '.png';
      const tmpPath = path.join(os.tmpdir(), `cti-img-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
      fs.writeFileSync(tmpPath, Buffer.from(file.data, 'base64'));
      tempFiles.push(tmpPath);
      commandArgs.push('--image', tmpPath);
    }

    const child = spawn('codex', commandArgs, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: params.abortController?.signal,
    });

    const stderrChunks: Buffer[] = [];
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    if (!child.stdin || !child.stdout) {
      throw new Error('Failed to start codex exec subprocess');
    }

    child.stdin.write(`${params.prompt}\n`);
    child.stdin.end();

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (params.abortController?.signal.aborted) {
        break;
      }
      if (!line.trim()) continue;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      switch (event.type) {
        case 'thread.started': {
          const threadId = event.thread_id as string;
          this.threadIds.set(params.sessionId, threadId);
          controller.enqueue(sseEvent('status', {
            session_id: threadId,
          }));
          break;
        }

        case 'item.completed': {
          const item = event.item as Record<string, unknown>;
          this.handleCompletedItem(controller, item);
          break;
        }

        case 'turn.completed': {
          const usage = event.usage as Record<string, unknown> | undefined;
          const threadId = this.threadIds.get(params.sessionId);
          controller.enqueue(sseEvent('result', {
            usage: usage ? {
              input_tokens: usage.input_tokens ?? 0,
              output_tokens: usage.output_tokens ?? 0,
              cache_read_input_tokens: usage.cached_input_tokens ?? 0,
            } : undefined,
            ...(threadId ? { session_id: threadId } : {}),
          }));
          break;
        }

        case 'turn.failed': {
          const error = event.message as string | undefined;
          controller.enqueue(sseEvent('error', error || 'Turn failed'));
          break;
        }

        case 'error': {
          const error = event.message as string | undefined;
          controller.enqueue(sseEvent('error', error || 'Thread error'));
          break;
        }
      }
    }

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });

    const stderrText = Buffer.concat(stderrChunks).toString('utf8').trim();
    if (exitCode !== 0) {
      throw new Error(
        stderrText
          ? `Codex Exec exited with code ${exitCode}: ${stderrText}`
          : `Codex Exec exited with code ${exitCode}`,
      );
    }
  }

  /**
   * Map a completed Codex item to SSE events.
   */
  private handleCompletedItem(
    controller: ReadableStreamDefaultController<string>,
    item: Record<string, unknown>,
  ): void {
    const itemType = item.type as string;

    switch (itemType) {
      case 'agent_message': {
        const text = (item.text as string) || '';
        if (text) {
          controller.enqueue(sseEvent('text', text));
        }
        break;
      }

      case 'command_execution': {
        const toolId = (item.id as string) || `tool-${Date.now()}`;
        const command = item.command as string || '';
        const output = item.aggregated_output as string || '';
        const exitCode = item.exit_code as number | undefined;
        const isError = exitCode != null && exitCode !== 0;

        controller.enqueue(sseEvent('tool_use', {
          id: toolId,
          name: 'Bash',
          input: { command },
        }));

        const resultContent = output || (isError ? `Exit code: ${exitCode}` : 'Done');
        controller.enqueue(sseEvent('tool_result', {
          tool_use_id: toolId,
          content: resultContent,
          is_error: isError,
        }));
        break;
      }

      case 'file_change': {
        const toolId = (item.id as string) || `tool-${Date.now()}`;
        const changes = item.changes as Array<{ path: string; kind: string }> || [];
        const summary = changes.map(c => `${c.kind}: ${c.path}`).join('\n');

        controller.enqueue(sseEvent('tool_use', {
          id: toolId,
          name: 'Edit',
          input: { files: changes },
        }));

        controller.enqueue(sseEvent('tool_result', {
          tool_use_id: toolId,
          content: summary || 'File changes applied',
          is_error: false,
        }));
        break;
      }

      case 'mcp_tool_call': {
        const toolId = (item.id as string) || `tool-${Date.now()}`;
        const server = item.server as string || '';
        const tool = item.tool as string || '';
        const args = item.arguments as unknown;
        const result = item.result as { content?: unknown; structured_content?: unknown } | undefined;
        const error = item.error as { message?: string } | undefined;

        const resultContent = result?.content ?? result?.structured_content;
        const resultText = typeof resultContent === 'string' ? resultContent : (resultContent ? JSON.stringify(resultContent) : undefined);

        controller.enqueue(sseEvent('tool_use', {
          id: toolId,
          name: `mcp__${server}__${tool}`,
          input: args,
        }));

        controller.enqueue(sseEvent('tool_result', {
          tool_use_id: toolId,
          content: error?.message || resultText || 'Done',
          is_error: !!error,
        }));
        break;
      }

      case 'reasoning': {
        // Reasoning is internal; emit as status
        const text = (item.text as string) || '';
        if (text) {
          controller.enqueue(sseEvent('status', { reasoning: text }));
        }
        break;
      }
    }
  }
}
