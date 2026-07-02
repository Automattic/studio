<?php

namespace WordPress\ByteStream\ReadStream;

use WordPress\ByteStream\ByteStreamException;

class FileReadStream extends BaseByteReadStream {

	protected $file_pointer;

	public static function from_path( $file_path ) {
		if ( ! file_exists( $file_path ) ) {
			throw new ByteStreamException( esc_html( sprintf( 'File %s does not exist', $file_path ) ) );
		}
		if ( ! is_file( $file_path ) ) {
			throw new ByteStreamException( esc_html( sprintf( '%s is not a file', $file_path ) ) );
		}
		$handle = fopen( $file_path, 'r' );
		if ( ! $handle ) {
			throw new ByteStreamException( esc_html( sprintf( 'Failed to open file %s', $file_path ) ) );
		}

		return self::from_resource( $handle, filesize( $file_path ) );
	}

	public static function from_resource( $handle, $expected_length = null ) {
		if ( ! is_resource( $handle ) ) {
			throw new ByteStreamException( 'Invalid file pointer provided' );
		}

		return new self( $handle, $expected_length );
	}

	public function __construct( $fp, $expected_length = null ) {
		$this->file_pointer    = $fp;
		$this->expected_length = $expected_length;
	}

	protected function internal_pull( $n ): string {
		$bytes = fread( $this->file_pointer, $n );
		/**
		 * Workaround for a streaming bug in WordPress Playground.
		 *
		 * Without the feof() call, Playground doesn't notice when the stream reaches EOF.
		 * The feof() call in internal_reached_end_of_data() somehow does not trigger the
		 * EOF event. It must be here, right after fread().
		 *
		 * @TODO: Improve the streaming support in WordPress Playground.
		 */
		feof( $this->file_pointer );
		if ( false === $bytes ) {
			throw new ByteStreamException( 'Failed to read from file' );
		}

		return $bytes;
	}

	protected function seek_outside_of_buffer( int $target_offset ): void {
		$retval = fseek( $this->file_pointer, $target_offset );
		if ( -1 === $retval ) {
			throw new ByteStreamException( 'Failed to seek to offset' );
		}

		$this->buffer                   = '';
		$this->offset_in_current_buffer = 0;
		$this->bytes_already_forgotten  = $target_offset;
	}

	public function close_reading(): void {
		if ( $this->is_read_closed ) {
			return;
		}
		$this->is_read_closed = true;
		$this->buffer         = '';
		if ( ! fclose( $this->file_pointer ) ) {
			throw new ByteStreamException( 'Failed to close file pointer' );
		}
		$this->file_pointer = null;
	}

	protected function internal_reached_end_of_data(): bool {
		return ! is_resource( $this->file_pointer ) || feof( $this->file_pointer );
	}
}
