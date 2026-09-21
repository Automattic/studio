import { describe, expect, it } from 'vitest';
import { validateProposedSitePath, validateSelectedSitePath } from '../site-path-validation';

const availablePath = {
	path: '/sites/portfolio',
	isEmpty: true,
	isWordPress: false,
};

describe( 'validateProposedSitePath', () => {
	it( 'accepts an available path', () => {
		expect( validateProposedSitePath( availablePath, false ) ).toEqual( availablePath );
	} );

	it( 'rejects names that are too long', () => {
		expect(
			validateProposedSitePath( { ...availablePath, isNameTooLong: true }, false ).error
		).toBe( 'The site name is too long. Please choose a shorter site name.' );
	} );

	it( 'rejects paths already used by Studio', () => {
		expect( validateProposedSitePath( availablePath, true ).error ).toBe(
			'The directory is already associated with another Studio site. Please choose a different site name or a custom local path.'
		);
	} );

	it( 'rejects non-empty directories without WordPress', () => {
		expect( validateProposedSitePath( { ...availablePath, isEmpty: false }, false ).error ).toBe(
			'This directory is not empty. Please select an empty directory or an existing WordPress folder.'
		);
	} );
} );

describe( 'validateSelectedSitePath', () => {
	const selectedPath = { ...availablePath, name: 'portfolio' };

	it( 'preserves the selected folder name', () => {
		expect( validateSelectedSitePath( selectedPath, false ) ).toEqual( selectedPath );
	} );

	it( 'uses the custom-path conflict message', () => {
		expect( validateSelectedSitePath( selectedPath, true ).error ).toBe(
			'The directory is already associated with another Studio site. Please choose a different custom local path.'
		);
	} );

	it( 'allows an existing WordPress directory', () => {
		expect(
			validateSelectedSitePath( { ...selectedPath, isEmpty: false, isWordPress: true }, false )
		).toEqual( { ...selectedPath, isEmpty: false, isWordPress: true } );
	} );
} );
