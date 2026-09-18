export type CoreConfig = {
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens: number;
  enableRefusalFallbacks: boolean;
  maxTurnsPerConversation: number;
  historyTokenBudget: number;
  idleCloseMinutes: number;
};

export function getConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  const effort = (env.ANTHROPIC_EFFORT ?? "medium") as CoreConfig["effort"];
  return {
    model: env.ANTHROPIC_MODEL ?? "claude-opus-5",
    effort: ["low", "medium", "high", "xhigh", "max"].includes(effort) ? effort : "medium",
    maxTokens: Number(env.ANTHROPIC_MAX_TOKENS ?? 8000),
    enableRefusalFallbacks: (env.ENABLE_REFUSAL_FALLBACKS ?? "true") !== "false",
    maxTurnsPerConversation: Number(env.MAX_TURNS_PER_CONVERSATION ?? 20),
    historyTokenBudget: Number(env.HISTORY_TOKEN_BUDGET ?? 20000),
    idleCloseMinutes: Number(env.CONVERSATION_IDLE_MINUTES ?? 120),
  };
}
