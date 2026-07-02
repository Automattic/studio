<?php

namespace WordPress\XML;

use WP_HTML_Span;
use WP_HTML_Text_Replacement;

use function WordPress\Encoding\compat\_wp_scan_utf8;
use function WordPress\Encoding\utf8_ord;

/**
 * XML API: XMLProcessor class
 *
 * Scans through an XML document to find specific tags, then
 * transforms those tags by adding, removing, or updating the
 * values of the XML attributes within that tag (opener).
 *
 * It implements a subset of the XML 1.0 specification (https://www.w3.org/TR/xml/)
 * and supports XML documents with the following characteristics:
 *
 * – XML 1.0
 * – Well-formed
 * – UTF-8 encoded
 * – Not standalone (so can use external entities)
 * – No DTD, DOCTYPE, ATTLIST, ENTITY, or conditional sections (will fail on them)
 *
 * XML 1.1 is explicitly not a design goal here. Version 1.1 is
 * more complex specification and not so widely supported.
 *
 * ### Possible future direction for this module
 *
 * XMLProcessor only aims to support XML 1.0, which is mostly well-defined and
 * supported across the web. There are no plans to extend the parsing logic to XML 1.1,
 * which is a more complex specification and not so widely supported.
 *
 * @TODO: Include the cursor string in internal bookmarks and use it for seeking.
 *
 * @TODO: Track specific error states, expose informative messages, line
 *        numbers, indexes, and other debugging info.
 *
 * @TODO: Skip over the following syntax elements instead of failing:
 *        * <!DOCTYPE, see https://www.w3.org/TR/xml/#sec-prolog-dtd
 *        * <!ATTLIST, see https://www.w3.org/TR/xml/#attdecls
 *        * <!ENTITY, see https://www.w3.org/TR/xml/#sec-entity-decl
 *        * <!NOTATION, see https://www.w3.org/TR/xml/#sec-entity-decl
 *        * Conditional sections, see https://www.w3.org/TR/xml/#sec-condition-sect
 *
 * @package WordPress
 * @subpackage HTML-API
 * @since WP_VERSION
 */

/**
 * Core class used to modify attributes in an XML document for tags matching a query.
 *
 * ## Usage
 *
 * Use of this class requires three steps:
 *
 *  1. Create a new class instance with your input XML document.
 *  2. Find the tag(s) you are looking for.
 *  3. Request changes to the attributes in those tag(s).
 *
 * Example:
 *
 *     $processor = XMLProcessor::create_from_string( $xml );
 *     if ( $processor->next_tag( 'option' ) ) {
 *         $processor->set_attribute( '', 'selected', 'yes' );
 *     }
 *
 * ### Finding tags
 *
 * The `next_tag()` function moves the internal cursor through
 * your input XML document until it finds a tag meeting any of
 * the supplied restrictions in the optional query argument. If
 * no argument is provided then it will find the next XML tag,
 * regardless of what kind it is.
 *
 * If you want to _find whatever the next tag is_:
 *
 *     $processor->next_tag();
 *
 * | Goal                                                     | Query                                                    |
 * |----------------------------------------------------------|----------------------------------------------------------|
 * | Find any tag.                                            | `$processor->next_tag();`                                |
 * | Find next image tag.                                     | `$processor->next_tag( array( 'tag_name' => 'image' ) );`|
 * | Find next image tag (shorthand).                         | `$processor->next_tag( 'image' );`                       |
 * | Find next image tag in the "wp.org" namespace.           | `$processor->next_tag( array( 'wp.org', 'image' ) );`    |
 *
 * #### Namespace Examples
 *
 * To work with namespaces, you can use the `breadcrumbs` query format, where each breadcrumb is a tuple of (namespace prefix, local name):
 *
 *     $xml = '<root xmlns:wp="http://wordpress.org/export/1.2/"><wp:image src="cat.jpg" /></root>';
 *     $processor = XMLProcessor::create_from_string( $xml );
 *     // Find the <wp:image> tag
 *     if ( $processor->next_tag( array( 'http://wordpress.org/export/1.2/', 'image' ) ) ) {
 *         // Get the namespace URI of the matched tag
 *         $ns = $processor->get_tag_namespace(); // 'http://wordpress.org/export/1.2/'
 *         // Get the value of the 'src' attribute
 *         $src = $processor->get_attribute( $ns, 'src' );
 *         // Set a new attribute in the same namespace
 *         $processor->set_attribute( $ns, 'alt', 'A cat' );
 *     }
 *
 * If a tag was found meeting your criteria then `next_tag()`
 * will return `true` and you can proceed to modify it. If it
 * returns `false`, it failed to find the tag and moved the cursor to the end of the file.
 *
 * Once the cursor reaches the end of the file the processor
 * is done and if you want to reach an earlier tag you will
 * need to recreate the processor and start over, as it's
 * unable to back up or move in reverse (except via bookmarks).
 *
 * #### Custom queries
 *
 * Sometimes it's necessary to further inspect an XML tag than
 * the query syntax here permits. In these cases one may further
 * inspect the search results using the read-only functions
 * provided by the processor or external state or variables.
 *
 * Example:
 *
 *     // Paint up to the first five `musician` or `actor` tags marked with the "jazzy" style.
 *     $remaining_count = 5;
 *     while ( $remaining_count > 0 && $processor->next_tag() ) {
 *         $tag = $processor->get_tag_local_name();
 *         if (
 *              ( 'musician' === $tag || 'actor' === $tag ) &&
 *              'jazzy' === $processor->get_attribute( '', 'data-style' )
 *         ) {
 *             $processor->set_attribute( '', 'theme-style', 'theme-style-everest-jazz' );
 *             $remaining_count--;
 *         }
 *     }
 *
 * `get_attribute()` will return `null` if the attribute wasn't present
 * on the tag when it was called. It may return `""` (the empty string)
 * in cases where the attribute was present but its value was empty.
 * For boolean attributes, those whose name is present but no value is
 * given, it will return `true` (the only way to set `false` for an
 * attribute is to remove it).
 *
 * #### When matching fails
 *
 * When `next_tag()` returns `false` it could mean different things:
 *
 *  - The requested tag wasn't found in the input document.
 *  - The input document ended in the middle of an XML syntax element.
 *
 * When a document ends in the middle of a syntax element it will pause
 * the processor. This is to make it possible in the future to extend the
 * input document and proceed - an important requirement for chunked
 * streaming parsing of a document.
 *
 * Example:
 *
 *     $processor = XMLProcessor::create_from_string( 'This <content is="a" partial="token' );
 *     false === $processor->next_tag();
 *
 * If a special element (see next section) is encountered but no closing tag
 * is found it will count as an incomplete tag. The parser will pause as if
 * the opening tag were incomplete.
 *
 * Example:
 *
 *     $processor = XMLProcessor::create_from_string( '<style>// there could be more styling to come' );
 *     false === $processor->next_tag();
 *
 *     $processor = XMLProcessor::create_from_string( '<style>// this is everything</style><content>' );
 *     true === $processor->next_tag( 'content' );
 *
 *
 * ### Modifying XML attributes for a found tag
 *
 * Once you've found the start of an opening tag you can modify
 * any number of the attributes on that tag. You can set a new
 * value for an attribute, remove the entire attribute, or do
 * nothing and move on to the next opening tag.
 *
 * Example:
 *
 *     if ( $processor->next_tag( 'user-group' ) ) {
 *         $processor->set_attribute( '', 'name', 'Content editors' );
 *         $processor->remove_attribute( '', 'data-test-id' );
 *     }
 *
 * If `set_attribute()` is called for an existing attribute it will
 * overwrite the existing value. Similarly, calling `remove_attribute()`
 * for a non-existing attribute has no effect on the document. Both
 * of these methods are safe to call without knowing if a given attribute
 * exists beforehand.
 *
 * #### Namespaced attribute example
 *
 *     $processor = XMLProcessor::from_string( '<root xmlns:wp="http://wordpress.org/export/1.2/"><image /></root>' );
 *
 *     $ns = 'http://wordpress.org/export/1.2/';
 *     if ( $processor->next_tag( 'image' ) ) {
 *         $processor->set_attribute( $ns, 'src', 'cat.jpg' );
 *     }
 *
 *     echo $processor->get_modifiable_text();
 *     // <root xmlns:wp="http://wordpress.org/export/1.2/"><image wp:src="cat.jpg" /></root>
 *
 * ### Bookmarks
 *
 * While scanning through the input XML document it's possible to set
 * a named bookmark when a particular tag is found. Later on, after
 * continuing to scan other tags, it's possible to `seek` to one of
 * the set bookmarks and then proceed again from that point forward.
 *
 * Because bookmarks create processing overhead one should avoid
 * creating too many of them. As a rule, create only bookmarks
 * of known string literal names; avoid creating "mark_{$index}"
 * and so on. It's fine from a performance standpoint to create a
 * bookmark and update it frequently, such as within a loop.
 *
 *     $total_todos = 0;
 *     while ( $processor->next_tag( array( 'tag_name' => 'todo-list' ) ) ) {
 *         $processor->set_bookmark( 'list-start' );
 *         while ( $processor->next_tag() ) {
 *             if ( 'todo' === $processor->get_tag_local_name() && $processor->is_tag_closer() ) {
 *                 $processor->set_bookmark( 'list-end' );
 *                 $processor->seek( 'list-start' );
 *                 $processor->set_attribute( '', 'data-contained-todos', (string) $total_todos );
 *                 $total_todos = 0;
 *                 $processor->seek( 'list-end' );
 *                 break;
 *             }
 *             if ( 'todo-item' === $processor->get_tag_local_name() && ! $processor->is_tag_closer() ) {
 *                 $total_todos++;
 *             }
 *         }
 *     }
 *
 * ## Tokens and finer-grained processing
 *
 * It's possible to scan through every lexical token in the
 * XML document using the `next_token()` function. This
 * alternative form takes no argument and provides no built-in
 * query syntax.
 *
 * Example:
 *
 *      $title = '(untitled)';
 *      $text  = '';
 *      while ( $processor->next_token() ) {
 *          switch ( $processor->get_token_name() ) {
 *              case '#text':
 *                  $text .= $processor->get_modifiable_text();
 *                  break;
 *              case 'new-line':
 *                  $text .= "\n";
 *                  break;
 *              case 'title':
 *                  $title = $processor->get_modifiable_text();
 *                  break;
 *          }
 *      }
 *      return trim( "# {$title}\n\n{$text}" );
 *
 * ### Tokens and _modifiable text_
 *
 * There are also non-elements which are void/self-closing in nature and contain
 * modifiable text that is part of that individual syntax token itself.
 *
 *  - `#text` nodes, whose entire token _is_ the modifiable text.
 *  - XML comments and tokens that become comments due to some syntax error. The
 *    text for these tokens is the portion of the comment inside of the syntax.
 *    E.g. for `<!-- comment -->` the text is `" comment "` (note the spaces are included).
 *  - `CDATA` sections, whose text is the content inside of the section itself. E.g. for
 *    `<![CDATA[some content]]>` the text is `"some content"`.
 *  - XML Processing instruction nodes like `<?xml __( "Like" ); ?>` (with restrictions [1]).
 *
 * [1]: XML requires "xml" as a processing instruction name. The Tag Processor captures the entire
 *      processing instruction as a single token up to the closing `?>`.
 *
 * ## Design and limitations
 *
 * The XMLProcessor is designed to linearly scan XML documents and tokenize
 * XML tags and their attributes. It's designed to do this as efficiently as
 * possible without compromising parsing integrity. Therefore it will be
 * slower than some methods of modifying XML, such as those incorporating
 * over-simplified PCRE patterns, but will not introduce the defects and
 * failures that those methods bring in, which lead to broken page renders
 * and often to security vulnerabilities. On the other hand, it will be faster
 * than full-blown XML parsers such as DOMDocument and use considerably
 * less memory. It requires a negligible memory overhead, enough to consider
 * it a zero-overhead system.
 *
 * The performance characteristics are maintained by avoiding tree construction.
 *
 * The XMLProcessor checks the most important aspects of XML integrity as it scans
 * through the document. It verifies that a single root element exists, that there are
 * no unclosed tags, and that each opener tag has a corresponding closer. It also
 * ensures no duplicate attributes exist on a single tag.
 *
 * At the same time, the XMLProcessor also skips expensive validation of XML entities
 * in the document. The processor will initially pass through invalid entity references
 * and only fail when the developer attempts to read their value. If that doesn't happen,
 * the invalid values will be left untouched in the final document.
 *
 * Most operations within the XMLProcessor are designed to minimize the difference
 * between an input and output document for any given change. For example, the
 * `set_attribute` and `remove_attribute` methods preserve whitespace and the attribute
 * ordering within the element definition. An exception to this rule is that all attribute
 * updates store their values as double-quoted strings, meaning that attributes on input with
 * single-quoted or unquoted values will appear in the output with double-quotes.
 *
 * ### Text Encoding
 *
 * The XMLProcessor assumes that the input XML document is encoded with a
 * UTF-8 encoding and will refuse to process documents that declare other encodings.
 *
 * ### Namespaces
 *
 * Namespaces are first-class citizens in the XMLProcessor. Methods such as `set_attribute()` and `remove_attribute()`
 * require the full namespace URI, not just the local name. The XML specification treats the local
 * name as a mere syntax sugar. The actual matching is always done on the fully qualified namespace name.
 *
 * Example:
 *
 *     $processor = XMLProcessor::from_string( '<root xmlns:wp="http://wordpress.org/export/1.2/"><wp:image src="cat.jpg" /></root>' );
 *     $processor->next_tag( 'image' );
 *     $local_name = $processor->get_tag_local_name(); // 'image'
 *     $ns = $processor->get_tag_namespace(); // 'http://wordpress.org/export/1.2/'
 *     echo $processor->get_tag_namespace_and_local_name(); // '{http://wordpress.org/export/1.2/}image'
 *
 * #### Internal representation of names
 *
 * Internally, the XMLProcessor stores names using the following format:
 *
 *     {namespace}local_name
 *
 * It's safe, because the "{" and "}" bytes cannot be used in tag names or attribute names:
 *
 *     [4]      NameStartChar  ::=      ":" | [A-Z] | "_" | [a-z] | [#xC0-#xD6] | [#xD8-#xF6] | [#xF8-#x2FF] | [#x370-#x37D] | [#x37F-#x1FFF] | [#x200C-#x200D] | [#x2070-#x218F] | [#x2C00-#x2FEF] | [#x3001-#xD7FF] | [#xF900-#xFDCF] | [#xFDF0-#xFFFD] | [#x10000-#xEFFFF]
 *     [4a]     NameChar       ::=      NameStartChar | "-" | "." | [0-9] | #xB7 | [#x0300-#x036F] | [#x203F-#x2040]
 *
 * @since WP_VERSION
 */
class XMLProcessor {
	/**
	 * The maximum number of bookmarks allowed to exist at
	 * any given time.
	 *
	 * @since WP_VERSION
	 * @var int
	 *
	 * @see XMLProcessor::set_bookmark()
	 */
	const MAX_BOOKMARKS = 10;

	/**
	 * Maximum number of times seek() can be called.
	 * Prevents accidental infinite loops.
	 *
	 * @since WP_VERSION
	 * @var int
	 *
	 * @see XMLProcessor::seek()
	 */
	const MAX_SEEK_OPS = 1000;

	/**
	 * The XML document to parse.
	 *
	 * @since WP_VERSION
	 * @var string
	 */
	public $xml;

	/**
	 * Specifies mode of operation of the parser at any given time.
	 *
	 * | State             | Meaning                                                              |
	 * | ------------------|----------------------------------------------------------------------|
	 * | *Ready*           | The parser is ready to run.                                          |
	 * | *Complete*        | There is nothing left to parse.                                      |
	 * | *Incomplete*      | The XML ended in the middle of a token; nothing more can be parsed.  |
	 * | *Matched tag*     | Found an XML tag; it's possible to modify its attributes.            |
	 * | *Text node*       | Found a #text node; this is plaintext and modifiable.                |
	 * | *CDATA node*      | Found a CDATA section; this is modifiable.                           |
	 * | *PI node*         | Found a processing instruction; this is modifiable.                  |
	 * | *XML declaration* | Found an XML declaration; this is modifiable.                        |
	 * | *Comment*         | Found a comment or bogus comment; this is modifiable.                |
	 *
	 * @since WP_VERSION
	 *
	 * @see XMLProcessor::STATE_READY
	 * @see XMLProcessor::STATE_COMPLETE
	 * @see XMLProcessor::STATE_INCOMPLETE_INPUT
	 * @see XMLProcessor::STATE_MATCHED_TAG
	 * @see XMLProcessor::STATE_TEXT_NODE
	 * @see XMLProcessor::STATE_CDATA_NODE
	 * @see XMLProcessor::STATE_PI_NODE
	 * @see XMLProcessor::STATE_XML_DECLARATION
	 * @see XMLProcessor::STATE_COMMENT
	 *
	 * @var string
	 */
	protected $parser_state = self::STATE_READY;

	/**
	 * Whether the input has been finished.
	 *
	 * @var bool
	 */
	protected $expecting_more_input = true;

	/**
	 * How many bytes from the current XML chunk have been read and parsed.
	 *
	 * This value points to the latest byte offset in the input document which
	 * has been already parsed. It is the internal cursor for the Tag Processor
	 * and updates while scanning through the XML tokens.
	 *
	 * @since WP_VERSION
	 * @var int
	 */
	public $bytes_already_parsed = 0;

	/**
	 * How many XML bytes from the original stream have already been removed
	 * from the memory.
	 *
	 * @since WP_VERSION
	 * @var int
	 */
	public $upstream_bytes_forgotten = 0;

	/**
	 * Byte offset in the current `$xml` string where the currently recognized token starts.
	 * `null` if no token is currently active.
	 *
	 * Example:
	 *
	 *     <content id="test">...
	 *     ^-- token_starts_at = 0
	 *
	 * @since WP_VERSION
	 *
	 * @var int|null
	 */
	protected $token_starts_at;

	/**
	 * Byte length of current token.
	 *
	 * Example:
	 *
	 *     <content id="test">...
	 *     012345678901234
	 *     - token length is 14 - 0 = 14
	 *
	 *     a <!-- comment --> is a token.
	 *     0123456789 123456789 123456789
	 *     - token length is 17 - 2 = 15
	 *
	 * @since WP_VERSION
	 *
	 * @var int|null
	 */
	private $token_length;

