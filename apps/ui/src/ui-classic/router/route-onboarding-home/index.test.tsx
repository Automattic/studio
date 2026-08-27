import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPendingBackup, peekPendingBackup } from '@/lib/pending-backup';
import { OnboardingHomePage } from './index';
import type { ComponentProps } from 'react';

const mocks = vi.hoisted( () => ( {
	navigate: vi.fn(),
	hasSites: false,
	isOffline: false,
} ) );

vi.mock( '@tanstack/react-router', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@tanstack/react-router') >();
	return {
		...actual,
		Link: ( { to, children, ...props }: ComponentProps< 'a' > & { to: string } ) => (
			<a href={ to } { ...props }>
				{ children }
			</a>
		),
		useNavigate: () => mocks.navigate,
	};
} );

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: () => ( { data: mocks.hasSites ? [ { id: 'site-1' } ] : [] } ),
} ) );

vi.mock( '@/hooks/use-offline', () => ( {
	useOffline: () => mocks.isOffline,
} ) );

describe( 'OnboardingHomePage', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		mocks.hasSites = false;
		mocks.isOffline = false;
		clearPendingBackup();
	} );

	it( 'shows Create, Blueprint, Connect, and Import in that order', () => {
		render( <OnboardingHomePage /> );

		expect( screen.getByRole( 'heading', { name: 'Add a site' } ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Start fresh or bring an existing site into your Studio.' )
		).toBeInTheDocument();
		const create = screen.getByRole( 'link', { name: /Create a new site/ } );
		const blueprint = screen.getByRole( 'link', { name: /Start from a Blueprint/ } );
		const connect = screen.getByRole( 'link', { name: /Connect a site/ } );
		const importBackup = screen.getByRole( 'button', { name: /Import from a backup/ } );

		expect( create ).toHaveAttribute( 'href', '/onboarding/create' );
		expect( blueprint ).toHaveAttribute( 'href', '/onboarding/blueprint' );
		expect( connect ).toHaveAttribute( 'href', '/onboarding/connect' );
		expect( importBackup ).toBeEnabled();
		expect( create.compareDocumentPosition( blueprint ) ).toBe( Node.DOCUMENT_POSITION_FOLLOWING );
		expect( blueprint.compareDocumentPosition( connect ) ).toBe( Node.DOCUMENT_POSITION_FOLLOWING );
		expect( connect.compareDocumentPosition( importBackup ) ).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
	} );

	it( 'marks Connect and Blueprint unavailable while offline', () => {
		mocks.isOffline = true;
		render( <OnboardingHomePage /> );

		expect( screen.getByRole( 'link', { name: /Connect a site/ } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.getByRole( 'link', { name: /Start from a Blueprint/ } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.getAllByText( 'Available online' ) ).toHaveLength( 2 );
	} );

	it( 'opens the file picker from the Import card', () => {
		const { container } = render( <OnboardingHomePage /> );
		const input = container.querySelector< HTMLInputElement >( 'input[type="file"]' );
		if ( ! input ) throw new Error( 'Backup input not found' );
		const click = vi.spyOn( input, 'click' );

		fireEvent.click( screen.getByRole( 'button', { name: /Import from a backup/ } ) );

		expect( click ).toHaveBeenCalledOnce();
		expect( input.accept ).toContain( '.zip' );
		expect( input.accept ).toContain( '.xml' );
		// A database dump has no files to go with it, so it can only be imported
		// over an existing site.
		expect( input.accept ).not.toContain( '.sql' );
	} );

	it( 'rejects a .sql dump, which can only be imported over an existing site', () => {
		const { container } = render( <OnboardingHomePage /> );
		const input = container.querySelector< HTMLInputElement >( 'input[type="file"]' );
		if ( ! input ) throw new Error( 'Backup input not found' );

		fireEvent.change( input, { target: { files: [ new File( [ 'dump' ], 'client-site.sql' ) ] } } );

		expect( peekPendingBackup() ).toBeNull();
		expect( mocks.navigate ).not.toHaveBeenCalled();
		expect( screen.getByRole( 'alert' ) ).toHaveTextContent( 'This file type is not supported' );
	} );

	it( 'hands a selected backup File to the import form', () => {
		const { container } = render( <OnboardingHomePage /> );
		const input = container.querySelector< HTMLInputElement >( 'input[type="file"]' );
		if ( ! input ) throw new Error( 'Backup input not found' );
		const file = new File( [ 'backup' ], 'client-site.tar.gz' );

		fireEvent.change( input, { target: { files: [ file ] } } );

		expect( peekPendingBackup() ).toBe( file );
		expect( mocks.navigate ).toHaveBeenCalledWith( { to: '/onboarding/import' } );
	} );

	it( 'hands a dropped backup File to the import form', () => {
		render( <OnboardingHomePage /> );
		const file = new File( [ 'backup' ], 'client-site.tar.gz' );

		fireEvent.drop( screen.getByRole( 'button', { name: /Import from a backup/ } ), {
			dataTransfer: { files: [ file ] },
		} );

		expect( peekPendingBackup() ).toBe( file );
		expect( mocks.navigate ).toHaveBeenCalledWith( { to: '/onboarding/import' } );
	} );

	it( 'keeps the drag state while moving across the Import card contents', () => {
		render( <OnboardingHomePage /> );
		const importCard = screen.getByRole( 'button', { name: /Import from a backup/ } );
		const cardContents = screen.getByText( 'Import from a backup' );

		fireEvent.dragOver( importCard );
		const draggingClassName = importCard.className;
		const childDragLeave = new Event( 'dragleave', { bubbles: true, cancelable: true } );
		Object.defineProperty( childDragLeave, 'relatedTarget', { value: cardContents } );
		fireEvent( importCard, childDragLeave );

		expect( importCard ).toHaveClass( draggingClassName, { exact: true } );

		fireEvent.dragLeave( importCard );
		expect( importCard ).not.toHaveClass( draggingClassName, { exact: true } );
	} );

	it( 'rejects unsupported selected and dropped files', () => {
		const { container } = render( <OnboardingHomePage /> );
		const input = container.querySelector< HTMLInputElement >( 'input[type="file"]' );
		if ( ! input ) throw new Error( 'Backup input not found' );
		const importCard = screen.getByRole( 'button', { name: /Import from a backup/ } );

		fireEvent.change( input, {
			target: { files: [ new File( [ 'text' ], 'notes.txt' ) ] },
		} );
		expect( screen.getByRole( 'alert' ) ).toHaveTextContent( 'This file type is not supported' );

		fireEvent.drop( importCard, {
			dataTransfer: { files: [ new File( [ 'image' ], 'screenshot.png' ) ] },
		} );
		expect( screen.getByRole( 'alert' ) ).toHaveTextContent( 'This file type is not supported' );
		expect( peekPendingBackup() ).toBeNull();
		expect( mocks.navigate ).not.toHaveBeenCalled();
	} );

	it( 'shows Back when onboarding was opened from an existing site', () => {
		mocks.hasSites = true;
		render( <OnboardingHomePage /> );

		expect( screen.getByRole( 'button', { name: 'Back' } ) ).toBeInTheDocument();
	} );
} );
