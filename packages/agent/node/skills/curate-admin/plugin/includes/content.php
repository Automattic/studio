<?php
/**
 * Registers the manifest's post types, fields and taxonomies with Core's APIs.
 *
 * Fields are post meta, edited in the block editor through paragraphs bound to
 * them. The same bindings show them on the site, so someone's data stays out of
 * the page's layout. A date has no block to edit it in, so it gets a sidebar
 * panel instead (`assets/editor.js`).
 *
 * @package ClientAdmin
 */

defined( 'ABSPATH' ) || exit;

/**
 * The manifest's definition of a post type this plugin registered.
 *
 * @param string $post_type Post type.
 */
function client_admin_post_type( string $post_type ): ?array {
	$object = get_post_type_object( $post_type );
	if ( ! $object || empty( $object->client_admin ) ) {
		return null;
	}
	foreach ( client_admin_post_types() as $type ) {
		if ( $type['slug'] === $post_type ) {
			return $type;
		}
	}
	return null;
}

/**
 * The fields of a post type with a given type.
 *
 * @param array $type  Post type from the manifest.
 * @param array $kinds Field types.
 */
function client_admin_fields( array $type, array $kinds ): array {
	return array_filter(
		$type['fields'] ?? array(),
		static function ( array $field ) use ( $kinds ) {
			return in_array( $field['type'], $kinds, true );
		}
	);
}

/**
 * A post type's labels.
 *
 * @param array $type Post type from the manifest.
 */
function client_admin_labels( array $type ): array {
	$singular = $type['singular'];
	$plural   = $type['plural'];
	return array(
		'name'          => $plural,
		'menu_name'     => $plural,
		'singular_name' => $singular,
		/* translators: %s: singular name, such as Dish. */
		'add_new'       => sprintf( __( 'Add %s', 'client-admin' ), $singular ),
		/* translators: %s: singular name, such as Dish. */
		'add_new_item'  => sprintf( __( 'Add %s', 'client-admin' ), $singular ),
		/* translators: %s: singular name, such as Dish. */
		'edit_item'     => sprintf( __( 'Edit %s', 'client-admin' ), $singular ),
		/* translators: %s: plural name, such as Dishes. */
		'search_items'  => sprintf( __( 'Search %s', 'client-admin' ), $plural ),
		/* translators: %s: plural name, such as Dishes. */
		'not_found'     => sprintf( __( 'No %s yet', 'client-admin' ), $plural ),
	);
}

/**
 * A post type's block template: its own, then one bound paragraph per text field.
 *
 * @param array $type Post type from the manifest.
 */
function client_admin_item_template( array $type ): array {
	$template = $type['template'] ?? array();
	foreach ( client_admin_fields( $type, array( 'text', 'textarea' ) ) as $field ) {
		$template[] = array(
			'core/paragraph',
			array(
				'placeholder' => $field['label'],
				'metadata'    => array(
					'name'     => $field['label'],
					'bindings' => array(
						'content' => array(
							'source' => 'core/post-meta',
							'args'   => array( 'key' => $field['key'] ),
						),
					),
				),
			),
		);
	}
	return $template;
}

/**
 * The fields template as block markup, for items created outside the editor.
 * A custom template has markup only the agent knows, so it writes that itself.
 *
 * @param array $type Post type from the manifest.
 */
function client_admin_item_markup( array $type ): string {
	if ( ! empty( $type['template'] ) ) {
		return '';
	}
	$blocks = array();
	foreach ( client_admin_item_template( $type ) as $block ) {
		$blocks[] = array(
			'blockName'    => $block[0],
			'attrs'        => $block[1],
			'innerBlocks'  => array(),
			'innerContent' => array( '<p></p>' ),
		);
	}
	return serialize_blocks( $blocks );
}

// The editor applies a post type's template only to new posts, so an item
// created over WP-CLI or REST would otherwise open with nothing to edit.
add_filter(
	'wp_insert_post_data',
	static function ( $data ) {
		$type = client_admin_post_type( (string) $data['post_type'] );
		if ( $type && '' === trim( (string) $data['post_content'] ) ) {
			$data['post_content'] = wp_slash( client_admin_item_markup( $type ) );
		}
		return $data;
	}
);

