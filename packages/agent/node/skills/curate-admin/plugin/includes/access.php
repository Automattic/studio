<?php
/**
 * Curates the wp-admin menu, and keeps Staff to what stays in it.
 *
 * Capabilities decide what Staff may do: hiding a menu item that has a capability
 * also removes it (`role.php`). The allowlist here keeps a deep link or a plugin
 * from dropping them on a screen outside their menu.
 *
 * @package ClientAdmin
 */

defined( 'ABSPATH' ) || exit;

/**
 * The screen a menu item opens, as it appears in the menu's links.
 *
 * @param string $slug   Menu slug.
 * @param string $parent Parent menu slug, for a submenu item.
 */
function client_admin_menu_screen( string $slug, string $parent = '' ): string {
	// Core escapes the `&` in taxonomy links.
	$slug = wp_specialchars_decode( $slug );
	if ( false !== strpos( $slug, '.php' ) ) {
		return $slug;
	}
	if ( false !== strpos( $parent, '.php' ) ) {
		return $parent . ( false === strpos( $parent, '?' ) ? '?' : '&' ) . "page={$slug}";
	}
	return "admin.php?page={$slug}";
}

/**
 * The screens a top-level menu item goes by: its own, and its first submenu item's,
 * since that is where WordPress links the item.
 *
 * @param string $slug Menu slug.
 */
function client_admin_item_screens( string $slug ): array {
	global $submenu;
	$screens = array( client_admin_menu_screen( $slug ) );
	if ( ! empty( $submenu[ $slug ] ) ) {
		$first     = reset( $submenu[ $slug ] );
		$screens[] = client_admin_menu_screen( $first[2], $slug );
	}
	return $screens;
}

/**
 * Whether a menu item is this plugin's own, which stays without being listed.
 *
 * @param string $screen Admin screen.
 */
function client_admin_is_own_screen( string $screen ): bool {
	foreach ( client_admin_post_types() as $type ) {
		if ( "edit.php?post_type={$type['slug']}" === $screen ) {
			return true;
		}
	}
	foreach ( client_admin_settings() as $setting ) {
		if ( 'admin.php?page=' . client_admin_settings_page( $setting ) === $screen ) {
			return true;
		}
	}
	return false;
}

/**
 * Applies a kept menu item's label and icon.
 *
 * @param array $item  Item from `$menu`.
 * @param array $entry Entry from the manifest.
 */
function client_admin_apply_entry( array $item, array $entry ): array {
	if ( ! empty( $entry['label'] ) ) {
		$item[0] = esc_html( $entry['label'] );
	}
	if ( ! empty( $entry['icon'] ) ) {
		$item[6] = $entry['icon'];
	}
	return $item;
}

/**
 * Moves a submenu item up to the top level, such as a plugin's form entries.
 *
 * @param array $entry Entry from the manifest.
 */
function client_admin_promote( array $entry ): ?array {
	global $submenu;
	foreach ( (array) $submenu as $parent => $children ) {
		foreach ( $children as $child ) {
			if ( client_admin_menu_screen( $child[2], (string) $parent ) === $entry['screen'] ) {
				return client_admin_apply_entry(
					array( $child[0], $child[1], $entry['screen'], $child[0], 'menu-top', '', 'dashicons-admin-generic' ),
					$entry
				);
			}
		}
	}
	return null;
}

/**
 * Hides a kept item's listed children.
 */
function client_admin_hide_children(): void {
	global $submenu;
	foreach ( client_admin_kept_menu() as $entry ) {
		foreach ( (array) $submenu as $parent => $children ) {
			foreach ( $children as $index => $child ) {
				if ( in_array( client_admin_menu_screen( $child[2], (string) $parent ), $entry['hideChildren'] ?? array(), true ) ) {
					unset( $submenu[ $parent ][ $index ] );
				}
			}
		}
	}
}

/**
 * Curates the menu, then keeps Staff on what is left. It runs last, once every
 * plugin has added its items, and before WordPress answers an unreachable screen
 * with a bare 403.
 */
