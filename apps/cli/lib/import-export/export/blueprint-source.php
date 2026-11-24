<?php

if ( is_multisite() ) {
	WP_CLI::error( 'Exporting a multisite network as a Blueprint is not supported.' );
}
if ( ! wp_is_block_theme() ) {
	WP_CLI::error( 'Blueprint export currently requires a block theme.' );
}

require_once ABSPATH . 'wp-admin/includes/plugin.php';

$theme_files = new RecursiveIteratorIterator(
	new RecursiveDirectoryIterator( get_stylesheet_directory(), FilesystemIterator::SKIP_DOTS ),
	RecursiveIteratorIterator::SELF_FIRST
);
foreach ( $theme_files as $file ) {
	if ( $file->isLink() ) {
		WP_CLI::error( 'The active theme contains a symbolic link and cannot be exported safely.' );
	}
}

$theme_archive = wp_generate_block_templates_export_file();
if ( is_wp_error( $theme_archive ) ) {
	WP_CLI::error( $theme_archive->get_error_message() );
}
if ( ! copy( $theme_archive, __DIR__ . '/theme.zip' ) ) {
	@unlink( $theme_archive );
	WP_CLI::error( 'Could not export the active theme.' );
}
@unlink( $theme_archive );

$types = array( 'post', 'page', 'wp_block', 'wp_navigation' );
if ( class_exists( 'WooCommerce' ) ) {
	$types[] = 'product';
	$types[] = 'product_variation';
}
global $wpdb;
$published_types = $wpdb->get_col( "SELECT DISTINCT post_type FROM {$wpdb->posts} WHERE post_status = 'publish' AND post_password = ''" );
if ( array_intersect( $published_types, array( 'wp_font_family', 'wp_font_face' ) ) ) {
	WP_CLI::error( 'Blueprint export cannot yet include fonts installed in the WordPress font library.' );
}
$unsupported_types = array_diff( $published_types, array_merge( $types, array(
	'attachment', 'wp_template', 'wp_template_part', 'wp_global_styles', 'custom_css',
) ) );
if ( $unsupported_types ) {
	WP_CLI::error( 'This site has published content types that Blueprint export cannot yet include: ' . implode( ', ', $unsupported_types ) . '.' );
}
$posts = get_posts( array(
	'post_type' => $types,
	'post_status' => 'publish',
	'has_password' => false,
	'numberposts' => -1,
	'orderby' => 'ID',
	'order' => 'ASC',
	'suppress_filters' => true,
) );
$data_posts = array();
$references = '';
$featured = array();
foreach ( $posts as $post ) {
	$terms = array();
	$taxonomies = array( 'category', 'post_tag', 'wp_pattern_category', 'product_cat', 'product_tag', 'product_type', 'product_visibility', 'product_shipping_class' );
	foreach ( get_object_taxonomies( $post->post_type ) as $taxonomy ) {
		if ( str_starts_with( $taxonomy, 'pa_' ) ) {
			$taxonomies[] = $taxonomy;
		}
	}
	foreach ( $taxonomies as $taxonomy ) {
		if ( ! is_object_in_taxonomy( $post->post_type, $taxonomy ) ) {
			continue;
		}
		$post_terms = wp_get_object_terms( $post->ID, $taxonomy );
		if ( is_wp_error( $post_terms ) ) {
			WP_CLI::error( $post_terms->get_error_message() );
		}
		foreach ( $post_terms as $term ) {
			$parents = array();
			foreach ( array_reverse( get_ancestors( $term->term_id, $taxonomy, 'taxonomy' ) ) as $parent_id ) {
				$parent = get_term( $parent_id, $taxonomy );
				if ( $parent && ! is_wp_error( $parent ) ) {
					$parents[] = array( 'slug' => $parent->slug, 'name' => $parent->name );
				}
			}
			$terms[] = array(
				'taxonomy' => $taxonomy,
				'slug' => $term->slug,
				'name' => $term->name,
				'parents' => $parents,
			);
		}
	}
	$thumbnail = (int) get_post_thumbnail_id( $post->ID );
	if ( $thumbnail ) {
		$featured[] = $thumbnail;
	}
	$product_meta = array();
	$gallery = array();
	if ( in_array( $post->post_type, array( 'product', 'product_variation' ), true ) ) {
		if ( 'yes' === get_post_meta( $post->ID, '_downloadable', true ) ) {
			WP_CLI::error( 'Blueprint export cannot yet include downloadable products.' );
		}
		$keys = array( '_sku', '_price', '_regular_price', '_sale_price', '_sale_price_dates_from', '_sale_price_dates_to', '_virtual', '_downloadable', '_manage_stock', '_stock', '_stock_status', '_backorders', '_sold_individually', '_weight', '_length', '_width', '_height', '_tax_status', '_tax_class', '_product_attributes', '_default_attributes', '_variation_description' );
		foreach ( array_keys( get_post_meta( $post->ID ) ) as $key ) {
			if ( in_array( $key, $keys, true ) || str_starts_with( $key, 'attribute_' ) ) {
				$product_meta[ $key ] = get_post_meta( $post->ID, $key, true );
			}
		}
		$gallery = array_filter( array_map( 'intval', explode( ',', get_post_meta( $post->ID, '_product_image_gallery', true ) ) ) );
		$featured = array_merge( $featured, $gallery );
	}
	$references .= "\n" . $post->post_content;
	$data_posts[] = array(
		'id' => $post->ID,
		'type' => $post->post_type,
		'title' => $post->post_title,
		'slug' => $post->post_name,
		'content' => $post->post_content,
		'excerpt' => $post->post_excerpt,
		'parent' => $post->post_parent,
		'menuOrder' => $post->menu_order,
		'date' => $post->post_date,
		'template' => get_post_meta( $post->ID, '_wp_page_template', true ),
		'thumbnail' => $thumbnail,
		'productMeta' => $product_meta,
		'gallery' => array_values( $gallery ),
		'terms' => $terms,
	);
}