/**
 * Registers a taxonomy from the manifest, or attaches an existing one.
 *
 * @param array|string $taxonomy  Taxonomy from the manifest, or an existing slug.
 * @param string       $post_type Post type.
 * @param bool         $public    Whether the post type has URLs of its own.
 */
function client_admin_register_taxonomy( $taxonomy, string $post_type, bool $public ): void {
	if ( is_string( $taxonomy ) ) {
		register_taxonomy_for_object_type( $taxonomy, $post_type );
		return;
	}
	register_taxonomy(
		$taxonomy['slug'],
		$post_type,
		array(
			'labels'            => array(
				'name'          => $taxonomy['plural'],
				'singular_name' => $taxonomy['singular'],
			),
			'public'            => $public,
			'show_ui'           => true,
			'show_in_rest'      => true,
			'show_admin_column' => true,
			'hierarchical'      => $taxonomy['hierarchical'] ?? true,
			'rewrite'           => $public ? array( 'slug' => $taxonomy['slug'] ) : false,
		)
	);
}

/**
 * Registers the manifest's post types.
 */
function client_admin_register_content(): void {
	foreach ( client_admin_post_types() as $type ) {
		// Only a post type it creates, so it can't change another plugin's.
		$post_type = $type['slug'];
		if ( post_type_exists( $post_type ) ) {
			continue;
		}

		$supports = $type['supports'] ?? array( 'title', 'editor' );
		if ( in_array( 'thumbnail', $supports, true ) ) {
			add_theme_support( 'post-thumbnails' );
		}

		$public = ! empty( $type['public'] );
		$lock   = $type['templateLock'] ?? ( empty( $type['fields'] ) ? false : 'contentOnly' );
		register_post_type(
			$post_type,
			array(
				'client_admin'        => true,
				'labels'              => client_admin_labels( $type ),
				'public'              => $public,
				// Query Loops only show viewable post types. A private type has no URLs
				// of its own: see the redirect below.
				'publicly_queryable'  => true,
				'exclude_from_search' => ! $public,
				'has_archive'         => $public && ! empty( $type['hasArchive'] ),
				'query_var'           => $public,
				'rewrite'             => $public ? array( 'slug' => $type['urlSlug'] ?? $post_type ) : false,
				'show_ui'             => true,
				'show_in_rest'        => true,
				'supports'            => array_merge( $supports, empty( $type['fields'] ) ? array() : array( 'custom-fields' ) ),
				'menu_icon'           => $type['icon'] ?? 'dashicons-admin-post',
				'template'            => client_admin_item_template( $type ),
				// Core's root `contentOnly` leaves blocks removable: see `editor.php`.
				'template_lock'       => 'contentOnly' === $lock ? 'all' : $lock,
			)
		);

		foreach ( $type['taxonomies'] ?? array() as $taxonomy ) {
			client_admin_register_taxonomy( $taxonomy, $post_type, $public );
		}

		foreach ( $type['fields'] ?? array() as $field ) {
			register_post_meta(
				$post_type,
				$field['key'],
				array(
					'type'         => 'string',
					'label'        => $field['label'],
					'single'       => true,
					'show_in_rest' => true,
					'default'      => '',
				)
			);
		}

		add_filter(
			"manage_{$post_type}_posts_columns",
			static function ( array $columns ) use ( $type ) {
				$date = $columns['date'] ?? null;
				unset( $columns['date'] );
				foreach ( client_admin_fields( $type, array( 'text', 'date' ) ) as $field ) {
					$columns[ "client-admin-{$field['key']}" ] = esc_html( $field['label'] );
				}
				return $date ? $columns + array( 'date' => $date ) : $columns;
			}
		);
		add_action(
			"manage_{$post_type}_posts_custom_column",
			static function ( string $column, int $post_id ) {
				if ( 0 === strpos( $column, 'client-admin-' ) ) {
					echo esc_html( (string) get_post_meta( $post_id, substr( $column, strlen( 'client-admin-' ) ), true ) );
				}
			},
			10,
			2
		);
	}

	register_block_bindings_source(
		'client-admin/setting',
		array(
			'label'              => __( 'Client admin setting', 'client-admin' ),
			'get_value_callback' => 'client_admin_setting_binding',
		)
	);
	register_block_bindings_source(
		'client-admin/date',
		array(
			'label'              => __( 'Client admin date', 'client-admin' ),
			'get_value_callback' => 'client_admin_date_binding',
			'uses_context'       => array( 'postId' ),
		)
	);

	// Single and archive templates that don't depend on the active theme.
	$directory = (string) apply_filters( 'client_admin_templates_directory', '' );
	foreach ( $directory ? (array) glob( "{$directory}/*.html" ) : array() as $file ) {
		$slug = basename( (string) $file, '.html' );
		register_block_template(
			"client-admin-site//{$slug}",
			array(
				'title'   => ucwords( str_replace( '-', ' ', $slug ) ),
				// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
				'content' => (string) file_get_contents( (string) $file ),
			)
		);
	}
}
// After other plugins' post types, which usually register at 5 or 10, so that one
// is never taken over. Before `client_admin_sync`, which needs the taxonomies.
add_action( 'init', 'client_admin_register_content', 15 );

