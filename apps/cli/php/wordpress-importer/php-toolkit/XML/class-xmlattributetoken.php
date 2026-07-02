<?php
namespace WordPress\XML;

/**
 * XML API: XMLAttributeToken class
 *
 * @package WordPress
 * @subpackage XML-API
 * @since 6.2.0
 */

/**
 * Core class used by the XML tag processor as a data structure for the attribute token,
 * allowing to drastically improve performance.
 *
 * This class is for internal usage of the XMLProcessor class.
 *
 * @see XMLProcessor
 */
class XMLAttributeToken {
	/**
	 * Attribute name.
	 *
	 * @since 6.2.0
	 *
	 * @var string
	 */
	public $qualified_name;

	/**
	 * Attribute value.
	 *
	 * @since 6.2.0
	 *
	 * @var int
	 */
	public $value_starts_at;

	/**
	 * How many bytes the value occupies in the input XML.
	 *
	 * @since 6.2.0
	 *
	 * @var int
	 */
	public $value_length;

	/**
	 * The string offset where the attribute name starts.
	 *
	 * @since 6.2.0
	 *
	 * @var int
	 */
	public $start;

	/**
	 * Byte length of text spanning the attribute inside a tag.
	 *
	 * This span starts at the first character of the attribute name
	 * and it ends after one of three cases:
	 *
	 *  - at the end of the attribute name for boolean attributes.
	 *  - at the end of the value for unquoted attributes.
	 *  - at the final single or double quote for quoted attributes.
	 *
	 * @var int
	 */
	public $length;

	/**
	 * Namespace prefix.
	 *
	 * @var string
	 */
	public $namespace_prefix;

	/**
	 * Local name.
	 *
	 * @var string
	 */
	public $local_name;

	/**
	 * Namespace.
	 *
	 * @var string
	 */
	public $namespace;

	/**
	 * Constructor.
	 *
	 * @param  int    $value_start  Attribute value.
	 * @param  int    $value_length  Number of bytes attribute value spans.
	 * @param  int    $start  The string offset where the attribute name starts.
	 * @param  int    $length  Byte length of the entire attribute name or name and value pair expression.
	 * @param  string $namespace_prefix  Namespace prefix.
	 * @param  string $local_name  Local name.
	 * @param  string $namespace_name  Namespace.
	 */
	public function __construct( $value_start, $value_length, $start, $length, $namespace_prefix = null, $local_name = null, $namespace_name = null ) {
		$this->value_starts_at  = $value_start;
		$this->value_length     = $value_length;
		$this->start            = $start;
		$this->length           = $length;
		$this->namespace_prefix = $namespace_prefix;
		$this->local_name       = $local_name;
		$this->namespace        = $namespace_name;
		$this->qualified_name   = $namespace_prefix ? $namespace_prefix . ':' . $local_name : $local_name;
	}
}
