export const defaultAgentModel = "claude-opus-5-5";

export function agentProfile() {
	return {
		actor: "agent:claude",
		runtime: "claude-agent-sdk",
		model: process.env.BRAISE_AGENT_MODEL ?? defaultAgentModel,
	};
}
