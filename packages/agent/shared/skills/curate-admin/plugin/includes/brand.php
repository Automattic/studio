<?php
/**
 * Carries the site's brand into wp-admin and the login screen.
 *
 * Curated users get an admin color scheme of their own. Other users keep theirs.
 *
 * @package CurateAdmin
 */

defined( 'ABSPATH' ) || exit;

const CURATE_ADMIN_COLOR_SCHEME = 'curate-admin';

/**
 * Whether the site has a brand to apply. Without one, wp-admin keeps its colors.
 */
function curate_admin_has_brand(): bool {
	return ! empty( curate_admin_manifest()['brand']['accent'] );
}

/**
 * The manifest's brand, with the fallbacks for anything it leaves out.
 */
function curate_admin_brand(): array {
	return wp_parse_args(
		curate_admin_manifest()['brand'] ?? array(),
		array(
			'name'        => get_bloginfo( 'name' ),
			'logo'        => get_site_icon_url( 192 ),
			'accent'      => '#1f5b43',
			'accentText'  => '#ffffff',
			'sidebar'     => '#143f2e',
			'sidebarText' => '#ffffff',
			'displayFont' => '',
		)
	);
}

/**
 * The brand as CSS custom properties.
 */
function curate_admin_brand_css(): string {
	$brand = curate_admin_brand();
	$vars  = array(
		'--ca-accent'       => $brand['accent'],
		'--ca-accent-text'  => $brand['accentText'],
		'--ca-sidebar'      => $brand['sidebar'],
		'--ca-sidebar-text' => $brand['sidebarText'],
	);
	$css   = '';
	foreach ( $vars as $name => $value ) {
		$css .= $name . ':' . ( sanitize_hex_color( $value ) ?: 'inherit' ) . ';';
	}
	// The block editor's components need the accent as separate channels too.
	$hex  = ltrim( (string) sanitize_hex_color( $brand['accent'] ), '#' );
	$css .= '--ca-accent-rgb:' . implode( ',', array_map( 'hexdec', str_split( str_pad( $hex, 6, '0' ), 2 ) ) ) . ';';
	return ":root{{$css}}";
}

add_action(
	'admin_init',
	static function () {
		if ( ! curate_admin_is_curated() || ! curate_admin_has_brand() ) {
			return;
		}

		$brand = curate_admin_brand();
		wp_admin_css_color(
			CURATE_ADMIN_COLOR_SCHEME,
			$brand['name'],
			plugin_dir_url( CURATE_ADMIN_FILE ) . 'assets/admin-colors.css',
			array( $brand['sidebar'], $brand['accent'], $brand['sidebarText'] )
		);
	}
);

add_filter(
	'get_user_option_admin_color',
	static function ( $color ) {
		return curate_admin_is_curated() && curate_admin_has_brand() ? CURATE_ADMIN_COLOR_SCHEME : $color;
	}
);

add_action(
	'admin_enqueue_scripts',
	static function () {
		if ( curate_admin_is_curated() && curate_admin_has_brand() ) {
			wp_add_inline_style( 'colors', curate_admin_brand_css() );
		}
	},
	PHP_INT_MAX
);

// In `login_head`, after the login stylesheet, so these rules win.
add_action(
	'login_head',
	static function () {
		if ( ! curate_admin_has_brand() ) {
			return;
		}

		$brand = curate_admin_brand();
		$logo  = $brand['logo']
			? 'background-image:url(' . esc_url( $brand['logo'] ) . ');background-size:contain;width:120px;height:120px;'
			: 'background:none;width:auto;height:auto;text-indent:0;font-size:30px;color:var(--ca-accent);';

		echo '<style>' . curate_admin_brand_css() . // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			'.login h1 a{' . $logo . '}' . // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			'.login .button-primary{background:var(--ca-accent);border-color:var(--ca-accent);color:var(--ca-accent-text)}' .
			'.login #backtoblog a,.login #nav a{color:var(--ca-accent)}' .
			'input:focus{border-color:var(--ca-accent)!important;box-shadow:0 0 0 1px var(--ca-accent)!important}' .
			'</style>';
	}
);

add_filter(
	'login_headertext',
	static function ( $text ) {
		return curate_admin_has_brand() ? curate_admin_brand()['name'] : $text;
	}
);

add_filter(
	'login_headerurl',
	static function ( $url ) {
		return curate_admin_has_brand() ? home_url( '/' ) : $url;
	}
);
