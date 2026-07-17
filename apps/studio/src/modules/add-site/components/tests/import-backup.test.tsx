import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ImportBackup from '../import-backup';

vi.mock( 'src/components/learn-more', () => ( {
	LearnMoreLink: () => <span>Learn more</span>,
} ) );

describe( 'ImportBackup', () => {
	it( 'accepts a SQL backup selected from the file picker', () => {
		const onFileSelect = vi.fn();
		render( <ImportBackup onFileSelect={ onFileSelect } /> );
		const input = screen.getByLabelText( 'Select backup file' );
		const file = new File( [ 'SELECT 1;' ], 'site.sql' );

		expect( input ).toHaveAttribute( 'accept', expect.stringContaining( '.sql' ) );
		fireEvent.change( input, { target: { files: [ file ] } } );

		expect( onFileSelect ).toHaveBeenCalledWith( file );
	} );

	it( 'lists every supported extension after an invalid drop', () => {
		render( <ImportBackup onFileSelect={ vi.fn() } /> );

		fireEvent.drop( screen.getByRole( 'button' ), {
			dataTransfer: { files: [ new File( [ 'text' ], 'notes.txt' ) ] },
		} );

		expect(
			screen.getByText( /\.zip, \.gz, \.gzip, \.tar, \.tar\.gz, \.wpress, or \.sql/ )
		).toBeVisible();
	} );
} );
