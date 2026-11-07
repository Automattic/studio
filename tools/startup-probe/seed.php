<?php

global $wpdb;

$count = (int) ( getenv( 'STARTUP_PROBE_PRODUCTS' ) ?: 5000 );
$url = site_url();
$wpdb->query( 'BEGIN TRANSACTION' );

for ( $i = 1; $i <= $count; $i++ ) {
	$product = new WC_Product_Simple();
	$product->set_name( sprintf( '検証商品 %05d', $i ) );
	$product->set_status( 'publish' );
	$product->set_regular_price( (string) ( 10 + $i % 200 ) );
	$product->set_description( 'Startup probe product. <a href="' . esc_url( $url ) . '/catalogue">Catalogue</a>' );
	$product->set_sku( 'probe-' . $i );
	$product->set_manage_stock( true );
	$product->set_stock_quantity( 50 );
	for ( $j = 1; $j <= 24; $j++ ) {
		$product->update_meta_data( 'probe_media_' . $j, $url . '/wp-content/uploads/probe-' . $i . '-' . $j . '.jpg' );
	}
	$product->save();
	if ( $i % 500 === 0 ) {
		echo 'Seeded ' . $i . ' products' . PHP_EOL;
	}
}

$wpdb->query( 'COMMIT' );
update_option( 'woocommerce_store_address', '1 Test Street' );
update_option( 'woocommerce_default_country', 'US:CA' );
update_option( 'woocommerce_store_city', 'Test City' );
update_option( 'woocommerce_store_postcode', '90001' );

echo 'STUDIO_PROBE_FIXTURE=' . wp_json_encode( array(
	'wordpress' => get_bloginfo( 'version' ),
	'php' => PHP_VERSION,
	'products' => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'product'" ),
	'postmeta_rows' => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->postmeta}" ),
	'tables' => count( $wpdb->get_col( 'SHOW TABLES' ) ),
	'active_plugins' => get_option( 'active_plugins' ),
) ) . PHP_EOL;
