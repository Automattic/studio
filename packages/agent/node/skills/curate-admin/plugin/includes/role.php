<?php
/**
 * Keeps the client role and the taxonomy terms in line with the manifest.
 *
 * Roles live in the database, which a host or a selective push can replace
 * without this plugin knowing, so they are compared on every load rather than
 * only on activation.
 *
 * @package ClientAdmin
 */

defined( 'ABSPATH' ) || exit;

/**
 * Capabilities a client never holds, whatever the role it extends. Shop manager,
 * for one, grants user editing and theme options.
 */
function client_admin_forbidden_capabilities(): array {
	return array(
		'activate_plugins',
		'create_users',
		'customize',
		'delete_plugins',
		'delete_themes',
		'delete_users',
		'edit_files',
		'edit_plugins',
		'edit_theme_options',
		'edit_themes',
		'edit_users',
		'export',
		'import',
		'install_languages',
		'install_plugins',
		'install_themes',
		'list_users',
		'manage_network',
		'manage_options',
		'manage_sites',
		'promote_users',
		'remove_users',
		'resume_plugins',
		'resume_themes',
		'switch_themes',
		'unfiltered_html',
		'unfiltered_upload',
		'update_core',
		'update_languages',
		'update_plugins',
		'update_themes',
		'view_site_health_checks',
	);
}

/**
 * Capabilities that only make sense while a menu item is kept: hiding the item
 * should also close it, because a hidden menu item is still a working URL.
 */
function client_admin_hidden_capabilities(): array {
	$hidden = array();
	if ( ! client_admin_menu_entry( 'edit-comments.php' ) ) {
		$hidden[] = 'moderate_comments';
	}
	if ( ! client_admin_menu_entry( 'edit.php?post_type=page' ) ) {
		array_push( $hidden, 'edit_pages', 'edit_others_pages', 'edit_published_pages', 'edit_private_pages', 'publish_pages', 'read_private_pages', 'delete_pages', 'delete_others_pages', 'delete_published_pages', 'delete_private_pages' );
	}

	if ( ! empty( client_admin_menu_entry( 'edit.php?post_type=page' )['only'] ) ) {
		$hidden[] = 'read_private_pages';
	}

	$has_terms = client_admin_menu_entry( 'edit.php' );
	foreach ( client_admin_post_types() as $type ) {
		$has_terms = $has_terms || ! empty( $type['taxonomies'] );
	}
	if ( ! $has_terms ) {
		$hidden[] = 'manage_categories';
	}
	return $hidden;
}

/**
 * The capabilities of the Staff role.
 *
 * @param array $role Role from the manifest.
 */
function client_admin_role_capabilities( array $role ): array {
	$base = get_role( $role['extends'] ?? 'editor' );
	$caps = $base ? $base->capabilities : array();

	foreach ( array_merge( client_admin_hidden_capabilities(), $role['remove'] ?? array() ) as $capability ) {
		unset( $caps[ $capability ] );
	}
	foreach ( $role['add'] ?? array() as $capability ) {
		$caps[ $capability ] = true;
	}
	foreach ( client_admin_forbidden_capabilities() as $capability ) {
		unset( $caps[ $capability ] );
	}
	$caps['read'] = true;

	return $caps;
}

/**
 * Applies the manifest's role and terms when they changed.
 */
function client_admin_sync(): void {
	$manifest = client_admin_manifest();
	if ( empty( $manifest ) ) {
		return;
	}

	$role = $manifest['role'] ?? array();
	$caps = client_admin_is_for_everyone() ? array() : client_admin_role_capabilities( $role );
	$slug = client_admin_role_slug();
	$hash = md5( (string) wp_json_encode( array( $role, $caps, client_admin_post_types() ) ) );

	$stored = client_admin_is_for_everyone() ? null : get_role( $slug );
	// A role editor or another plugin can grant capabilities directly to the stored role.
	$held    = $stored ? array_intersect( array_keys( array_filter( $stored->capabilities ) ), client_admin_forbidden_capabilities() ) : array();
	$current = get_option( 'client_admin_hash' ) === $hash && ! $held && ( $stored || client_admin_is_for_everyone() );
	if ( $current ) {
		return;
	}

	if ( ! client_admin_is_for_everyone() ) {
		remove_role( $slug );
		add_role( $slug, $role['name'] ?? __( 'Staff', 'client-admin' ), $caps );
	}

	foreach ( client_admin_post_types() as $type ) {
		foreach ( $type['taxonomies'] ?? array() as $taxonomy ) {
			foreach ( is_array( $taxonomy ) ? $taxonomy['terms'] ?? array() : array() as $term ) {
				if ( ! term_exists( $term, $taxonomy['slug'] ) ) {
					wp_insert_term( $term, $taxonomy['slug'] );
				}
			}
		}
	}

	// New post types with their own URLs.
	flush_rewrite_rules();

	update_option( 'client_admin_hash', $hash, false );
}
add_action( 'init', 'client_admin_sync', 20 );

register_deactivation_hook(
	CLIENT_ADMIN_FILE,
	static function () {
		delete_option( 'client_admin_hash' );
	}
);
