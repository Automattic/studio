import { extractJson } from './llm';

/**
 * Single-pass content seeder. The previous seed path issued one WP-CLI command
 * per item (post list + create/update + a call per meta key + options) — tens of
 * serial WASM WP-CLI boots. This runs the whole insert/meta/front-page pass in
 * ONE `wp eval-file` execution (Telex's content-loader pattern): the PHP reads a
 * sibling `_seed-manifest.json` + each item's content file and echoes a JSON
 * result.
 */

export interface SeederResult {
	created: string[];
	updated: string[];
	failed: string[];
	homeId: number;
	frontSet: boolean;
}

function stringArray( value: unknown ): string[] {
	return Array.isArray( value ) ? value.filter( ( v ): v is string => typeof v === 'string' ) : [];
}

export function parseSeederResult( stdout: string ): SeederResult {
	try {
		const data = JSON.parse( extractJson( stdout ) ) as Record< string, unknown >;
		return {
			created: stringArray( data.created ),
			updated: stringArray( data.updated ),
			failed: stringArray( data.failed ),
			homeId: typeof data.homeId === 'number' ? data.homeId : 0,
			frontSet: data.frontSet === true,
		};
	} catch {
		return { created: [], updated: [], failed: [], homeId: 0, frontSet: false };
	}
}

/**
 * The PHP run via `wp eval-file`. Fixed logic parameterised entirely by the
 * sibling `_seed-manifest.json`, so the same script seeds any site.
 */
export function buildSeederPhp(): string {
	return `<?php
/**
 * Single-pass content seeder (WordPress site generator). Reads
 * _seed-manifest.json + each item's content file, upserts every post/page/CPT
 * entry by slug, sets meta, and the static front page — one WP load.
 */
$dir = __DIR__;
$manifest = json_decode( file_get_contents( $dir . '/_seed-manifest.json' ), true );
$items = is_array( $manifest['items'] ?? null ) ? $manifest['items'] : array();
$contentMode = is_string( $manifest['contentMode'] ?? null ) ? $manifest['contentMode'] : '';

$created = array();
$updated = array();
$failed  = array();
$homeId = 0;
$firstPageId = 0;

foreach ( $items as $item ) {
	$postType = (string) $item['postType'];
	$slug     = (string) $item['slug'];
	$label    = $postType . ':' . $slug;

	$contentPath = $dir . '/' . $item['contentFile'];
	$content = is_readable( $contentPath ) ? file_get_contents( $contentPath ) : '';

	$existing = get_posts( array(
		'post_type'   => $postType,
		'name'        => $slug,
		'post_status' => 'any',
		'numberposts' => 1,
		'fields'      => 'ids',
	) );

	$postarr = array(
		'post_type'    => $postType,
		'post_name'    => $slug,
		'post_title'   => (string) $item['title'],
		'post_content' => $content,
		'post_status'  => 'publish',
	);
	if ( ! empty( $existing ) ) {
		$postarr['ID'] = (int) $existing[0];
	}

	$id = wp_insert_post( $postarr, true );
	if ( is_wp_error( $id ) || ! $id ) {
		$failed[] = $label;
		continue;
	}

	if ( ! empty( $existing ) ) {
		$updated[] = $label;
	} else {
		$created[] = $label;
	}

	if ( isset( $item['meta'] ) && is_array( $item['meta'] ) ) {
		foreach ( $item['meta'] as $key => $value ) {
			update_post_meta( $id, $key, $value );
		}
	}

	if ( ! empty( $item['isHome'] ) ) {
		$homeId = (int) $id;
	}
	if ( 'page' === $postType && ! $firstPageId ) {
		$firstPageId = (int) $id;
	}
}

if ( ! $homeId && $firstPageId && 'homepage-and-pages' === $contentMode ) {
	$homeId = $firstPageId;
}

$frontSet = false;
if ( $homeId ) {
	update_option( 'show_on_front', 'page' );
	update_option( 'page_on_front', $homeId );
	$frontSet = true;
}

echo json_encode( array(
	'created'  => $created,
	'updated'  => $updated,
	'failed'   => $failed,
	'homeId'   => $homeId,
	'frontSet' => $frontSet,
) );
`;
}
