<?php

namespace WordPress\ByteStream\ReadStream;

use WordPress\ByteStream\ByteStreamException;
use WordPress\ByteStream\NotEnoughDataException;

abstract class BaseByteReadStream implements ByteReadStream {

	const CHUNK_SIZE_BYTES = 64 * 1024; // 64kb.

	/**
	 * The maximum number of consumed bytes to keep in memory.
	 *
	 * For example:
	 *
	 *     The quick brown fox jumps over the lazy dog.
	 *     ^-------------------^
	 *         consumed bytes
	 *
	 * Say the maximum lookbehind bytes is 4. Then the byte stream will forget about
	 * all consumed bytes except the last 4:
	 *
	 *     fox jumps over the lazy dog.
	 *     ^--^
	 *       consumed but retained for seek()-ing backwards.
	 *
	 * @var int
	 */
	protected $max_lookbehind_bytes = 2048;

	/**
	 * The remaining unconsumed bytes.
	 *
	 * @var string
	 */
	protected $buffer = '';

	/**
	 * How many bytes have already been consumed in the current **buffer**.
	 *
	 * @var int
	 */
	protected $offset_in_current_buffer = 0;

	/**
	 * How many bytes have already been forgotten in the current **stream**.
	 *
	 * @var int
	 */
	protected $bytes_already_forgotten = 0;

	/**
	 * Whether the stream has been closed for reading.
	 *
	 * @var bool
	 */
	protected $is_read_closed = false;

	/**
	 * How many bytes are expected in the stream. Optional.
	 *
	 * When it's null, the stream is unbounded and length() will also return null.
	 *
	 * @var int|null
	 */
	protected $expected_length = null;

	public function length(): ?int {
		return $this->expected_length;
	}

	public function pull( ?int $n = self::CHUNK_SIZE_BYTES, string $mode = self::PULL_NO_MORE_THAN ): int {
		switch ( $mode ) {
			case self::PULL_NO_MORE_THAN:
			case self::PULL_EXACTLY:
				break;
			default:
				throw new ByteStreamException( 'Invalid pull mode' );
		}
		if ( $this->is_read_closed ) {
			throw new ByteStreamException( 'Cannot pull() on a closed producer' );
		}

		if ( 0 === $n ) {
			return 0;
		}

		if ( $n < 0 ) {
			throw new ByteStreamException( 'Cannot pull a negative number of bytes' );
		}

		if ( $n <= $this->count_consumable_bytes() ) {
			return $n;
		}

		if ( $this->reached_end_of_data() ) {
			if ( ByteReadStream::PULL_EXACTLY === $mode ) {
				throw new NotEnoughDataException( 'End of data reached while pulling' );
			}

			return 0;
		}

		if ( ByteReadStream::PULL_NO_MORE_THAN === $mode ) {
			return $this->pull_no_more_than( $n );
		}

		return $this->pull_exactly( $n );
	}

	protected function pull_exactly( $n ): int {
		$empty_pulls = 0;
		while ( $this->count_consumable_bytes() < $n ) {
			$consumable_before = $this->count_consumable_bytes();
			$this->pull_no_more_than( $n );
			$consumable_after = $this->count_consumable_bytes();

			if ( $consumable_after === $consumable_before ) {
				++$empty_pulls;
				if ( $this->reached_end_of_data() ) {
					throw new NotEnoughDataException( 'End of data reached while pulling' );
				}
			}

			if ( $empty_pulls > 4 ) {
				throw new NotEnoughDataException( '4 empty pulls in a row, we are probably at the end of the data' );
			}
		}

		return $n;
	}

	protected function pull_no_more_than( $n ): int {
		$this->buffer .= $this->internal_pull( self::CHUNK_SIZE_BYTES );

		return min( $n, $this->count_consumable_bytes() );
	}

	public function consume_all(): string {
		$body = '';
		while ( true ) {
			if ( $this->reached_end_of_data() ) {
				return $body;
			}
			$consumable = $this->pull( self::CHUNK_SIZE_BYTES );
			$body      .= $this->consume( $consumable );
		}
	}

	protected function count_consumable_bytes(): int {
		return strlen( $this->buffer ) - $this->offset_in_current_buffer;
	}

	abstract protected function internal_pull( $n ): string;

	public function peek( int $n ): string {
		return substr( $this->buffer, $this->offset_in_current_buffer, $n );
	}

	public function consume( int $n ): string {
		if ( strlen( $this->buffer ) < $this->offset_in_current_buffer + $n ) {
			throw new NotEnoughDataException( 'Cannot consume more bytes than available in the buffer.' );
		}
		$bytes                           = substr( $this->buffer, $this->offset_in_current_buffer, $n );
		$this->offset_in_current_buffer += $n;
		if ( $this->offset_in_current_buffer > $this->max_lookbehind_bytes ) {
			$overflow                        = $this->offset_in_current_buffer - $this->max_lookbehind_bytes;
			$this->offset_in_current_buffer -= $overflow;
			$this->bytes_already_forgotten  += $overflow;
			$this->buffer                    = substr( $this->buffer, $overflow );
		}

		return $bytes;
	}

	public function seek( int $target_offset ): void {
		// We have that offset in the buffer, let's just update the pointer.
		if ( $target_offset >= $this->bytes_already_forgotten && $target_offset <= $this->bytes_already_forgotten + strlen( $this->buffer ) ) {
			$this->offset_in_current_buffer = $target_offset - $this->bytes_already_forgotten;

			return;
		}
		if ( null !== $this->length() && $target_offset > $this->length() ) {
			$length = $this->length();
			throw new NotEnoughDataException(
				esc_html(
					sprintf(
						'Cannot seek to past the stream length (seeked to %d, stream length is %d).',
						$target_offset,
						$length
					)
				)
			);
		}

		if ( $target_offset < 0 ) {
			throw new ByteStreamException( 'Cannot seek to a negative offset' );
		}

		// Seeking outside of buffer range, we need a producer-specific implementation.
		$this->seek_outside_of_buffer( $target_offset );
	}

	protected function seek_outside_of_buffer( int $target_offset ): void {
		throw new ByteStreamException( 'Cannot seek outside of the buffered range' );
	}

	public function tell(): int {
		return $this->bytes_already_forgotten + $this->offset_in_current_buffer;
	}

	public function reached_end_of_data(): bool {
		if ( $this->is_read_closed ) {
			return true;
		}
		if ( $this->count_consumable_bytes() > 0 ) {
			return false;
		}
		if ( null !== $this->length() ) {
			return $this->tell() >= $this->length();
		}

		return $this->internal_reached_end_of_data();
	}

	protected function internal_reached_end_of_data(): bool {
		return false;
	}

	public function close_reading(): void {
		$this->is_read_closed = true;
		$this->internal_close_reading();
	}

	protected function internal_close_reading(): void {
	}
}
