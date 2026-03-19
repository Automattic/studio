export enum StatsGroup {
	STUDIO_CLI_USAGE_UNIQUE = 'studio-cli-usage-unique',
	STUDIO_CLI_WEEKLY_UNIQUE_NPM = 'studio-cli-weekly-unq-npm',
	STUDIO_CLI_WEEKLY_UNIQUE_APP = 'studio-cli-weekly-unq-app',
}

export enum StatsMetric {
	SUCCESS = 'success',
	FAILURE = 'failure',
	// Platforms
	DARWIN = 'darwin',
	LINUX = 'linux',
	WINDOWS = 'win32',
	UNKNOWN_PLATFORM = 'unknown-platform',
}
