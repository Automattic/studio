<?php

namespace WordPress\DataLiberation\URL;

use WordPress\DataLiberation\BlockMarkup\URL;
use WP_HTML_Text_Replacement;

/**
 * Finds string fragments that look like URLs and allows replacing them.
 *
 * This class implements two stages of detection:
 *
 * 1. **A "thick" sieve**
 * 2. **A "fine" sieve**
 *
 * The thick sieve uses a regular expression to match URL-like substrings. It matches too
 * much and may yield false positives.
 *
 * The fine sieve filters out invalid candidates using a WHATWG-compliant parser so only
 * real URLs are returned.
 *
 * ## URL Detection
 *
 * The thick sieve looks for URLs:
 *
 * * Starting with http://, https://, or //, e.g. //wp.org.
 * * With no protocol, e.g. www.wp.org or wp.org/path
 *
 * Here's a list of matching-related rules, limitations, and assumptions:
 *
 * ### Protocols
 *
 * As a site migration tool, this processor only considers URLs with HTTP
 * and HTTPS protocols.
 *
 * ### Domain names
 *
 * UTF-8 characters in the domain names are supported even if they're
 * not encoded as punycode. For example, scanning the text:
 *
 * > Więcej na łąka.pl
 *
 * Would yield `łąka.pl`
 *
 * ### Paths
 *
 * The path is limited to ASCII characters, as per the URL specification.
 * For example, scanning the text:
 *
 * > Visit the WordPress plugins directory https://w.org/plugins?łąka=1
 *
 * Would yield `https://w.org/plugins?`, not `https://w.org/plugins?łąka=1`.
 * However, scanning this text:
 *
 * > Visit the WordPress plugins directory https://w.org/plugins?%C5%82%C4%85ka=1
 *
 * Would yield `https://w.org/plugins?%C5%82%C4%85ka=1`.
 *
 * ### Parenthesis treatment
 *
 * This scanner captures parentheses as a part of the path, query, or fragment, except
 * when they're seen as the last character in the URL. For example, scanning the text:
 *
 * > Visit the WordPress plugins directory (https://w.org/plugins)
 *
 * Would yield `https://w.org/plugins`, but scanning the text:
 *
 * > Visit the WordPress plugins directory (https://w.org/plug(in)s
 *
 * Would yield `https://w.org/plug(in)s`.
 *
 * ### Rejecting URLs with embedded credentials
 *
 * `https://user:pass@wp.org` is not matched. Rewriting URLs that presume transferable
 * credentials is hazardous and rarely correct for migrations.
 *
 * ### Reject non-HTTP(S) schemes
 *
 * Out of scope for site moves; all of these are rejected:
 * `gopher://site.com`, `blob:afgh2-48189d`, `ahttp://site.com`, `mailto:user@site.com`, `file://asset.zip`.
 * If we need additional schemes later, we can add them intentionally.
 *
 * ### Reject non‑absolute‑looking references
 *
 * While we do rely on a base URL, inputs like `::`, `/index.html`, `?query` are still ignored.
 * Bare-domain forms like `mysite.org/?query` are still matched.
 *
 * ### Handle trailing punctuation sensibly
 *
 * `https://mysite.com/path/..` is interpreted as `https://mysite.com/path/` rather than
 * collapsing to the origin. A final period is far more likely sentence punctuation than `../`.
 * If a user truly writes `https://mysite.com/path/../`, we parse it as expected.
 *
 * ### Fuzzy matching for malformed ports
 *
 * * **WHATWG**: `"http://w.org:100000 plugins are in the directory" → failure`.
 * * **Inline detection**: `"http://w.org:100000 plugins are in the directory" → "http://w.org/"`
 *   (truncate at the invalid port).
 *
 * This is a best‑effort extraction of the valid prefix rather than an all‑or‑nothing rejection.
 *
 * ### Whitespace handling
 *
 * * **WHATWG**: `"http://example\t.\norg" → "http://example.org/"`.
 * * **Inline detection**: stops at the first whitespace, yielding `"http://example/"`.
 *
 * This reflects how URLs actually appear in text blocks where whitespace often terminates a link.
 */
class URLInTextProcessor {

	private $text;
	private $url_starts_at;
	private $url_length;
	private $bytes_already_parsed = 0;
	/**
	 * @var string
	 */
	private $matched_url;
	/**
	 * @var URL
	 */
	private $parsed_url;
	private $did_prepend_protocol;
	/**
	 * The base URL for the parsing algorithm.
	 * See https://url.spec.whatwg.org/.
	 *
	 * @var mixed|null
	 */
	private $base_url;
	private $base_protocol;

	/**
	 * The regular expression pattern used for the matchin URL candidates
	 * from the text.
	 *
	 * @var string
	 */
	private $regex;

