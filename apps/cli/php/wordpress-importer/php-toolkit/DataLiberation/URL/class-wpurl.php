<?php

namespace WordPress\DataLiberation\URL;

use Rowbot\URL\URL;

/**
 * An abstraction to make swapping the URL parser easier later on.
 * We do not need it in the long run. It adds extra overhead of the
 * function call – let's remove it once the URL parser is decided.
 */
class WPURL {

	public static function parse( $url, $base = null ) {
		if ( is_string( $url ) ) {
			return URL::parse( $url, $base ) ?? false;
		} elseif ( is_a( $url, 'Rowbot\URL\URL' ) ) {
			return $url;
		}

		return false;
	}

	public static function can_parse( $url, $base = null ) {
		return URL::canParse( $url, $base );
	}

	/**
	 * Replaces the "base" of a URL — scheme, host (and port), and the portion of the path that
	 * belongs to the old base — with a new base while keeping the remainder of the URL intact.
	 *
	 * This is intended for content migrations, where URLs embedded in block markup, HTML attributes,
	 * or inline text must be moved from one site root to another without losing the rest of the path,
	 * query, or fragment. It handles simple domain swaps, ports, and deep path bases. When the old
	 * base includes path segments, only that matched prefix is substituted and the unmatched tail is
	 * carried over to the target base.
	 *
	 * For example:
	 * * URL:      https://example.com/a/b/c/d/e/f/g/h/i/j/page/
	 * * Old base: https://example.com/a/b/c/d/e/f/
	 * * New base: https://example.org/docs/
	 * * Result:   https://example.org/docs/g/h/i/j/page/
	 *
	 * ## Trailing slash handling
	 *
	 * Trailing slash style is preserved from the original URL. If it has no trailing slash, the
	 * result will also omit the trailing slash and vice versa.
	 *
	 * For example, here the final result has no trailing slash:
	 * * URL:      https://example.com/uploads/file.txt
	 * * Old base: https://example.com/uploads/
	 * * New base: https://example.org/docs/
	 * * Result:   https://example.org/docs/file.txt
	 *
	 * And here it does:
	 * * URL:      https://example.com/uploads/2018/
	 * * Old base: https://example.com/uploads/
	 * * New base: https://example.org/docs/
	 * * Result:   https://example.org/docs/2018/
	 *
	 * ## URL-encoded path segments
	 *
	 * URL-encoded path segments are respected and not inadvertently decoded or re-encoded. Only the
	 * matched base prefix is considered for alignment, so inputs that contain percent-encoded content
	 * keep that content exactly as-is in the output. This prevents data corruption in tricky cases such
	 * as "/~jappleseed/1997.10.1/%2561-reasons-to-migrate-data/" where the "%2561" must remain
	 * double-escaped after the move.
	 *
	 * ## Relative URLs
	 *
	 * This method can preserve the relative nature of the original URL. Say you are processing a markup
	 * that contains `<a href="/uploads/file.txt">`. The original URL string is "/uploads/file.txt",
	 * and the URL actually resolves to "https://example.com/uploads/file.txt". If you want to replace
	 * the base URL from "https://example.com/uploads/" to "https://newsite.com/files/" but keep the
	 * URL relative, you can pass the raw URL string via the "raw_url" option.
	 *
	 * For example:
	 * * URL:      https://example.com/uploads/file.txt
	 * * Raw URL:  /uploads/file.txt
	 * * Old base: https://example.com/uploads/
	 * * New base: https://example.org/files/
	 * * Result:   /files/file.txt
	 *
	 * The method also supports relative inputs commonly found in markup. If you pass the raw URL
	 * string via the "raw_url" option, the method can infer whether the author originally wrote a
	 * relative URL like "docs/page.html" or an absolute one. You may also explicitly
	 * assert relativity with "is_relative" to avoid inference.
	 *
	 * @param string|URL $url The URL to replace the base of.
	 * @param array      $options Associative options: old_base_url, new_base_url; optional raw_url.
	 * @return ConvertedUrl|false Returns a ConvertedUrl value object on success, or false when parsing
	 *                           or replacement cannot be performed.
	 */
	public static function replace_base_url( $url, $options ) {
		if ( ! is_array( $options ) ) {
			return false;
		}

		foreach ( array( 'old_base_url', 'new_base_url' ) as $required ) {
			if ( ! array_key_exists( $required, $options ) || null === $options[ $required ] ) {
				return false;
			}
		}

		$old_base_url = self::parse( $options['old_base_url'] );
		$new_base_url = self::parse( $options['new_base_url'] );
		$url          = self::parse( $url, $old_base_url ? $old_base_url->toString() : null );

		if ( false === $old_base_url || false === $new_base_url || false === $url ) {
			return false;
		}

		$updated_url = clone $url;

		$updated_url->hostname = $new_base_url->hostname;
		$updated_url->protocol = $new_base_url->protocol;
		$updated_url->port     = $new_base_url->port;

		$from_pathname = $url->pathname;
		$to_pathname   = $new_base_url->pathname;
		$base_pathname = $old_base_url->pathname;

		if ( $base_pathname !== $to_pathname ) {
			$base_pathname_with_trailing_slash = rtrim( $base_pathname, '/' ) . '/';
			$decoded_matched_pathname          = urldecode_n(
				$from_pathname,
				strlen( $base_pathname_with_trailing_slash )
			);
			$to_pathname_with_trailing_slash   = rtrim( $to_pathname, '/' ) . '/';
			$remaining_pathname                = substr(
				$decoded_matched_pathname,
				strlen( $base_pathname_with_trailing_slash )
			);

			$updated_url->pathname = $to_pathname_with_trailing_slash . $remaining_pathname;
		}

		/*
		 * Stylistic choice – if the updated URL has no trailing slash,
		 * do not add it to the new URL. The WHATWG URL parser will
		 * add one automatically if the path is empty, so we have to
		 * explicitly remove it.
		 */
		$new_raw_url                = $updated_url->toString();
		$should_trim_trailing_slash = (
			'' !== $from_pathname &&
			'/' !== substr( $from_pathname, -1 ) &&
			'/' !== $from_pathname &&
			'' === $url->search &&
			'' === $url->hash
		);
		if ( $should_trim_trailing_slash ) {
			$new_raw_url = rtrim( $new_raw_url, '/' );
		}
		if ( ! $new_raw_url ) {
			// This may technically happen, but does it happen in practice?
			return false;
		}

		$converted_url              = new ConvertedUrl();
		$converted_url->new_url     = $updated_url;
		$converted_url->new_raw_url = $new_raw_url;

		// Preserve the relative nature of the original URL.
		if ( array_key_exists( 'raw_url', $options ) && is_string( $options['raw_url'] ) ) {
			if ( ! array_key_exists( 'is_relative', $options ) ) {
				$options['is_relative'] = self::can_parse( $options['raw_url'] );
			}
			if ( $options['is_relative'] ) {
				$relative_url = $updated_url->pathname;
				// Remove the trailing slash if it's not the root path.
				if ( strlen( $relative_url ) > 1 && $should_trim_trailing_slash ) {
					$relative_url = rtrim( $relative_url, '/' );
				}
				if ( '' !== $updated_url->search ) {
					$relative_url .= $updated_url->search;
				}
				if ( '' !== $updated_url->hash ) {
					$relative_url .= $updated_url->hash;
				}

				$converted_url->was_relative         = true;
				$converted_url->new_raw_relative_url = $relative_url;
			}
		}

		return $converted_url;
	}