foreach ( array_merge( get_block_templates(), get_block_templates( array(), 'wp_template_part' ) ) as $template ) {
	$references .= "\n" . $template->content;
}
$custom_css = wp_get_custom_css();
$references .= $custom_css . wp_json_encode( WP_Theme_JSON_Resolver::get_user_data()->get_data() );
$theme_zip = new ZipArchive();
if ( true === $theme_zip->open( __DIR__ . '/theme.zip' ) ) {
	for ( $index = 0; $index < $theme_zip->numFiles; $index++ ) {
		$name = $theme_zip->getNameIndex( $index );
		if ( preg_match( '/\.(?:html|json|css|php)$/i', $name ) ) {
			$references .= "\n" . $theme_zip->getFromIndex( $index );
		}
	}
	$theme_zip->close();
}
$featured[] = (int) get_option( 'site_icon' );
$featured[] = (int) get_theme_mod( 'custom_logo' );

$uploads = wp_upload_dir();
if ( ! empty( $uploads['error'] ) ) {
	WP_CLI::error( $uploads['error'] );
}
$media = array();
$attachments = get_posts( array(
	'post_type' => 'attachment',
	'post_status' => 'inherit',
	'numberposts' => -1,
	'orderby' => 'ID',
	'order' => 'ASC',
	'suppress_filters' => true,
) );
foreach ( $attachments as $attachment ) {
	$id = $attachment->ID;
	$file = get_attached_file( $id );
	$url = wp_get_attachment_url( $id );
	if ( ! $file || ! $url ) {
		continue;
	}
	$urls = array( 'full' => $url );
	$metadata = wp_get_attachment_metadata( $id );
	if ( is_array( $metadata ) && ! empty( $metadata['sizes'] ) ) {
		foreach ( array_keys( $metadata['sizes'] ) as $size ) {
			$size_url = wp_get_attachment_image_url( $id, $size );
			if ( $size_url ) {
				$urls[ $size ] = $size_url;
			}
		}
	}
	$used = in_array( $id, $featured, true ) || str_contains( $references, 'wp-image-' . $id );
	foreach ( $urls as $candidate ) {
		$used = $used || str_contains( $references, $candidate );
	}
	if ( ! $used && preg_match( '/"(?:id|mediaId|backgroundId)"\s*:\s*' . (int) $id . '(?:\D|$)/', $references ) ) {
		$used = true;
	}
	if ( $used ) {
		$media[] = array(
			'id' => $id,
			'file' => $file,
			'urls' => $urls,
			'title' => $attachment->post_title,
			'caption' => $attachment->post_excerpt,
			'description' => $attachment->post_content,
			'alt' => get_post_meta( $id, '_wp_attachment_image_alt', true ),
			'mime' => $attachment->post_mime_type,
		);
	}
}

