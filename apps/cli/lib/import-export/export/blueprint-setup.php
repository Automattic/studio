<?php

require_once '/wordpress/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/image.php';

$resources = WP_CONTENT_DIR . '/studio-blueprint-resources';
$data = json_decode( file_get_contents( $resources . '/content.json' ), true, 512, JSON_THROW_ON_ERROR );
$admins = get_users( array( 'role' => 'administrator', 'number' => 1, 'fields' => 'ID' ) );
if ( ! $admins ) {
	throw new RuntimeException( 'The Blueprint needs a site administrator.' );
}
$uploads = wp_upload_dir();
if ( ! empty( $uploads['error'] ) ) {
	throw new RuntimeException( $uploads['error'] );
}

$ids = array();
$url_map = array();
if ( function_exists( 'wc_create_attribute' ) ) {
	foreach ( $data['wooAttributes'] as $attribute ) {
		if ( ! wc_attribute_taxonomy_id_by_name( $attribute['slug'] ) ) {
			$created = wc_create_attribute( array(
				'name' => $attribute['name'],
				'slug' => $attribute['slug'],
				'type' => $attribute['type'],
				'order_by' => $attribute['orderBy'],
				'has_archives' => $attribute['hasArchives'],
			) );
			if ( is_wp_error( $created ) ) throw new RuntimeException( $created->get_error_message() );
		}
		$taxonomy = wc_attribute_taxonomy_name( $attribute['slug'] );
		if ( ! taxonomy_exists( $taxonomy ) ) {
			register_taxonomy( $taxonomy, array( 'product' ), array( 'hierarchical' => true ) );
		}
	}
}
foreach ( $data['media'] as $media ) {
	$source = $resources . '/' . $media['bundle'];
	if ( ! is_file( $source ) ) {
		throw new RuntimeException( 'A Blueprint media file is missing: ' . $media['bundle'] );
	}
	$name = wp_unique_filename( $uploads['path'], $media['name'] );
	$target = $uploads['path'] . '/' . $name;
	if ( ! wp_mkdir_p( $uploads['path'] ) || ! copy( $source, $target ) ) {
		throw new RuntimeException( 'Could not import Blueprint media: ' . $media['name'] );
	}
	$id = wp_insert_attachment( array(
		'post_mime_type' => $media['mime'],
		'post_title' => $media['title'],
		'post_excerpt' => $media['caption'],
		'post_content' => $media['description'],
		'post_status' => 'inherit',
		'post_author' => $admins[0],
	), $target, 0, true );
	if ( is_wp_error( $id ) ) {
		throw new RuntimeException( $id->get_error_message() );
	}
	$metadata = wp_generate_attachment_metadata( $id, $target );
	if ( is_array( $metadata ) ) {
		wp_update_attachment_metadata( $id, $metadata );
	}
	update_post_meta( $id, '_wp_attachment_image_alt', $media['alt'] );
	$ids[ (string) $media['id'] ] = (int) $id;
	foreach ( $media['urls'] as $size => $old_url ) {
		$new_url = 'full' === $size ? wp_get_attachment_url( $id ) : wp_get_attachment_image_url( $id, $size );
		$url_map[ $old_url ] = $new_url ?: wp_get_attachment_url( $id );
	}
}

foreach ( $data['posts'] as $post ) {
	$id = wp_insert_post( wp_slash( array(
		'post_type' => $post['type'],
		'post_status' => 'publish',
		'post_author' => $admins[0],
		'post_title' => $post['title'],
		'post_name' => $post['slug'],
		'post_excerpt' => $post['excerpt'],
		'post_date' => $post['date'],
		'menu_order' => $post['menuOrder'],
	) ), true );
	if ( is_wp_error( $id ) ) {
		throw new RuntimeException( $id->get_error_message() );
	}
	$ids[ (string) $post['id'] ] = (int) $id;
}

