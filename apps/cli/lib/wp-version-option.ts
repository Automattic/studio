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
 * Internally the mode stays `latest`: it names a cache directory, a segment of
 * the wordpress.org download URL, and the persisted `wpVersion`. The alias is
 * resolved here so it never reaches storage, and `latest` keeps working for
 * existing scripts.
 */
export const CLI_AUTO_UPDATE_WP_VERSION = 'auto-update';

export function normalizeCliWpVersion( value: string ): string {
	return value === CLI_AUTO_UPDATE_WP_VERSION ? DEFAULT_WORDPRESS_VERSION : value;
}

/** Description for the `--wp` option, shared so both commands read alike. */
export function getWpVersionOptionDescription(): string {
	return sprintf(
		/* translators: %s: the literal CLI value "auto-update", do not translate. */
		__(
			'WordPress version. Use "%s" to let the site auto-update, or pin a version (e.g., "6.4", "6.4.1"). "latest" is accepted as an alias.'
		),
		CLI_AUTO_UPDATE_WP_VERSION
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
