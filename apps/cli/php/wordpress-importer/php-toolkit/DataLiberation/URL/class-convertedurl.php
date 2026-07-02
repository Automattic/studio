<?php

namespace WordPress\DataLiberation\URL;

use Rowbot\URL\URL;

/**
 * Value object returned by WPURL::replace_base_url().
 *
 * - Cast to string to get the updated URL as a string.
 * - When the original URL was relative, casting returns a relative string against
 *   the new base.
 */
class ConvertedUrl {

	/** @var URL */
	public $new_url;

	/** @var string */
	public $new_raw_url;

	/** @var string|null */
	public $new_raw_relative_url;

	/** @var bool */
	public $was_relative = false;

	/**
	 * Returns the updated URL string. If the original was relative, returns a relative string.
	 */
	public function __toString(): string {
		if ( $this->was_relative ) {
			return $this->new_raw_relative_url;
		}
		return $this->new_raw_url;
	}
}