$url_map['{{STUDIO_BLUEPRINT_UPLOADS}}'] = untrailingslashit( $uploads['baseurl'] );
$url_map['{{STUDIO_BLUEPRINT_SITE}}'] = untrailingslashit( home_url() );
$rewrite_text = static function ( $text ) use ( &$url_map, &$ids ) {
	$text = strtr( $text, $url_map );
	return preg_replace_callback( '/wp-image-(\d+)/', static function ( $match ) use ( &$ids ) {
		return isset( $ids[ $match[1] ] ) ? 'wp-image-' . $ids[ $match[1] ] : $match[0];
	}, $text );
};
$rewrite_blocks = static function ( $text ) use ( &$ids, $rewrite_text ) {
	$walk = static function ( &$block ) use ( &$walk, &$ids, $rewrite_text ) {
		$rewrite_attributes = static function ( &$value ) use ( &$rewrite_attributes, $rewrite_text ) {
			if ( is_string( $value ) ) {
				$value = $rewrite_text( $value );
			} elseif ( is_array( $value ) ) {
				foreach ( $value as &$child ) {
					$rewrite_attributes( $child );
				}
			}
		};
		if ( isset( $block['attrs'] ) ) {
			$rewrite_attributes( $block['attrs'] );
		}
		foreach ( array( 'id', 'ref', 'mediaId', 'backgroundId' ) as $key ) {
			$value = $block['attrs'][ $key ] ?? null;
			if ( is_numeric( $value ) && isset( $ids[ (string) $value ] ) ) {
				$block['attrs'][ $key ] = $ids[ (string) $value ];
			}
		}
		if ( isset( $block['attrs']['ids'] ) && is_array( $block['attrs']['ids'] ) ) {
			$block['attrs']['ids'] = array_map( static function ( $id ) use ( &$ids ) {
				return $ids[ (string) $id ] ?? $id;
			}, $block['attrs']['ids'] );
		}
		if ( isset( $block['innerHTML'] ) ) {
			$block['innerHTML'] = $rewrite_text( $block['innerHTML'] );
		}
		foreach ( $block['innerContent'] ?? array() as $index => $fragment ) {
			if ( is_string( $fragment ) ) {
				$block['innerContent'][ $index ] = $rewrite_text( $fragment );
			}
		}
		if ( ! empty( $block['innerBlocks'] ) ) {
			foreach ( $block['innerBlocks'] as &$inner ) {
				$walk( $inner );
			}
		}
	};
	$blocks = parse_blocks( $text );
	foreach ( $blocks as &$block ) {
		$walk( $block );
	}
	return serialize_blocks( $blocks );
};

foreach ( $data['posts'] as $post ) {
	$id = $ids[ (string) $post['id'] ];
	$updated = wp_update_post( wp_slash( array(
		'ID' => $id,
		'post_content' => $rewrite_blocks( $post['content'] ),
		'post_parent' => $ids[ (string) $post['parent'] ] ?? 0,
	) ), true );
	if ( is_wp_error( $updated ) ) {
		throw new RuntimeException( $updated->get_error_message() );
	}
	if ( $post['template'] ) {
		update_post_meta( $id, '_wp_page_template', $post['template'] );
	}
	if ( isset( $ids[ (string) $post['thumbnail'] ] ) ) {
		set_post_thumbnail( $id, $ids[ (string) $post['thumbnail'] ] );
	}
	foreach ( $post['productMeta'] as $key => $value ) {
		update_post_meta( $id, $key, $value );
	}
	if ( $post['gallery'] ) {
		$gallery = array();
		foreach ( $post['gallery'] as $source_id ) {
			if ( isset( $ids[ (string) $source_id ] ) ) {
				$gallery[] = $ids[ (string) $source_id ];
			}
		}
		update_post_meta( $id, '_product_image_gallery', implode( ',', $gallery ) );
	}
	foreach ( $post['terms'] as $term ) {
		if ( ! taxonomy_exists( $term['taxonomy'] ) ) {
			continue;
		}
		$parent_id = 0;
		foreach ( $term['parents'] as $parent ) {
			$found = term_exists( $parent['slug'], $term['taxonomy'] );
			if ( ! $found ) {
				$found = wp_insert_term( $parent['name'], $term['taxonomy'], array( 'slug' => $parent['slug'], 'parent' => $parent_id ) );
			}
			if ( is_wp_error( $found ) ) {
				throw new RuntimeException( $found->get_error_message() );
			}
			$parent_id = (int) ( is_array( $found ) ? $found['term_id'] : $found );
		}
		$existing = term_exists( $term['slug'], $term['taxonomy'] );
		if ( ! $existing ) {
			$existing = wp_insert_term( $term['name'], $term['taxonomy'], array(
				'slug' => $term['slug'],
				'parent' => $parent_id,
			) );
		}
		if ( is_wp_error( $existing ) ) {
			throw new RuntimeException( $existing->get_error_message() );
		}
		wp_set_object_terms( $id, (int) ( is_array( $existing ) ? $existing['term_id'] : $existing ), $term['taxonomy'], true );
	}
}