	/**
	 * Currently matched XML element object.
	 *
	 * @var XMLElement|null
	 */
	private $element;

	/**
	 * Byte offset in input document where current tag name starts.
	 *
	 * Example:
	 *
	 *     <content id="test">...
	 *     01234
	 *      - tag name starts at 1
	 *
	 * @since WP_VERSION
	 *
	 * @var int|null
	 */
	private $tag_name_starts_at;

	/**
	 * Byte length of current tag name.
	 *
	 * Example:
	 *
	 *     <content id="test">...
	 *     01234
	 *      --- tag name length is 3
	 *
	 * @since WP_VERSION
	 *
	 * @var int|null
	 */
	private $tag_name_length;

	/**
	 * Byte offset into input document where current modifiable text starts.
	 *
	 * @since WP_VERSION
	 *
	 * @var int
	 */
	private $text_starts_at;

	/**
	 * Byte length of modifiable text.
	 *
	 * @since WP_VERSION
	 *
	 * @var string
	 */
	private $text_length;

	/**
	 * Whether the current tag is an opening tag, e.g. <content>, or a closing tag, e.g. </content>.
	 *
	 * @var bool
	 */
	private $is_closing_tag;

	/**
	 * Stores the error for why something failed, if it did.
	 *
	 * @see self::get_last_error
	 *
	 * @since WP_VERSION
	 *
	 * @var string|null
	 */
	protected $last_error = null;

	/**
	 * Stores context for why the parser bailed on unsupported XML, if it did.
	 *
	 * @see self::get_exception
	 *
	 * @var XMLUnsupportedException|null
	 */
	private $exception = null;

	/**
	 * Temporary index of attributes found within an XML tag, keyed by the qualified
	 * attribute name. It is only used during the initial attributes parsing phase and
	 * discarded once all the attributes have been parsed.
	 *
	 * @since WP_VERSION
	 * @var XMLAttributeToken[]
	 */
	private $qualified_attributes = array();

	/**
	 * Stores the attributes found within an XML tag, keyed by their namespace
	 * and local name combination.
	 *
	 * Example:
	 *
	 *     // Supposing the parser just finished parsing the wp:content tag:
	 *     // <channel xmlns:wp="http://wordpress.org/export/1.2/">
	 *     //   <wp:content wp:id="test-4" class="outline">
	 *     // </channel>
	 *     //
	 *     // Then, the attributes array would be:
	 *     $this->attributes = array(
	 *         '{http://wordpress.org/export/1.2/}id' => new XMLAttributeToken( 9, 6, 5, 14, 'wp', 'id' ),
	 *         'class' => new XMLAttributeToken( 23, 7, 17, 13, '', 'class', '' )
	 *     );
	 *
	 * @since WP_VERSION
	 * @var XMLAttributeToken[]
	 */
	private $attributes = array();

	/**
	 * Tracks a semantic location in the original XML which
	 * shifts with updates as they are applied to the document.
	 *
	 * @since WP_VERSION
	 * @var WP_HTML_Span[]
	 */
	protected $bookmarks = array();

	/**
	 * Lexical replacements to apply to input XML document.
	 *
	 * "Lexical" in this class refers to the part of this class which
	 * operates on pure text _as text_ and not as XML. There's a line
	 * between the public interface, with XML-semantic methods like
	 * `set_attribute` and `add_class`, and an internal state that tracks
	 * text offsets in the input document.
	 *
	 * When higher-level XML methods are called, those have to transform their
	 * operations (such as setting an attribute's value) into text diffing
	 * operations (such as replacing the sub-string from indices A to B with
	 * some given new string). These text-diffing operations are the lexical
	 * updates.
	 *
	 * As new higher-level methods are added they need to collapse their
	 * operations into these lower-level lexical updates since that's the
	 * Tag Processor's internal language of change. Any code which creates
	 * these lexical updates must ensure that they do not cross XML syntax
	 * boundaries, however, so these should never be exposed outside of this
	 * class or any classes which intentionally expand its functionality.
	 *
	 * These are enqueued while editing the document instead of being immediately
	 * applied to avoid processing overhead, string allocations, and string
	 * copies when applying many updates to a single document.
	 *
	 * Example:
	 *
	 *     // Replace an attribute stored with a new value, indices
	 *     // sourced from the lazily-parsed XML recognizer.
	 *     $start  = $attributes['src']->start;
	 *     $length = $attributes['src']->length;
	 *     $modifications[] = new WP_HTML_Text_Replacement( $start, $length, $new_value );
	 *
	 *     // Correspondingly, something like this will appear in this array.
	 *     $lexical_updates = array(
	 *         WP_HTML_Text_Replacement( 14, 28, 'https://my-site.my-domain/wp-content/uploads/2014/08/kittens.jpg' )
	 *     );
	 *
	 * @since WP_VERSION
	 * @var WP_HTML_Text_Replacement[]
	 */
	protected $lexical_updates = array();

	/**
	 * The Name from the DOCTYPE declaration.
	 *
	 * ```
	 * doctypedecl ::= '<!DOCTYPE' S Name (S ExternalID)? S? ('[' intSubset ']' S?)? '>'
	 *                               ^^^^
	 * ```
	 *
	 * @since WP_VERSION
	 * @var WP_HTML_Span|null
	 */
	protected $doctype_name = null;

	/**
	 * The system literal value from the DOCTYPE declaration.
	 *
	 * ```
	 * doctypedecl ::= '<!DOCTYPE' S Name (S ExternalID)? S? ('[' intSubset ']' S?)? '>'
	 * ExternalID ::= 'SYSTEM' S SystemLiteral | 'PUBLIC' S PubidLiteral
	 *                           ^^^^^^^^^^^^^
	 * ```
	 *
	 * Example:
	 *
	 *     <!DOCTYPE html SYSTEM "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
	 *
	 * In this example, the system_literal would be:
	 * "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd"
	 *
	 * @since WP_VERSION
	 * @var WP_HTML_Span|null
	 */
	protected $system_literal = null;

	/**
	 * The public identifier value from the DOCTYPE declaration.
	 *
	 * ```
	 * doctypedecl ::= '<!DOCTYPE' S Name (S ExternalID)? S? ('[' intSubset ']' S?)? '>'
	 * ExternalID ::= 'SYSTEM' S SystemLiteral | 'PUBLIC' S PubidLiteral
	 * ```
	 *                                                      ^^^^^^^^^^^^
	 * Example:
	 *
	 * ```
	 * <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
	 * ```
	 *
	 * In this example, the publid_literal would be:
	 * "-//W3C//DTD XHTML 1.0 Strict//EN"
	 *
	 * @since WP_VERSION
	 * @var WP_HTML_Span|null
	 */
	protected $pubid_literal = null;

	/**
	 * Memory budget for the processed XML.
	 *
	 * `append_bytes()` will flush the processed bytes whenever the XML buffer
	 * exceeds this budget. The lexical updates will be applied and the bookmarks
	 * will be reset.
	 *
	 * @var int
	 */
	protected $memory_budget = 1024 * 1024 * 1024;

	/**
	 * Tracks and limits `seek()` calls to prevent accidental infinite loops.
	 *
	 * @since WP_VERSION
	 * @var int
	 *
	 * @see XMLProcessor::seek()
	 */
	protected $seek_count = 0;

	/**
	 * Indicates the current parsing stage.
	 *
	 * A well-formed XML document has the following structure:
	 *
	 *     document ::= prolog element Misc*
	 *     prolog   ::= XMLDecl? Misc* (doctypedecl Misc*)?
	 *     Misc     ::= Comment | PI | S
	 *
	 * There is exactly one element, called the root. No elements or text nodes may
	 * precede or follow it.
	 *
	 * See https://www.w3.org/TR/xml/#NT-document.
	 *
	 * | Stage           | Meaning                                                             |
	 * | ----------------|---------------------------------------------------------------------|
	 * | *Prolog*        | The parser is parsing the prolog.                                   |
	 * | *Element*       | The parser is parsing the root element.                             |
	 * | *Misc*          | The parser is parsing miscellaneous content.                        |
	 *
	 * @see XMLProcessor::IN_PROLOG_CONTEXT
	 * @see XMLProcessor::IN_ELEMENT_CONTEXT
	 * @see XMLProcessor::IN_MISC_CONTEXT
	 *
	 * @since WP_VERSION
	 * @var bool
	 */
	protected $parser_context = self::IN_PROLOG_CONTEXT;

	/**
	 * Top-level namespaces for the currently parsed document.
	 *
	 * @var array
	 */
	private $document_namespaces;

	/**
	 * Tracks open elements and their namespaces while scanning XML.
	 *
	 * @var array
	 */
	private $stack_of_open_elements = array();

	public static function create_from_string( $xml, $cursor = null, $known_definite_encoding = 'UTF-8', $document_namespaces = array() ) {
		$processor = static::create_for_streaming( $xml, $cursor, $known_definite_encoding, $document_namespaces );
		if ( null === $processor ) {
			return false;
		}
		$processor->input_finished();

		return $processor;
	}

	public static function create_for_streaming( $xml = '', $cursor = null, $known_definite_encoding = 'UTF-8', $document_namespaces = array() ) {
		if ( 'UTF-8' !== $known_definite_encoding ) {
			return false;
		}
		$processor = new XMLProcessor( $xml, $document_namespaces, self::CONSTRUCTOR_UNLOCK_CODE );
		if ( null !== $cursor && true !== $processor->initialize_from_cursor( $cursor ) ) {
			return false;
		}

		return $processor;
	}

	/**
	 * Returns a re-entrancy cursor – it's a string that can instruct a new XML
	 * Processor instance to continue parsing from the current location in the
	 * document.
	 *
	 * The only stable part of this API is the return type of string. The consumer
	 * of this method MUST NOT assume any specific structure of the returned
	 * string. It will change without a warning between WordPress releases.
	 *
	 * This is not a tell() API. No XML Processor method will accept the cursor
	 * to move to another location. The only way to use this cursor is creating
	 * a new XML Processor instance. If you need to move around the document, use
	 * `set_bookmark()` and `seek()`.
	 */
	public function get_reentrancy_cursor() {
		$stack_of_open_elements = array();
		foreach ( $this->stack_of_open_elements as $element ) {
			$stack_of_open_elements[] = $element->to_array();
		}

		return base64_encode( // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
			json_encode(
				array(
					'is_finished'              => $this->is_finished(),
					'upstream_bytes_forgotten' => $this->upstream_bytes_forgotten,
					'parser_context'           => $this->parser_context,
					'stack_of_open_elements'   => $stack_of_open_elements,
					'expecting_more_input'     => $this->expecting_more_input,
					'document_namespaces'      => $this->document_namespaces,
				)
			)
		);
	}

	/**
	 * Returns the byte offset in the input stream where the current token starts.
	 *
	 * You should probably not use this method.
	 *
	 * It's only exists to allow resuming the input stream at the same offset where
	 * the XML parsing was finished. It will never expose any attribute's byte
	 * offset and no method in the XML processor API will ever accept the byte offset
	 * to move to another location. If you need to move around the document, use
	 * `set_bookmark()` and `seek()` instead.
	 */
	public function get_token_byte_offset_in_the_input_stream() {
		return $this->token_starts_at + $this->upstream_bytes_forgotten;
	}

