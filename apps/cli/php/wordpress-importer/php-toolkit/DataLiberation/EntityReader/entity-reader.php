<?php

namespace WordPress\DataLiberation\EntityReader;

/**
 * The Entity Reader ingests content from a source and breaks it down into
 * individual "entities" that WordPress understands - posts, comments, metadata, etc.
 */
interface EntityReader {

	/**
	 * Gets the current entity being processed.
	 *
	 * @return ImportedEntity|false The current entity, or false if none available
	 */
	public function get_entity();

	/**
	 * Advances to the next entity in the source content.
	 *
	 * This is where each data source implements its own logic for parsing the bytes
	 * and extracting the next meaningful piece of content.
	 *
	 * @return bool Whether we successfully moved to the next entity
	 */
	public function next_entity();

	/**
	 * Checks if we've processed everything from the source.
	 *
	 * @return bool Whether we've processed everything from the source
	 */
	public function is_finished(): bool;

	/**
	 * Returns a cursor position that can be used to resume processing later.
	 *
	 * This allows for processing large imports in chunks without losing your place.
	 * Not all readers support this yet.
	 *
	 * @TODO: Define a general interface for entity readers.
	 * @return string Position marker for resuming later
	 */
	public function get_reentrancy_cursor();
}