foreach ( $data['options'] as $key => $value ) {
	update_option( $key, $value );
}
foreach ( $data['linkedOptions'] as $key => $old_id ) {
	if ( isset( $ids[ (string) $old_id ] ) ) {
		update_option( $key, $ids[ (string) $old_id ] );
	}
}
if ( isset( $ids[ (string) $data['frontPage'] ] ) ) {
	update_option( 'show_on_front', 'page' );
	update_option( 'page_on_front', $ids[ (string) $data['frontPage'] ] );
} else {
	update_option( 'show_on_front', 'posts' );
}
if ( isset( $ids[ (string) $data['postsPage'] ] ) ) {
	update_option( 'page_for_posts', $ids[ (string) $data['postsPage'] ] );
}
if ( isset( $ids[ (string) $data['siteIcon'] ] ) ) {
	update_option( 'site_icon', $ids[ (string) $data['siteIcon'] ] );
}
if ( isset( $ids[ (string) $data['customLogo'] ] ) ) {
	set_theme_mod( 'custom_logo', $ids[ (string) $data['customLogo'] ] );
}
if ( ! empty( $data['customCss'] ) ) {
	$result = wp_update_custom_css_post( $rewrite_text( $data['customCss'] ) );
	if ( is_wp_error( $result ) ) {
		throw new RuntimeException( $result->get_error_message() );
	}
}
if ( function_exists( 'wc_get_product' ) ) {
	foreach ( $data['posts'] as $post ) {
		if ( ! in_array( $post['type'], array( 'product', 'product_variation' ), true ) ) continue;
		$product = wc_get_product( $ids[ (string) $post['id'] ] );
		if ( $product ) $product->save();
	}
	foreach ( $data['posts'] as $post ) {
		if ( 'product' !== $post['type'] ) continue;
		$product = wc_get_product( $ids[ (string) $post['id'] ] );
		if ( $product && $product->is_type( 'variable' ) ) WC_Product_Variable::sync( $product->get_id() );
	}
}

foreach ( array_unique( array( get_stylesheet_directory(), get_template_directory() ) ) as $theme_dir ) {
	$files = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $theme_dir, FilesystemIterator::SKIP_DOTS ) );
	foreach ( $files as $file ) {
		if ( ! $file->isFile() || ! in_array( strtolower( $file->getExtension() ), array( 'html', 'json', 'css', 'php' ), true ) ) {
			continue;
		}
		$content = file_get_contents( $file->getPathname() );
		$rewritten = 'html' === strtolower( $file->getExtension() ) ? $rewrite_blocks( $content ) : $rewrite_text( $content );
		if ( $rewritten !== $content && false === file_put_contents( $file->getPathname(), $rewritten ) ) {
			throw new RuntimeException( 'Could not update a Blueprint theme file.' );
		}
	}
}

flush_rewrite_rules();
$files = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $resources, FilesystemIterator::SKIP_DOTS ), RecursiveIteratorIterator::CHILD_FIRST );
foreach ( $files as $file ) {
	$file->isDir() ? rmdir( $file->getPathname() ) : unlink( $file->getPathname() );
}
rmdir( $resources );
