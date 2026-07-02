<?php
/**
 * WordPress eXtended RSS file parser implementations
 *
 * @package WordPress
 * @subpackage Importer
 */

use WordPress\ByteStream\ReadStream\FileReadStream;

/**
 * WXR Parser that uses the XMLProcessor component.
 */
class WXR_Parser_XML_Processor {
	public $authors       = array();
	public $posts         = array();
	public $categories    = array();
	public $tags          = array();
	public $terms         = array();
	public $base_url      = '';
	public $base_blog_url = '';

	/**
	 * Parse a WXR file
	 *
	 * @param string $file Path to WXR file
	 * @return array|WP_Error Parsed data or error object
	 */
	public function parse( $file ) {
		// Trigger a warning for non-existent files to match legacy behavior and tests.
		if ( ! is_readable( $file ) ) {
			// Intentionally trigger a PHP warning; return value is ignored.
			file_get_contents( $file );
		}
		// Initialize variables
		$this->authors       = array();
		$this->posts         = array();
		$this->categories    = array();
		$this->tags          = array();
		$this->terms         = array();
		$this->base_url      = '';
		$this->base_blog_url = '';
		$wxr_version         = '';

		try {
			$reader = $this->create_wxr_entity_reader( $file );
			// Parse the XML document
			$last_term = null;
			while ( $reader->next_entity() ) {
				$entity       = $reader->get_entity();
				$trimmed_data = array();
				foreach ( $entity->get_data() as $k => $v ) {
					if ( ! is_string( $v ) ) {
						$trimmed_data[ $k ] = $v;
						continue;
					}
					$trimmed_data[ $k ] = $v;
				}
				switch ( $entity->get_type() ) {
					case 'wxr_version':
						$wxr_version = $trimmed_data['wxr_version'];
						break;
					case 'site_option':
						if ( isset( $trimmed_data['option_name'], $trimmed_data['option_value'] ) ) {
							switch ( $trimmed_data['option_name'] ) {
								case 'wxr_version':
									$wxr_version = $trimmed_data['option_value'];
									break;
								case 'siteurl':
									$this->base_url = $trimmed_data['option_value'];
									break;
								case 'home':
									$this->base_blog_url = $trimmed_data['option_value'];
									break;
							}
						}
						break;
					case 'user':
						$key                   = isset( $trimmed_data['author_login'] ) ? $trimmed_data['author_login'] : (
							isset( $trimmed_data['author_email'] ) ? $trimmed_data['author_email'] : (
								isset( $trimmed_data['author_id'] ) ? $trimmed_data['author_id'] : count( $this->authors )
							)
						);
						$this->authors[ $key ] = $trimmed_data;
						break;
					case 'post':
						$this->posts[] = $trimmed_data;
						break;
					case 'post_meta':
						$last_post_key = count( $this->posts ) - 1;
						if ( ! isset( $this->posts[ $last_post_key ]['postmeta'] ) ) {
							$this->posts[ $last_post_key ]['postmeta'] = array();
						}
						// Ensure only expected keys 'key' and 'value' are present to match tests
						if ( isset( $trimmed_data['post_id'] ) ) {
							unset( $trimmed_data['post_id'] );
						}
						$this->posts[ $last_post_key ]['postmeta'][] = $trimmed_data;
						break;
					case 'comment':
						$last_post_key = count( $this->posts ) - 1;
						if ( ! isset( $this->posts[ $last_post_key ]['comments'] ) ) {
							$this->posts[ $last_post_key ]['comments'] = array();
						}
						$trimmed_data['commentmeta']                 = array();
						$this->posts[ $last_post_key ]['comments'][] = $trimmed_data;
						break;
					case 'comment_meta':
						$last_post_key      = count( $this->posts ) - 1;
						$last_comment_index = count( $this->posts[ $last_post_key ]['comments'] ) - 1;
						if ( $last_comment_index >= 0 ) {
							// Do not include comment_id in the final commentmeta array to match expected shape.
							if ( isset( $trimmed_data['comment_id'] ) ) {
								unset( $trimmed_data['comment_id'] );
							}
							$this->posts[ $last_post_key ]['comments'][ $last_comment_index ]['commentmeta'][] = $trimmed_data;
						}
						break;
					case 'category':
						if ( isset( $trimmed_data['term_id'] ) ) {
							$trimmed_data['term_id'] = (int) $trimmed_data['term_id'];
						}
						unset( $trimmed_data['taxonomy'], $trimmed_data['term_description'] );
						$this->categories[] = $trimmed_data;
						$last_term_index    = count( $this->categories ) - 1;
						$last_term          = &$this->categories[ $last_term_index ];
						break;
					case 'tag':
						if ( isset( $trimmed_data['term_id'] ) ) {
							$trimmed_data['term_id'] = (int) $trimmed_data['term_id'];
						}
						unset( $trimmed_data['taxonomy'], $trimmed_data['term_description'] );
						$this->tags[]    = $trimmed_data;
						$last_term_index = count( $this->tags ) - 1;
						$last_term       = &$this->tags[ $last_term_index ];
						break;
					case 'term':
						if ( isset( $trimmed_data['term_id'] ) ) {
							$trimmed_data['term_id'] = (int) $trimmed_data['term_id'];
						}
						// unset($trimmed_data['taxonomy'], $trimmed_data['term_description']);
						// $trimmed_data['taxonomy'] id 'domain'
						// $trimmed_data['slug'] id 'nicename'
						$this->terms[]   = $trimmed_data;
						$last_term_index = count( $this->terms ) - 1;
						$last_term       = &$this->terms[ $last_term_index ];
						break;
					case 'termmeta':
					case 'term_meta':
						if ( ! isset( $last_term['termmeta'] ) ) {
							$last_term['termmeta'] = array();
						}
						$last_term['termmeta'][] = $trimmed_data;
						break;
					case 'wxr_version':
						// Support entity-style wxr_version array or raw string
						if ( isset( $trimmed_data['wxr_version'] ) ) {
							$wxr_version = $trimmed_data['wxr_version'];
						} else {
							$wxr_version = $trimmed_data;
						}
						break;
					default:
						// Ignore unknown entity types silently to avoid emitting notices.
						break;
				}
			}
		} catch ( Exception $e ) {
			return new WP_Error( 'WXR_parse_error', $e->getMessage() );
		}

		// Normalize per-post terms to legacy shape { domain, slug, name } when needed.
		foreach ( $this->posts as $idx => $post ) {
			if ( isset( $post['terms'] ) && is_array( $post['terms'] ) ) {
				foreach ( $post['terms'] as $tidx => $term ) {
					if ( ! isset( $term['domain'] ) && isset( $term['taxonomy'] ) ) {
						$mapped                                = array(
							'domain' => $term['taxonomy'],
							'slug'   => isset( $term['slug'] ) ? $term['slug'] : '',
							'name'   => isset( $term['description'] ) ? $term['description'] : '',
						);
						$this->posts[ $idx ]['terms'][ $tidx ] = $mapped;
					}
				}
			}
		}

		// Validate WXR version
		if ( empty( $wxr_version ) || ! preg_match( '/^\d+\.\d+$/', $wxr_version ) ) {
			return new WP_Error( 'WXR_parse_error', __( 'This does not appear to be a WXR file, missing/invalid WXR version number', 'wordpress-importer' ) );
		}

		return array(
			'authors'       => $this->authors,
			'posts'         => $this->posts,
			'categories'    => $this->categories,
			'tags'          => $this->tags,
			'terms'         => $this->terms,
			'base_url'      => $this->base_url,
			'base_blog_url' => $this->base_blog_url,
			'version'       => $wxr_version,
		);
	}

