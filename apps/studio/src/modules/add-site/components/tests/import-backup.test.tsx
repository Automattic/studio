import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ImportBackup from '../import-backup';

vi.mock( 'src/components/learn-more', () => ( {
	LearnMoreLink: () => <span>Learn more</span>,
} ) );

describe( 'ImportBackup', () => {
	it( 'rejects SQL selected for a new site while preserving XML support', () => {
		const onFileSelect = vi.fn();
		render( <ImportBackup onFileSelect={ onFileSelect } /> );
		const input = screen.getByLabelText( 'Select backup file' );

		expect( input.getAttribute( 'accept' ) ).not.toContain( '.sql' );
		expect( input ).toHaveAttribute( 'accept', expect.stringContaining( '.xml' ) );
		fireEvent.change( input, {
			target: { files: [ new File( [ 'SELECT 1;' ], 'site.sql' ) ] },
		} );

		expect( onFileSelect ).not.toHaveBeenCalled();
		expect( screen.getByText( /This file type is not supported/ ) ).toBeVisible();

		const xml = new File( [ '<rss />' ], 'site.xml' );
		fireEvent.change( input, { target: { files: [ xml ] } } );
		expect( onFileSelect ).toHaveBeenCalledWith( xml );
	} );

	it( 'rejects a dropped SQL file for a new site', () => {
		const onFileSelect = vi.fn();
		render( <ImportBackup onFileSelect={ onFileSelect } /> );

		fireEvent.drop( screen.getByRole( 'button' ), {
			dataTransfer: { files: [ new File( [ 'SELECT 1;' ], 'site.sql' ) ] },
		} );

		expect( onFileSelect ).not.toHaveBeenCalled();
		expect( screen.getByText( /This file type is not supported/ ) ).toBeVisible();
	} );
} );
