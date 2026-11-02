<?php
/**
 * Reads this site's client admin manifest.
 *
 * The manifest lives in a small per-site plugin, which points at it with the
 * `client_admin_manifest_file` filter. This plugin holds no site data, so
 * replacing it never touches what an agency set up.
 *
 * @package ClientAdmin
 */

defined( 'ABSPATH' ) || exit;

/**
 * The site's manifest, or an empty array when no site plugin provides one.
 */
function client_admin_manifest(): array {
	static $manifest = null;
	if ( null !== $manifest ) {
		return $manifest;
	}

	$manifest = array();
	$file     = apply_filters( 'client_admin_manifest_file', '' );
	if ( $file && is_readable( $file ) ) {
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		$decoded  = json_decode( (string) file_get_contents( $file ), true );
		$manifest = is_array( $decoded ) ? $decoded : array();
	}
	return $manifest;
}

/**
 * The custom post types the manifest defines.
 */
function client_admin_post_types(): array {
	return client_admin_manifest()['postTypes'] ?? array();
}

/**
 * The settings pages the manifest defines.
 */
function client_admin_settings(): array {
	return client_admin_manifest()['settings'] ?? array();
}

/**
 * The menu items to keep.
 */
function client_admin_kept_menu(): array {
	return client_admin_manifest()['menu']['keep'] ?? array();
}

/**
 * The kept menu item for a screen, if there is one.
 *
 * @param string $screen Admin screen, such as `edit.php?post_type=page`.
 */
function client_admin_menu_entry( string $screen ): ?array {
	foreach ( client_admin_kept_menu() as $entry ) {
		if ( $entry['screen'] === $screen ) {
			return $entry;
		}
	}
	return null;
}

/**
 * The manifest's translations of the plugin's own strings, keyed by the English text.
 */
function client_admin_strings(): array {
	return client_admin_manifest()['strings'] ?? array();
}

add_filter(
	'gettext_client-admin',
	static function ( $translation, $text ) {
		return client_admin_strings()[ $text ] ?? $translation;
	},
	10,
	2
);

/**
 * The manifest's translations as locale data for `wp.i18n`.
 */
function client_admin_locale_data(): array {
	$data = array( '' => array( 'domain' => 'client-admin' ) );
	foreach ( client_admin_strings() as $text => $translation ) {
		$data[ $text ] = array( $translation );
	}
	return $data;
}

/**
 * The slug of the Staff role.
 */
function client_admin_role_slug(): string {
	return client_admin_manifest()['role']['slug'] ?? 'staff';
}

/**
 * Whether wp-admin is curated for everyone who logs in, with no Staff role.
 */
function client_admin_is_for_everyone(): bool {
	return 'everyone' === ( client_admin_manifest()['audience'] ?? '' );
}

/**
 * Whether a user has the Staff role.
 *
 * @param WP_User $user User.
 */
function client_admin_user_is_staff( WP_User $user ): bool {
	return ! client_admin_is_for_everyone() && ! empty( client_admin_manifest() ) && in_array( client_admin_role_slug(), (array) $user->roles, true );
}

/**
 * Whether the current user has the Staff role. Staff are the only users limited
 * by this plugin: everything else it does only changes what people see.
 */
function client_admin_is_staff(): bool {
	$user = wp_get_current_user();
	return $user->exists() && client_admin_user_is_staff( $user );
}

/**
 * Whether the current user sees the curated wp-admin.
 */
function client_admin_is_curated(): bool {
	if ( client_admin_is_staff() ) {
		return true;
	}
	if ( ! client_admin_is_for_everyone() || ! is_user_logged_in() ) {
		return false;
	}
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended
	if ( isset( $_GET['client-admin-full'] ) && current_user_can( 'manage_options' ) ) {
		return false;
	}
	return ! get_user_meta( get_current_user_id(), 'client_admin_full', true );
}