	/**
	 * Prepends a protocol to any matched URL without the double slash.
	 *
	 * Imagine we have a base URL of `https://example.com` and a text like `Visit myblog.com`.
	 * This Processor would match `myblog.com` as a URL candidate and then the parser
	 * would parse it as `https://example.com/myblog.com`, which is not what a user would expect.
	 *
	 * To get `https://myblog.com`, we need to prepend a protocol and turn that candidate into
	 * `https://myblog.com` before parsing.
	 */
	public static function ensure_protocol( $raw_url, $protocol = 'https' ) {
		if ( ! self::has_http_https_protocol( $raw_url ) ) {
			$raw_url = $protocol . '://' . $raw_url;
		}

		return $raw_url;
	}

	/**
	 * This method only considers http and https protocols.
	 */
	public static function has_http_https_protocol( $raw_url ) {
		return (
			(
				// Protocol-relative URLs.
				strlen( $raw_url ) > 2 &&
				'/' === $raw_url[0] &&
				'/' === $raw_url[1]
			) || (
				strlen( $raw_url ) > 5 &&
				( 'h' === $raw_url[0] || 'H' === $raw_url[0] ) &&
				( 't' === $raw_url[1] || 'T' === $raw_url[1] ) &&
				( 't' === $raw_url[2] || 'T' === $raw_url[2] ) &&
				( 'p' === $raw_url[3] || 'P' === $raw_url[3] ) &&
				':' === $raw_url[4]
			) || (
				strlen( $raw_url ) > 6 &&
				( 'h' === $raw_url[0] || 'H' === $raw_url[0] ) &&
				( 't' === $raw_url[1] || 'T' === $raw_url[1] ) &&
				( 't' === $raw_url[2] || 'T' === $raw_url[2] ) &&
				( 'p' === $raw_url[3] || 'P' === $raw_url[3] ) &&
				( 's' === $raw_url[4] || 'S' === $raw_url[4] ) &&
				':' === $raw_url[5]
			)
		);
	}

	public static function append_path( $base_url, $path ) {
		$base_url           = self::parse( $base_url );
		$base_url->pathname = rtrim( $base_url->pathname, '/' ) . '/' . ltrim( $path, '/' );

		return $base_url->toString();
	}

	/**
	 * Checks if a TLD is in the known public domain suffix list.
	 * This reduces false positives like `index.html` or `plugins.php`.
	 *
	 * @see https://publicsuffix.org/
	 *
	 * @param string $tld The top-level domain to check.
	 * @return bool True if the TLD is a known public domain, false otherwise.
	 */
	public static function is_known_public_domain( $tld ) {
		static $public_suffix_list = null;

		if ( null === $public_suffix_list ) {
			$public_suffix_list = require_once __DIR__ . '/public-suffix-list.php';
		}

		// @TODO: Parse wildcards and exceptions from the public suffix list.
		$tld = strtolower( $tld );
		return ! empty( $public_suffix_list[ $tld ] ) || 'internal' === $tld;
	}
}