	protected function initialize_from_cursor( $cursor ) {
		if ( ! is_string( $cursor ) ) {
			_doing_it_wrong( __METHOD__, 'Cursor must be a JSON-encoded string.', '1.0.0' );

			return false;
		}
		$cursor = base64_decode( $cursor ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode
		if ( false === $cursor ) {
			_doing_it_wrong( __METHOD__, 'Invalid cursor provided to initialize_from_cursor().', '1.0.0' );

			return false;
		}
		$cursor = json_decode( $cursor, true );
		if ( false === $cursor ) {
			_doing_it_wrong( __METHOD__, 'Invalid cursor provided to initialize_from_cursor().', '1.0.0' );

			return false;
		}
		if ( $cursor['is_finished'] ) {
			$this->parser_state = self::STATE_COMPLETE;
		}
		// Assume the input stream will start from the last known byte offset.
		$this->bytes_already_parsed     = 0;
		$this->upstream_bytes_forgotten = $cursor['upstream_bytes_forgotten'];
		$this->stack_of_open_elements   = array();
		foreach ( $cursor['stack_of_open_elements'] as $element ) {
			array_push( $this->stack_of_open_elements, XMLElement::from_array( $element ) );
		}
		$this->document_namespaces  = $cursor['document_namespaces'];
		$this->parser_context       = $cursor['parser_context'];
		$this->expecting_more_input = $cursor['expecting_more_input'];

		return true;
	}

	/**
	 * Constructor.
	 *
	 * Do not use this method. Use the static creator methods instead.
	 *
	 * @access private
	 *
	 * @param  string      $xml  XML to process.
	 * @param  array       $document_namespaces  Document namespaces.
	 * @param  string|null $use_the_static_create_methods_instead  This constructor should not be called manually.
	 *
	 * @see XMLProcessor::create_stream()
	 *
	 * @since 6.4.0
	 *
	 * @see XMLProcessor::create_fragment()
	 */
	protected function __construct( $xml, $document_namespaces = array(), $use_the_static_create_methods_instead = null ) {
		if ( self::CONSTRUCTOR_UNLOCK_CODE !== $use_the_static_create_methods_instead ) {
			_doing_it_wrong(
				__METHOD__,
				sprintf(
				/* translators: %s: XMLProcessor::create_fragment(). */
					__( 'Call %s to create an XML Processor instead of calling the constructor directly.' ),
					'<code>XMLProcessor::create_fragment()</code>'
				),
				'6.4.0'
			);
		}
		$this->xml                 = isset( $xml ) ? $xml : '';
		$this->document_namespaces = array_merge(
			$document_namespaces,
			// These initial namespaces cannot be overridden.
			array(
				'xml'   => 'http://www.w3.org/XML/1998/namespace', // Predefined, cannot be unbound or changed.
				'xmlns' => 'http://www.w3.org/2000/xmlns/',        // Reserved for xmlns attributes, not a real namespace for elements/attributes.
				''      => '', // Default namespace is initially empty (no namespace).
			)
		);
	}

	/**
	 * Wipes out the processed XML and appends the next chunk of XML to
	 * any remaining unprocessed XML.
	 *
	 * @param  string $next_chunk  XML to append.
	 */
	public function append_bytes( $next_chunk ) {
		if ( ! $this->expecting_more_input ) {
			_doing_it_wrong(
				__METHOD__,
				__( 'Cannot append bytes after the last input chunk was provided and input_finished() was called.' ),
				'WP_VERSION'
			);

			return false;
		}
		$this->xml .= $next_chunk;
		if ( self::STATE_INCOMPLETE_INPUT === $this->parser_state ) {
			$this->parser_state = self::STATE_READY;
		}

		// Periodically flush the processed bytes to avoid high memory usage.
		if (
			null !== $this->memory_budget &&
			strlen( $this->xml ) > $this->memory_budget
		) {
			$this->flush_processed_xml();
		}

		return true;
	}

	/**
	 * Forgets the XML bytes that have been processed and are no longer needed to
	 * avoid high memory usage.
	 *
	 * @return string The flushed bytes.
	 */
	private function flush_processed_xml() {
		// Flush updates.
		$this->get_updated_xml();

		$unreferenced_bytes = $this->bytes_already_parsed;
		if ( null !== $this->token_starts_at ) {
			$unreferenced_bytes = min( $unreferenced_bytes, $this->token_starts_at );
		}

		$flushed_bytes               = substr( $this->xml, 0, $unreferenced_bytes );
		$this->xml                   = substr( $this->xml, $unreferenced_bytes );
		$this->bookmarks             = array();
		$this->lexical_updates       = array();
		$this->seek_count            = 0;
		$this->bytes_already_parsed -= $unreferenced_bytes;
		if ( null !== $this->token_starts_at ) {
			$this->token_starts_at -= $unreferenced_bytes;
		}
		if ( null !== $this->tag_name_starts_at ) {
			$this->tag_name_starts_at -= $unreferenced_bytes;
		}
		if ( null !== $this->text_starts_at ) {
			$this->text_starts_at -= $unreferenced_bytes;
		}
		$this->upstream_bytes_forgotten += $unreferenced_bytes;

		return $flushed_bytes;
	}

	/**
	 * Indicates that all the XML document bytes have been provided.
	 *
	 * After calling this method, the processor will emit errors where
	 * previously it would have entered the STATE_INCOMPLETE_INPUT state.
	 */
	public function input_finished() {
		$this->expecting_more_input = false;
		$this->parser_state         = self::STATE_READY;
	}

	/**
	 * Indicates if the processor is expecting more data bytes.
	 * If not, the processor will expect the remaining XML bytes to form
	 * a valid document and will not stop on incomplete input.
	 *
	 * @return bool Whether the processor is expecting more data bytes.
	 */
	public function is_expecting_more_input() {
		return $this->expecting_more_input;
	}

	/**
	 * Internal method which finds the next token in the XML document.
	 *
	 * This method is a protected internal function which implements the logic for
	 * finding the next token in a document. It exists so that the parser can update
	 * its state without affecting the location of the cursor in the document and
	 * without triggering subclass methods for things like `next_token()`, e.g. when
	 * applying patches before searching for the next token.
	 *
	 * @return bool Whether a token was parsed.
	 * @since 6.5.0
	 *
	 * @access private
	 */
	protected function parse_next_token() {
		$was_at = $this->bytes_already_parsed;
		$this->after_tag();

		// Don't proceed if there's nothing more to scan.
		if (
			self::STATE_COMPLETE === $this->parser_state ||
			self::STATE_INCOMPLETE_INPUT === $this->parser_state ||
			null !== $this->last_error
		) {
			return false;
		}

		/*
		 * The next step in the parsing loop determines the parsing state;
		 * clear it so that state doesn't linger from the previous step.
		 */
		$this->parser_state = self::STATE_READY;

		if ( $this->bytes_already_parsed >= strlen( $this->xml ) ) {
			if ( $this->expecting_more_input ) {
				$this->parser_state = self::STATE_INCOMPLETE_INPUT;
			} else {
				$this->parser_state = self::STATE_COMPLETE;
			}

			return false;
		}

		// Find the next tag if it exists.
		if ( false === $this->parse_next_tag() ) {
			if ( self::STATE_INCOMPLETE_INPUT === $this->parser_state ) {
				$this->bytes_already_parsed = $was_at;
			}

			return false;
		}

		if ( null !== $this->last_error ) {
			return false;
		}

		/*
		 * For legacy reasons the rest of this function handles tags and their
		 * attributes. If the processor has reached the end of the document
		 * or if it matched any other token then it should return here to avoid
		 * attempting to process tag-specific syntax.
		 */
		if (
			self::STATE_INCOMPLETE_INPUT !== $this->parser_state &&
			self::STATE_COMPLETE !== $this->parser_state &&
			self::STATE_MATCHED_TAG !== $this->parser_state
		) {
			return true;
		}

		if ( $this->is_closing_tag ) {
			$this->skip_whitespace();
		} else {
			// Parse all of its attributes.
			while ( $this->parse_next_attribute() ) {
				continue;
			}
		}

		if ( null !== $this->last_error ) {
			return false;
		}

		if ( self::STATE_INCOMPLETE_INPUT === $this->parser_state ) {
			$this->bytes_already_parsed = $was_at;

			return false;
		}

		// Ensure that the tag closes before the end of the document.
		if ( $this->bytes_already_parsed >= strlen( $this->xml ) ) {
			// Does this appropriately clear state (parsed attributes)?
			$this->mark_incomplete_input( 'Tag attributes were not closed before the end of the document.' );
			$this->bytes_already_parsed = $was_at;

			return false;
		}

		$tag_ends_at = strpos( $this->xml, '>', $this->bytes_already_parsed );
		if ( false === $tag_ends_at ) {
			$this->mark_incomplete_input( 'No > found at the end of a tag.' );
			$this->bytes_already_parsed = $was_at;

			return false;
		}

		if ( $this->is_closing_tag && $tag_ends_at !== $this->bytes_already_parsed ) {
			$this->bail(
				'Invalid closing tag encountered.',
				self::ERROR_SYNTAX
			);

			return false;
		}

		$this->parser_state         = self::STATE_MATCHED_TAG;
		$this->bytes_already_parsed = $tag_ends_at + 1;
		$this->token_length         = $this->bytes_already_parsed - $this->token_starts_at;

		/**
		 * Resolve the namespaces defined in opening tags.
		 */
		if ( ! $this->is_closing_tag ) {
			/**
			 * By default, inherit all namespaces from the parent element.
			 */
			$namespaces = $this->get_tag_namespaces_in_scope();
			foreach ( $this->qualified_attributes as $attribute ) {
				/**
				 * `xmlns` attribute is the default namespace
				 * `xmlns:<prefix>` declares a namespace prefix scoped to the current element and its descendants
				 *
				 * @see https://www.w3.org/TR/2006/REC-xml-names11-20060816/#ns-decl
				 */
				if ( 'xmlns' === $attribute->qualified_name ) {
					$value = $this->get_qualified_attribute( $attribute->qualified_name );
					// Update the default namespace.
					$namespaces[''] = $value;
					continue;
				}

				if ( 'xmlns' === $attribute->namespace_prefix ) {
					$value = $this->get_qualified_attribute( $attribute->qualified_name );

					/**
					 * @see https://www.w3.org/TR/2006/REC-xml-names11-20060816/#xmlReserved
					 */
					if ( 'xml' === $attribute->local_name && 'http://www.w3.org/XML/1998/namespace' !== $value ) {
						$this->bail(
							'The `xml` namespace prefix is by definition bound to the namespace name http://www.w3.org/XML/1998/namespace and must not be overridden.',
							self::ERROR_SYNTAX
						);

						return false;
					}

					/**
					 * @see https://www.w3.org/TR/2006/REC-xml-names11-20060816/#xmlReserved
					 */
					if ( 'xmlns' === $attribute->local_name ) {
						$this->bail( 'The `xmlns` namespace prefix must not be overridden.', self::ERROR_SYNTAX );

						return false;
					}

					/**
					 * The attribute value in a namespace declaration for a prefix MAY be empty.
					 * This has the effect, within the scope of the declaration, of removing any
					 * association of the prefix with a namespace name. Further declarations MAY
					 * re-declare the prefix again.
					 */
					if ( '' === $value ) {
						unset( $namespaces[ $attribute->namespace_prefix ] );
						continue;
					}

					$namespaces[ $attribute->local_name ] = $value;
					continue;
				}
			}

			/**
			 * Confirm the tag name is valid with respect to XML namespaces.
			 *
			 * @see https://www.w3.org/TR/2006/REC-xml-names11-20060816/#Conformance
			 */
			$tag_name = $this->get_tag_name_qualified();
			if ( false === $this->validate_qualified_name( $tag_name ) ) {
				return false;
			}

			list( $tag_namespace_prefix, $tag_local_name ) = $this->parse_qualified_name( $tag_name );

			/**
			 * Validate the element namespace.
			 */
			if ( ! array_key_exists( $tag_namespace_prefix, $namespaces ) ) {
				$this->bail(
					sprintf(
						'Namespace prefix "%s" does not resolve to any namespace in the current element\'s scope.',
						$tag_namespace_prefix
					),
					self::ERROR_SYNTAX
				);
			}

			/**
			 * Compute fully qualified attributes and assert:
			 *
			 * – All attributes have valid namespaces.
			 * – No two attributes have the same (local name, namespace) pair.
			 *
			 * @see https://www.w3.org/TR/2006/REC-xml-names11-20060816/#uniqAttrs
			 */
			$namespaced_attributes = array();
			foreach ( $this->qualified_attributes as $attribute ) {
				list( $attribute_namespace_prefix, $attribute_local_name ) = $this->parse_qualified_name( $attribute->qualified_name );
				if ( ! array_key_exists( $attribute_namespace_prefix, $namespaces ) ) {
					$this->bail(
						sprintf(
							'Attribute "%s" has an invalid namespace prefix "%s".',
							$attribute->qualified_name,
							$attribute_namespace_prefix
						),
						self::ERROR_SYNTAX
					);

					return false;
				}
				$namespace_reference = $attribute_namespace_prefix ? $namespaces[ $attribute_namespace_prefix ] : '';

				/**
				 * It looks supicious but it's safe – $local_name is guaranteed to not contain
				 * curly braces at this point.
				 */
				$attribute_full_name = $namespace_reference ? '{' . $namespace_reference . '}' . $attribute_local_name : $attribute_local_name;
				if ( isset( $namespaced_attributes[ $attribute_full_name ] ) ) {
					$this->bail(
						sprintf(
							'Duplicate attribute "%s" with namespace "%s" found in the same element.',
							$attribute_local_name,
							$namespace_reference
						),
						self::ERROR_SYNTAX
					);

					return false;
				}
				$namespaced_attributes[ $attribute_full_name ] = $attribute;
				$attribute->namespace                          = $namespace_reference;
			}

			// Store attributes with their namespaces and discard the temporary
			// qualified attributes array.
			$this->attributes           = $namespaced_attributes;
			$this->qualified_attributes = array();

			$this->element = new XMLElement( $tag_local_name, $tag_namespace_prefix, $namespaces[ $tag_namespace_prefix ], $namespaces );
			// Closers assume $this->element is the element created for the opener.
			// @see step_in_element.
		}

		/*
		 * Preserve the opening tag pointers, as these will be overwritten
		 * when finding the closing tag. They will be reset after finding
		 * the closing to tag to point to the opening of the special atomic
		 * tag sequence.
		 */
		$tag_name_starts_at = $this->tag_name_starts_at;
		$tag_name_length    = $this->tag_name_length;
		$tag_ends_at        = $this->token_starts_at + $this->token_length;
		$attributes         = $this->qualified_attributes;

		/*
		 * The values here look like they reference the opening tag but they reference
		 * the closing tag instead. This is why the opening tag values were stored
		 * above in a variable. It reads confusingly here, but that's because the
		 * functions that skip the contents have moved all the internal cursors past
		 * the inner content of the tag.
		 */
		$this->token_starts_at      = $was_at;
		$this->token_length         = $this->bytes_already_parsed - $this->token_starts_at;
		$this->text_starts_at       = $tag_ends_at;
		$this->text_length          = $this->tag_name_starts_at - $this->text_starts_at;
		$this->tag_name_starts_at   = $tag_name_starts_at;
		$this->tag_name_length      = $tag_name_length;
		$this->qualified_attributes = $attributes;

		return true;
	}

	private function get_tag_namespaces_in_scope() {
		$top = $this->top_element();
		if ( null === $top ) {
			// Namespaces defined by default in every XML document.
			return $this->document_namespaces;
		}
		return $top->namespaces_in_scope;
	}

	/**
	 * Returns the namespace prefix of the matched tag or, when the $namespace
	 * argument is given, the prefix of the requested fully-qualified namespace .
	 *
	 * Examples:
	 *
	 *     $p = new XMLProcessor( '<wp:content xmlns:xhtml="http://www.w3.org/1999/xhtml">Test</wp:content>' );
	 *     $p->next_tag() === true;
	 *     $p->get_tag_namespace_prefix() === 'xhtml';
	 *
	 *     $p = new XMLProcessor( '
	 *         <wp:content
	 *             xmlns:xhtml="http://www.w3.org/1999/xhtml"
	 *             xmlns:wp="http://wordpress.org/export/1.2/"
	 *         >
	 *             Test
	 *         </wp:content>
	 *     ' );
	 *     $p->next_tag() === true;
	 *     $p->get_tag_namespace_prefix('http://wordpress.org/export/1.2/') === 'wp';
	 *
	 * @internal
	 * @param string|null $xml_namespace Fully-qualified namespace to return the prefix for.
	 * @return string|null The namespace prefix of the matched tag, or null if not available.
	 */
	private function get_tag_namespace_prefix( $xml_namespace = null ) {
		if ( null === $xml_namespace ) {
			if ( self::STATE_MATCHED_TAG !== $this->parser_state ) {
				return null;
			}
			return $this->element->namespace_prefix;
		} else {
			$namespaces_in_scope = $this->get_tag_namespaces_in_scope();
			foreach ( $namespaces_in_scope as $prefix => $uri ) {
				if ( $uri === $xml_namespace ) {
					return $prefix;
				}
			}
			return false;
		}
	}

	/**
	 * Returns the top XMLElement on the stack without removing it.
	 *
	 * @return XMLElement|null Returns the top element, or null if stack is empty.
	 */
	private function top_element() {
		if ( empty( $this->stack_of_open_elements ) ) {
			return null;
		}
		return $this->stack_of_open_elements[ count( $this->stack_of_open_elements ) - 1 ];
	}

	/**
	 * Whether the processor paused because the input XML document ended
	 * in the middle of a syntax element, such as in the middle of a tag.
	 *
	 * Example:
	 *
	 *     $processor = new XMLProcessor( '<input type="text" value="Th' );
	 *     false      === $processor->get_next_tag();
	 *     true       === $processor->is_paused_at_incomplete_token();
	 *
	 * @return bool Whether the parse paused at the start of an incomplete token.
	 * @since WP_VERSION
	 */
	public function is_paused_at_incomplete_input(): bool {
		return self::STATE_INCOMPLETE_INPUT === $this->parser_state;
	}

	/**
	 * Whether the processor finished processing.
	 *
	 * @return bool Whether the processor finished processing.
	 * @since WP_VERSION
	 */
	public function is_finished() {
		return self::STATE_COMPLETE === $this->parser_state;
	}

	/**
	 * Sets a bookmark in the XML document.
	 *
	 * Bookmarks represent specific places or tokens in the XML
	 * document, such as a tag opener or closer. When applying
	 * edits to a document, such as setting an attribute, the
	 * text offsets of that token may shift; the bookmark is
	 * kept updated with those shifts and remains stable unless
	 * the entire span of text in which the token sits is removed.
	 *
	 * Release bookmarks when they are no longer needed.
	 *
	 * Example:
	 *
	 *     <main><h2>Surprising fact you may not know!</h2></main>
	 *           ^  ^
	 *            \-|-- this `H2` opener bookmark tracks the token
	 *
	 *     <main class="clickbait"><h2>Surprising fact you may no…
	 *                             ^  ^
	 *                              \-|-- it shifts with edits
	 *
	 * Bookmarks provide the ability to seek to a previously-scanned
	 * place in the XML document. This avoids the need to re-scan
	 * the entire document.
	 *
	 * Example:
	 *
	 *     <ul><li>One</li><li>Two</li><li>Three</li></ul>
	 *                                 ^^^^
	 *                                 want to note this last item
	 *
	 *     $p = new XMLProcessor( $xml );
	 *     $in_list = false;
	 *     while ( $p->next_tag( array( 'tag_closers' => $in_list ? 'visit' : 'skip' ) ) ) {
	 *         if ( 'UL' === $p->get_qualified_tag() ) {
	 *             if ( $p->is_tag_closer() ) {
	 *                 $in_list = false;
	 *                 $p->set_bookmark( 'resume' );
	 *                 if ( $p->seek( 'last-li' ) ) {
	 *                     $p->add_class( 'last-li' );
	 *                 }
	 *                 $p->seek( 'resume' );
	 *                 $p->release_bookmark( 'last-li' );
	 *                 $p->release_bookmark( 'resume' );
	 *             } else {
	 *                 $in_list = true;
	 *             }
	 *         }
	 *
	 *         if ( 'LI' === $p->get_qualified_tag() ) {
	 *             $p->set_bookmark( 'last-li' );
	 *         }
	 *     }
	 *
	 * Bookmarks intentionally hide the internal string offsets
	 * to which they refer. They are maintained internally as
	 * updates are applied to the XML document and therefore
	 * retain their "position" - the location to which they
	 * originally pointed. The inability to use bookmarks with
	 * functions like `substr` is therefore intentional to guard
	 * against accidentally breaking the XML.
	 *
	 * Because bookmarks allocate memory and require processing
	 * for every applied update, they are limited and require
	 * a name. They should not be created with programmatically-made
	 * names, such as "li_{$index}" with some loop. As a general
	 * rule they should only be created with string-literal names
	 * like "start-of-section" or "last-paragraph".
	 *
	 * Bookmarks are a powerful tool to enable complicated behavior.
	 * Consider double-checking that you need this tool if you are
	 * reaching for it, as inappropriate use could lead to broken
	 * XML structure or unwanted processing overhead.
	 *
	 * @param  string $name  Identifies this particular bookmark.
	 *
	 * @return bool Whether the bookmark was successfully created.
	 * @since WP_VERSION
	 */
	public function set_bookmark( $name ) {
		// It only makes sense to set a bookmark if the parser has paused on a concrete token.
		if (
			self::STATE_COMPLETE === $this->parser_state ||
			self::STATE_INCOMPLETE_INPUT === $this->parser_state
		) {
			return false;
		}

		if ( ! array_key_exists( $name, $this->bookmarks ) && count( $this->bookmarks ) >= static::MAX_BOOKMARKS ) {
			_doing_it_wrong(
				__METHOD__,
				__( 'Too many bookmarks: cannot create any more.' ),
				'WP_VERSION'
			);

			return false;
		}

		$this->bookmarks[ $name ] = new WP_HTML_Span( $this->token_starts_at, $this->token_length );

		return true;
	}


	/**
	 * Removes a bookmark that is no longer needed.
	 *
	 * Releasing a bookmark frees up the small
	 * performance overhead it requires.
	 *
	 * @param  string $name  Name of the bookmark to remove.
	 *
	 * @return bool Whether the bookmark already existed before removal.
	 */
	public function release_bookmark( $name ) {
		if ( ! array_key_exists( $name, $this->bookmarks ) ) {
			return false;
		}

		unset( $this->bookmarks[ $name ] );

		return true;
	}

	/**
	 * Returns the last error, if any.
	 *
	 * Various situations lead to parsing failure but this class will
	 * return `false` in all those cases. To determine why something
	 * failed it's possible to request the last error. This can be
	 * helpful to know to distinguish whether a given tag couldn't
	 * be found or if content in the document caused the processor
	 * to give up and abort processing.
	 *
	 * Example
	 *
	 *     $processor = XMLProcessor::create_fragment( '<content invalid-attr></content>' );
	 *     false === $processor->next_tag();
	 *     XMLProcessor::ERROR_SYNTAX === $processor->get_last_error();
	 *
	 * @return string|null The last error, if one exists, otherwise null.
	 * @see self::ERROR_UNSUPPORTED
	 * @see self::ERROR_EXCEEDED_MAX_BOOKMARKS
	 *
	 * @since WP_VERSION
	 */
	public function get_last_error(): ?string {
		return $this->last_error;
	}

	/**
	 * Finds the next element matching the $query.
	 *
	 * This doesn't currently have a way to represent non-tags and doesn't process
	 * semantic rules for text nodes. For access to the raw tokens consider using
	 * XMLProcessor instead.
	 *
	 * @param  array|string|null $query_or_ns  {
	 *    Optional. Which tag name to find, having which class, etc. Default is to find any tag.
	 *
	 * @type string|null $tag_name Which tag to find, or `null` for "any tag."
	 * @type int|null $match_offset Find the Nth tag matching all search criteria.
	 *                                     1 for "first" tag, 3 for "third," etc.
	 *                                     Defaults to first tag.
	 * @type string[] $breadcrumbs DOM sub-path at which element is found, e.g. `array( 'FIGURE', 'IMG' )`.
	 *                                     May also contain the wildcard `*` which matches a single element, e.g. `array( 'SECTION', '*' )`.
	 * }
	 * @return bool Whether a tag was matched.
	 * @since WP_VERSION
	 */
	public function next_tag( $query_or_ns = null, $null_or_local_name = null ) {
		if ( null === $query_or_ns && null === $null_or_local_name ) {
			while ( $this->step() ) {
				if ( '#tag' !== $this->get_token_type() ) {
					continue;
				}

				if ( ! $this->is_tag_closer() ) {
					return true;
				}
			}

			return false;
		}

		if ( is_string( $query_or_ns ) ) {
			if ( is_string( $null_or_local_name ) ) {
				$query = array( 'breadcrumbs' => array( array( $query_or_ns, $null_or_local_name ) ) );
			} else {
				$query = array( 'breadcrumbs' => array( array( '', $query_or_ns ) ) );
			}
		} else {
			$query = $query_or_ns;
		}

		if ( ! is_array( $query ) ) {
			_doing_it_wrong(
				__METHOD__,
				__( 'Please pass a query array to this function.' ),
				'WP_VERSION'
			);

			return false;
		}

		if ( array( 0, 1 ) === array_keys( $query ) && is_string( $query[0] ) && is_string( $query[1] ) ) {
			$query = array( 'breadcrumbs' => array( $query ) );
		}

		if ( ! ( array_key_exists( 'breadcrumbs', $query ) && is_array( $query['breadcrumbs'] ) ) ) {
			while ( $this->step() ) {
				if ( '#tag' !== $this->get_token_type() ) {
					continue;
				}

				if ( ! $this->is_tag_closer() ) {
					return true;
				}
			}

			return false;
		}

		if ( isset( $query['tag_closers'] ) && 'visit' === $query['tag_closers'] ) {
			_doing_it_wrong(
				__METHOD__,
				__( 'Cannot visit tag closers in XML Processor.' ),
				'WP_VERSION'
			);

			return false;
		}

		$namespaced_breadcrumbs = array();
		foreach ( $query['breadcrumbs'] as $breadcrumb ) {
			if ( is_array( $breadcrumb ) && 2 === count( $breadcrumb ) ) {
				$namespaced_breadcrumbs[] = $breadcrumb;
			} elseif ( is_string( $breadcrumb ) ) {
				$namespaced_breadcrumbs[] = array( '', $breadcrumb );
			} else {
				_doing_it_wrong(
					__METHOD__,
					__( 'Breadcrumbs must be an array of strings or two-tuples of (namespace, local name).' ),
					'WP_VERSION'
				);
			}
		}
		$breadcrumbs  = $namespaced_breadcrumbs;
		$match_offset = isset( $query['match_offset'] ) ? (int) $query['match_offset'] : 1;

		while ( $match_offset > 0 && $this->step() ) {
			if ( '#tag' !== $this->get_token_type() ) {
				continue;
			}

			if ( $this->matches_breadcrumbs( $breadcrumbs ) && 0 === --$match_offset ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Parses the next tag.
	 *
	 * This will find and start parsing the next tag, including
	 * the opening `<`, the potential closer `/`, and the tag
	 * name. It does not parse the attributes or scan to the
	 * closing `>`; these are left for other methods.
	 *
	 * @return bool Whether a tag was found before the end of the document.
	 * @since WP_VERSION
	 */
	private function parse_next_tag() {
		$this->after_tag();

		$xml        = $this->xml;
		$doc_length = strlen( $xml );
		$was_at     = $this->bytes_already_parsed;
		$at         = $was_at;

		while ( false !== $at && $at < $doc_length ) {
			$at = strpos( $xml, '<', $at );
			if ( false === $at ) {
				break;
			}

			if ( $at > $was_at ) {
				$this->parser_state         = self::STATE_TEXT_NODE;
				$this->token_starts_at      = $was_at;
				$this->token_length         = $at - $was_at;
				$this->text_starts_at       = $was_at;
				$this->text_length          = $this->token_length;
				$this->bytes_already_parsed = $at;

				return true;
			}

			$this->token_starts_at = $at;

			if ( $at + 1 < $doc_length && '/' === $this->xml[ $at + 1 ] ) {
				$this->is_closing_tag = true;
				++$at;
			} else {
				$this->is_closing_tag = false;
			}

			if ( $at + 1 >= $doc_length ) {
				$this->mark_incomplete_input();

				return false;
			}

			/*
			 * XML tag names are defined by the same `Name` grammar rule as attribute
			 * names.
			 *
			 * Reference:
			 * – https://www.w3.org/TR/xml/#NT-STag
			 * – https://www.w3.org/TR/xml/#NT-Name
			 */
			$tag_name_length = $this->parse_name( $at + 1 );
			if ( false === $tag_name_length ) {
				return false;
			}

			if ( $tag_name_length > 0 ) {
				++$at;
				$this->parser_state         = self::STATE_MATCHED_TAG;
				$this->tag_name_starts_at   = $at;
				$this->tag_name_length      = $tag_name_length;
				$this->token_length         = $this->tag_name_length;
				$this->bytes_already_parsed = $at + $this->tag_name_length;

				return true;
			}

			/*
			 * Abort if no tag is found before the end of
			 * the document. There is nothing left to parse.
			 */
			if ( $at + 1 >= $doc_length ) {
				$this->mark_incomplete_input( 'No more tags found before the end of the document.' );

				return false;
			}

			/*
			 * `<!` indicates one of a few possible constructs:
			 */
			if ( ! $this->is_closing_tag && '!' === $xml[ $at + 1 ] ) {
				/*
				 * `<!--` mark a beginning of a comment.
				 * https://www.w3.org/TR/xml/#sec-comments
				 */
				if (
					$doc_length > $at + 3 &&
					'-' === $xml[ $at + 2 ] &&
					'-' === $xml[ $at + 3 ]
				) {
					$closer_at = $at + 4;
					// If it's not possible to close the comment then there is nothing more to scan.
					if ( $doc_length <= $closer_at ) {
						$this->mark_incomplete_input( 'The document ends with a comment opener.' );

						return false;
					}

					/*
					 * Comments may only be closed by a --> sequence.
					 */
					--$closer_at; // Pre-increment inside condition below reduces risk of accidental infinite looping.
					while ( ++$closer_at < $doc_length ) {
						$closer_at = strpos( $xml, '--', $closer_at );
						if ( false === $closer_at || $closer_at + 2 === $doc_length ) {
							$this->mark_incomplete_input( 'Unclosed comment.' );

							return false;
						}

						/*
						 * The string " -- " (double-hyphen) must not occur within comments
						 * See https://www.w3.org/TR/xml/#sec-comments
						 */
						if ( '>' !== $xml[ $closer_at + 2 ] ) {
							$this->bail( 'Invalid comment syntax', self::ERROR_SYNTAX );
						}

						$this->parser_state         = self::STATE_COMMENT;
						$this->token_length         = $closer_at + 3 - $this->token_starts_at;
						$this->text_starts_at       = $this->token_starts_at + 4;
						$this->text_length          = $closer_at - $this->text_starts_at;
						$this->bytes_already_parsed = $closer_at + 3;

						return true;
					}
				}

				/*
				 * Identify CDATA sections.
				 *
				 * Within a CDATA section, everything until the ]]> string is treated
				 * as data, not markup. Left angle brackets and ampersands may occur in
				 * their literal form; they need not (and cannot) be escaped using "&lt;"
				 * and "&amp;". CDATA sections cannot nest.
				 *
				 * See https://www.w3.org/TR/xml11.xml/#sec-cdata-sect
				 */
				if (
					$doc_length > $this->token_starts_at + 8 &&
					'[' === $xml[ $this->token_starts_at + 2 ] &&
					'C' === $xml[ $this->token_starts_at + 3 ] &&
					'D' === $xml[ $this->token_starts_at + 4 ] &&
					'A' === $xml[ $this->token_starts_at + 5 ] &&
					'T' === $xml[ $this->token_starts_at + 6 ] &&
					'A' === $xml[ $this->token_starts_at + 7 ] &&
					'[' === $xml[ $this->token_starts_at + 8 ]
				) {
					$closer_at = strpos( $xml, ']]>', $at + 1 );
					if ( false === $closer_at ) {
						$this->mark_incomplete_input( 'Unclosed CDATA section' );

						return false;
					}

					$this->parser_state         = self::STATE_CDATA_NODE;
					$this->token_length         = $closer_at + 1 - $this->token_starts_at;
					$this->text_starts_at       = $this->token_starts_at + 9;
					$this->text_length          = $closer_at - $this->text_starts_at;
					$this->bytes_already_parsed = $closer_at + 3;

					return true;
				}

				/*
				 * Identify DOCTYPE nodes.
				 *
				 * doctypedecl     ::=      '<!DOCTYPE' S Name (S ExternalID)? S? ('[' intSubset ']' S?)? '>'
				 * ExternalID      ::=      'SYSTEM' S SystemLiteral | 'PUBLIC' S PubidLiteral S SystemLiteral
				 * SystemLiteral   ::=      ('"' [^"]* '"') | ("'" [^']* "'")
				 * PubidLiteral    ::=      '"' PubidChar* '"' | "'" (PubidChar - "'")* "'"
				 * PubidChar       ::=      #x20 | #xD | #xA | [a-zA-Z0-9] | [-'()+,./:=?;!*#@$_%]
				 * See https://www.w3.org/TR/xml11.html/#dtd
				 */
				if (
					$doc_length > $this->token_starts_at + 8 &&
					'D' === $xml[ $at + 2 ] &&
					'O' === $xml[ $at + 3 ] &&
					'C' === $xml[ $at + 4 ] &&
					'T' === $xml[ $at + 5 ] &&
					'Y' === $xml[ $at + 6 ] &&
					'P' === $xml[ $at + 7 ] &&
					'E' === $xml[ $at + 8 ]
				) {
					$at += 9;
					// Skip whitespace.
					$at += strspn( $this->xml, " \t\f\r\n", $at );

					if ( $doc_length <= $at ) {
						$this->mark_incomplete_input( 'Unclosed DOCTYPE declaration.' );

						return false;
					}

					// @TODO: Expose the "name" value instead of skipping it like that.
					$name_length = $this->parse_name( $at );
					if ( false === $name_length ) {
						$this->mark_incomplete_input( 'Unclosed DOCTYPE declaration.' );

						return false;
					}
					$this->doctype_name = new WP_HTML_Span(
						$at,
						$name_length
					);
					$at                += $name_length;

					// Skip whitespace.
					$at += strspn( $this->xml, " \t\f\r\n", $at );

					if ( $doc_length <= $at ) {
						$this->mark_incomplete_input( 'Unclosed DOCTYPE declaration.' );

						return false;
					}

					// Check for SYSTEM or PUBLIC identifiers.
					if (
						$doc_length > $at + 6 &&
						'S' === $this->xml[ $at ] &&
						'Y' === $this->xml[ $at + 1 ] &&
						'S' === $this->xml[ $at + 2 ] &&
						'T' === $this->xml[ $at + 3 ] &&
						'E' === $this->xml[ $at + 4 ] &&
						'M' === $this->xml[ $at + 5 ]
					) {
						$at += 6;
						// Skip whitespace.
						$at += strspn( $this->xml, " \t\f\r\n", $at );

						// Parse the SystemLiteral token.
						$quoted_string_length = $this->parse_quoted_string( $at );
						if ( self::STATE_INCOMPLETE_INPUT === $this->parser_state ) {
							$this->mark_incomplete_input( 'Unclosed SYSTEM literal.' );

							return false;
						}

						$this->system_literal = new WP_HTML_Span(
						// Start after the opening quote.
							$at + 1,
							// Exclude the closing quote.
							$quoted_string_length - 2
						);
						$at += $quoted_string_length;
					} elseif (
						$doc_length > $at + 6 &&
						'P' === $this->xml[ $at ] &&
						'U' === $this->xml[ $at + 1 ] &&
						'B' === $this->xml[ $at + 2 ] &&
						'L' === $this->xml[ $at + 3 ] &&
						'I' === $this->xml[ $at + 4 ] &&
						'C' === $this->xml[ $at + 5 ]
					) {
						$at += 6;
						// Skip whitespace.
						$at += strspn( $this->xml, " \t\f\r\n", $at );

						/*
						 * PubidLiteral    ::=  '"' PubidChar* '"' | "'" (PubidChar - "'")* "'"
						 * PubidChar       ::=  #x20 | #xD | #xA | [a-zA-Z0-9] | [-'()+,./:=?;!*#@$_%]
						 */
						$opening_quote_char = $this->xml[ $at ];
						if ( "'" !== $opening_quote_char && '"' !== $opening_quote_char ) {
							$this->bail( 'Unsupported DOCTYPE syntax. PUBLIC identifiers must be enclosed in double quotes.' );

							return false;
						}

						$pubid_char = " \r\nabcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-()+,./:=?;!*#@\$_%";
						if ( "'" === $opening_quote_char ) {
							$pubid_char .= "'";
						}
						$pubid_literal_length = strspn( $this->xml, $pubid_char, $at + 1 );
						$this->pubid_literal  = new WP_HTML_Span(
							$at + 1,
							$pubid_literal_length
						);
						$at                  += $pubid_literal_length + 2;

						// Skip whitespace.
						$at += strspn( $this->xml, " \t\f\r\n", $at );

						// Parse the SystemLiteral token.
						$quoted_string_length = $this->parse_quoted_string( $at );
						if ( self::STATE_INCOMPLETE_INPUT === $this->parser_state ) {
							$this->mark_incomplete_input( 'Unclosed SYSTEM literal.' );

							return false;
						}

						$this->system_literal = new WP_HTML_Span(
						// Start after the opening quote.
							$at + 1,
							// Exclude the closing quote.
							$quoted_string_length - 2
						);
						$at += $quoted_string_length;
					} elseif ( '[' === $this->xml[ $at ] ) {
						$this->bail( 'Inline entity declarations are not yet supported in DOCTYPE declarations.', self::ERROR_SYNTAX );
					}

					// Skip whitespace.
					$at += strspn( $this->xml, " \t\f\r\n", $at );

					if ( '>' !== $this->xml[ $at ] ) {
						$this->bail(
							sprintf(
								'Syntax error in DOCTYPE declaration. Unexpected character "%s" at position %d.',
								$this->xml[ $at ],
								$at
							),
							self::ERROR_SYNTAX
						);
					}

					$closer_at                  = $at;
					$this->parser_state         = self::STATE_DOCTYPE_NODE;
					$this->token_length         = $closer_at + 1 - $this->token_starts_at;
					$this->bytes_already_parsed = $closer_at + 1;

					return true;
				}

				/*
				 * Anything else here is either unsupported at this point or invalid
				 * syntax. See the class-level @TODO annotations for more information.
				 */
				$this->mark_incomplete_input( 'Unsupported <! syntax.' );

				return false;
			}

			/*
			 * An `<?xml` token at the beginning of the document marks a start of an
			 * xml declaration.
			 * See https://www.w3.org/TR/xml/#sec-prolog-dtd
			 */
			if (
				0 === $at &&
				0 === $this->upstream_bytes_forgotten &&
				! $this->is_closing_tag &&
				'?' === $xml[ $at + 1 ] &&
				'x' === $xml[ $at + 2 ] &&
				'm' === $xml[ $at + 3 ] &&
				'l' === $xml[ $at + 4 ]
			) {
				// Setting the parser state early for the get_attribute_by_qualified_name() calls later in this
				// branch.
				$this->parser_state = self::STATE_XML_DECLARATION;

				$at += 5;

				// Skip whitespace.
				$at += strspn( $this->xml, " \t\f\r\n", $at );

				$this->bytes_already_parsed = $at;

				/*
				 * Reuse parse_next_attribute() to parse the XML declaration attributes.
				 * Technically, only "version", "encoding", and "standalone" are accepted
				 * and, unlike regular tag attributes, their values can contain any character
				 * other than the opening quote. However, the "<" and "&" characters are very
				 * unlikely to be encountered and cause trouble, so this code path liberally
				 * does not provide a dedicated parsing logic.
				 */
				while ( false !== $this->parse_next_attribute() ) {
					$this->skip_whitespace();
					// Parse until the XML declaration closer.
					if ( '?' === $xml[ $this->bytes_already_parsed ] ) {
						break;
					}
				}

				if ( null !== $this->last_error ) {
					return false;
				}

				foreach ( $this->qualified_attributes as $name => $attribute ) {
					if ( 'version' !== $name && 'encoding' !== $name && 'standalone' !== $name ) {
						$this->bail( 'Invalid attribute found in XML declaration.', self::ERROR_SYNTAX );
						return false;
					}
				}

				if ( '1.0' !== $this->get_qualified_attribute( 'version' ) ) {
					$this->bail( 'Unsupported XML version declared', self::ERROR_UNSUPPORTED );
					return false;
				}

				/**
				 * Standalone XML documents have no external dependencies,
				 * including predefined entities like `&nbsp;` and `&copy;`.
				 *
				 * See https://www.w3.org/TR/xml/#sec-predefined-ent.
				 */
				if ( null !== $this->get_qualified_attribute( 'encoding' )
					&& 'UTF-8' !== strtoupper( $this->get_qualified_attribute( 'encoding' ) )
				) {
					$this->bail( 'Unsupported XML encoding declared, only UTF-8 is supported.', self::ERROR_UNSUPPORTED );
					return false;
				}

				if ( null !== $this->get_qualified_attribute( 'standalone' )
					&& 'YES' !== strtoupper( $this->get_qualified_attribute( 'standalone' ) )
				) {
					$this->bail( 'Standalone XML documents are not supported.', self::ERROR_UNSUPPORTED );
					return false;
				}

				$at = $this->bytes_already_parsed;

				// Skip whitespace.
				$at += strspn( $this->xml, " \t\f\r\n", $at );

				// Consume the closer.
				if ( ! (
					$at + 2 <= $doc_length &&
					'?' === $xml[ $at ] &&
					'>' === $xml[ $at + 1 ]
				) ) {
					$this->bail( 'XML declaration closer not found.', self::ERROR_SYNTAX );
					return false;
				}

				$this->token_length         = $at + 2 - $this->token_starts_at;
				$this->text_starts_at       = $this->token_starts_at + 2;
				$this->text_length          = $at - $this->text_starts_at;
				$this->bytes_already_parsed = $at + 2;
				$this->parser_state         = self::STATE_XML_DECLARATION;

				// Processing instructions don't have namespaces. We can just
				// copy the qualified attributes to the attributes array without
				// resolving anything.
				$this->attributes           = $this->qualified_attributes;
				$this->qualified_attributes = array();

				return true;
			}

			/*
			 * `<?` denotes a processing instruction.
			 * See https://www.w3.org/TR/xml/#sec-pi
			 */
			if (
				! $this->is_closing_tag &&
				'?' === $xml[ $at + 1 ]
			) {
				if ( $at + 4 >= $doc_length ) {
					$this->mark_incomplete_input();

					return false;
				}

				if ( ! (
					( 'x' === $xml[ $at + 2 ] || 'X' === $xml[ $at + 2 ] ) &&
					( 'm' === $xml[ $at + 3 ] || 'M' === $xml[ $at + 3 ] ) &&
					( 'l' === $xml[ $at + 4 ] || 'L' === $xml[ $at + 4 ] )
				) ) {
					$this->bail( 'Invalid processing instruction target.', self::ERROR_SYNTAX );
				}

				$at += 5;

				// Skip whitespace.
				$this->skip_whitespace();

				/*
				 * Find the closer.
				 *
				 * We could, at this point, only consume the bytes allowed by the specification, that is:
				 *
				 * [2] Char ::= #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF] // any Unicode character, excluding the surrogate blocks, FFFE, and FFFF.
				 *
				 * However, that would require running a slow regular-expression engine for, seemingly,
				 * little benefit. For now, we are going to pretend that all bytes are allowed until the
				 * closing ?> is found. Some failures may pass unnoticed. That may not be a problem in practice,
				 * but if it is then this code path will require a stricter implementation.
				 */
				$closer_at = strpos( $xml, '?>', $at );
				if ( false === $closer_at ) {
					$this->mark_incomplete_input();

					return false;
				}

				$this->parser_state         = self::STATE_PI_NODE;
				$this->token_length         = $closer_at + 5 - $this->token_starts_at;
				$this->text_starts_at       = $this->token_starts_at + 5;
				$this->text_length          = $closer_at - $this->text_starts_at;
				$this->bytes_already_parsed = $closer_at + 2;

				return true;
			}

			++$at;
		}

		// There's no more tag openers and we're not expecting more data –
		// this mist be a trailing text node.
		if ( ! $this->expecting_more_input ) {
			$this->parser_state         = self::STATE_TEXT_NODE;
			$this->token_starts_at      = $was_at;
			$this->token_length         = $doc_length - $was_at;
			$this->text_starts_at       = $was_at;
			$this->text_length          = $doc_length - $was_at;
			$this->bytes_already_parsed = $doc_length;

			return true;
		}

		/*
		 * This does not imply an incomplete parse; it indicates that there
		 * can be nothing left in the document other than a #text node.
		 */
		$this->mark_incomplete_input();
		$this->token_starts_at = $was_at;
		$this->token_length    = $doc_length - $was_at;
		$this->text_starts_at  = $was_at;
		$this->text_length     = $doc_length - $was_at;

		return false;
	}

	/**
	 * Parses the next attribute.
	 *
	 * @return bool Whether an attribute was found before the end of the document.
	 * @since WP_VERSION
	 */
	private function parse_next_attribute() {
		// Skip whitespace and slashes.
		$this->bytes_already_parsed += strspn( $this->xml, " \t\f\r\n/", $this->bytes_already_parsed );
		if ( $this->bytes_already_parsed >= strlen( $this->xml ) ) {
			$this->mark_incomplete_input();

			return false;
		}

		// No more attributes to parse.
		if ( '>' === $this->xml[ $this->bytes_already_parsed ] ) {
			return false;
		}

		$attribute_start        = $this->bytes_already_parsed;
		$attribute_qname_length = $this->parse_name( $this->bytes_already_parsed );
		if ( 0 === $attribute_qname_length ) {
			$this->bail( 'Invalid attribute name encountered.', self::ERROR_SYNTAX );
		}
		$this->bytes_already_parsed += $attribute_qname_length;
		$attribute_qname             = substr( $this->xml, $attribute_start, $attribute_qname_length );
		$this->skip_whitespace();

		// Parse attribute value.
		++$this->bytes_already_parsed;
		$this->skip_whitespace();
		if ( $this->bytes_already_parsed >= strlen( $this->xml ) ) {
			$this->mark_incomplete_input();

			return false;
		}
		switch ( $this->xml[ $this->bytes_already_parsed ] ) {
			case "'":
			case '"':
				$quote       = $this->xml[ $this->bytes_already_parsed ];
				$value_start = $this->bytes_already_parsed + 1;
				/**
				 * XML attributes cannot contain the characters "<" or "&".
				 *
				 * This only checks for "<" because it's reasonably fast.
				 * Ampersands are actually allowed when used as the start
				 * of an entity reference, but enforcing that would require
				 * an expensive and complex check. It doesn't seem to be
				 * worth it.
				 *
				 * @TODO: Discuss enforcing or abandoning the ampersand rule
				 *        and document the rationale.
				 */
				$value_length  = strcspn( $this->xml, "<$quote", $value_start );
				$attribute_end = $value_start + $value_length + 1;

				if ( $attribute_end - 1 >= strlen( $this->xml ) ) {
					$this->mark_incomplete_input();

					return false;
				}

				if ( $this->xml[ $attribute_end - 1 ] !== $quote ) {
					$this->bail( 'A disallowed character encountered in an attribute value (either < or &).', self::ERROR_SYNTAX );
				}
				$this->bytes_already_parsed = $attribute_end;
				break;

			default:
				$this->bail( 'Unquoted attribute value encountered.', self::ERROR_SYNTAX );
		}

		if ( $attribute_end >= strlen( $this->xml ) ) {
			$this->mark_incomplete_input();

			return false;
		}

		if ( $this->is_closing_tag ) {
			return true;
		}

		if ( array_key_exists( $attribute_qname, $this->qualified_attributes ) ) {
			$this->bail( 'Duplicate attribute found in an XML tag.', self::ERROR_SYNTAX );
		}

		/**
		 * Confirm the tag name is valid with respect to XML namespaces.
		 *
		 * @see https://www.w3.org/TR/2006/REC-xml-names11-20060816/#Conformance
		 */
		if ( false === $this->validate_qualified_name( $attribute_qname ) ) {
			return false;
		}

		/**
		 * We must compute the namespace prefix and local name for each attribute
		 * to assert there are no duplicate (local name, namespace) pairs in any
		 * element. Note we must still keep track of string indices to support
		 * replacements.
		 */
		list( $namespace_prefix, $local_name ) = $this->parse_qualified_name( $attribute_qname );

		$this->qualified_attributes[ $attribute_qname ] = new XMLAttributeToken(
			$value_start,
			$value_length,
			$attribute_start,
			$attribute_end - $attribute_start,
			$namespace_prefix,
			$local_name
			/**
			* The full namespace is resolved in parse_next_token() once
			* all the attributes have been consumed.
			*/
		);

		return true;
	}

	private function parse_quoted_string( $at = null ) {
		if ( null === $at ) {
			$at = $this->bytes_already_parsed;
		}

		$quote = $this->xml[ $at ];
		if ( "'" !== $quote && '"' !== $quote ) {
			$this->bail( 'Invalid quote character encountered in an attribute value.', self::ERROR_SYNTAX );
		}
		$value_length = strcspn( $this->xml, $quote, $at + 1 );
		if ( $at + $value_length + 1 >= strlen( $this->xml ) ) {
			$this->mark_incomplete_input();

			return false;
		}

		if ( $this->xml[ $at + $value_length + 1 ] !== $quote ) {
			$this->bail( 'A disallowed character encountered in an attribute value (either < or &).', self::ERROR_SYNTAX );
		}

		return $value_length + 2;
	}

	/**
	 * Move the internal cursor past any immediate successive whitespace.
	 *
	 * @since WP_VERSION
	 */
	private function skip_whitespace() {
		$this->bytes_already_parsed += strspn( $this->xml, " \t\f\r\n", $this->bytes_already_parsed );
	}

	/**
	 * Parses a Name token starting at $offset
	 *
	 * Name ::= NameStartChar (NameChar)*
	 *
	 * @param  int $offset
	 *
	 * @return int
	 */
	private function parse_name( $offset ) {
		$name_byte_length = 0;
		$at               = $offset;

		// Fast path: consume any ASCII NameStartChar bytes.
		$name_byte_length += strspn(
			$this->xml,
			':ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz',
			$offset + $name_byte_length,
			1
		);

		while ( true ) {
			/**
			 * Parse the next unicode codepoint.
			 *
			 * We use a the `_wp_scan_utf8` UTF-8 decoder introduced in WordPress 6.9. No other method
			 * is reliable and available enough to depend on it in WordPress core:
			 *
			 * – mb_ord() – is available on 99.5%+ or more of hosts, but not on all hosts.
			 * – iconv_substr() – is not available on all hosts.
			 * – preg_match() – can fail with PREG_BAD_UTF8_ERROR when the input
			 *                  contains an incomplete UTF-8 byte sequence – even
			 *                  when that sequence comes after a valid match. This
			 *                  failure mode cannot be reproduced with just any string.
			 *                  The runtime must be in a specific state. It's unclear
			 *                  how to reliably reproduce this failure mode in a
			 *                  unit test.
			 *
			 * Performance-wise, character-by-character processing via _wp_scan_utf8
			 * is pretty slow. The ASCII fast path below enables skipping most of the
			 * UTF-8 decoder calls.
			 *
			 * If the UTF-8 decoder performance ever becomes a bottleneck, there are a
			 * few ways to significantly improve it:
			 *
			 * – Call a native grapheme_ function when available.
			 * – Introduce a custom UTF-8 decoder optimized for codepoint-by-codepoint processing.
			 *   It could be the streaming version of the UTF-8 decoder, such as `_wp_iterate_utf8`,
			 *   that avoids the repeated strspn() calls. Alternatively, the older `utf8_codepoint_at`
			 *   function could be restored if its codepoint-by-codepoint decoding performance is
			 *   better than the _wp_scan_utf8.
			 */

			/**
			 * The ASCII speedup includes all ASCII NameStartChar, which are also valid
			 * NameChar, making it possible to quickly scan past these bytes without
			 * further processing.
			 */
			$name_byte_length += strspn( $this->xml, ":ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-.0123456789\u{B7}", $offset + $name_byte_length );

			/*
			 * Quickly check if the next byte is an ASCII byte that is not allowed in XML
			 * NameStartChar. If so, we can break out of the loop without calling the UTF-8 decoder.
			 *
			 * Even though this does not seem to be different from the ASCII fast path in the
			 * _wp_scan_utf8 function, skipping that function call still provides a ~50% speed
			 * improvement.
			 */
			$is_non_name_ascii_byte = strspn(
				$this->xml,
				"\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f" .
				"\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f" .
				" !\"#$%&'()*+,./;<=>?@[\\]^`{|}~\x7f",
				$offset + $name_byte_length,
				1
			) > 0;
			if ( $is_non_name_ascii_byte ) {
				break;
			}

			// EOF.
			if ( $offset + $name_byte_length >= strlen( $this->xml ) ) {
				break;
			}

			// The next byte sequence is, very likely, a UTF-8 codepoint. Let's
			// try to decode it.
			$at             = $offset + $name_byte_length;
			$new_at         = $at;
			$invalid_length = 0;
			if ( 1 !== _wp_scan_utf8( $this->xml, $new_at, $invalid_length, null, 1 ) ) {
				// EOF or invalid utf-8 byte sequence.
				break;
			}

			$codepoint_byte_length = $new_at - $at;
			$codepoint             = utf8_ord( substr( $this->xml, $at, $codepoint_byte_length ) );

			// The codepoint is not a valid part of an XML NameChar or NameStartChar.
			if ( ! $this->is_valid_name_codepoint( $codepoint, 0 === $name_byte_length ) ) {
				break;
			}
			$name_byte_length += $codepoint_byte_length;
			$at                = $new_at;
		}

		return $name_byte_length;
	}

	private function is_valid_name_codepoint( $codepoint, $is_first_character = false ) {
		// Test against the NameStartChar pattern:
		// NameStartChar ::= ":" | [A-Z] | "_" | [a-z] | [#xC0-#xD6] | [#xD8-#xF6] | [#xF8-#x2FF] | [#x370-#x37D] | [#x37F-#x1FFF] | [#x200C-#x200D] | [#x2070-#x218F] | [#x2C00-#x2FEF] | [#x3001-#xD7FF] | [#xF900-#xFDCF] | [#xFDF0-#xFFFD] | [#x10000-#xEFFFF]
		// See `https://www.w3.org/TR/xml/#NT-Name`.
		if (
			// :.
			( 0x3A <= $codepoint && $codepoint <= 0x3A ) ||
			// _.
			( 0x5F <= $codepoint && $codepoint <= 0x5F ) ||
			// A-Z.
			( 0x41 <= $codepoint && $codepoint <= 0x5A ) ||
			// a-z.
			( 0x61 <= $codepoint && $codepoint <= 0x7A ) ||
			// [#xC0-#xD6].
			( 0xC0 <= $codepoint && $codepoint <= 0xD6 ) ||
			// [#xD8-#xF6].
			( 0xD8 <= $codepoint && $codepoint <= 0xF6 ) ||
			// [#xF8-#x2FF].
			( 0xF8 <= $codepoint && $codepoint <= 0x2FF ) ||
			// [#x370-#x37D].
			( 0x370 <= $codepoint && $codepoint <= 0x37D ) ||
			// [#x37F-#x1FFF].
			( 0x37F <= $codepoint && $codepoint <= 0x1FFF ) ||
			// [#x200C-#x200D].
			( 0x200C <= $codepoint && $codepoint <= 0x200D ) ||
			// [#x2070-#x218F].
			( 0x2070 <= $codepoint && $codepoint <= 0x218F ) ||
			// [#x2C00-#x2FEF].
			( 0x2C00 <= $codepoint && $codepoint <= 0x2FEF ) ||
			// [#x3001-#xD7FF].
			( 0x3001 <= $codepoint && $codepoint <= 0xD7FF ) ||
			// [#xF900-#xFDCF].
			( 0xF900 <= $codepoint && $codepoint <= 0xFDCF ) ||
			// [#xFDF0-#xFFFD].
			( 0xFDF0 <= $codepoint && $codepoint <= 0xFFFD ) ||
			// [#x10000-#xEFFFF].
			( 0x10000 <= $codepoint && $codepoint <= 0xEFFFF )
		) {
			return true;
		}
		if ( $is_first_character ) {
			return false;
		}

		// Test against the NameChar pattern:
		// NameChar ::= NameStartChar | "-" | "." | [0-9] | #xB7 | [#x0300-#x036F] | [#x203F-#x2040]
		// See `https://www.w3.org/TR/xml/#NT-Name`.
		return (
			// "-".
			45 === $codepoint ||
			// ".".
			46 === $codepoint ||
			// [0-9].
			( 48 <= $codepoint && 57 >= $codepoint ) ||
			// #xB7.
			183 === $codepoint ||
			// [#x0300-#x036F].
			( 0x0300 <= $codepoint && $codepoint <= 0x036F ) ||
			// [#x203F-#x2040].
			( 0x203F <= $codepoint && $codepoint <= 0x2040 )
		);
	}

	/**
	 * Applies attribute updates and cleans up once a tag is fully parsed.
	 *
	 * @since WP_VERSION
	 */
	private function after_tag() {
		/*
		 * Purge updates if there are too many. The actual count isn't
		 * scientific, but a few values from 100 to a few thousand were
		 * tests to find a practically-useful limit.
		 *
		 * If the update queue grows too big, then the Tag Processor
		 * will spend more time iterating through them and lose the
		 * efficiency gains of deferring applying them.
		 */
		if ( 1000 < count( $this->lexical_updates ) ) {
			$this->get_updated_xml();
		}

		foreach ( $this->lexical_updates as $name => $update ) {
			/*
			 * Any updates appearing after the cursor should be applied
			 * before proceeding, otherwise they may be overlooked.
			 */
			if ( $update->start >= $this->bytes_already_parsed ) {
				$this->get_updated_xml();
				break;
			}

			if ( is_int( $name ) ) {
				continue;
			}

			$this->lexical_updates[] = $update;
			unset( $this->lexical_updates[ $name ] );
		}

		$this->element              = null;
		$this->token_starts_at      = null;
		$this->token_length         = null;
		$this->tag_name_starts_at   = null;
		$this->tag_name_length      = null;
		$this->text_starts_at       = null;
		$this->text_length          = null;
		$this->is_closing_tag       = null;
		$this->pubid_literal        = null;
		$this->system_literal       = null;
		$this->attributes           = array();
		$this->qualified_attributes = array();
	}

	/**
	 * Applies lexical updates to XML document.
	 *
	 * @param  int $shift_this_point  Accumulate and return shift for this position.
	 *
	 * @return int How many bytes the given pointer moved in response to the updates.
	 * @since WP_VERSION
	 */
	private function apply_lexical_updates( $shift_this_point = 0 ) {
		if ( ! count( $this->lexical_updates ) ) {
			return 0;
		}

		$accumulated_shift_for_given_point = 0;

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
		usort( $this->lexical_updates, array( self::class, 'sort_start_ascending' ) );

		$bytes_already_copied = 0;
		$output_buffer        = '';
		foreach ( $this->lexical_updates as $diff ) {
			$shift = strlen( $diff->text ) - $diff->length;

			// Adjust the cursor position by however much an update affects it.
			if ( $diff->start < $this->bytes_already_parsed ) {
				$this->bytes_already_parsed += $shift;
			}

			// Accumulate shift of the given pointer within this function call.
			if ( $diff->start <= $shift_this_point ) {
				$accumulated_shift_for_given_point += $shift;
			}

			$output_buffer       .= substr( $this->xml, $bytes_already_copied, $diff->start - $bytes_already_copied );
			$output_buffer       .= $diff->text;
			$bytes_already_copied = $diff->start + $diff->length;
		}

		$this->xml = $output_buffer . substr( $this->xml, $bytes_already_copied );

		/*
		 * Adjust bookmark locations to account for how the text
		 * replacements adjust offsets in the input document.
		 */
		foreach ( $this->bookmarks as $bookmark_name => $bookmark ) {
			$bookmark_end = $bookmark->start + $bookmark->length;

			/*
			 * Each lexical update which appears before the bookmark's endpoints
			 * might shift the offsets for those endpoints. Loop through each change
			 * and accumulate the total shift for each bookmark, then apply that
			 * shift after tallying the full delta.
			 */
			$head_delta = 0;
			$tail_delta = 0;

			foreach ( $this->lexical_updates as $diff ) {
				$diff_end = $diff->start + $diff->length;

				if ( $bookmark->start < $diff->start && $bookmark_end < $diff->start ) {
					break;
				}

				if ( $bookmark->start >= $diff->start && $bookmark_end < $diff_end ) {
					$this->release_bookmark( $bookmark_name );
					continue 2;
				}

				$delta = strlen( $diff->text ) - $diff->length;

				if ( $bookmark->start >= $diff->start ) {
					$head_delta += $delta;
				}

				if ( $bookmark_end >= $diff_end ) {
					$tail_delta += $delta;
				}
			}

			$bookmark->start  += $head_delta;
			$bookmark->length += $tail_delta - $head_delta;
		}

		$this->lexical_updates = array();

		return $accumulated_shift_for_given_point;
	}

	/**
	 * Checks whether a bookmark with the given name exists.
	 *
	 * @param  string $bookmark_name  Name to identify a bookmark that potentially exists.
	 *
	 * @return bool Whether that bookmark exists.
	 * @since WP_VERSION
	 */
	public function has_bookmark( $bookmark_name ) {
		return array_key_exists( $bookmark_name, $this->bookmarks );
	}

	/**
	 * Move the internal cursor in the Tag Processor to a given bookmark's location.
	 *
	 * Be careful! Seeking backwards to a previous location resets the parser to the
	 * start of the document and reparses the entire contents up until it finds the
	 * sought-after bookmarked location.
	 *
	 * In order to prevent accidental infinite loops, there's a
	 * maximum limit on the number of times seek() can be called.
	 *
	 * @param  string $bookmark_name  Jump to the place in the document identified by this bookmark name.
	 *
	 * @return bool Whether the internal cursor was successfully moved to the bookmark's location.
	 * @since WP_VERSION
	 */
	public function seek( $bookmark_name ) {
		if ( ! array_key_exists( $bookmark_name, $this->bookmarks ) ) {
			_doing_it_wrong(
				__METHOD__,
				__( 'Unknown bookmark name.' ),
				'WP_VERSION'
			);

			return false;
		}

		if ( ++$this->seek_count > static::MAX_SEEK_OPS ) {
			_doing_it_wrong(
				__METHOD__,
				__( 'Too many calls to seek() - this can lead to performance issues.' ),
				'WP_VERSION'
			);

			return false;
		}

		// Flush out any pending updates to the document.
		$this->get_updated_xml();

		// Point this tag processor before the sought tag opener and consume it.
		$this->bytes_already_parsed = $this->bookmarks[ $bookmark_name ]->start;
		$this->parser_state         = self::STATE_READY;

		return $this->parse_next_token();
	}

	/**
	 * Compare two WP_HTML_Text_Replacement objects.
	 *
	 * @param  WP_HTML_Text_Replacement $a  First attribute update.
	 * @param  WP_HTML_Text_Replacement $b  Second attribute update.
	 *
	 * @return int Comparison value for string order.
	 * @since WP_VERSION
	 */
	private static function sort_start_ascending( $a, $b ) {
		$by_start = $a->start - $b->start;
		if ( 0 !== $by_start ) {
			return $by_start;
		}

		$by_text = isset( $a->text, $b->text ) ? strcmp( $a->text, $b->text ) : 0;
		if ( 0 !== $by_text ) {
			return $by_text;
		}

		/*
		 * This code should be unreachable, because it implies the two replacements
		 * start at the same location and contain the same text.
		 */

		return $a->length - $b->length;
	}

	/**
	 * Return the enqueued value for a given attribute, if one exists.
	 *
	 * Enqueued updates can take different data types:
	 *  - If an update is enqueued and is boolean, the return will be `true`
	 *  - If an update is otherwise enqueued, the return will be the string value of that update.
	 *  - If an attribute is enqueued to be removed, the return will be `null` to indicate that.
	 *  - If no updates are enqueued, the return will be `false` to differentiate from "removed."
	 *
	 * @param  string $comparable_name  The attribute name in its comparable form.
	 *
	 * @return string|boolean|null Value of enqueued update if present, otherwise false.
	 * @since WP_VERSION
	 */
	private function get_enqueued_attribute_value( $comparable_name ) {
		if ( self::STATE_MATCHED_TAG !== $this->parser_state ) {
			return false;
		}

		if ( ! isset( $this->lexical_updates[ $comparable_name ] ) ) {
			return false;
		}

		$enqueued_text = $this->lexical_updates[ $comparable_name ]->text;

		// Removed attributes erase the entire span.
		if ( '' === $enqueued_text ) {
			return null;
		}

		/*
		 * Boolean attribute updates are just the attribute name without a corresponding value.
		 *
		 * This value might differ from the given comparable name in that there could be leading
		 * or trailing whitespace, and that the casing follows the name given in `set_attribute`.
		 *
		 * Example:
		 *
		 *     $p->set_attribute( 'data-TEST-id', 'update' );
		 *     'update' === $p->get_enqueued_attribute_value( 'data-test-id' );
		 *
		 * Detect this difference based on the absence of the `=`, which _must_ exist in any
		 * attribute containing a value, e.g. `<input type="text" enabled />`.
		 *                                            ¹           ²
		 *                                       1. Attribute with a string value.
		 *                                       2. Boolean attribute whose value is `true`.
		 */
		$equals_at = strpos( $enqueued_text, '=' );
		if ( false === $equals_at ) {
			return true;
		}

		/*
		 * Finally, a normal update's value will appear after the `=` and
		 * be double-quoted, as performed incidentally by `set_attribute`.
		 *
		 * e.g. `type="text"`
		 *           ¹²    ³
		 *        1. Equals is here.
		 *        2. Double-quoting starts one after the equals sign.
		 *        3. Double-quoting ends at the last character in the update.
		 */
		$enqueued_value = substr( $enqueued_text, $equals_at + 2, - 1 );

		/*
		 * We're deliberately not decoding entities in attribute values:
		 *
		 *     Attribute values must not contain direct or indirect entity references to external entities.
		 *
		 * See https://www.w3.org/TR/xml/#sec-starttags.
		 */

		return $enqueued_value;
	}

	/**
	 * Returns the value of a requested attribute from a matched tag opener if that attribute exists.
	 *
	 * Example:
	 *
	 *     $p = new XMLProcessor(
	 *        '<root xmlns:wp="http://www.w3.org/1999/xhtml">
	 *            <content enabled="true" class="test" data-test-id="14" wp:enabled="true">Test</content>
	 *         </root>'
	 *     );
	 *     $p->next_tag( array( 'class_name' => 'test' ) ) === true;
	 *     $p->get_attribute( '', 'data-test-id' ) === '14';
	 *     $p->get_attribute( '', 'enabled' ) === "true";
	 *     $p->get_attribute( 'wp', 'enabled' ) === null;
	 *     $p->get_attribute( 'http://www.w3.org/1999/xhtml', 'enabled' ) === "true";
	 *     $p->get_attribute( 'aria-label' ) === null;
	 *
	 * @param  string $namespace_reference  Full namespace of the requested attribute, e.g. "http://wordpress.org/export/1.2/"
	 * @param  string $local_name           Name of attribute whose value is requested, e.g. data-test-id
	 *
	 * @return string|true|null Value of attribute or `null` if not available. Boolean attributes return `true`.
	 * @since WP_VERSION
	 */
	public function get_attribute( $namespace_reference, $local_name ) {
		if (
			self::STATE_MATCHED_TAG !== $this->parser_state &&
			self::STATE_XML_DECLARATION !== $this->parser_state
		) {
			return null;
		}

		$full_name = $namespace_reference ? '{' . $namespace_reference . '}' . $local_name : $local_name;

		// Return any enqueued attribute value updates if they exist.
		$enqueued_value = $this->get_enqueued_attribute_value( $full_name );
		if ( false !== $enqueued_value ) {
			return $enqueued_value;
		}

		if ( ! isset( $this->attributes[ $full_name ] ) ) {
			return null;
		}

		$attribute = $this->attributes[ $full_name ];
		$raw_value = substr( $this->xml, $attribute->value_starts_at, $attribute->value_length );

		$decoded = XMLDecoder::decode( $raw_value );
		if ( ! isset( $decoded ) ) {
			/**
			 * If the attribute contained an invalid value, it's
			 * a fatal error.
			 *
			 * @see WP_XML_Decoder::decode()
			 */
			$this->last_error = self::ERROR_SYNTAX;
			_doing_it_wrong(
				__METHOD__,
				__( 'Invalid attribute value encountered.' ),
				'WP_VERSION'
			);

			return false;
		}

		return $decoded;
	}

	/**
	 * Gets a value from a qualified attribute name if it exists in the
	 * matched tag.
	 *
	 * It's for internal use only to source values of raw attributes
	 * after they're parsed but before the namespaces are resolved.
	 *
	 * @param string $qname The qualified attribute name.
	 * @return string|null The attribute value, or null if not found.
	 */
	private function get_qualified_attribute( $qname ) {
		if ( ! isset( $this->qualified_attributes[ $qname ] ) ) {
			return null;
		}

		$attribute = $this->qualified_attributes[ $qname ];
		$raw_value = substr( $this->xml, $attribute->value_starts_at, $attribute->value_length );

		$decoded = XMLDecoder::decode( $raw_value );
		if ( ! isset( $decoded ) ) {
			/**
			 * If the attribute contained an invalid value, it's
			 * a fatal error.
			 *
			 * @see WP_XML_Decoder::decode()
			 */
			$this->last_error = self::ERROR_SYNTAX;
			_doing_it_wrong(
				__METHOD__,
				__( 'Invalid attribute value encountered.' ),
				'WP_VERSION'
			);

			return false;
		}

		return $decoded;
	}

	/**
	 * Gets  names of all attributes matching a given namespace prefix and local name prefix in the current tag.
	 *
	 * This method allows you to filter attributes by both their namespace prefix (e.g., 'wp') and the start of their local name (e.g., 'data-').
	 * Matching is case-sensitive for both namespace and local name prefixes, in accordance with the XML specification.
	 *
	 * Each returned attribute is represented as a two-element array: [namespace_prefix, local_name].
	 *
	 * Examples:
	 *
	 *     // No namespace, local name prefix only
	 *     $p = new XMLProcessor( '<content data-ENABLED="1" class="test" DATA-test-id="14">Test</content>' );
	 *     $p->next_tag( array( 'class_name' => 'test' ) ) === true;
	 *     $p->get_attribute_names_with_prefix( '', 'data-' );
	 *     // Returns: array( array( '', 'data-ENABLED' ), array( '', 'DATA-test-id' ) )
	 *
	 *     // With namespace prefix
	 *     $p = new XMLProcessor( '<content xmlns:wp="http://wordpress.org/export/1.2/" wp:data-foo="bar" wp:data-bar="baz" data-no-namespace="true" />' );
	 *     $p->next_tag();
	 *     $p->get_attribute_names_with_prefix( 'http://wordpress', 'data-' );
	 *     // Returns: array( array( 'http://wordpress.org/export/1.2/', 'data-foo' ), array( 'http://wordpress.org/export/1.2/', 'data-bar' ) )
	 *
	 *     // Empty string namespace prefix matches all attributes.
	 *     $p->get_attribute_names_with_prefix( '', 'data-' );
	 *     // Returns: array( array( 'http://wordpress.org/export/1.2/', 'data-foo' ), array( 'http://wordpress.org/export/1.2/', 'data-bar' ), array( '', 'data-no-namespace' ) )
	 *
	 *     // Null namespace prefix matches attributes with no namespace.
	 *     $p->get_attribute_names_with_prefix( null, 'data-' );
	 *     // Returns: array( array( '', 'data-no-namespace' ) )
	 *
	 *     // No match for wrong namespace prefix
	 *     $p->get_attribute_names_with_prefix( 'other', 'data-' );
	 *     // Returns: array()
	 *
	 * @param  string $full_namespace_prefix   Prefix of the fully qualified namespace to match on (e.g., 'http://wordpress.org/'). Use '' for no namespace prefix.
	 * @param  string $local_name_prefix       Local name prefix to match (e.g., 'data-').
	 *
	 * @return array|null List of [namespace, local_name] pairs, or `null` when no tag opener is matched.
	 * @since WP_VERSION
	 */
	public function get_attribute_names_with_prefix( $full_namespace_prefix, $local_name_prefix ) {
		if (
			self::STATE_MATCHED_TAG !== $this->parser_state ||
			$this->is_closing_tag
		) {
			return null;
		}

		$matches = array();
		foreach ( $this->attributes as $attr ) {
			if ( 0 === strncmp( $attr->local_name, $local_name_prefix, strlen( $local_name_prefix ) ) &&
				(
					// Distinguish between no namespace and empty namespace.
					( null === $full_namespace_prefix && '' === $attr->namespace ) ||
					( null !== $full_namespace_prefix && 0 === strncmp( $attr->namespace, $full_namespace_prefix, strlen( $full_namespace_prefix ) ) )
				)
			) {
				$matches[] = array( $attr->namespace, $attr->local_name );
			}
		}

		return $matches;
	}

	/**
	 * Returns the local name of the matched tag.
	 *
	 * Example without namespaces:
	 *
	 *     $p = new XMLProcessor( '<content class="test">Test</content>' );
	 *     $p->next_tag() === true;
	 *     $p->get_tag_local_name() === 'content';
	 *
	 * Example with namespaces:
	 *
	 *     $p = new XMLProcessor( '<root xmlns:wp="http://www.w3.org/1999/xhtml"><wp:content>Test</wp:content></root>' );
	 *     $p->next_tag() === true;
	 *     $p->get_tag_local_name() === 'content';
	 *
	 * @return string|null Name of currently matched tag in input XML, or `null` if none found.
	 * @since WP_VERSION
	 */
	public function get_tag_local_name() {
		if ( null !== $this->element ) {
			// Return cached name if we already have it.
			return $this->element->local_name;
		}

		$qualified_tag_name = $this->get_tag_name_qualified();
		if ( null === $qualified_tag_name ) {
			return null;
		}

		list( $_, $local_name ) = $this->parse_qualified_name( $qualified_tag_name );

		return $local_name;
	}

	/**
	 * Returns the namespace prefix and the local name of the matched tag.
	 *
	 * Example without namespaces:
	 *
	 *     $p = new XMLProcessor( '<content>Test</content>' );
	 *     $p->next_tag() === true;
	 *     $p->get_tag_name_qualified() === 'content';
	 *
	 * Example with namespaces:
	 *
	 *     $p = new XMLProcessor( '<root xmlns:wp="http://www.w3.org/1999/xhtml"><wp:content>Test</wp:content></root>' );
	 *     $p->next_tag() === true;
	 *     $p->get_tag_name_qualified() === 'wp:content';
	 *
	 * @return string|null The namespace prefix and the local name of the matched tag, or null if not available.
	 */
	private function get_tag_name_qualified() {
		if ( null !== $this->element ) {
			// Return cached name if we already have it.
			return $this->element->qualified_name;
		}

		if ( null === $this->tag_name_starts_at ) {
			return null;
		}

		$tag_name = substr( $this->xml, $this->tag_name_starts_at, $this->tag_name_length );
		if ( self::STATE_MATCHED_TAG !== $this->parser_state ) {
			return null;
		}

		return $tag_name;
	}

	/**
	 * Returns a string with the fully qualified namespace and local name of the matched tag
	 * in the following format: "{namespace}local_name".
	 *
	 * Example:
	 *
	 *     $p = new XMLProcessor( '<root xmlns:wp="http://www.w3.org/1999/xhtml"><wp:content>Test</wp:content></root>' );
	 *     $p->next_tag() === true;
	 *     $p->get_tag_namespace_and_local_name() === '{http://www.w3.org/1999/xhtml"}content';
	 *
	 * @return string|null The namespace and local name of the matched tag, or null if not available.
	 */
	public function get_tag_namespace_and_local_name() {
		$namespace = $this->get_tag_namespace();
		if ( ! $namespace ) {
			return $this->get_tag_local_name();
		}

		return '{' . $namespace . '}' . $this->get_tag_local_name();
	}

	/**
	 * Returns the namespace reference of the matched tag.
	 *
	 * Example:
	 *
	 *     $p = new XMLProcessor( '<root xmlns:wp="http://www.w3.org/1999/xhtml"><wp:content>Test</wp:content></root>' );
	 *     $p->next_tag() === true;
	 *     $p->next_tag() === true;
	 *     $p->get_tag_namespace() === 'http://www.w3.org/1999/xhtml';
	 *
	 * @return string|null The namespace reference of the matched tag, or null if not available.
	 */
	public function get_tag_namespace() {
		if ( self::STATE_MATCHED_TAG !== $this->parser_state ) {
			return null;
		}

		return $this->element->namespace;
	}

	/**
	 * Returns the name from the DOCTYPE declaration.
	 *
	 * ```
	 * doctypedecl ::= '<!DOCTYPE' S Name (S ExternalID)? S? ('[' intSubset ']' S?)? '>'
	 *                               ^^^^
	 * ```
	 *
	 * @return string|null The name from the DOCTYPE declaration, or null if not available.
	 * @since WP_VERSION
	 */
	public function get_doctype_name() {
		if ( null === $this->doctype_name ) {
			return null;
		}

		return substr( $this->xml, $this->doctype_name->start, $this->doctype_name->length );
	}


	/**
	 * Returns the system literal value from the DOCTYPE declaration.
	 *
	 * Example:
	 *
	 *     <!DOCTYPE html SYSTEM "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
	 *
	 * In this example, the system_literal would be:
	 * "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd"
	 *
	 * @return string|null The system literal value, or null if not available.
	 * @since WP_VERSION
	 */
	public function get_system_literal() {
		if ( null === $this->system_literal ) {
			return null;
		}

		return substr( $this->xml, $this->system_literal->start, $this->system_literal->length );
	}

	/**
	 * Returns the public identifier value from the DOCTYPE declaration.
	 *
	 * Example:
	 *
	 *     <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
	 *
	 * In this example, the pubid_literal would be:
	 * "-//W3C//DTD XHTML 1.0 Strict//EN"
	 *
	 * @return string|null The public identifier value, or null if not available.
	 * @since WP_VERSION
	 */
	public function get_pubid_literal() {
		if ( null === $this->pubid_literal ) {
			return null;
		}

		return substr( $this->xml, $this->pubid_literal->start, $this->pubid_literal->length );
	}

	/**
	 * Indicates if the currently matched tag is expected to be closed.
	 * Returns true for tag openers (<div>) and false for empty elements (<img />) and tag closers (</div>).
	 *
	 * This method exists to provide a consistent interface with WP_HTML_Processor.
	 *
	 * @return bool Whether the tag is expected to be closed.
	 */
	public function expects_closer() {
		if ( self::STATE_MATCHED_TAG !== $this->parser_state ) {
			return false;
		}

		return $this->is_tag_opener() && ! $this->is_empty_element();
	}

	/**
	 * Indicates if the currently matched tag is an empty element tag.
	 *
	 * XML tags ending with a solidus ("/") are parsed as empty elements. They have no
	 * content and no matching closer is expected.
	 *
	 * @return bool Whether the currently matched tag is an empty element tag.
	 * @since WP_VERSION
	 */
	public function is_empty_element() {
		if ( self::STATE_MATCHED_TAG !== $this->parser_state ) {
			return false;
		}

		/*
		 * An empty element tag is defined by the solidus at the _end_ of the tag, not the beginning.
		 *
		 * Example:
		 *
		 *     <figure />
		 *             ^ this appears one character before the end of the closing ">".
		 */

		return '/' === $this->xml[ $this->token_starts_at + $this->token_length - 2 ];
	}

	/**
	 * Indicates if the current tag token is a tag closer.
	 *
	 * Example:
	 *
	 *     $p = new XMLProcessor( '<content></content>' );
	 *     $p->next_tag( array( 'tag_name' => 'content', 'tag_closers' => 'visit' ) );
	 *     $p->is_tag_closer() === false;
	 *
	 *     $p->next_tag( array( 'tag_name' => 'content', 'tag_closers' => 'visit' ) );
	 *     $p->is_tag_closer() === true;
	 *
	 * @return bool Whether the current tag is a tag closer.
	 * @since WP_VERSION
	 */
	public function is_tag_closer() {
		return (
			self::STATE_MATCHED_TAG === $this->parser_state &&
			$this->is_closing_tag
		);
	}

	/**
	 * Indicates if the current tag token is a tag opener.
	 *
	 * Example:
	 *
	 *     $p = new XMLProcessor( '<content></content>' );
	 *     $p->next_token();
	 *     $p->is_tag_opener() === true;
	 *
	 *     $p->next_token();
	 *     $p->is_tag_opener() === false;
	 *
	 * @return bool Whether the current tag is a tag closer.
	 * @since WP_VERSION
	 */
	public function is_tag_opener() {
		return (
			self::STATE_MATCHED_TAG === $this->parser_state &&
			! $this->is_closing_tag &&
			! $this->is_empty_element()
		);
	}

	/**
	 * Indicates the kind of matched token, if any.
	 *
	 * This differs from `get_token_name()` in that it always
	 * returns a static string indicating the type, whereas
	 * `get_token_name()` may return values derived from the
	 * token itself, such as a tag name or processing
	 * instruction tag.
	 *
	 * Possible values:
	 *  - `#tag` when matched on a tag.
	 *  - `#text` when matched on a text node.
	 *  - `#cdata-section` when matched on a CDATA node.
	 *  - `#comment` when matched on a comment.
	 *  - `#presumptuous-tag` when matched on an empty tag closer.
	 *
	 * @return string|null What kind of token is matched, or null.
	 * @since WP_VERSION
	 */
	public function get_token_type() {
		switch ( $this->parser_state ) {
			case self::STATE_MATCHED_TAG:
				return '#tag';

			default:
				return $this->get_token_name();
		}
	}

	/**
	 * Returns the node name represented by the token.
	 *
	 * This matches the DOM API value `nodeName`. Some values
	 * are static, such as `#text` for a text node, while others
	 * are dynamically generated from the token itself.
	 *
	 * Dynamic names:
	 *  - Uppercase tag name for tag matches.
	 *
	 * Note that if the Tag Processor is not matched on a token
	 * then this function will return `null`, either because it
	 * hasn't yet found a token or because it reached the end
	 * of the document without matching a token.
	 *
	 * @return string|null Name of the matched token.
	 * @since WP_VERSION
	 */
	public function get_token_name() {
		switch ( $this->parser_state ) {
			case self::STATE_MATCHED_TAG:
				return $this->get_tag_local_name();

			case self::STATE_TEXT_NODE:
				return '#text';

			case self::STATE_CDATA_NODE:
				return '#cdata-section';

			case self::STATE_DOCTYPE_NODE:
				return '#doctype';

			case self::STATE_XML_DECLARATION:
				return '#xml-declaration';

			case self::STATE_PI_NODE:
				return '#processing-instructions';

			case self::STATE_COMMENT:
				return '#comment';

			case self::STATE_COMPLETE:
				return '#complete';

			case self::STATE_INVALID_DOCUMENT:
				return '#error';

			default:
				return '#none';
		}
	}

	/**
	 * Returns the modifiable text for a matched token, or an empty string.
	 *
	 * Modifiable text is text content that may be read and changed without
	 * changing the XML structure of the document around it. This includes
	 * the contents of `#text` and `#cdata-section` nodes in the XML as well
	 * as the inner contents of XML comments, Processing Instructions, and others.
	 *
	 * If a token has no modifiable text then an empty string is returned to
	 * avoid needless crashing or type errors. An empty string does not mean
	 * that a token has modifiable text, and a token with modifiable text may
	 * have an empty string (e.g. a comment with no contents).
	 *
	 * @return string
	 * @since WP_VERSION
	 */
	public function get_modifiable_text() {
		if ( null === $this->text_starts_at ) {
			return '';
		}

		$text = substr( $this->xml, $this->text_starts_at, $this->text_length );

		/*
		 * > the XML processor must behave as if it normalized all line breaks in external parsed
		 * > entities (including the document entity) on input, before parsing, by translating both
		 * > the two-character sequence #xD #xA and any #xD that is not followed by #xA to a single
		 * > #xA character.
		 *
		 * See https://www.w3.org/TR/xml/#sec-line-ends
		 */
		$text = str_replace( array( "\r\n", "\r" ), "\n", $text );

		// Comment data and CDATA sections contents are not decoded any further.
		if (
			self::STATE_CDATA_NODE === $this->parser_state ||
			self::STATE_COMMENT === $this->parser_state
		) {
			return $text;
		}

		$decoded = XMLDecoder::decode( $text );
		if ( ! isset( $decoded ) ) {
			/**
			 * If the attribute contained an invalid value, it's
			 * a fatal error.
			 *
			 * @see WP_XML_Decoder::decode()
			 */

			$this->last_error = self::ERROR_SYNTAX;
			_doing_it_wrong(
				__METHOD__,
				__( 'Invalid text content encountered.' ),
				'WP_VERSION'
			);

			return false;
		}

		return $decoded;
	}

	/**
	 * Updates the modifiable text for a matched token.
	 *
	 * Modifiable text is text content that may be read and changed without
	 * changing the XML structure of the document around it. This includes
	 * the contents of `#text` and `#cdata-section` nodes in the XML as well
	 * as the inner contents of XML comments, Processing Instructions, and others.
	 *
	 * If a token has no modifiable text then false is returned to avoid needless
	 * crashing or type errors.
	 *
	 * @param $new_value New modifiable text for the current node.
	 * @return string
	 */
	public function set_modifiable_text( $new_value ) {
		switch ( $this->parser_state ) {
			case self::STATE_TEXT_NODE:
			case self::STATE_COMMENT:
				$this->lexical_updates[] = new WP_HTML_Text_Replacement(
					$this->text_starts_at,
					$this->text_length,
					// @TODO: Audit this in details. Is this too naive? Or is it actually safe?
					htmlspecialchars( $new_value, ENT_XML1, 'UTF-8' )
				);

				return true;

			case self::STATE_CDATA_NODE:
				$this->lexical_updates[] = new WP_HTML_Text_Replacement(
					$this->text_starts_at,
					$this->text_length,
					// @TODO: Audit this in details. Is this too naive? Or is it actually safe?
					str_replace( ']]>', ']]&gt;', $new_value )
				);

				return true;
			default:
				_doing_it_wrong(
					__METHOD__,
					__( 'Cannot set text content on a non-text node.' ),
					'WP_VERSION'
				);

				return false;
		}
	}

	/**
	 * Updates or creates a new attribute on the currently matched tag with the passed value.
	 *
	 * For boolean attributes special handling is provided:
	 *  - When `true` is passed as the value, then only the attribute name is added to the tag.
	 *  - When `false` is passed, the attribute gets removed if it existed before.
	 *
	 * For string attributes, the value is escaped using the `esc_attr` function.
	 *
	 * @param  string      $xml_namespace  The attribute's namespace.
	 * @param  string      $local_name  The attribute name to target.
	 * @param  string|bool $value  The new attribute value.
	 *
	 * @return bool Whether an attribute value was set.
	 * @since WP_VERSION
	 */
	public function set_attribute( $xml_namespace, $local_name, $value ) {
		if ( ! is_string( $value ) ) {
			_doing_it_wrong(
				__METHOD__,
				__( 'Non-string attribute values cannot be passed to set_attribute().' ),
				'WP_VERSION'
			);

			return false;
		}
		if ( 'xmlns' === $xml_namespace ) {
			$this->bail(
				__( 'Setting attributes in the xmlns namespace is not yet supported by set_attribute().' ),
				$xml_namespace
			);
			return false;
		}
		if (
			self::STATE_MATCHED_TAG !== $this->parser_state ||
			$this->is_closing_tag
		) {
			return false;
		}

		$value = htmlspecialchars( $value, ENT_XML1, 'UTF-8' );

		if ( '' !== $xml_namespace ) {
			$prefix = $this->get_tag_namespace_prefix( $xml_namespace );
			if ( false === $prefix ) {
				$this->bail(
					// Translators: 1: The XML namespace.
					__( 'The namespace "%1$s" is not in the current element\'s scope.' ),
					$xml_namespace
				);
				return false;
			}
			$name = $prefix . ':' . $local_name;
		} else {
			$name = $local_name;
		}
		$updated_attribute = "{$name}=\"{$value}\"";

		/*
		 * > An attribute name must not appear more than once
		 * > in the same start-tag or empty-element tag.
		 *     - XML 1.0 spec
		 *
		 * @see https://www.w3.org/TR/xml/#sec-starttags
		 */
		if ( isset( $this->attributes[ $name ] ) ) {
			/*
			 * Update an existing attribute.
			 *
			 * Example – set attribute id to "new" in <content id="initial_id" />:
			 *
			 *     <content id="initial_id"/>
			 *              ^-------------^
			 *             start         end
			 *     replacement: `id="new"`
			 *
			 *     Result: <content id="new"/>
			 */
			$existing_attribute             = $this->attributes[ $name ];
			$this->lexical_updates[ $name ] = new WP_HTML_Text_Replacement(
				$existing_attribute->start,
				$existing_attribute->length,
				$updated_attribute
			);
		} else {
			/*
			 * Create a new attribute at the tag's name end.
			 *
			 * Example – add attribute id="new" to <content />:
			 *
			 *     <content />
			 *             ^
			 *         start and end
			 *     replacement: ` id="new"`
			 *
			 *     Result: <content id="new"/>
			 */
			$this->lexical_updates[ $name ] = new WP_HTML_Text_Replacement(
				$this->tag_name_starts_at + $this->tag_name_length,
				0,
				' ' . $updated_attribute
			);
		}

		return true;
	}

	/**
	 * Remove an attribute from the currently-matched tag.
	 *
	 * @param  string $xml_namespace  The attribute's namespace.
	 * @param  string $local_name     The attribute name to remove.
	 *
	 * @return bool Whether an attribute was removed.
	 * @since WP_VERSION
	 */
	public function remove_attribute( $xml_namespace, $local_name ) {
		if (
			self::STATE_MATCHED_TAG !== $this->parser_state ||
			$this->is_closing_tag
		) {
			return false;
		}

		$name = $xml_namespace ? '{' . $xml_namespace . '}' . $local_name : $local_name;

		/*
		 * If updating an attribute that didn't exist in the input
		 * document, then remove the enqueued update and move on.
		 *
		 * For example, this might occur when calling `remove_attribute()`
		 * after calling `set_attribute()` for the same attribute
		 * and when that attribute wasn't originally present.
		 */
		if ( ! isset( $this->attributes[ $name ] ) ) {
			if ( isset( $this->lexical_updates[ $name ] ) ) {
				unset( $this->lexical_updates[ $name ] );
			}

			return false;
		}

		/*
		 * Removes an existing tag attribute.
		 *
		 * Example – remove the attribute id from <content id="main"/>:
		 *    <content id="initial_id"/>
		 *             ^-------------^
		 *           start          end
		 *    replacement: ``
		 *
		 *    Result: <content />
		 */
		$this->lexical_updates[ $name ] = new WP_HTML_Text_Replacement(
			$this->attributes[ $name ]->start,
			$this->attributes[ $name ]->length,
			''
		);

		return true;
	}

	/**
	 * Returns the string representation of the XML Tag Processor.
	 *
	 * @return string The processed XML.
	 * @see XMLProcessor::get_updated_xml()
	 *
	 * @since WP_VERSION
	 */
	public function __toString() {
		return $this->get_updated_xml();
	}

	/**
	 * Returns the string representation of the XML Tag Processor.
	 *
	 * @return string The processed XML.
	 * @since WP_VERSION
	 */
	public function get_updated_xml() {
		$requires_no_updating = 0 === count( $this->lexical_updates );

		/*
		 * When there is nothing more to update and nothing has already been
		 * updated, return the original document and avoid a string copy.
		 */
		if ( $requires_no_updating ) {
			return $this->xml;
		}

		/*
		 * Keep track of the position right before the current token. This will
		 * be necessary for reparsing the current token after updating the XML.
		 */
		$before_current_token = isset( $this->token_starts_at ) ? $this->token_starts_at : 0;

		/*
		 * 1. Apply the enqueued edits and update all the pointers to reflect those changes.
		 */
		$before_current_token += $this->apply_lexical_updates( $before_current_token );

		/*
		 * 2. Rewind to before the current tag and reparse to get updated attributes.
		 *
		 * At this point the internal cursor points to the end of the tag name.
		 * Rewind before the tag name starts so that it's as if the cursor didn't
		 * move; a call to `next_tag()` will reparse the recently-updated attributes
		 * and additional calls to modify the attributes will apply at this same
		 * location, but in order to avoid issues with subclasses that might add
		 * behaviors to `next_tag()`, the internal methods should be called here
		 * instead.
		 *
		 * It's important to note that in this specific place there will be no change
		 * because the processor was already at a tag when this was called and it's
		 * rewinding only to the beginning of this very tag before reprocessing it
		 * and its attributes.
		 *
		 * <p>Previous XML<em>More XML</em></p>
		 *                 ↑  │ back up by the length of the tag name plus the opening <
		 *                 └←─┘ back up by strlen("em") + 1 ==> 3
		 */
		$this->bytes_already_parsed = $before_current_token;
		$this->parse_next_token();

		return $this->xml;
	}

	/**
	 * Finds the next token in the XML document.
	 *
	 * An XML document can be viewed as a stream of tokens,
	 * where tokens are things like XML tags, XML comments,
	 * text nodes, etc. This method finds the next token in
	 * the XML document and returns whether it found one.
	 *
	 * If it starts parsing a token and reaches the end of the
	 * document then it will seek to the start of the last
	 * token and pause, returning `false` to indicate that it
	 * failed to find a complete token.
	 *
	 * Possible token types, based on the XML specification:
	 *
	 *  - an XML tag
	 *  - a text node - the plaintext inside tags.
	 *  - a CData section
	 *  - an XML comment.
	 *  - a DOCTYPE declaration.
	 *  - a processing instruction, e.g. `<?xml mode="WordPress" ?>`.
	 *
	 * @return bool Whether a token was parsed.
	 */
	public function next_token() {
		return $this->step();
	}

	/**
	 * Moves the internal cursor to the next token in the XML document
	 * according to the XML specification.
	 *
	 * It considers the current XML context (prolog, element, or misc)
	 * and only expects the nodes that are allowed in that context.
	 *
	 * @param  int $node_to_process  Whether to process the next node or
	 *           reprocess the current node, e.g. using another parser context.
	 *
	 * @return bool Whether a token was parsed.
	 * @since WP_VERSION
	 *
	 * @access private
	 */
	private function step( $node_to_process = self::PROCESS_NEXT_NODE ) {
		// Refuse to proceed if there was a previous error.
		if ( null !== $this->last_error ) {
			return false;
		}

		// Finish stepping when there are no more tokens in the document.
		if (
			self::STATE_INCOMPLETE_INPUT === $this->parser_state ||
			self::STATE_COMPLETE === $this->parser_state
		) {
			return false;
		}

		if ( self::PROCESS_NEXT_NODE === $node_to_process ) {
			if ( $this->is_empty_element() ) {
				array_pop( $this->stack_of_open_elements );
			}
		}

		try {
			switch ( $this->parser_context ) {
				case self::IN_PROLOG_CONTEXT:
					return $this->step_in_prolog( $node_to_process );
				case self::IN_ELEMENT_CONTEXT:
					return $this->step_in_element( $node_to_process );
				case self::IN_MISC_CONTEXT:
					return $this->step_in_misc( $node_to_process );
				default:
					$this->last_error = self::ERROR_UNSUPPORTED;

					return false;
			}
		} catch ( XMLUnsupportedException $e ) {
			/*
			 * Exceptions are used in this class to escape deep call stacks that
			 * otherwise might involve messier calling and return conventions.
			 */
			return false;
		}
	}

	/**
	 * Parses the next node in the 'prolog' part of the XML document.
	 *
	 * @return bool Whether a node was found.
	 * @see https://www.w3.org/TR/xml/#NT-document.
	 * @see XMLProcessor::step
	 *
	 * @since WP_VERSION
	 */
	private function step_in_prolog( $node_to_process = self::PROCESS_NEXT_NODE ) {
		if ( self::PROCESS_NEXT_NODE === $node_to_process ) {
			$has_next_node = $this->parse_next_token();
			if (
				false === $has_next_node &&
				! $this->expecting_more_input
			) {
				$this->bail( 'The root element was not found.', self::ERROR_SYNTAX );
			}
		}

		// XML requires a root element. If we've reached the end of data in the prolog stage,
		// before finding a root element, then the document is incomplete.
		if ( self::STATE_COMPLETE === $this->parser_state ) {
			$this->mark_incomplete_input();

			return false;
		}
		// Do not step if we paused due to an incomplete input.
		if ( self::STATE_INCOMPLETE_INPUT === $this->parser_state ) {
			return false;
		}
		switch ( $this->get_token_type() ) {
			case '#text':
				$text        = $this->get_modifiable_text();
				$whitespaces = strspn( $text, " \t\n\r" );
				if ( strlen( $text ) !== $whitespaces ) {
					// @TODO: Only look for this in the 2 initial bytes of the document:.
					if ( "\xFF\xFE" === substr( $text, 0, 2 ) ) {
						$this->bail( 'Unexpected UTF-16 BOM byte sequence (0xFFFE) in the document. XMLProcessor only supports UTF-8.', self::ERROR_SYNTAX );
					}
					$this->bail( 'Unexpected non-whitespace text token in prolog stage.', self::ERROR_SYNTAX );
				}

				return $this->step();
			// @TODO: Fail if there's more than one <!DOCTYPE> or if <!DOCTYPE> was found before the XML declaration token.
			case '#doctype':
			case '#comment':
			case '#xml-declaration':
			case '#processing-instructions':
				return true;
			case '#tag':
				$this->parser_context = self::IN_ELEMENT_CONTEXT;

				return $this->step( self::PROCESS_CURRENT_NODE );
			default:
				$this->bail( 'Unexpected token type in prolog stage.', self::ERROR_SYNTAX );
		}
	}

	/**
	 * Parses the next node in the 'element' part of the XML document.
	 *
	 * @return bool Whether a node was found.
	 * @see https://www.w3.org/TR/xml/#NT-document.
	 * @see XMLProcessor::step
	 *
	 * @since WP_VERSION
	 */
	private function step_in_element( $node_to_process = self::PROCESS_NEXT_NODE ) {
		if ( self::PROCESS_NEXT_NODE === $node_to_process ) {
			$has_next_node = $this->parse_next_token();
			if (
				false === $has_next_node &&
				! $this->expecting_more_input
			) {
				$this->bail( 'A tag was not closed.', self::ERROR_SYNTAX );
			}
		}

		// Do not step if we paused due to an incomplete input.
		if ( self::STATE_INCOMPLETE_INPUT === $this->parser_state ) {
			return false;
		}

		switch ( $this->get_token_type() ) {
			case '#text':
			case '#cdata-section':
			case '#comment':
			case '#processing-instructions':
				return true;
			case '#tag':
				// Update the stack of open elements.
				$tag_qname = $this->get_tag_name_qualified();
				if ( $this->is_tag_closer() ) {
					if ( ! count( $this->stack_of_open_elements ) ) {
						$this->bail(
							// Translators: 1: The closing tag name. 2: The opening tag name.
							__( 'The closing tag "%1$s" did not match the opening tag "%2$s".' ),
							$tag_qname,
							$tag_qname
						);
						return false;
					}
					$this->element = array_pop( $this->stack_of_open_elements );
					$popped_qname  = $this->element->qualified_name;
					if ( $popped_qname !== $tag_qname ) {
						$this->bail(
							sprintf(
							// translators: %1$s is the name of the closing HTML tag, %2$s is the name of the opening HTML tag.
								__( 'The closing tag "%1$s" did not match the opening tag "%2$s".' ),
								$tag_qname,
								$popped_qname
							),
							self::ERROR_SYNTAX
						);
					}
					if ( 0 === count( $this->stack_of_open_elements ) ) {
						$this->parser_context = self::IN_MISC_CONTEXT;
					}
				} else {
					array_push( $this->stack_of_open_elements, $this->element );
					$this->element = $this->top_element();
				}

				return true;
			default:
				$this->bail(
					sprintf(
					// translators: %1$s is the unexpected token type.
						__( 'Unexpected token type "%1$s" in element stage.', 'data-liberation' ),
						$this->get_token_type()
					),
					self::ERROR_SYNTAX
				);
		}
	}

	/**
	 * Parses the next node in the 'misc' part of the XML document.
	 *
	 * @return bool Whether a node was found.
	 * @see https://www.w3.org/TR/xml/#NT-document.
	 * @see XMLProcessor::step
	 *
	 * @since WP_VERSION
	 */
	private function step_in_misc( $node_to_process = self::PROCESS_NEXT_NODE ) {
		if ( self::PROCESS_NEXT_NODE === $node_to_process ) {
			$has_next_node = $this->parse_next_token();
			if (
				false === $has_next_node &&
				! $this->expecting_more_input
			) {
				// Parsing is complete.
				$this->parser_state = self::STATE_COMPLETE;

				return true;
			}
		}

		// Do not step if we paused due to an incomplete input.
		if ( self::STATE_INCOMPLETE_INPUT === $this->parser_state ) {
			return false;
		}

		if ( self::STATE_COMPLETE === $this->parser_state ) {
			return true;
		}

		switch ( $this->get_token_type() ) {
			case '#comment':
			case '#processing-instructions':
				return true;
			case '#text':
				$text        = $this->get_modifiable_text();
				$whitespaces = strspn( $text, " \t\n\r" );
				if ( strlen( $text ) !== $whitespaces ) {
					$this->bail( 'Unexpected token type "' . $this->get_token_type() . '" in misc stage.', self::ERROR_SYNTAX );
				}

				return $this->step();
			default:
				$this->bail( 'Unexpected token type "' . $this->get_token_type() . '" in misc stage.', self::ERROR_SYNTAX );
		}
	}

	/**
	 * Computes the XML breadcrumbs for the currently-matched element, if matched.
	 *
	 * Breadcrumbs start at the outermost parent and descend toward the matched element.
	 * They always include the entire path from the root XML node to the matched element.
	 * Example
	 *
	 *     $processor = XMLProcessor::create_fragment( '<p><strong><em><img/></em></strong></p>' );
	 *     $processor->next_tag( 'img' );
	 *     $processor->get_breadcrumbs() === array( 'p', 'strong', 'em', 'img' );
	 *
	 * @return string[]|null Array of tag names representing path to matched node, if matched, otherwise NULL.
	 * @since WP_VERSION
	 */
	public function get_breadcrumbs() {
		return array_map(
			function ( $element ) {
				return array( $element->namespace, $element->local_name );
			},
			$this->stack_of_open_elements
		);
	}

	/**
	 * Indicates if the currently-matched tag matches the given breadcrumbs.
	 *
	 * A "*" represents a single tag wildcard, where any tag matches, but not no tags.
	 *
	 * At some point this function _may_ support a `**` syntax for matching any number
	 * of unspecified tags in the breadcrumb stack. This has been intentionally left
	 * out, however, to keep this function simple and to avoid introducing backtracking,
	 * which could open up surprising performance breakdowns.
	 *
	 * Example:
	 *
	 *     $processor = new XMLProcessor( '<root><post><content><image /></content></post></root>' );
	 *     $processor->next_tag( 'img' );
	 *     true  === $processor->matches_breadcrumbs( array( 'content', 'image' ) );
	 *     true  === $processor->matches_breadcrumbs( array( 'post', 'content', 'image' ) );
	 *     false === $processor->matches_breadcrumbs( array( 'post', 'image' ) );
	 *     true  === $processor->matches_breadcrumbs( array( 'post', '*', 'image' ) );
	 *
	 * @param  string[] $breadcrumbs  DOM sub-path at which element is found, e.g. `array( 'content', 'image' )`.
	 *                             May also contain the wildcard `*` which matches a single element, e.g. `array( 'post', '*' )`.
	 *
	 * @return bool Whether the currently-matched tag is found at the given nested structure.
	 * @since WP_VERSION
	 */
	public function matches_breadcrumbs( $breadcrumbs ) {
		// Everything matches when there are zero constraints.
		if ( 0 === count( $breadcrumbs ) ) {
			return true;
		}

		// Start at the last crumb.
		$crumb = end( $breadcrumbs );

		if ( '#tag' !== $this->get_token_type() ) {
			return false;
		}

		$open_elements = $this->stack_of_open_elements;
		$crumb_count   = count( $breadcrumbs );
		$elem_count    = count( $open_elements );

		// Walk backwards through both arrays, matching each crumb to the corresponding open element.
		for ( $j = 1; $j <= $crumb_count; $j++ ) {
			$crumb   = $breadcrumbs[ $crumb_count - $j ];
			$element = isset( $open_elements[ $elem_count - $j ] ) ? $open_elements[ $elem_count - $j ] : null;

			if ( ! $element ) {
				return false;
			}

			// Normalize crumb to [namespace, local_name].
			if ( ! is_array( $crumb ) ) {
				if ( '*' === $crumb ) {
					$crumb = array( '*', '*' );
				} else {
					$crumb = array( '*', $crumb );
				}
			}
			list( $namespace, $local_name ) = $crumb;

			// Match local name, respecting wildcard '*'.
			if ( '*' !== $local_name && $local_name !== $element->local_name ) {
				return false;
			}

			// Match namespace, respecting wildcard '*'.
			if ( '*' !== $namespace && $namespace !== $element->namespace ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Returns the nesting depth of the current location in the document.
	 *
	 * Example:
	 *
	 *     $processor = new XMLProcessor( '<?xml version="1.0" ?><root><text></text></root>' );
	 *     0 === $processor->get_current_depth();
	 *
	 *     // Opening the root element increases the depth.
	 *     $processor->next_tag();
	 *     1 === $processor->get_current_depth();
	 *
	 *     // Opening the text element increases the depth.
	 *     $processor->next_tag();
	 *     2 === $processor->get_current_depth();
	 *
	 *     // The text element is closed during `next_token()` so the depth is decreased to reflect that.
	 *     $processor->next_token();
	 *     1 === $processor->get_current_depth();
	 *
	 * @return int Nesting-depth of current location in the document.
	 * @since WP_VERSION
	 */
	public function get_current_depth() {
		return count( $this->stack_of_open_elements );
	}

	/**
	 * Parses a qualified name into a namespace prefix and local name.
	 *
	 * Example:
	 *
	 *     $this->parse_qualified_name( 'wp:post' ); // Returns array( 'wp.org', 'post' )
	 *     $this->parse_qualified_name( 'image' ); // Returns array( '', 'image' )
	 *
	 * @param  string $qualified_name  The qualified name to parse.
	 *
	 * @return array<string, string> The namespace prefix and local name.
	 */
	private function parse_qualified_name( $qualified_name ) {
		$namespace_prefix = '';
		$local_name       = $qualified_name;

		$prefix_length = strcspn( $qualified_name, ':' );
		if ( null !== $prefix_length && strlen( $qualified_name ) !== $prefix_length ) {
			$namespace_prefix = substr( $qualified_name, 0, $prefix_length );
			$local_name       = substr( $qualified_name, $prefix_length + 1 );
		}

		return array( $namespace_prefix, $local_name );
	}

	/**
	 * Asserts a qualified tag name is syntactically valid according to the
	 * XML specification.
	 *
	 * @param  string $qualified_name  The qualified name to validate.
	 * @return bool Whether the qualified name is syntactically valid.
	 */
	private function validate_qualified_name( $qualified_name ) {
		if ( substr_count( $qualified_name, ':' ) > 1 ) {
			$this->bail(
				sprintf(
					'Invalid identifier "%s" – more than one ":" in tag name. Every tag name must contain either zero or one colon.',
					$qualified_name
				),
				self::ERROR_SYNTAX
			);

			return false;
		}

		$prefix_length = strcspn( $qualified_name, ':' );
		if ( 0 === $prefix_length && strlen( $qualified_name ) > 0 ) {
			$this->bail(
				sprintf( 'Invalid identifier "%s" – namespace qualifier must not have zero length.', $qualified_name ),
				self::ERROR_SYNTAX
			);

			return false;
		}

		return true;
	}

	private function mark_incomplete_input(
		$error_message = 'Unexpected syntax encountered.'
	) {
		if ( $this->expecting_more_input ) {
			$this->parser_state = self::STATE_INCOMPLETE_INPUT;

			return;
		}

		$this->parser_state = self::STATE_INVALID_DOCUMENT;
		$this->last_error   = self::ERROR_SYNTAX;
		_doing_it_wrong( __METHOD__, $error_message, 'WP_VERSION' );
	}

	/**
	 * Returns context for why the parser aborted due to unsupported XML, if it did.
	 *
	 * This is meant for debugging purposes, not for production use.
	 *
	 * @return XMLUnsupportedException|null
	 */
	public function get_exception() {
		return $this->exception;
	}

	/**
	 * Stops the parser and terminates its execution when encountering unsupported markup.
	 *
	 * @param  string $message  Explains support is missing in order to parse the current node.
	 *
	 * @throws XMLUnsupportedException Halts execution of the parser.
	 */
	private function bail( $message, $reason = self::ERROR_UNSUPPORTED ) {
		$starts_at = isset( $this->token_starts_at ) ? $this->token_starts_at : strlen( $this->xml );
		$length    = isset( $this->token_length ) ? $this->token_length : 0;
		$token     = substr( $this->xml, $starts_at, $length );

		$this->last_error = $reason;
		$this->exception  = new XMLUnsupportedException(
			$message,
			$this->get_token_type(),
			$starts_at,
			$token,
			$this->get_breadcrumbs()
		);

		throw $this->exception;
	}

	/**
	 * Parser Ready State.
	 *
	 * Indicates that the parser is ready to run and waiting for a state transition.
	 * It may not have started yet, or it may have just finished parsing a token and
	 * is ready to find the next one.
	 *
	 * @since WP_VERSION
	 *
	 * @access private
	 */
	const STATE_READY = 'STATE_READY';

	/**
	 * Parser Complete State.
	 *
	 * Indicates that the parser has reached the end of the document and there is
	 * nothing left to scan. It finished parsing the last token completely.
	 *
	 * @since WP_VERSION
	 *
	 * @access private
	 */
	const STATE_COMPLETE = 'STATE_COMPLETE';

	/**
	 * Parser Incomplete Input State.
	 *
	 * Indicates that the parser has reached the end of the document before finishing
	 * a token. It started parsing a token but there is a possibility that the input
	 * XML document was truncated in the middle of a token.
	 *
	 * The parser is reset at the start of the incomplete token and has paused. There
	 * is nothing more than can be scanned unless provided a more complete document.
	 *
	 * @since WP_VERSION
	 *
	 * @access private
	 */
	const STATE_INCOMPLETE_INPUT = 'STATE_INCOMPLETE_INPUT';

	/**
	 * Parser Invalid Input State.
	 *
	 * Indicates that the parsed xml document contains malformed input and cannot be parsed.
	 *
	 * @since WP_VERSION
	 *
	 * @access private
	 */
	const STATE_INVALID_DOCUMENT = 'STATE_INVALID_DOCUMENT';

	/**
	 * Parser Matched Tag State.
	 *
	 * Indicates that the parser has found an XML tag and it's possible to get
	 * the tag name and read or modify its attributes (if it's not a closing tag).
	 *
	 * @since WP_VERSION
	 *
	 * @access private
	 */
	const STATE_MATCHED_TAG = 'STATE_MATCHED_TAG';

	/**
	 * Parser Text Node State.
	 *
	 * Indicates that the parser has found a text node and it's possible
	 * to read and modify that text.
	 *
	 * @since WP_VERSION
	 *
	 * @access private
	 */
	const STATE_TEXT_NODE = 'STATE_TEXT_NODE';

	/**
	 * Parser CDATA Node State.
	 *
	 * Indicates that the parser has found a CDATA node and it's possible
	 * to read and modify its modifiable text. Note that in XML there are
	 * no CDATA nodes outside of foreign content (SVG and MathML). Outside
	 * of foreign content, they are treated as XML comments.
	 *
	 * @since WP_VERSION
	 *
	 * @access private
	 */
	const STATE_CDATA_NODE = 'STATE_CDATA_NODE';

	/**
	 * Parser DOCTYPE Node State.
	 *
	 * Indicates that the parser has found a DOCTYPE declaration and it's possible
	 * to read and modify its modifiable text.
	 *
	 * @since WP_VERSION
	 *
	 * @access private
	 */
	const STATE_DOCTYPE_NODE = 'STATE_DOCTYPE_NODE';

	/**
	 * Indicates that the parser has found an XML processing instruction.
	 *
	 * @since WP_VERSION
	 *
	 * @access private
	 */
	const STATE_PI_NODE = 'STATE_PI_NODE';

	/**
	 * Indicates that the parser has found an XML declaration
	 *
	 * @since WP_VERSION
	 *
	 * @access private
	 */
	const STATE_XML_DECLARATION = 'STATE_XML_DECLARATION';

	/**
	 * Indicates that the parser has found an XML comment and it's
	 * possible to read and modify its modifiable text.
	 *
	 * @since WP_VERSION
	 *
	 * @access private
	 */
	const STATE_COMMENT = 'STATE_COMMENT';

	/**
	 * Indicates that the parser encountered unsupported syntax and has bailed.
	 *
	 * @since WP_VERSION
	 *
	 * @var string
	 */
	const ERROR_SYNTAX = 'syntax';

	/**
	 * Indicates that the provided XML document contains a declaration that is
	 * unsupported by the parser.
	 *
	 * @since WP_VERSION
	 *
	 * @var string
	 */
	const ERROR_UNSUPPORTED = 'unsupported';

	/**
	 * Indicates that the parser encountered more XML tokens than it
	 * was able to process and has bailed.
	 *
	 * @since WP_VERSION
	 *
	 * @var string
	 */
	const ERROR_EXCEEDED_MAX_BOOKMARKS = 'exceeded-max-bookmarks';


	/**
	 * Indicates that we're parsing the `prolog` part of the XML
	 * document.
	 *
	 * @since WP_VERSION
	 *
	 * @access private
	 */
	const IN_PROLOG_CONTEXT = 'prolog';

	/**
	 * Indicates that we're parsing the `element` part of the XML
	 * document.
	 *
	 * @since WP_VERSION
	 *
	 * @access private
	 */
	const IN_ELEMENT_CONTEXT = 'element';

	/**
	 * Indicates that we're parsing the `misc` part of the XML
	 * document.
	 *
	 * @since WP_VERSION
	 *
	 * @access private
	 */
	const IN_MISC_CONTEXT = 'misc';

	/**
	 * Indicates that the next HTML token should be parsed and processed.
	 *
	 * @since WP_VERSION
	 *
	 * @var string
	 */
	const PROCESS_NEXT_NODE = 'process-next-node';

	/**
	 * Indicates that the current HTML token should be processed without advancing the parser.
	 *
	 * @since WP_VERSION
	 *
	 * @var string
	 */
	const PROCESS_CURRENT_NODE = 'process-current-node';


	/**
	 * Unlock code that must be passed into the constructor to create this class.
	 *
	 * This class extends the WP_HTML_Tag_Processor, which has a public class
	 * constructor. Therefore, it's not possible to have a private constructor here.
	 *
	 * This unlock code is used to ensure that anyone calling the constructor is
	 * doing so with a full understanding that it's intended to be a private API.
	 *
	 * @access private
	 */
	const CONSTRUCTOR_UNLOCK_CODE = 'Use WP_HTML_Processor::create_fragment() instead of calling the class constructor directly.';
}
