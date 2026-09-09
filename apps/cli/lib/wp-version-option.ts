import { DEFAULT_WORDPRESS_VERSION, MINIMUM_WORDPRESS_VERSION } from '@studio/common/constants';
import {
	isValidWordPressVersion,
	isWordPressVersionAtLeast,
} from '@studio/common/lib/wordpress-version-utils';
import { __, sprintf } from '@wordpress/i18n';
import { ValidationError } from 'cli/lib/validation-error';

/**
 * CLI-facing name for the auto-update mode, matching the "Auto-update" option in
 * the apps.
 *
 * `latest` is the legacy spelling. It stays the internal value — it names a cache
 * directory, a segment of the wordpress.org download URL, and the persisted
 * `wpVersion` — so `auto-update` is resolved to it here, at the boundary, and
 * never reaches storage. Passing `latest` keeps working for existing scripts.
 */
export const CLI_AUTO_UPDATE_WP_VERSION = 'auto-update';

export function normalizeCliWpVersion( value: string ): string {
	return value === CLI_AUTO_UPDATE_WP_VERSION ? DEFAULT_WORDPRESS_VERSION : value;
}

/** Description for the `--wp` option, shared so both commands read alike. */
export function getWpVersionOptionDescription(): string {
	return sprintf(
		/* translators: 1: the CLI value "auto-update". 2: the legacy CLI value "latest". Do not translate either. */
		__(
			'WordPress version. Use "%1$s" to let the site auto-update, or pin a version (e.g., "6.4", "6.4.1"). Replaces the legacy "%2$s" option, which still works.'
		),
		CLI_AUTO_UPDATE_WP_VERSION,
		DEFAULT_WORDPRESS_VERSION
	);
}

/** Resolves the auto-update alias, then validates. Returns the internal value. */
export function coerceWpVersionOption( value: string ): string {
	const version = normalizeCliWpVersion( value );

	if ( ! isValidWordPressVersion( version ) ) {
		throw new ValidationError(
			'wp',
			value,
			sprintf(
				/* translators: %s: the literal CLI value "auto-update", do not translate. */
				__(
					'Must be: "%s", "nightly", or a valid version number (e.g., "6.4", "6.4.1", "6.4-beta1")'
				),
				CLI_AUTO_UPDATE_WP_VERSION
			)
		);
	}

	if ( ! isWordPressVersionAtLeast( version, MINIMUM_WORDPRESS_VERSION ) ) {
		throw new ValidationError(
			'wp',
			value,
			sprintf( __( 'Must be: at least %s' ), MINIMUM_WORDPRESS_VERSION )
		);
	}

	return version;
}
