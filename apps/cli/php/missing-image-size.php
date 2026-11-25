<?php

/**
 * Image sizes made on request, for the router.
 *
 * WordPress.com and VIP don't store image sizes: their edge makes `name-WxH.ext` from the
 * original when it's requested. Content pulled or imported from them links to those sizes, so
 * Studio makes them the same way. They go in wp-content/cache, which push leaves out, so the
 * remote never receives them.
 */

/**
 * Serves `$path`, a missing size of an upload, made from its original. Returns false when it
 * can't, so the request goes on to WordPress.
 */
function studio_serve_missing_image_size( string $root, string $path ): bool {
	if (
		! extension_loaded( 'gd' )
		|| ! preg_match( '#^/wp-content/uploads/(.+)-(\d+)x(\d+)\.(jpe?g|png|gif|webp)$#i', $path, $matches )
	) {
		return false;
	}
	list( , $stem, $width, $height, $extension ) = $matches;
	$width  = (int) $width;
	$height = (int) $height;

	$uploads  = realpath( $root . '/wp-content/uploads' );
	$original = $uploads ? studio_find_original_image( $uploads, $stem, $extension ) : false;
	if ( ! $original || $width < 1 || $height < 1 ) {
		return false;
	}

	// Named after the original's real folder, so the request path can't point the write elsewhere.
	$cached = $root . '/wp-content/cache/studio-image-sizes'
		. str_replace( DIRECTORY_SEPARATOR, '/', substr( dirname( $original ), strlen( $uploads ) ) )
		. '/' . basename( $path );
	if (
		( ! is_file( $cached ) || filemtime( $cached ) < filemtime( $original ) )
		&& ! studio_make_image_size( $original, $width, $height, $cached )
	) {
		return false;
	}

	$extension = strtolower( $extension );
	header( 'Content-Type: image/' . ( 'jpg' === $extension ? 'jpeg' : $extension ) );
	header( 'Content-Length: ' . filesize( $cached ) );
	readfile( $cached );
	return true;
}

/**
 * The upload a size was made from: `name.ext`, or WordPress's `name-scaled.ext` copy of a large
 * upload. Only a file inside uploads counts.
 */
function studio_find_original_image( string $uploads, string $stem, string $extension ) {
	foreach ( array( "$stem.$extension", "$stem-scaled.$extension" ) as $candidate ) {
		$original = realpath( $uploads . '/' . $candidate );
		if ( $original && is_file( $original ) && str_starts_with( $original, $uploads . DIRECTORY_SEPARATOR ) ) {
			return $original;
		}
	}
	return false;
}

/**
 * Writes `$original` scaled to cover `$width` × `$height` and cropped to it around the center, as
 * WordPress crops sizes. A proportional size already has the original's shape, so it isn't cut.
 * Never upscales.
 */
function studio_make_image_size( string $original, int $width, int $height, string $target ): bool {
	$size = @getimagesize( $original );
	if ( ! $size || $width > $size[0] || $height > $size[1] ) {
		return false;
	}
	$source = @imagecreatefromstring( (string) file_get_contents( $original ) );
	if ( ! $source ) {
		return false;
	}

	$source_width  = imagesx( $source );
	$source_height = imagesy( $source );
	$scale         = max( $width / $source_width, $height / $source_height );
	$crop_width    = min( $source_width, (int) round( $width / $scale ) );
	$crop_height   = min( $source_height, (int) round( $height / $scale ) );

	$image = imagecreatetruecolor( $width, $height );
	imagealphablending( $image, false );
	imagesavealpha( $image, true );
	imagecopyresampled(
		$image,
		$source,
		0,
		0,
		intdiv( $source_width - $crop_width, 2 ),
		intdiv( $source_height - $crop_height, 2 ),
		$width,
		$height,
		$crop_width,
		$crop_height
	);

	if ( ! is_dir( dirname( $target ) ) ) {
		@mkdir( dirname( $target ), 0777, true );
	}
	// Written aside, then renamed, so a worker serving the same size never reads half a file.
	$temporary = $target . '.' . getmypid() . '.tmp';
	$written   = match ( strtolower( pathinfo( $target, PATHINFO_EXTENSION ) ) ) {
		'png' => @imagepng( $image, $temporary ),
		'gif' => @imagegif( $image, $temporary ),
		'webp' => @imagewebp( $image, $temporary, 82 ),
		default => @imagejpeg( $image, $temporary, 82 ),
	};
	if ( $written && @rename( $temporary, $target ) ) {
		return true;
	}
	@unlink( $temporary );
	return false;
}
