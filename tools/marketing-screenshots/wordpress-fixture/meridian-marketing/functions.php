<?php
/**
 * Meridian Marketing theme setup.
 */

function meridian_marketing_setup() {
	add_theme_support( 'title-tag' );
	add_theme_support( 'html5', array( 'style', 'script' ) );
}
add_action( 'after_setup_theme', 'meridian_marketing_setup' );

function meridian_marketing_enqueue_styles() {
	wp_enqueue_style(
		'meridian-marketing',
		get_stylesheet_uri(),
		array(),
		wp_get_theme()->get( 'Version' )
	);
}
add_action( 'wp_enqueue_scripts', 'meridian_marketing_enqueue_styles' );

function meridian_marketing_body_class( $classes ) {
	$classes[] = 'meridian-demo-site';
	return $classes;
}
add_filter( 'body_class', 'meridian_marketing_body_class' );