function client_admin_curate_menu(): void {
	if ( ! client_admin_is_curated() ) {
		return;
	}

	global $menu;
	$hidden = client_admin_manifest()['menu']['hide'] ?? array();
	$staff  = client_admin_is_staff();
	$items  = array();
	foreach ( (array) $menu as $position => $item ) {
		$slug = (string) ( $item[2] ?? '' );
		if ( 0 === strpos( $slug, 'separator' ) && ! $staff ) {
			$items[ $position ] = $item;
		}
		if ( '' === $slug || 0 === strpos( $slug, 'separator' ) ) {
			continue;
		}
		$entry = null;
		$kept  = false;
		$seen  = false;
		foreach ( client_admin_item_screens( $slug ) as $screen ) {
			$found = client_admin_menu_entry( $screen );
			// A promoted item leaves its parent, which only stays if listed itself.
			$entry = $entry ?? ( empty( $found['promote'] ) ? $found : null );
			$kept  = $kept || 'index.php' === $screen || 'profile.php' === $screen || client_admin_is_own_screen( $screen ) || $entry;
			$seen  = $seen || in_array( $screen, $hidden, true );
		}
		if ( $staff ? $kept : ! $seen ) {
			$items[ $position ] = $entry ? client_admin_apply_entry( $item, $entry ) : $item;
		}
	}

	foreach ( client_admin_kept_menu() as $entry ) {
		$promoted = empty( $entry['promote'] ) ? null : client_admin_promote( $entry );
		if ( $promoted ) {
			$items[] = $promoted;
		}
	}

	$menu = $items; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
	client_admin_hide_children();

	if ( $staff ) {
		client_admin_redirect_staff();
	}
}
add_action( 'admin_menu', 'client_admin_curate_menu', PHP_INT_MAX );

/**
 * The screens a kept menu item brings with it.
 *
 * @param string $screen Admin screen.
 */
function client_admin_companion_screens( string $screen ): array {
	// Saving and deleting a term leave out the `post_type` of the link to its list.
	if ( preg_match( '/^edit-tags\.php\?taxonomy=([\w-]+)/', $screen, $match ) ) {
		return array( "term.php?taxonomy={$match[1]}", "edit-tags.php?taxonomy={$match[1]}" );
	}
	if ( 'edit-comments.php' === $screen ) {
		return array( 'comment.php' );
	}
	if ( 'upload.php' === $screen ) {
		return array( 'media-new.php', 'media-upload.php' );
	}
	return array();
}

/**
 * The admin screens Staff may open: what is in their menu, and what comes with it.
 */
function client_admin_allowed_screens(): array {
	global $menu, $submenu;
	$screens = array( 'admin-ajax.php', 'admin-post.php', 'async-upload.php', 'index.php', 'options.php', 'post.php', 'profile.php', 'revision.php' );
	foreach ( (array) $menu as $item ) {
		$slug      = (string) $item[2];
		$screens[] = client_admin_menu_screen( $slug );
		foreach ( $submenu[ $slug ] ?? array() as $child ) {
			$screens[] = client_admin_menu_screen( $child[2], $slug );
		}
	}

	foreach ( $screens as $screen ) {
		$screens = array_merge( $screens, client_admin_companion_screens( $screen ) );
	}

	return array_map(
		static function ( string $screen ) {
			// Bare, these would match every post type.
			return 'edit.php' === $screen || 'post-new.php' === $screen ? "{$screen}?post_type=post" : $screen;
		},
		$screens
	);
}

/**
 * Whether a request for an admin screen matches an allowed screen.
 *
 * @param string $file  Requested file, such as `upload.php`.
 * @param array  $query Request query.
 */
function client_admin_is_allowed_screen( string $file, array $query ): bool {
	if ( in_array( $file, array( 'edit.php', 'post-new.php' ), true ) ) {
		$query += array( 'post_type' => 'post' );
	}
	// An item opens only when its list does.
	$post_id = (int) ( $query['post'] ?? $query['post_ID'] ?? 0 );
	if ( 'post.php' === $file && $post_id ) {
		$post_type = (string) get_post_type( $post_id );
		if ( isset( $query['page'] ) ) {
			return false;
		}
		return 'attachment' === $post_type
			? client_admin_is_allowed_screen( 'upload.php', array() )
			: client_admin_is_allowed_screen( 'edit.php', array( 'post_type' => $post_type ) );
	}

	foreach ( client_admin_allowed_screens() as $screen ) {
		$parts = explode( '?', $screen, 2 );
		if ( $parts[0] !== $file ) {
			continue;
		}
		parse_str( $parts[1] ?? '', $required );
		// `page` runs a plugin's own screen, whichever admin file it arrives on.
		if ( isset( $query['page'] ) && ! isset( $required['page'] ) ) {
			continue;
		}
		if ( array_intersect_assoc( array_map( 'strval', $required ), array_map( 'strval', array_filter( $query, 'is_scalar' ) ) ) === $required ) {
			return true;
		}
	}
	return false;
}

