/**
 * pi-dry-run
 *
 * Preview and confirm dangerous tool calls before they execute.
 * Intercepts bash commands with dangerous patterns, writes to sensitive paths,
 * and edits of protected files — and shows a confirmation dialog before proceeding.
 *
 * Enable with `/dryrun on`, disable with `/dryrun off`, check status with `/dryrun`.
 * Default: off.
 *
 * Dangerous bash commands (e.g. rm -rf, sudo, dd) always require confirmation.
 * Writes and edits to sensitive paths (.env, .pem, /etc/) always require confirmation.
 * Other bash calls are shown a warning but allowed through.
 */

import { Type } from "@sinclair/typebox";
import {
  isToolCallEventType,
  type ExtensionAPI,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Dangerous pattern detection
// ---------------------------------------------------------------------------

const BASH_DANGEROUS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /rm\s+-[rfvx]+\s+\//, label: "recursive rm at root" },
  { pattern: /rm\s+-[rfvx]+\s+\.\//, label: "recursive rm in current dir" },
  { pattern: /sudo\s+/i, label: "sudo command" },
  { pattern: /kill\s+-\d+/, label: "kill with signal" },
  { pattern: /dd\s+/i, label: "dd command (raw disk)" },
  { pattern: /^>\s*\/dev\//i, label: "redirect to device" },
  { pattern: /mkfs/i, label: "mkfs (filesystem wipe)" },
  { pattern: /fdisk/i, label: "fdisk (partition edit)" },
  { pattern: /wipefs/i, label: "wipefs" },
  { pattern: /curl\s+.*\|\s*sh/i, label: "pipe to shell" },
  { pattern: /wget\s+.*\|\s*sh/i, label: "wget pipe to shell" },
  { pattern: /shutdown|reboot|init\s+6/i, label: "system shutdown/reboot" },
  { pattern: /chattr\s+-i/i, label: "immutable file removal" },
  { pattern: /:\s*>!\s*\//i, label: "file destruction redirect" },
  { pattern: /chmod\s+777\s+\//i, label: "chmod 777 on root" },
  { pattern: /chmod\s+-\s*R\s+777/i, label: "recursive chmod 777" },
];

const SENSITIVE_PATHS: RegExp[] = [
  /\.env$/,
  /\.env\.[a-z]/,
  /\.env\.[a-z]+\.[a-z]/,
  /id_rsa/,
  /\.pem$/,
  /\.key$/,
  /\/etc\//,
  /\/root\/\.ssh\//,
  /\.aws\//,
];

function detectDanger(command: string): string | null {
  for (const { pattern, label } of BASH_DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return label;
  }
  return null;
}

function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATHS.some((p) => p.test(path));
}

function truncateForDisplay(text: string, maxLen = 200): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let dryRunEnabled = false;
let warnedNonStandard = false;

type Context = import("@mariozechner/pi-coding-agent").ExtensionContext;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default async function (pi: ExtensionAPI) {
  // ------------------------------------------------------------------
  // Command: /dryrun
  // ------------------------------------------------------------------
  pi.registerCommand("dryrun", {
    description: "Toggle dry-run mode: /dryrun on|off|status",
    handler: async (text: string, ctx: Context) => {
      const arg = text.trim().toLowerCase();
      if (arg === "on" || arg === "enable" || arg === "true") {
        dryRunEnabled = true;
        warnedNonStandard = false;
        ctx.ui.notify("Dry-run mode ON — confirmations required for dangerous operations", "info");
      } else if (arg === "off" || arg === "disable" || arg === "false") {
        dryRunEnabled = false;
        ctx.ui.notify("Dry-run mode OFF", "info");
      } else {
        ctx.ui.notify(
          `Dry-run: ${dryRunEnabled ? "ON" : "OFF"}`,
          dryRunEnabled ? "warning" : "info"
        );
      }
    },
  });

  // ------------------------------------------------------------------
  // Tool: DryRunToggle — callable by the LLM
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "DryRunToggle",
    label: "Dry Run",
    description:
      "Toggle or query dry-run mode. When active, dangerous bash commands and writes/edits to sensitive paths require confirmation before execution.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("on"),
        Type.Literal("off"),
        Type.Literal("status"),
      ]),
    }),

    async execute(
      _toolCallId: string,
      params: { action: "on" | "off" | "status" },
      _signal: undefined,
      _onUpdate: undefined,
      _ctx: import("@mariozechner/pi-coding-agent").ExtensionContext
    ) {
      switch (params.action) {
        case "on":
          dryRunEnabled = true;
          warnedNonStandard = false;
          return {
            content: [{ type: "text" as const, text: "Dry-run mode enabled." }],
            details: { action: "on", enabled: true },
          };
        case "off":
          dryRunEnabled = false;
          return {
            content: [{ type: "text" as const, text: "Dry-run mode disabled." }],
            details: { action: "off", enabled: false },
          };
        case "status":
          return {
            content: [
              {
                type: "text" as const,
                text: `Dry-run mode is ${dryRunEnabled ? "ON" : "OFF"}.`,
              },
            ],
            details: { action: "status", enabled: dryRunEnabled },
          };
      }
    },
  });

  // ------------------------------------------------------------------
  // Interceptor: tool_call event
  // ------------------------------------------------------------------
  pi.on("tool_call", async (event, ctx: Context) => {
    if (!dryRunEnabled) return;
    if (!ctx.hasUI) return; // No dialog in RPC/print modes

    // ------------------------------------------------------------------
    // bash — detect dangerous command patterns
    // ------------------------------------------------------------------
    if (isToolCallEventType("bash", event)) {
      const command: string = event.input.command ?? "";
      const danger = detectDanger(command);
      if (danger) {
        const display = truncateForDisplay(command);
        const confirmed = await ctx.ui.confirm(
          "Confirm bash — dangerous pattern",
          `Detected: ${danger}\n\nCommand:\n${display}`,
          { timeout: 30_000 }
        );
        if (!confirmed) {
          return { block: true, reason: `Dry-run blocked: ${danger}` };
        }
        return; // allowed through
      }

      // Warn once on non-standard non-interactive commands
      if (!warnedNonStandard) {
        const isInteractive = /^(cd|ls|git|grep|find|cat|head|tail|wc|sort|uniq|awk|sed|curl|wget|npm|yarn|pip|pnpm)\b/i.test(command);
        if (!isInteractive && command.length > 0) {
          warnedNonStandard = true;
          ctx.ui.notify(
            `Dry-run warning: non-standard bash command — running without confirmation`,
            "warning"
          );
        }
      }
    }

    // ------------------------------------------------------------------
    // write — sensitive path warning
    // ------------------------------------------------------------------
    if (isToolCallEventType("write", event)) {
      const path: string = event.input.path ?? "";
      if (isSensitivePath(path)) {
        const confirmed = await ctx.ui.confirm(
          "Confirm write — sensitive path",
          `About to write to:\n\n${path}\n\nContinue?`,
          { timeout: 30_000 }
        );
        if (!confirmed) {
          return { block: true, reason: `Dry-run blocked: sensitive path ${path}` };
        }
      }
    }

    // ------------------------------------------------------------------
    // edit — sensitive path warning
    // ------------------------------------------------------------------
    if (isToolCallEventType("edit", event)) {
      const input = event.input as { path?: string; edits?: Array<{ path?: string }> };
      const path: string = input.path ?? input.edits?.[0]?.path ?? "";
      if (isSensitivePath(path)) {
        const confirmed = await ctx.ui.confirm(
          "Confirm edit — sensitive path",
          `About to edit:\n\n${path}\n\nContinue?`,
          { timeout: 30_000 }
        );
        if (!confirmed) {
          return { block: true, reason: `Dry-run blocked: sensitive path ${path}` };
        }
      }
    }
  });
}
