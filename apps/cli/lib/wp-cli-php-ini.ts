const E_ALL = 32767;
const E_DEPRECATED = 8192;

export const WP_CLI_PHP_INI_ENTRIES = {
	error_reporting: String( E_ALL & ~E_DEPRECATED ),
	display_errors: 'stderr',
	log_errors: 0,
} as const;

export function getWpCliPhpIniArgs(): string[] {
	return Object.entries( WP_CLI_PHP_INI_ENTRIES ).flatMap( ( [ key, value ] ) => [
		'-d',
		`${ key }=${ value }`,
	] );
}