/**
 * Sends Staff who land outside their menu back to the dashboard.
 */
function client_admin_redirect_staff(): void {
	if ( wp_doing_ajax() ) {
		return;
	}

	global $pagenow;
	// Core reads `page` and `post` from the URL alone, and the rest from either place,
	// so both have to pass whichever one wins.
	// phpcs:disable WordPress.Security.NonceVerification
	$url  = wp_unslash( $_GET );
	$body = array_diff_key( wp_unslash( $_POST ), array_flip( array( 'page', 'post' ) ) );
	// phpcs:enable WordPress.Security.NonceVerification
	if ( ! client_admin_is_allowed_screen( (string) $pagenow, $url + $body ) || ! client_admin_is_allowed_screen( (string) $pagenow, $body + $url ) ) {
		wp_safe_redirect( admin_url() );
		exit;
	}
}

add_action(
	'in_admin_header',
	static function () {
		if ( client_admin_is_curated() ) {
			remove_all_actions( 'admin_notices' );
			remove_all_actions( 'all_admin_notices' );
			remove_all_actions( 'user_admin_notices' );
		}
	},
	PHP_INT_MAX
);

add_action(
	'admin_bar_menu',
	static function ( WP_Admin_Bar $bar ) {
		if ( client_admin_is_for_everyone() && current_user_can( 'manage_options' ) ) {
			$full = ! client_admin_is_curated();
			$bar->add_node(
				array(
					'id'    => 'client-admin-full',
					'title' => $full ? __( 'Simple admin', 'client-admin' ) : __( 'Full admin', 'client-admin' ),
					'href'  => client_admin_full_admin_url( ! $full ),
				)
			);
		}
		if ( ! client_admin_is_curated() ) {
			return;
		}
		foreach ( array( 'wp-logo', 'updates', 'customize', 'site-editor' ) as $node ) {
			$bar->remove_node( $node );
		}
	},
	PHP_INT_MAX
);

/**
 * The URL that turns the full admin on or off for the current administrator.
 *
 * @param bool $on Whether to show the full admin.
 */
function client_admin_full_admin_url( bool $on ): string {
	return add_query_arg(
		array(
			'action'   => 'client_admin_full',
			'on'       => $on ? '1' : '0',
			'_wpnonce' => wp_create_nonce( 'client_admin_full' ),
		),
		admin_url( 'admin-post.php' )
	);
}

// When wp-admin is curated for everyone, administrators can still reach all of it.
add_action(
	'admin_post_client_admin_full',
	static function () {
		check_admin_referer( 'client_admin_full' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Only administrators can do this.', 'client-admin' ), 403 );
		}
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( ! empty( $_GET['on'] ) ) {
			update_user_meta( get_current_user_id(), 'client_admin_full', 1 );
		} else {
			delete_user_meta( get_current_user_id(), 'client_admin_full' );
		}
		wp_safe_redirect( admin_url() );
		exit;
	}
);

/**
 * Whether Staff can't add a post type: pages that are limited or locked are the
 * agency's to add, and hidden posts share `edit_posts` with every custom post type.
 *
 * @param string $post_type `post` or `page`.
 */
function client_admin_closes_new( string $post_type ): bool {
	if ( empty( client_admin_manifest() ) || client_admin_is_for_everyone() ) {
		return false;
	}
	if ( 'post' === $post_type ) {
		return ! client_admin_menu_entry( 'edit.php' );
	}
	return client_admin_pages_are_limited();
}

/**
 * Whether Staff only work on the pages they were given.
 */
function client_admin_pages_are_limited(): bool {
	$entry = client_admin_menu_entry( 'edit.php?post_type=page' );
	return ! empty( $entry['only'] ) || ! empty( $entry['lock'] );
}

// A capability of its own, resolved per user below, since who is signed in isn't
// always known when core registers its post types.
add_filter(
	'register_post_type_args',
	static function ( array $args, string $post_type ) {
		if ( in_array( $post_type, array( 'post', 'page' ), true ) && client_admin_closes_new( $post_type ) ) {
			$args['capabilities']['create_posts'] = "client_admin_create_{$post_type}";
		}
		return $args;
	},
	10,
	2
);

