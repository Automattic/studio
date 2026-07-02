<?php

namespace WordPress\DataLiberation\URL;

use WordPress\DataLiberation\CSS\CSSProcessor;

/**
 * Provides URL specific helpers on top of the CSSProcessor tokenizer.
 */
class CSSURLProcessor {
	/**
	 * @var CSSProcessor
	 */
	private $processor;

	/**
	 * @param string $css CSS source without wrapping braces.
	 */
	public function __construct( string $css ) {
		$this->processor = CSSProcessor::create( $css );
	}

	/**
	 * Moves the cursor to the next URL token, if available.
	 *
	 * @return bool
	 */
	public function next_url(): bool {
		while ( $this->processor->next_token() ) {
			$type = $this->processor->get_token_type();

			// Direct URL token.
			if ( CSSProcessor::TOKEN_URL === $type ) {
				return true;
			}

			// url() function with STRING token.
			if ( CSSProcessor::TOKEN_FUNCTION === $type &&
				0 === strcasecmp( $this->processor->get_token_value(), 'url' ) ) {
				// Look ahead for STRING token, skipping whitespace.
				while ( $this->processor->next_token() ) {
					$inner_type = $this->processor->get_token_type();
					if ( CSSProcessor::TOKEN_WHITESPACE === $inner_type ) {
						continue; // Skip whitespace.
					}
					if ( CSSProcessor::TOKEN_STRING === $inner_type ) {
						return true; // Found the URL string.
					}
					// Hit something else (like RIGHT_PAREN or another token).
					break;
				}
			}
		}
		return false;
	}

	/**
	 * Returns the raw (decoded) URL for the current match.
	 *
	 * @return string|false
	 */
	public function get_raw_url() {
		$value = $this->processor->get_token_value();
		return false !== $value ? $value : false;
	}

	/**
	 * Replaces the currently matched URL with a new value.
	 *
	 * @param string $new_url Replacement URL without quoting.
	 * @return bool
	 */
	public function set_raw_url( string $new_url ): bool {
		return $this->processor->set_token_value( $new_url );
	}

	/**
	 * Returns the updated CSS with all replacements applied.
	 *
	 * @return string
	 */
	public function get_updated_css(): string {
		return $this->processor->get_updated_css();
	}

	/**
	 * Determines whether the current URL is a data URI.
	 *
	 * @return bool
	 */
	public function is_data_uri(): bool {
		return $this->processor->is_data_uri();
	}
}
