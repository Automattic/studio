<?php

declare( strict_types=1 );

namespace Rowbot\URL\String;

use Countable;
use IteratorAggregate;

/**
 * @extends IteratorAggregate<int, USVStringInterface>
 */
interface StringListInterface extends Countable, IteratorAggregate {
	/**
	 * @return USVStringInterface
	 */
	public function first();

	public function isEmpty(): bool;

	/**
	 * @return USVStringInterface
	 */
	public function last();

	/**
	 * @return USVStringInterface|null
	 */
	public function pop();

	/**
	 * @param  USVStringInterface  $item
	 */
	public function push( $item ): void;
}