$plugin_data = get_plugins();
$plugins = array();
foreach ( (array) get_option( 'active_plugins', array() ) as $plugin_file ) {
	if ( ! isset( $plugin_data[ $plugin_file ] ) ) {
		continue;
	}
	$folder = dirname( $plugin_file );
	$plugins[] = array(
		'file' => $plugin_file,
		'slug' => '.' === $folder ? ( $plugin_data[ $plugin_file ]['TextDomain'] ?: pathinfo( $plugin_file, PATHINFO_FILENAME ) ) : $folder,
		'name' => $plugin_data[ $plugin_file ]['Name'],
	);
}

$options = array();
foreach ( array( 'blogname', 'blogdescription', 'permalink_structure', 'posts_per_page', 'date_format', 'time_format', 'start_of_week', 'timezone_string', 'woocommerce_currency', 'woocommerce_currency_pos', 'woocommerce_price_num_decimals', 'woocommerce_weight_unit', 'woocommerce_dimension_unit' ) as $name ) {
	$value = get_option( $name );
	if ( false !== $value ) {
		$options[ $name ] = $value;
	}
}
$linked_options = array();
foreach ( array( 'woocommerce_shop_page_id', 'woocommerce_cart_page_id', 'woocommerce_checkout_page_id', 'woocommerce_myaccount_page_id', 'woocommerce_terms_page_id' ) as $name ) {
	$linked_options[ $name ] = (int) get_option( $name );
}
$woo_attributes = array();
if ( function_exists( 'wc_get_attribute_taxonomies' ) ) {
	foreach ( wc_get_attribute_taxonomies() as $attribute ) {
		$woo_attributes[] = array(
			'name' => $attribute->attribute_label,
			'slug' => $attribute->attribute_name,
			'type' => $attribute->attribute_type,
			'orderBy' => $attribute->attribute_orderby,
			'hasArchives' => (bool) $attribute->attribute_public,
		);
	}
}
$theme = wp_get_theme();
$result = array(
	'siteUrl' => untrailingslashit( home_url() ),
	'uploadsUrl' => untrailingslashit( $uploads['baseurl'] ),
	'uploadsPath' => $uploads['basedir'],
	'theme' => get_stylesheet(),
	'themePath' => get_stylesheet_directory(),
	'parentTheme' => $theme->parent() ? $theme->parent()->get_stylesheet() : null,
	'parentThemePath' => $theme->parent() ? $theme->parent()->get_stylesheet_directory() : null,
	'wordpressVersion' => get_bloginfo( 'version' ),
	'posts' => $data_posts,
	'media' => $media,
	'plugins' => $plugins,
	'options' => $options,
	'linkedOptions' => $linked_options,
	'wooAttributes' => $woo_attributes,
	'frontPage' => 'page' === get_option( 'show_on_front' ) ? (int) get_option( 'page_on_front' ) : 0,
	'postsPage' => (int) get_option( 'page_for_posts' ),
	'siteIcon' => (int) get_option( 'site_icon' ),
	'customLogo' => (int) get_theme_mod( 'custom_logo' ),
	'customCss' => $custom_css,
);
if ( false === file_put_contents( __DIR__ . '/source.json', wp_json_encode( $result, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) ) ) {
	WP_CLI::error( 'Could not write the Blueprint content.' );
}
