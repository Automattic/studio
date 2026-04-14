export enum StatsGroup {
	STUDIO_CLI_USAGE_UNIQUE = 'studio-cli-usage-unique',
	STUDIO_CLI_WEEKLY_UNIQUE_NPM = 'studio-cli-weekly-unq-npm',
	STUDIO_CLI_WEEKLY_UNIQUE_APP = 'studio-cli-weekly-unq-app',
	STUDIO_CLI_MONTHLY_UNIQUE_NPM = 'studio-cli-mon-unq-npm',
	STUDIO_CLI_MONTHLY_UNIQUE_APP = 'studio-cli-mon-unq-app',
	STUDIO_CLI_FIRST_LAUNCH_NPM = 'studio-cli-lch-1st-npm',
	STUDIO_CLI_FIRST_LAUNCH_APP = 'studio-cli-lch-1st-app',
	STUDIO_CLI_TOTAL_LAUNCHES_NPM = 'studio-cli-lch-tot-npm',
	STUDIO_CLI_TOTAL_LAUNCHES_APP = 'studio-cli-lch-tot-app',
	STUDIO_CLI_SITE_CREATE_NPM = 'studio-cli-site-crt-npm',
	STUDIO_CLI_SITE_CREATE_APP = 'studio-cli-site-crt-app',
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