// A page entry's `only` list.
add_action(
	'pre_get_posts',
	static function ( WP_Query $query ) {
		$only = client_admin_menu_entry( 'edit.php?post_type=page' )['only'] ?? null;
		if ( $only && is_admin() && $query->is_main_query() && 'page' === $query->get( 'post_type' ) && client_admin_is_curated() ) {
			$query->set( 'post_name__in', $only );
		}
	}
);

/**
 * What Staff may do to one post. The menu only hides things, so this closes
 * `post.php`, the toolbar's Edit link and REST.
 *
 * @param array   $caps Primitive capabilities.
 * @param string  $cap  Capability asked for.
 * @param WP_Post $post Post.
 */
function client_admin_staff_post_caps( array $caps, string $cap, WP_Post $post ): array {
	$reading = 'read_post' === $cap || 'read_page' === $cap;
	if ( ! $reading && 'post' === $post->post_type && ! client_admin_menu_entry( 'edit.php' ) ) {
		return array( 'do_not_allow' );
	}
	if ( 'page' !== $post->post_type ) {
		return $caps;
	}

	$only = client_admin_menu_entry( 'edit.php?post_type=page' )['only'] ?? null;
	if ( $only && ! in_array( $post->post_name, $only, true ) && ! ( $reading && 'publish' === $post->post_status ) ) {
		return array( 'do_not_allow' );
	}
	$deleting = 'delete_post' === $cap || 'delete_page' === $cap;
	return $deleting && client_admin_pages_are_limited() ? array( 'do_not_allow' ) : $caps;
}

add_filter(
	'map_meta_cap',
	static function ( array $caps, string $cap, int $user_id, array $args ) {
		$new_item = array(
			'client_admin_create_post' => 'edit_posts',
			'client_admin_create_page' => 'edit_pages',
		);
		$watched  = array( 'edit_post', 'edit_page', 'delete_post', 'delete_page', 'read_post', 'read_page', 'edit_comment' );
		if ( ! isset( $new_item[ $cap ] ) && ! in_array( $cap, $watched, true ) ) {
			return $caps;
		}

		$user  = get_userdata( $user_id );
		$staff = $user && client_admin_user_is_staff( $user );
		if ( isset( $new_item[ $cap ] ) ) {
			return array( $staff ? 'do_not_allow' : $new_item[ $cap ] );
		}
		if ( ! $staff ) {
			return $caps;
		}
		// Core maps this to the commented post, whatever `moderate_comments` says.
		if ( 'edit_comment' === $cap ) {
			return array( client_admin_menu_entry( 'edit-comments.php' ) ? 'moderate_comments' : 'do_not_allow' );
		}
		$post = get_post( $args[0] ?? 0 );
		return $post ? client_admin_staff_post_caps( $caps, $cap, $post ) : $caps;
	},
	10,
	4
);

// Quick Edit and bulk edit set a page's status, URL and password with only
// `edit_post`, which would take a limited page offline. Core has already renamed a
// trashed page by now, so its old slug comes back from where core keeps it.
add_filter(
	'wp_insert_post_data',
	static function ( array $data, array $postarr, array $unsanitized, bool $update ) {
		$post = $update ? get_post( (int) $postarr['ID'] ) : null;
		if ( ! $post || 'page' !== $post->post_type || ! client_admin_is_staff() || ! client_admin_pages_are_limited() ) {
			return $data;
		}

		$slug = get_post_meta( $post->ID, '_wp_desired_post_slug', true );
		if ( $slug ) {
			delete_post_meta( $post->ID, '_wp_desired_post_slug' );
		}
		$data['post_name']     = $slug ?: $post->post_name;
		$data['post_parent']   = $post->post_parent;
		$data['post_password'] = $post->post_password;
		// A draft in `only` still has to reach the site.
		if ( 'draft' !== $post->post_status || 'trash' === $data['post_status'] ) {
			$data['post_status'] = $post->post_status;
		}
		return $data;
	},
	10,
	4
);

add_filter(
	'login_redirect',
	static function ( $redirect_to, $requested, $user ) {
		if ( $user instanceof WP_User && client_admin_user_is_staff( $user ) ) {
			return admin_url();
		}
		return $redirect_to;
	},
	10,
	3
);
