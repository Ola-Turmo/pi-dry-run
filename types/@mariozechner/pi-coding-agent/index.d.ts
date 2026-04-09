/**
 * Local type stubs for @mariozechner/pi-coding-agent and @sinclair/typebox.
 *
 * These are minimal stubs covering only the symbols actually used by pi-dry-run.
 * They let you build with `tsc` without any npm dependencies.
 *
 * When pi installs this package, it runs `npm install` in the package directory,
 * which installs the real @mariozechner/pi-coding-agent — at that point the real
 * types take over and these stubs are shadowed by the actual node_modules.
 *
 * To update stubs when the API changes:
 *   - ExtensionAPI / ExtensionContext / ToolCallEvent types → dist/core/extensions/types.d.ts
 *   - TypeBox primitives → @sinclair/typebox
 */

// ── @sinclair/typebox ────────────────────────────────────────────────────────

declare module "@sinclair/typebox" {
  export type TSchema = { readonly [key: string]: unknown };
  export type Static<T extends TSchema> = {
    [K in keyof T]: T[K] extends { type: "string" } ? string
      : T[K] extends { type: "number" } ? number
      : T[K] extends { type: "boolean" } ? boolean
      : T[K] extends { type: "array"; items: infer I } ? Static<I>[]
      : T[K] extends { type: "union"; anyOf: infer V } ? Static<V[number]>
      : T[K] extends { type: "optional"; items: infer I } ? Static<I> | undefined
      : T[K] extends TSchema ? Static<T[K]>
      : unknown;
  } & {};
  export function Literal<T extends string>(v: T): { type: "literal"; const: T };
  export function Optional<T extends TSchema>(v: T): { type: "optional"; items: T };
  export function Union<V extends TSchema[]>(v: V): { type: "union"; anyOf: V };
  export function Object<V extends Record<string, TSchema>>(v: V): { type: "object"; properties: V };
  export function String(opts?: { description?: string }): TSchema;
  export function Number(opts?: { description?: string }): TSchema;
  export function Boolean(opts?: { description?: string }): TSchema;
  export function Array<T extends TSchema>(v: T, opts?: { description?: string }): { type: "array"; items: T };
}

// ── Tool call event types ────────────────────────────────────────────────────

interface ToolCallEventBase {
  type: "tool_call";
  toolCallId: string;
}

interface BashToolCallEvent extends ToolCallEventBase {
  toolName: "bash";
  input: { command: string; timeout?: number };
}

interface WriteToolCallEvent extends ToolCallEventBase {
  toolName: "write";
  input: { path: string; content: string };
}

interface EditToolCallEvent extends ToolCallEventBase {
  toolName: "edit";
  input: { path: string; edits: Array<{ oldText: string; newText: string }> };
}

type ToolCallEvent = BashToolCallEvent | WriteToolCallEvent | EditToolCallEvent | ToolCallEventBase & { toolName: string; input: unknown };

type ToolCallEventResult = {
  block?: boolean;
  reason?: string;
};

type ToolResultEventResult = {
  content?: unknown[];
  details?: unknown;
  isError?: boolean;
};

declare function isToolCallEventType<T extends "bash" | "write" | "edit">(
  toolName: T,
  event: ToolCallEvent
): event is T extends "bash" ? BashToolCallEvent : T extends "write" ? WriteToolCallEvent : EditToolCallEvent;

// ── UI context ───────────────────────────────────────────────────────────────

interface ExtensionUIDialogOptions {
  signal?: AbortSignal;
  timeout?: number;
}

interface ExtensionUIContext {
  select(title: string, options: string[], opts?: ExtensionUIDialogOptions): Promise<string | undefined>;
  confirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean>;
  input(title: string, placeholder?: string, opts?: ExtensionUIDialogOptions): Promise<string | undefined>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

// ── Extension context ────────────────────────────────────────────────────────

interface ExtensionContext {
  ui: ExtensionUIContext;
  hasUI: boolean;
  cwd: string;
  sessionManager: unknown;
  isIdle(): boolean;
  signal: AbortSignal | undefined;
  abort(): void;
}

// ── Agent tool result ────────────────────────────────────────────────────────

type TextContent = { type: "text"; text: string };

type AgentToolResult<T = unknown> = {
  content: TextContent[];
  details: T;
};

// ── ExtensionAPI ─────────────────────────────────────────────────────────────

interface ExtensionAPI {
  on(event: "tool_call", handler: ExtensionHandler<ToolCallEvent, ToolCallEventResult>): void;
  on(event: "tool_result", handler: ExtensionHandler<unknown, ToolResultEventResult>): void;
  on(event: "session_start" | "session_shutdown", handler: ExtensionHandler<unknown, unknown>): void;
  registerTool(tool: ToolDefinition): void;
  registerCommand(name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">): void;
  getFlag(name: string): boolean | string | undefined;
  exec(command: string, args: string[], options?: unknown): Promise<unknown>;
}

type ExtensionHandler<E, R = unknown> = (event: E, ctx: ExtensionContext) => Promise<R | void> | R | void;

type RegisteredCommand = {
  name: string;
  sourceInfo: unknown;
  description?: string;
  handler: (args: string, ctx: ExtensionContext) => Promise<void>;
};

type ToolDefinition = {
  name: string;
  label: string;
  description: string;
  parameters: import("@sinclair/typebox").TSchema;
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: ((result: AgentToolResult) => void) | undefined,
    ctx: ExtensionContext
  ): Promise<AgentToolResult>;
};

// ── Module exports ────────────────────────────────────────────────────────────

export type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
  ToolCallEventResult,
  AgentToolResult,
  RegisteredCommand,
  ToolDefinition,
};

export { isToolCallEventType };
