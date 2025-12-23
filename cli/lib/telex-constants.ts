/**
 * Telex API configuration constants
 */
export const TELEX_DEFAULTS = {
	API_URL: 'https://telex.automattic.ai/api',
	BUILD_POLL_INTERVAL_MS: 2000,
	BUILD_MAX_RETRIES: 60, // ~2 minutes
	ENCODED_ID_PREFIX: 'v1.',
} as const;

/**
 * Get Telex API URL from environment variable or default
 *
 * Set STUDIO_TELEX_URL environment variable to use a custom Telex deployment
 * (useful for development or testing against staging environments)
 *
 * @returns Resolved Telex API URL
 */
export function getTelexApiUrl(): string {
	return process.env.STUDIO_TELEX_URL || TELEX_DEFAULTS.API_URL;
}

/**
 * Studio site path conventions
 */
export const STUDIO_PATHS = {
	SITES_DIR: 'Studio/sites',
	DOMAIN_SUFFIX: '.local',
} as const;
