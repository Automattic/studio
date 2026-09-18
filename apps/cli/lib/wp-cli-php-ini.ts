const E_ALL = 32767;

/**
 * PHP ini policy for WP-CLI invocations.
 *
 * WP-CLI's vendored dependencies raise deprecations on PHP 8.5, and PHP's default
 * `display_errors=1` puts them on stdout, which corrupts `--format=json` output (#4686).
 * `display_errors=stderr` moves diagnostics off stdout without discarding them, so callers
 * that parse stdout stay correct while the diagnostics remain visible. `log_errors=0` stops
 * PHP from also writing a duplicate copy to stderr through the error log.
 *
 * Apply this per WP-CLI invocation, never to a whole PHP instance: the Playground server
 * instance also serves HTTP requests, and this policy has no business changing those.
 */
export const WP_CLI_PHP_INI_ENTRIES = {
	error_reporting: String( E_ALL ),
	display_errors: 'stderr',
	log_errors: 0,
} as const;

export function getWpCliPhpIniArgs(): string[] {
	return Object.entries( WP_CLI_PHP_INI_ENTRIES ).flatMap( ( [ key, value ] ) => [
		'-d',
		`${ key }=${ value }`,
	] );
}

/**
 * Builds the `php` argv for a WP-CLI invocation. The ini flags must precede the phar path,
 * otherwise PHP passes them through to WP-CLI as script arguments.
 */
export function buildWpCliPhpArgv(
	pharPath: string,
	documentRoot: string,
	args: string[]
): string[] {
	return [ 'php', ...getWpCliPhpIniArgs(), pharPath, `--path=${ documentRoot }`, ...args ];
}