	/**
	 * @see \WP_HTML_Tag_Processor
	 * @var WP_HTML_Text_Replacement[]
	 */
	private $lexical_updates = array();

	/**
	 * @var bool
	 * A flag to indicate whether the URL matching should be strict or not.
	 * If set to true, the matching will be strict, meaning it will only match URLs that strictly adhere to the pattern.
	 * If set to false, the matching will be more lenient, allowing for potential false positives.
	 */
	private $strict = false;
	public function __construct( $text, $base_url = null ) {
		$this->text          = $text;
		$this->base_url      = $base_url;
		$this->base_protocol = $base_url ? parse_url( $base_url, PHP_URL_SCHEME ) : null;

		$prefix = $this->strict ? '^' : '';
		$suffix = $this->strict ? '$' : '';

		// Source: https://github.com/vstelmakh/url-highlight/blob/master/src/Matcher/Matcher.php.
		$this->regex = '/' . $prefix . '
            (?:                                                      # scheme
                (?<scheme>[a-z0-9\+]+?:)?                            #
                (?:\/*)                                              # The protocol may optionally be followed by one or more slashes
            )?
            (?:                                                        # userinfo
                (?:
                    (?<=\/{2})                                             # prefixed with \/\/
                    |                                                      # or
                    (?=[^\p{Sm}\p{Sc}\p{Sk}\p{P}])                         # start with not: mathematical, currency, modifier symbol, punctuation
                )
                (?<userinfo>[^\s<>@\/]+)                                   # not: whitespace, < > @ \/
                @                                                          # at
            )?
            (?=%|[^\p{Z}\p{Sm}\p{Sc}\p{Sk}\p{C}\p{P}])                   # followed by valid host char
            (?|                                                        # host
                (?<host>                                                   # host prefixed by scheme or userinfo (less strict)
                    (?<=\/\/|@)                                               # prefixed with \/\/ or @
                    (?=[^\-])                                                  # label start, not: -
                    (?:%|[^\p{Z}\p{Sm}\p{Sc}\p{Sk}\p{C}\p{P}]|-){1,63}         # label not: whitespace, mathematical, currency, modifier symbol, control point, punctuation | except -
                    (?<=[^\-])                                                 # label end, not: -
                    (?:                                                        # more label parts
                        \.
                        (?=[^\-])                                                  # label start, not: -
                        (?<tld>(?:[^\p{Z}\p{Sm}\p{Sc}\p{Sk}\p{C}\p{P}]|-){1,63})   # label not: whitespace, mathematical, currency, modifier symbol, control point, punctuation | except -
                        (?<=[^\-])                                                 # label end, not: -
                    )*
                )
                |                                                          # or
                (?<host>                                                   # host with tld (no scheme or userinfo)
                    (?=[^\-])                                                  # label start, not: -
                    (?:%|[^\p{Z}\p{Sm}\p{Sc}\p{Sk}\p{C}\p{P}]|-){1,63}         # label not: whitespace, mathematical, currency, modifier symbol, control point, punctuation | except -
                    (?<=[^\-])                                                 # label end, not: -
                    (?:                                                        # more label parts
                        \.
                        (?=[^\-])                                                  # label start, not: -
                        (?:%|[^\p{Z}\p{Sm}\p{Sc}\p{Sk}\p{C}\p{P}]|-){1,63}         # label not: whitespace, mathematical, currency, modifier symbol, control point, punctuation | except -
                        (?<=[^\-])                                                 # label end, not: -
                    )*
                    \.(?<tld>\w{2,63})                                         # tld
                )
            )
            (?:\:(?<port>\d{1,5}(?!\d)))?                              # port
            (?<path>                                                   # path, query, fragment
                [\/?#]                                                 # prefixed with \/ or ? or #
                [^\s<>]*                                               # any chars except whitespace and <>
                (?<=[^\s<>({\[`!;:\'".,?«»“”‘’])                       # end with not a space or some punctuation chars
            )?
        ' . $suffix . '/ixuJ';
	}

	/**
	 * @return string
	 */
	public function next_url() {
		while ( true ) {
			$this->matched_url          = null;
			$this->parsed_url           = null;
			$this->url_starts_at        = null;
			$this->url_length           = null;
			$this->did_prepend_protocol = false;

			/**
			 * Thick sieve – eagerly match things that look like URLs but turn out to not be URLs in the end.
			 */
			$matches = array();
			$found   = preg_match( $this->regex, $this->text, $matches, PREG_OFFSET_CAPTURE, $this->bytes_already_parsed );
			if ( 1 !== $found ) {
				return false;
			}

			$this->matched_url = $matches[0][0];
			// Do not consider just :: as a URL.
			if ( '::' === $this->matched_url ) {
				continue;
			}
			if (
				')' === $this->matched_url[ strlen( $this->matched_url ) - 1 ] ||
				'.' === $this->matched_url[ strlen( $this->matched_url ) - 1 ]
			) {
				$this->matched_url = substr( $this->matched_url, 0, - 1 );
			}
			$url_starts_at              = $matches[0][1];
			$this->bytes_already_parsed = $url_starts_at + strlen( $this->matched_url );

			$had_protocol = WPURL::has_http_https_protocol( $this->matched_url );

			$preprocessed_url = $this->matched_url;
			if ( $this->base_url && $this->base_protocol && ! $had_protocol ) {
				$preprocessed_url           = WPURL::ensure_protocol( $preprocessed_url, $this->base_protocol );
				$this->did_prepend_protocol = true;
			}

			/*
			 * Extra fine sieve – parse the candidates using a WHATWG-compliant parser to rule out false positives.
			 */
			$parsed_url = WPURL::parse( $preprocessed_url, $this->base_url );
			if ( false === $parsed_url ) {
				continue;
			}

			// Only consider HTTP and HTTPS URLs.
			if ( $parsed_url->protocol && ! in_array( $parsed_url->protocol, array( 'http:', 'https:' ), true ) ) {
				continue;
			}

			// Disregard URLs with auth details.
			if ( $parsed_url->username || $parsed_url->password ) {
				continue;
			}

			// Additional rigor for URLs that are not explicitly preceded by a double slash.
			if ( ! $had_protocol ) {
				/*
				 * Skip TLDs that are not in the public suffix.
				 * This reduces false positives like `index.html` or `plugins.php`.
				 *
				 * See https://publicsuffix.org/.
				 */
				$last_dot_position = strrpos( $parsed_url->hostname, '.' );
				if ( false === $last_dot_position ) {
					/*
					 * Oh, there was no dot in the hostname AND no double slash at
					 * the beginning! Let's assume this isn't a valid URL and move on.
					 * @TODO: Explore updating the regular expression above to avoid matching
					 *        URLs without a dot in the hostname when they're not preceeded
					 *        by a protocol.
					 */
					continue;
				}

				$tld = substr( $parsed_url->hostname, $last_dot_position + 1 );
				if ( ! WPURL::is_known_public_domain( $tld ) ) {
					// This TLD is not in the public suffix list. It's not a valid domain name.
					continue;
				}
			}

			$this->parsed_url    = $parsed_url;
			$this->url_starts_at = $url_starts_at;
			$this->url_length    = strlen( $matches[0][0] );

			return true;
		}
	}

	public function get_raw_url() {
		return $this->matched_url ?? false;
	}

	public function get_parsed_url() {
		if ( null === $this->parsed_url ) {
			return false;
		}

		return $this->parsed_url;
	}

	public function set_raw_url( $new_url ) {
		if ( null === $this->matched_url ) {
			return false;
		}
		if ( $this->did_prepend_protocol ) {
			$new_url = substr( $new_url, strpos( $new_url, '://' ) + 3 );
		}
		$this->matched_url                             = $new_url;
		$this->lexical_updates[ $this->url_starts_at ] = new WP_HTML_Text_Replacement(
			$this->url_starts_at,
			$this->url_length,
			$new_url
		);

		return true;
	}

	private function apply_lexical_updates() {
		if ( ! count( $this->lexical_updates ) ) {
			return 0;
		}

		/*
		 * Attribute updates can be enqueued in any order but updates
		 * to the document must occur in lexical order; that is, each
		 * replacement must be made before all others which follow it
		 * at later string indices in the input document.
		 *
		 * Sorting avoid making out-of-order replacements which
		 * can lead to mangled output, partially-duplicated
		 * attributes, and overwritten attributes.
		 */

		ksort( $this->lexical_updates );

		$bytes_already_copied = 0;
		$output_buffer        = '';
		foreach ( $this->lexical_updates as $diff ) {
			$shift = strlen( $diff->text ) - $diff->length;

			// Adjust the cursor position by however much an update affects it.
			if ( $diff->start < $this->bytes_already_parsed ) {
				$this->bytes_already_parsed += $shift;
			}

			$output_buffer .= substr( $this->text, $bytes_already_copied, $diff->start - $bytes_already_copied );
			if ( $diff->start === $this->url_starts_at ) {
				$this->url_starts_at = strlen( $output_buffer );
				$this->url_length    = strlen( $diff->text );
			}
			$output_buffer       .= $diff->text;
			$bytes_already_copied = $diff->start + $diff->length;
		}

		$this->text            = $output_buffer . substr( $this->text, $bytes_already_copied );
		$this->lexical_updates = array();
	}

	public function get_updated_text() {
		$this->apply_lexical_updates();

		return $this->text;
	}
}
