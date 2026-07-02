<?php

namespace WordPress\Encoding;

/**
 * UTF-8 encoding pipeline by Dennis Snell (@dmsnell).
 *
 * It enables parsing XML documents with incomplete UTF-8 byte sequences
 * without crashing or depending on the mbstring extension.
 */

/**
 * Encode a code point number into the UTF-8 encoding.
 *
 * This encoder implements the UTF-8 encoding algorithm for converting
 * a code point into a byte sequence. If it receives an invalid code
 * point it will return the Unicode Replacement Character U+FFFD `�`.
 *
 * Example:
 *
 *     '🅰' === WP_HTML_Decoder::codepoint_to_utf8_bytes( 0x1f170 );
 *
 *     // Half of a surrogate pair is an invalid code point.
 *     '�' === WP_HTML_Decoder::codepoint_to_utf8_bytes( 0xd83c );
 *
 * @since 6.6.0
 *
 * @see https://www.rfc-editor.org/rfc/rfc3629 For the UTF-8 standard.
 *
 * @param int $codepoint Which code point to convert.
 * @return string Converted code point, or `�` if invalid.
 */
function codepoint_to_utf8_bytes( $codepoint ) {
	// Pre-check to ensure a valid code point.
	if (
		$codepoint <= 0 ||
		( $codepoint >= 0xD800 && $codepoint <= 0xDFFF ) ||
		$codepoint > 0x10FFFF
	) {
		return '�';
	}

	if ( $codepoint <= 0x7F ) {
		return chr( $codepoint );
	}

	if ( $codepoint <= 0x7FF ) {
		$byte1 = chr( ( 0xC0 | ( ( $codepoint >> 6 ) & 0x1F ) ) );
		$byte2 = chr( $codepoint & 0x3F | 0x80 );

		return "{$byte1}{$byte2}";
	}

	if ( $codepoint <= 0xFFFF ) {
		$byte1 = chr( ( $codepoint >> 12 ) | 0xE0 );
		$byte2 = chr( ( $codepoint >> 6 ) & 0x3F | 0x80 );
		$byte3 = chr( $codepoint & 0x3F | 0x80 );

		return "{$byte1}{$byte2}{$byte3}";
	}

	// Any values above U+10FFFF are eliminated above in the pre-check.
	$byte1 = chr( ( $codepoint >> 18 ) | 0xF0 );
	$byte2 = chr( ( $codepoint >> 12 ) & 0x3F | 0x80 );
	$byte3 = chr( ( $codepoint >> 6 ) & 0x3F | 0x80 );
	$byte4 = chr( $codepoint & 0x3F | 0x80 );

	return "{$byte1}{$byte2}{$byte3}{$byte4}";
}
