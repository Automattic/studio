import type { AgentProcess, AgentProcessOptions, AgentRuntime } from './runtime';

/**
 * Placeholder runtime: the hosted backend has no agent execution backend yet.
 *
 * The previous local stand-in forked the `studio code` CLI as a child process —
 * that coupled this server to a local Studio install and is exactly the kind of
 * local-only behaviour the hosted product moves away from. The real
 * implementation will run the agent inside a per-session SecEx sandbox and be
 * injected via {@link setAgentRuntime}. Until then, attempting to start a run
 * fails loudly rather than pretending to work.
 */
export const stubRuntime: AgentRuntime = {
	start( _options: AgentProcessOptions ): AgentProcess {
		throw new Error(
			'Agent execution is not implemented in the hosted backend yet. ' +
				'Inject a runtime with setAgentRuntime() before starting a run.'
		);
	},
};
