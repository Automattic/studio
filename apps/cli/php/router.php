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

$root = getcwd();
$path = urldecode( parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH ) );
$file = $root . $path;

// Existing file (static asset or PHP script): let the built-in server handle it.
if ( '/' !== $path && is_file( $file ) ) {
	return false;
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
