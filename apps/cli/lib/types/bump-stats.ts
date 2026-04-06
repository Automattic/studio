export enum StatsGroup {
	STUDIO_CLI_USAGE_UNIQUE = 'studio-cli-usage-unique',
	STUDIO_CLI_WEEKLY_UNIQUE_NPM = 'studio-cli-weekly-unq-npm',
	STUDIO_CLI_WEEKLY_UNIQUE_APP = 'studio-cli-weekly-unq-app',
}

export const MCP_TELEMETRY_GROUPS = [ 'claude-code-plugin', 'codex-plugin' ] as const;
export type McpTelemetryGroup = ( typeof MCP_TELEMETRY_GROUPS )[ number ];

export const MCP_WORKFLOWS = [
	'site-build',
	'theme-build',
	'block-build',
	'plugin-build',
	'auditing',
] as const;
export type McpWorkflow = ( typeof MCP_WORKFLOWS )[ number ];

export const MCP_WORKFLOW_STAGES = [ 'started', 'completed', 'failed' ] as const;
export type McpWorkflowStage = ( typeof MCP_WORKFLOW_STAGES )[ number ];
export type McpWorkflowStat = `${ McpWorkflow }-${ McpWorkflowStage }`;

export type BumpStatGroup = StatsGroup | McpTelemetryGroup;
export type BumpStatMetric = StatsMetric | McpWorkflowStat;

export enum StatsMetric {
	SUCCESS = 'success',
	FAILURE = 'failure',
	// Platforms
	DARWIN = 'darwin',
	LINUX = 'linux',
	WINDOWS = 'win32',
	UNKNOWN_PLATFORM = 'unknown-platform',
}
