<?php
namespace WordPress\XML;

/**
 * XML API: XMLElement class
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
class XMLElement {
	/**
	 * Local name.
	 *
	 * @var string
	 */
	public $local_name;

	/**
	 * Namespace Prefix.
	 *
	 * @var string
	 */
	public $namespace_prefix;

	/**
	 * Full XML namespace name.
	 *
	 * @var string
	 */
	public $namespace;

	/**
	 * Namespaces in current element's scope.
	 *
	 * @var array<string, string>
	 */
	public $namespaces_in_scope;

	/**
	 * Qualified name.
	 *
	 * @var string
	 */
	public $qualified_name;

	/**
	 * Constructor.
	 *
	 * @param string                $local_name Local name.
	 * @param string                $xml_namespace_prefix Namespace prefix.
	 * @param string                $xml_namespace Full XML namespace name.
	 * @param array<string, string> $namespaces_in_scope Namespaces in current element's scope.
	 */
	public function __construct( $local_name, $xml_namespace_prefix, $xml_namespace, $namespaces_in_scope ) {
		$this->local_name          = $local_name;
		$this->namespace_prefix    = $xml_namespace_prefix;
		$this->namespace           = $xml_namespace;
		$this->namespaces_in_scope = $namespaces_in_scope;
		$this->qualified_name      = $xml_namespace_prefix ? $xml_namespace_prefix . ':' . $local_name : $local_name;
	}

	public function get_full_name() {
		return $this->namespace ? '{' . $this->namespace . '}' . $this->local_name : $this->local_name;
	}

	public function to_array() {
		return array(
			'local_name'          => $this->local_name,
			'namespace_prefix'    => $this->namespace_prefix,
			'namespace'           => $this->namespace,
			'namespaces_in_scope' => $this->namespaces_in_scope,
		);
	}

	public static function from_array( $array_value ) {
		return new self(
			$array_value['local_name'],
			$array_value['namespace_prefix'],
			$array_value['namespace'],
			$array_value['namespaces_in_scope']
		);
	}
}
