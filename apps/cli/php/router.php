<?php

/**
 * Router script for PHP's built-in web server.
 *
 *   php -S localhost:8888 router.php
 *
 * Mirrors the default WordPress .htaccess: existing files and directories
 * are served as-is, everything else is dispatched to index.php so that
 * WP::parse_request() can resolve it against the rewrite rules.
 */

// PHP <= 8.3's built-in server doesn't apply auto_prepend_file to the router
// script (PHP bug #64566; fixed in 8.4), so apply it ourselves.
$studio_auto_prepend = ini_get( 'auto_prepend_file' );
if ( $studio_auto_prepend && is_file( $studio_auto_prepend ) ) {
	require_once $studio_auto_prepend;
}

$root = realpath( $_SERVER['DOCUMENT_ROOT'] ?? '' ) ?: getcwd();
$path = urldecode( parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH ) );
$file = $root . $path;

// phpMyAdmin ships outside the site root, so map the public URL prefix to the
// bundled directory explicitly instead of letting the built-in server resolve it.
$phpmyadmin_prefix = '/phpmyadmin';
$phpmyadmin_root   = getenv( 'STUDIO_PHPMYADMIN_PATH' ) ?: '';

if (
	$phpmyadmin_root
	&& ( $path === $phpmyadmin_prefix || str_starts_with( $path, $phpmyadmin_prefix . '/' ) )
) {
	$real_phpmyadmin_root = realpath( $phpmyadmin_root );

	if ( $path === $phpmyadmin_prefix ) {
		header( 'Location: ' . $phpmyadmin_prefix . '/', true, 301 );
		return true;
	}

	if ( false === $real_phpmyadmin_root ) {
		http_response_code( 404 );
		return true;
	}

	$relative_path = substr( $path, strlen( $phpmyadmin_prefix ) );
	$candidate     = rtrim( $real_phpmyadmin_root, DIRECTORY_SEPARATOR ) . str_replace( '/', DIRECTORY_SEPARATOR, $relative_path );
	$target        = realpath( $candidate );
	$root_prefix   = rtrim( $real_phpmyadmin_root, DIRECTORY_SEPARATOR ) . DIRECTORY_SEPARATOR;

	if (
		false === $target
		|| ( $target !== $real_phpmyadmin_root && ! str_starts_with( $target, $root_prefix ) )
	) {
		http_response_code( 404 );
		return true;
	}

	$script_name = $path;
	if ( is_dir( $target ) ) {
		if ( ! str_ends_with( $path, '/' ) ) {
			header( 'Location: ' . $path . '/', true, 301 );
			return true;
		}

		$index = realpath( $target . DIRECTORY_SEPARATOR . 'index.php' );
		if ( false === $index || ! str_starts_with( $index, $root_prefix ) ) {
			http_response_code( 404 );
			return true;
		}

		$target      = $index;
		$script_name = rtrim( $path, '/' ) . '/index.php';
	}

	if ( 'php' === strtolower( pathinfo( $target, PATHINFO_EXTENSION ) ) ) {
		$_SERVER['SCRIPT_NAME']     = $script_name;
		$_SERVER['PHP_SELF']        = $script_name;
		$_SERVER['SCRIPT_FILENAME'] = $target;
		chdir( dirname( $target ) );
		require $target;
		return true;
	}

	$mime_types   = array(
		'css'   => 'text/css',
		'js'    => 'application/javascript',
		'json'  => 'application/json',
		'map'   => 'application/json',
		'png'   => 'image/png',
		'jpg'   => 'image/jpeg',
		'jpeg'  => 'image/jpeg',
		'gif'   => 'image/gif',
		'svg'   => 'image/svg+xml',
		'ico'   => 'image/x-icon',
		'woff'  => 'font/woff',
		'woff2' => 'font/woff2',
		'ttf'   => 'font/ttf',
		'eot'   => 'application/vnd.ms-fontobject',
	);
	$extension    = strtolower( pathinfo( $target, PATHINFO_EXTENSION ) );
	$content_type = $mime_types[ $extension ] ?? mime_content_type( $target );
	if ( $content_type ) {
		header( 'Content-Type: ' . $content_type );
	}
	header( 'Content-Length: ' . filesize( $target ) );
	readfile( $target );
	return true;
}

// Existing file: require PHP scripts ourselves, serve static assets via the
// server. Returning false for PHP would run it as a second script, firing
// auto_prepend_file (runtime.php) twice and redeclaring its classes.
if ( '/' !== $path && is_file( $file ) ) {
	if ( 'php' !== strtolower( pathinfo( $file, PATHINFO_EXTENSION ) ) ) {
		return false;
	}

	$_SERVER['SCRIPT_NAME']     = $path;
	$_SERVER['PHP_SELF']        = $path;
	$_SERVER['SCRIPT_FILENAME'] = $file;
	chdir( dirname( $file ) );
	require $file;
	return true;
}

// Existing directory with an index.php: dispatch to that script.
if ( is_dir( $file ) && is_file( rtrim( $file, '/' ) . '/index.php' ) ) {
	$script                     = rtrim( $path, '/' ) . '/index.php';
	$_SERVER['SCRIPT_NAME']     = $script;
	$_SERVER['PHP_SELF']        = $script;
	$_SERVER['SCRIPT_FILENAME'] = $root . $script;
	require $root . $script;
	return true;
}

// Fall through to WordPress's front controller.
$_SERVER['SCRIPT_NAME']     = '/index.php';
$_SERVER['PHP_SELF']        = '/index.php';
$_SERVER['SCRIPT_FILENAME'] = $root . '/index.php';
require $root . '/index.php';
