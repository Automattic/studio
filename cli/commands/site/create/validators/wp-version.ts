import { __, sprintf } from '@wordpress/i18n';
import {
	isValidWordPressVersion,
	isWordPressVersionAtLeast,
} from 'common/lib/wordpress-version-utils';
import { generateYargsErrorMessage } from 'cli/lib/generate-yargs-error-message';
import { LoggerError } from 'cli/logger';

const MINIMUM_WORDPRESS_VERSION = '6.2.1' as const; // https://wordpress.github.io/wordpress-playground/blueprints/examples/#load-an-older-wordpress-version

export function wpVersionValidator( value: string ): string {
	if ( ! isValidWordPressVersion( value ) ) {
		throw new LoggerError(
			generateYargsErrorMessage(
				'wp',
				value,
				__( '"latest", "nightly", or a valid version number (e.g., "6.4", "6.4.1", "6.4-beta1")' )
			)
		);
	}

	if ( ! isWordPressVersionAtLeast( value, MINIMUM_WORDPRESS_VERSION ) ) {
		throw new LoggerError(
			generateYargsErrorMessage(
				'wp',
				value,
				sprintf( __( 'at least %s' ), MINIMUM_WORDPRESS_VERSION )
			)
		);
	}

	return value;
}
