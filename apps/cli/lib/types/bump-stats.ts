export enum StatsGroup {
	STUDIO_CLI_USAGE_UNIQUE = 'studio-cli-usage-unique',
	STUDIO_CLI_WEEKLY_UNIQUE_NPM = 'studio-cli-weekly-unq-npm',
	STUDIO_CLI_WEEKLY_UNIQUE_APP = 'studio-cli-weekly-unq-app',
	STUDIO_CLI_WEEKLY_UNIQUE_STANDALONE = 'studio-cli-weekly-unq-std',
	STUDIO_CLI_MONTHLY_UNIQUE_NPM = 'studio-cli-mon-unq-npm',
	STUDIO_CLI_MONTHLY_UNIQUE_APP = 'studio-cli-mon-unq-app',
	STUDIO_CLI_MONTHLY_UNIQUE_STANDALONE = 'studio-cli-mon-unq-std',
	STUDIO_CLI_FIRST_LAUNCH_NPM = 'studio-cli-lch-1st-npm',
	STUDIO_CLI_FIRST_LAUNCH_APP = 'studio-cli-lch-1st-app',
	STUDIO_CLI_FIRST_LAUNCH_STANDALONE = 'studio-cli-lch-1st-std',
	STUDIO_CLI_TOTAL_LAUNCHES_NPM = 'studio-cli-lch-tot-npm',
	STUDIO_CLI_TOTAL_LAUNCHES_APP = 'studio-cli-lch-tot-app',
	STUDIO_CLI_TOTAL_LAUNCHES_STANDALONE = 'studio-cli-lch-tot-std',
	STUDIO_CLI_SITE_CREATE_NPM = 'studio-cli-site-crt-npm',
	STUDIO_CLI_SITE_CREATE_APP = 'studio-cli-site-crt-app',
	// Daily active sites by PHP runtime + file access — see RSM-3958.
	STUDIO_CLI_RUNTIME_DAILY = 'studio-cli-runtime-day',
	// Dolly remote-session (Telegram bot bridge) — see STU-1739.
	STUDIO_CLI_DOLLY_START = 'studio-cli-dolly-start',
	STUDIO_CLI_DOLLY_ATTACH = 'studio-cli-dolly-attach',
	STUDIO_CLI_DOLLY_TURN = 'studio-cli-dolly-turn',
	STUDIO_CLI_DOLLY_DETACH = 'studio-cli-dolly-detach',
	STUDIO_CLI_DOLLY_WEEKLY_UNIQ = 'studio-cli-dolly-wkly-unq',
	STUDIO_CLI_DOLLY_MONTHLY_UNIQ = 'studio-cli-dolly-mon-unq',
}

export enum StatsMetric {
	SUCCESS = 'success',
	FAILURE = 'failure',
	// Platforms
	DARWIN = 'darwin',
	LINUX = 'linux',
	WINDOWS = 'win32',
	UNKNOWN_PLATFORM = 'unknown-platform',
	// Per-site daily active-runtime adoption — see RSM-3958.
	RUNTIME_NATIVE_SITE_DIR = 'native-site-dir',
	RUNTIME_NATIVE_ALL_FILES = 'native-all-files',
	RUNTIME_SANDBOX = 'sandbox',
	// Dolly turn outcomes — mirror `TurnOutcomeStatus` from turn-runner.ts, plus an `aborted`
	// bucket for detach-mid-turn (signalled via the abort controller, not the status field).
	TURN_ERROR = 'error',
	TURN_PAUSED = 'paused',
	TURN_MAX_TURNS = 'max-turns',
	TURN_TIMEOUT = 'timeout',
	TURN_SPAWN_ERROR = 'spawn-error',
	TURN_ABORTED = 'aborted',
	// Dolly detach reasons — mirror the `reason` arg passed to announceDetach() in poll-loop.ts.
	DETACH_REQUESTED = 'requested',
	DETACH_LOOP_EXIT = 'loop-exit',
	DETACH_AUTH_ERROR = 'auth-error',
	DETACH_FATAL_POLL_ERROR = 'fatal-poll-error',
}