// A Query Loop has no date filter or meta sort, so a type's `order` adds them.
add_filter(
	'query_loop_block_query_vars',
	static function ( array $query ) {
		$post_type = is_string( $query['post_type'] ?? null ) ? $query['post_type'] : '';
		$order     = client_admin_post_type( $post_type )['order'] ?? null;
		if ( ! $order ) {
			return $query;
		}

		$query['meta_key'] = $order['field']; // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
		$query['orderby']  = 'meta_value';
		$query['order']    = strtoupper( $order['direction'] ?? 'asc' );
		if ( ! empty( $order['upcoming'] ) ) {
			// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
			$query['meta_query'] = array(
				array(
					'key'     => $order['field'],
					'value'   => wp_date( 'Y-m-d' ),
					'compare' => '>=',
					'type'    => 'CHAR',
				),
			);
		}
		return $query;
	}
);

add_filter(
	'enter_title_here',
	static function ( $title, $post ) {
		return client_admin_post_type( $post->post_type )['titleLabel'] ?? $title;
	},
	10,
	2
);

add_action(
	'template_redirect',
	static function () {
		$post_types = (array) get_query_var( 'post_type' );
		if ( is_singular() ) {
			$post_types[] = get_post_type();
		}
		foreach ( $post_types as $post_type ) {
			$type = client_admin_post_type( (string) $post_type );
			if ( $type && empty( $type['public'] ) ) {
				wp_safe_redirect( home_url( $type['previewPath'] ?? '/' ) );
				exit;
			}
		}
	}
);

/**
 * The value of a settings field for Block Bindings.
 *
 * @param array $args Binding arguments: `setting` and `key`.
 */
function client_admin_setting_binding( array $args ): ?string {
	$key = $args['key'] ?? '';
	foreach ( client_admin_settings() as $setting ) {
		if ( is_string( $key ) && ( $args['setting'] ?? '' ) === $setting['id'] ) {
			$value = get_option( $setting['option'], array() )[ $key ] ?? null;
			return is_scalar( $value ) ? (string) $value : null;
		}
	}
	return null;
}

/**
 * A date field in the site's date format, for Block Bindings.
 *
 * @param array    $args  Binding arguments: `key`.
 * @param WP_Block $block The bound block.
 */
function client_admin_date_binding( array $args, WP_Block $block ): ?string {
	$post_id = (int) ( $block->context['postId'] ?? 0 );
	$type    = client_admin_post_type( (string) get_post_type( $post_id ) );
	$keys    = $type ? array_column( client_admin_fields( $type, array( 'date' ) ), 'key' ) : array();
	if ( ! in_array( $args['key'] ?? '', $keys, true ) ) {
		return null;
	}

	$time = strtotime( (string) get_post_meta( $post_id, $args['key'], true ) );
	return $time ? wp_date( get_option( 'date_format' ), $time ) : null;
}