	private function create_wxr_entity_reader( $file ) {
		// Every XML element is a combination of a long-form namespace and a
		// local element name, e.g. a syntax <wp:post_id> could actually refer
		// to a (https://wordpress.org/export/1.0/, post_id) element.
		//
		// Namespaces are paramount for parsing XML and cannot be ignored. Elements
		// element must be matched based on both their namespace and local name.
		//
		// Unfortunately, different WXR files defined the `wp` namespace in a different way.
		// Folks use a mixture of HTTP vs HTTPS protocols and version numbers. We must
		// account for all possible options to parse these documents correctly.
		$wxr_namespaces = array(
			'http://wordpress.org/export/1.0/',
			'https://wordpress.org/export/1.0/',
			'http://wordpress.org/export/1.1/',
			'https://wordpress.org/export/1.1/',
			'http://wordpress.org/export/1.2/',
			'https://wordpress.org/export/1.2/',
		);
		$known_entities = array(
			'item' => array(
				'type'   => 'post',
				'fields' => array(
					'title'       => 'post_title',
					'guid'        => 'guid',
					'description' => 'post_excerpt',
					'{http://purl.org/dc/elements/1.1/}creator' => 'post_author',
					'{http://purl.org/rss/1.0/modules/content/}encoded' => 'post_content',
					'{http://wordpress.org/export/1.0/excerpt/}encoded' => 'post_excerpt',
					'{http://wordpress.org/export/1.1/excerpt/}encoded' => 'post_excerpt',
					'{http://wordpress.org/export/1.2/excerpt/}encoded' => 'post_excerpt',
				),
			),
		);

		$known_site_options = array();

		foreach ( $wxr_namespaces as $wxr_namespace ) {
			$known_site_options               = array_merge(
				$known_site_options,
				array(
					'{' . $wxr_namespace . '}base_blog_url' => 'home',
					'{' . $wxr_namespace . '}base_site_url' => 'siteurl',
					'{' . $wxr_namespace . '}wxr_version' => 'wxr_version',
					'title'                               => 'blogname',
				)
			);
			$known_entities['item']['fields'] = array_merge(
				$known_entities['item']['fields'],
				array(
					'{' . $wxr_namespace . '}post_id'     => 'post_id',
					'{' . $wxr_namespace . '}status'      => 'status',
					'{' . $wxr_namespace . '}post_date'   => 'post_date',
					'{' . $wxr_namespace . '}post_date_gmt' => 'post_date_gmt',
					'{' . $wxr_namespace . '}post_modified' => 'post_modified',
					'{' . $wxr_namespace . '}post_modified_gmt' => 'post_modified_gmt',
					'{' . $wxr_namespace . '}comment_status' => 'comment_status',
					'{' . $wxr_namespace . '}ping_status' => 'ping_status',
					'{' . $wxr_namespace . '}post_name'   => 'post_name',
					'{' . $wxr_namespace . '}post_parent' => 'post_parent',
					'{' . $wxr_namespace . '}menu_order'  => 'menu_order',
					'{' . $wxr_namespace . '}post_type'   => 'post_type',
					'{' . $wxr_namespace . '}post_password' => 'post_password',
					'{' . $wxr_namespace . '}is_sticky'   => 'is_sticky',
					'{' . $wxr_namespace . '}attachment_url' => 'attachment_url',
				)
			);
			$known_entities                   = array_merge(
				$known_entities,
				array(
					'{' . $wxr_namespace . '}comment'     => array(
						'type'   => 'comment',
						'fields' => array(
							'{' . $wxr_namespace . '}comment_id'   => 'comment_id',
							'{' . $wxr_namespace . '}comment_author' => 'comment_author',
							'{' . $wxr_namespace . '}comment_author_email' => 'comment_author_email',
							'{' . $wxr_namespace . '}comment_author_url' => 'comment_author_url',
							'{' . $wxr_namespace . '}comment_author_IP' => 'comment_author_IP',
							'{' . $wxr_namespace . '}comment_date' => 'comment_date',
							'{' . $wxr_namespace . '}comment_date_gmt' => 'comment_date_gmt',
							'{' . $wxr_namespace . '}comment_content' => 'comment_content',
							'{' . $wxr_namespace . '}comment_approved' => 'comment_approved',
							'{' . $wxr_namespace . '}comment_type' => 'comment_type',
							'{' . $wxr_namespace . '}comment_parent' => 'comment_parent',
							'{' . $wxr_namespace . '}comment_user_id' => 'comment_user_id',
						),
					),
					'{' . $wxr_namespace . '}commentmeta' => array(
						'type'   => 'comment_meta',
						'fields' => array(
							'{' . $wxr_namespace . '}meta_key' => 'key',
							'{' . $wxr_namespace . '}meta_value' => 'value',
						),
					),
					'{' . $wxr_namespace . '}author'      => array(
						'type'   => 'user',
						'fields' => array(
							'{' . $wxr_namespace . '}author_id'    => 'author_id',
							'{' . $wxr_namespace . '}author_login' => 'author_login',
							'{' . $wxr_namespace . '}author_email' => 'author_email',
							'{' . $wxr_namespace . '}author_display_name' => 'author_display_name',
							'{' . $wxr_namespace . '}author_first_name' => 'author_first_name',
							'{' . $wxr_namespace . '}author_last_name' => 'author_last_name',
						),
					),
					'{' . $wxr_namespace . '}postmeta'    => array(
						'type'   => 'post_meta',
						'fields' => array(
							'{' . $wxr_namespace . '}meta_key' => 'key',
							'{' . $wxr_namespace . '}meta_value' => 'value',
						),
					),
					'{' . $wxr_namespace . '}term'        => array(
						'type'   => 'term',
						'fields' => array(
							'{' . $wxr_namespace . '}term_id' => 'term_id',
							'{' . $wxr_namespace . '}term_taxonomy' => 'term_taxonomy',
							'{' . $wxr_namespace . '}term_slug' => 'slug',
							'{' . $wxr_namespace . '}term_parent' => 'term_parent',
							'{' . $wxr_namespace . '}term_name' => 'term_name',
							'{' . $wxr_namespace . '}term_description' => 'term_description',
						),
					),
					'{' . $wxr_namespace . '}termmeta'    => array(
						'type'   => 'term_meta',
						'fields' => array(
							'{' . $wxr_namespace . '}meta_key' => 'key',
							'{' . $wxr_namespace . '}meta_value' => 'value',
						),
					),
					'{' . $wxr_namespace . '}tag'         => array(
						'type'   => 'tag',
						'fields' => array(
							'{' . $wxr_namespace . '}term_id'  => 'term_id',
							'{' . $wxr_namespace . '}tag_slug' => 'tag_slug',
							'{' . $wxr_namespace . '}tag_name' => 'tag_name',
							'{' . $wxr_namespace . '}tag_description' => 'tag_description',
						),
					),
					'{' . $wxr_namespace . '}category'    => array(
						'type'   => 'category',
						'fields' => array(
							'{' . $wxr_namespace . '}term_id'  => 'term_id',
							'{' . $wxr_namespace . '}category_nicename' => 'category_nicename',
							'{' . $wxr_namespace . '}category_parent' => 'category_parent',
							'{' . $wxr_namespace . '}cat_name' => 'cat_name',
							'{' . $wxr_namespace . '}category_description' => 'category_description',
						),
					),
				)
			);
		}
		return WordPress\DataLiberation\EntityReader\WXREntityReader::create(
			FileReadStream::from_path( $file ),
			null,
			array(
				'known_site_options'        => $known_site_options,
				'known_entities'            => $known_entities,
				'use_legacy_post_term_keys' => true,
				'remap_wp_author'           => false,
			)
		);
	}
}
