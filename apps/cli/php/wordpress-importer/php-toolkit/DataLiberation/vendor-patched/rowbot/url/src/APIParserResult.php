<?php

declare( strict_types=1 );

namespace Rowbot\URL;

final class APIParserResult {
	/**
	 * @readonly
	 * @var URLRecord|null
	 */
	public $url;

	/**
	 * @readonly
	 * @var APIParserErrorType
	 */
	public $error;

	/**
	 * @param  APIParserErrorType::*  $error
	 */
	public function __construct( ?URLRecord $urlRecord, $error ) {
		$this->url   = $urlRecord;
		$this->error = $error;
	}
}
