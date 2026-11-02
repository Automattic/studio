<?php
/**
 * Editor guardrails for clients.
 *
 * A post type or the page list can limit editing to text and photos: the root
 * template lock stops blocks being added, moved or removed, and `assets/editor.js`
 * limits each block to its content. Everything else stays free to write, within
 * any allowed blocks the manifest sets.
 *
 * These protect a design from accidents. Capabilities remain the security
 * boundary: a client who crafts their own REST request can still save markup,
 * though removing `unfiltered_html` means it is sanitized.
 *
 * @package ClientAdmin
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether only a post's text and photos can change.
 *
 * @param WP_Post|null $post Post in the editor.
 */
function client_admin_is_locked( ?WP_Post $post ): bool {
	if ( ! $post ) {
		return false;
	}
	if ( 'page' === $post->post_type ) {
		return 'contentOnly' === ( client_admin_menu_entry( 'edit.php?post_type=page' )['lock'] ?? '' );
	}
	$type = client_admin_post_type( $post->post_type );
	return $type && 'contentOnly' === ( $type['templateLock'] ?? ( empty( $type['fields'] ) ? '' : 'contentOnly' ) );
}

/**
 * The blocks a post can use, when the manifest limits them.
 *
 * @param WP_Post|null $post Post in the editor.
 */
function client_admin_allowed_blocks( ?WP_Post $post ): ?array {
	$type = $post ? client_admin_post_type( $post->post_type ) : null;
	return $type['blocks'] ?? client_admin_manifest()['editor']['blocks'] ?? null;
}

add_filter(
	'block_editor_settings_all',
	static function ( array $settings, WP_Block_Editor_Context $context ) {
		if ( ! client_admin_is_curated() ) {
			return $settings;
		}

		if ( ! empty( client_admin_manifest()['editor']['restrict'] ) ) {
			$settings['codeEditingEnabled']                   = false;
			$settings['canLockBlocks']                        = false;
			$settings['enableCustomFields']                   = false;
			$settings['disableCustomColors']                  = true;
			$settings['disableCustomGradients']               = true;
			$settings['disableCustomFontSizes']               = true;
			$settings['enableCustomLineHeight']               = false;
			$settings['enableCustomSpacing']                  = false;
			$settings['__experimentalBlockPatterns']          = array();
			$settings['__experimentalBlockPatternCategories'] = array();

			foreach ( array(
				array( 'color', 'custom' ),
				array( 'color', 'customGradient' ),
				array( 'color', 'customDuotone' ),
				array( 'typography', 'customFontSize' ),
				array( 'typography', 'lineHeight' ),
				array( 'spacing', 'customSpacingSize' ),
			) as $path ) {
				$settings['__experimentalFeatures'][ $path[0] ][ $path[1] ] = false;
			}
		}

		if ( client_admin_is_locked( $context->post ) ) {
			$settings['templateLock'] = 'all';
		}
		return $settings;
	},
	10,
	2
);

add_filter(
	'allowed_block_types_all',
	static function ( $allowed, WP_Block_Editor_Context $context ) {
		$blocks = client_admin_allowed_blocks( $context->post );
		if ( ! client_admin_is_curated() || ! $blocks || client_admin_is_locked( $context->post ) ) {
			return $allowed;
		}
		return $blocks;
	},
	10,
	2
);

add_action(
	'enqueue_block_editor_assets',
	static function () {
		if ( ! client_admin_is_curated() ) {
			return;
		}

		$url = plugin_dir_url( CLIENT_ADMIN_FILE ) . 'assets/';
		wp_enqueue_style( 'client-admin-editor', $url . 'editor.css', array(), CLIENT_ADMIN_VERSION );
		wp_enqueue_script(
			'client-admin-editor',
			$url . 'editor.js',
			array( 'wp-block-editor', 'wp-blocks', 'wp-components', 'wp-data', 'wp-edit-post', 'wp-editor', 'wp-element', 'wp-i18n', 'wp-plugins', 'wp-preferences' ),
			CLIENT_ADMIN_VERSION,
			true
		);

		$settings = array();
		foreach ( client_admin_settings() as $setting ) {
			$settings[ $setting['id'] ] = get_option( $setting['option'], array() );
		}

		$post   = get_post();
		$type   = $post ? client_admin_post_type( $post->post_type ) : null;
		$agency = client_admin_manifest()['agency'] ?? array();
		wp_add_inline_script(
			'client-admin-editor',
			'window.clientAdminEditor = ' . wp_json_encode(
				array(
					'locked'       => client_admin_is_locked( $post ),
					'isPage'       => $post && 'page' === $post->post_type,
					'dates'        => $type ? array_values( client_admin_fields( $type, array( 'date' ) ) ) : array(),
					'canAsk'       => client_admin_accepts_requests(),
					'agency'       => $agency['name'] ?? __( 'your web team', 'client-admin' ),
					'settings'     => $settings,
					'nonce'        => wp_create_nonce( 'client_admin_request' ),
					'translations' => client_admin_locale_data(),
				)
			) . ';',
			'before'
		);
		if ( client_admin_has_brand() ) {
			wp_add_inline_style( 'client-admin-editor', client_admin_brand_css() );
		}
	}
);
