/**
 * Local type definitions for PHP versions.
 * These replace imports from @php-wasm/universal to avoid bundling PHP-WASM in the desktop app.
 *
 * Note: Keep these values in sync with @php-wasm/universal if the upstream package changes.
 */

export const SupportedPHPVersions = [
	'8.4',
	'8.3',
	'8.2',
	'8.1',
	'8.0',
	'7.4',
] as const;

export const LatestSupportedPHPVersion = '8.4' as const;

export const SupportedPHPVersionsList: string[] = [ ...SupportedPHPVersions ];

export type SupportedPHPVersion = ( typeof SupportedPHPVersions )[ number ];

/**
 * The recommended PHP version for new sites.
 * This replaces RecommendedPHPVersion from @wp-playground/common.
 */
export const RecommendedPHPVersion: SupportedPHPVersion = '8.3';
