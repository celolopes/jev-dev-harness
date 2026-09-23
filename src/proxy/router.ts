import { SafeJevClient, choice, noul } from "../shared/typesafe-client.js";
import { SAFE_TOOL_NAME } from "../tool-ranker/types.js";
import type { ProxyAgentTarget, RoutingDecision } from "./types.js";

interface ExtractedTurnData {
  messages: Array<{ role: string; content: string }>;
  tools: Array<{ name: string; description?: string }>;
}

export function extractTurnData(body: any): ExtractedTurnData {
  const tools: Array<{ name: string; description?: string }> = [];
  const messages: Array<{ role: string; content: string }> = [];

  if (!body || typeof body !== "object") {
    return { messages, tools };
  }

  // 1. Extract tools
  if (Array.isArray(body.tools)) {
    for (const t of body.tools) {
      if (t && typeof t === "object") {
        const name = t.function?.name || t.name;
        const description = t.function?.description || t.description;
        if (typeof name === "string" && SAFE_TOOL_NAME.test(name)) {
          tools.push({ name, description });
        }
      }
    }
  }

  // 2. Extract messages / conversation turns
  if (Array.isArray(body.messages)) {
    for (const m of body.messages) {
      if (m && typeof m === "object") {
        const role = m.role || "user";
        let content = "";
        if (typeof m.content === "string") {
          content = m.content;
        } else if (Array.isArray(m.content)) {
          content = m.content
            .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
            .join(" ");
        }
        if (content.trim()) {
          messages.push({ role, content: content.slice(0, 1000) });
        }
      }
    }
  } else if (Array.isArray(body.input)) {
    // Codex Responses API
    for (const item of body.input) {
      if (typeof item === "string") {
        messages.push({ role: "user", content: item.slice(0, 1000) });
      } else if (item && typeof item === "object") {
        const content = item.content || item.text || JSON.stringify(item);
        messages.push({ role: item.role || "user", content: String(content).slice(0, 1000) });
      }
    }
  }

  return { messages, tools };
}

/**
 * Evaluates the turn with Jev System One to decide whether and which tool to force or hint.
 * Always adheres to the Fail-Open Invariant.
 */
export async function decideRoute(
  body: any,
  target: ProxyAgentTarget,
  client: SafeJevClient,
  routingEnabled = true
): Promise<RoutingDecision> {
  const start = Date.now();

  if (!routingEnabled) {
    return { mode: "passthrough", reason: "routing_disabled", latencyMs: 0 };
  }

  const { messages, tools } = extractTurnData(body);

  if (tools.length === 0) {
    return { mode: "passthrough", reason: "no_tools_declared", latencyMs: 0 };
  }

  if (messages.length === 0) {
    return { mode: "passthrough", reason: "no_messages_present", latencyMs: 0 };
  }

  if (!client.isConfigured || client.disabled) {
    return {
      mode: "passthrough",
      reason: client.disabled ? "jev_disabled" : "jev_not_configured",
      latencyMs: 0,
      provider: client.provider,
    };
  }

  try {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    const toolNames = tools.map((t) => t.name).slice(0, 120);

    const criteria: Record<string, string> = {};
    for (const t of tools.slice(0, 120)) {
      criteria[t.name] = (t.description || `Tool ${t.name}`).slice(0, 150);
    }
    criteria["no_tool_needed"] = "Reply directly with text, no tool call needed";

    const state = {
      user_turn: lastUserMsg.slice(0, 800),
      available_tools: tools.slice(0, 80).map((t) => `${t.name}: ${t.description || ""}`),
      agent_target: target,
    };

    const questions = {
      tool_choice: choice(
        "Which tool is most appropriate for the assistant to call for this turn, or reply in text?",
        criteria
      ),
      needs_tool: noul("Does the assistant need to call an external tool for this request?"),
    };

    const res = await client.systemOne(state, questions);
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      return {
        mode: "passthrough",
        reason: `fail_open: ${res.reason}`,
        latencyMs,
        provider: client.provider,
      };
    }

    const answers = res.result.answers;
    const pickedTool = (answers as any).tool_choice?.choice;
    const confidence = (answers as any).tool_choice?.confidence ?? 0.8;
    const needsToolNoul = (answers as any).needs_tool?.noul ?? 0.8;

    if (pickedTool === "no_tool_needed" || needsToolNoul < 0.25) {
      return {
        mode: "none",
        confidence,
        reason: "Jev determined no tool call is needed",
        latencyMs,
        provider: client.provider,
      };
    }

    if (pickedTool && toolNames.includes(pickedTool)) {
      if (target === "claude") {
        // Claude Code uses extended thinking and prompt cache; forced tool breaks it, so use hint mode
        return {
          mode: "hint",
          tool: pickedTool,
          confidence,
          reason: "Suggested tool via prompt hint for Claude",
          latencyMs,
          provider: client.provider,
        };
      }

      // Default: force tool choice for OpenAI, Codex, OpenCode, generic
      return {
        mode: "forced",
        tool: pickedTool,
        confidence,
        reason: "Forced tool choice",
        latencyMs,
        provider: client.provider,
      };
    }

    return {
      mode: "passthrough",
      reason: "low_confidence_or_none_of_these",
      latencyMs,
      provider: client.provider,
    };
  } catch (err) {
    return {
      mode: "passthrough",
      reason: `fail_open: ${(err as Error).message}`,
      latencyMs: Date.now() - start,
      provider: client.provider,
    };
  }
}
