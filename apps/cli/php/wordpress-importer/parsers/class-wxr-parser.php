<?php
/**
 * WordPress eXtended RSS file parser implementations
 *
 * @package WordPress
 * @subpackage Importer
 */

/**
 * WordPress Importer class for managing parsing of WXR files.
 */
class WXR_Parser {
	public function parse( $file ) {
		// Allow forcing a specific parser via WXR_PARSER: simplexml|xml|regex|xmlprocessor
		$preferred_parser = defined( 'PREFERRED_WXR_PARSER' ) ? constant( 'PREFERRED_WXR_PARSER' ) : null;
		if ( $preferred_parser ) {
			$available_parsers = array(
				'simplexml'    => 'WXR_Parser_SimpleXML',
				'xml'          => 'WXR_Parser_XML',
				'regex'        => 'WXR_Parser_Regex',
				'xmlprocessor' => 'WXR_Parser_XML_Processor',
			);
			if ( isset( $available_parsers[ $preferred_parser ] ) ) {
				$parser = new $available_parsers[ $preferred_parser ]();
				$result = $parser->parse( $file );
			} else {
				_doing_it_wrong( __FUNCTION__, sprintf( __( 'Invalid parser specified: %s', 'wordpress-importer' ), $preferred_parser ), '0.9.0' );
				$result = new WP_Error( 'invalid_parser', sprintf( __( 'Invalid parser specified: %s', 'wordpress-importer' ), $preferred_parser ) );
			}

			// If XMLParser succeeds or this is an invalid WXR file then return the results
			if ( ! is_wp_error( $result ) || 'XML_parse_error' != $result->get_error_code() ) {
				return $result;
			}
		} else {
			// Attempt to auto-select the best XML parser based on available extensions
			if ( extension_loaded( 'simplexml' ) ) {
				$parser = new WXR_Parser_SimpleXML();
				$result = $parser->parse( $file );

				// If SimpleXML succeeds or this is an invalid WXR file then return the results
				if ( ! is_wp_error( $result ) || 'SimpleXML_parse_error' != $result->get_error_code() ) {
					return $result;
				}
			} elseif ( extension_loaded( 'xml' ) ) {
				$parser = new WXR_Parser_XML();
				$result = $parser->parse( $file );

				// If XMLParser succeeds or this is an invalid WXR file then return the results
				if ( ! is_wp_error( $result ) || 'XML_parse_error' != $result->get_error_code() ) {
					return $result;
				}
			}
		}

		// We have a malformed XML file, so display the error and fallthrough to regex
		if ( isset( $result ) && defined( 'IMPORT_DEBUG' ) && IMPORT_DEBUG ) {
			echo '<pre>';
			if ( 'SimpleXML_parse_error' == $result->get_error_code() ) {
				foreach ( $result->get_error_data() as $error ) {
					echo $error->line . ':' . $error->column . ' ' . esc_html( $error->message ) . "\n";
				}
			} elseif ( 'XML_parse_error' == $result->get_error_code() ) {
				$error = $result->get_error_data();
				echo $error[0] . ':' . $error[1] . ' ' . esc_html( $error[2] );
			}
			echo '</pre>';
			echo '<p><strong>' . __( 'There was an error when reading this WXR file', 'wordpress-importer' ) . '</strong><br />';
			echo __( 'Details are shown above. The importer will now try again with a different parser...', 'wordpress-importer' ) . '</p>';
		}

		// use regular expressions if nothing else available or this is bad XML
		$parser = new WXR_Parser_XML_Processor();
		return $parser->parse( $file );
	}
}
