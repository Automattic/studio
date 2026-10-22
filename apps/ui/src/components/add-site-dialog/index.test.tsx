import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applySyncActivity } from '@/data/sync-activity';
import { useAddSite } from './context';
import { AddSiteDialog } from './index';
import type { Blueprint } from '@studio/common/lib/studio-blueprints-api';

const mocks = vi.hoisted( () => ( {
	navigate: vi.fn(),
	search: {} as Record< string, unknown >,
	setPins: vi.fn(),
} ) );

const BLOG = { slug: 'personal-blog-2', title: 'Personal Blog' } as Blueprint;

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => mocks.navigate,
	useSearch: () => mocks.search,
} ) );

vi.mock( '@/data/queries/use-sidebar-pins', () => ( {
	sitePinKey: ( id: string ) => `site:${ id }`,
	useSidebarPins: () => ( { pins: [ 'site:old' ], setPins: mocks.setPins } ),
} ) );

vi.mock( './blueprint-gallery', () => ( {
	getUseCases: () => [ { value: 'blog', label: 'Blog' } ],
	getUseCaseLabel: () => 'Blog',
	BlueprintGallery: ( { onView }: { onView: ( blueprint: Blueprint ) => void } ) => (
		<button type="button" onClick={ () => onView( BLOG ) }>
			Personal Blog card
		</button>
	),
} ) );

function Panel( { name }: { name: string } ) {
	const { setProgress, followSite, pinNewSite } = useAddSite();
	return (
		<>
			<p>{ name } panel</p>
			<button type="button" onClick={ () => setProgress( 'Creating site…' ) }>
				Start work
			</button>
			<button type="button" onClick={ () => followSite( 'importing' ) }>
				Follow site
			</button>
			<button type="button" onClick={ () => pinNewSite( 'new' ) }>
				Finish
			</button>
		</>
	);
}

vi.mock( './blueprint-details', () => ( {
	BlueprintDetails: () => <Panel name="Details" />,
} ) );
vi.mock( './create-panel', () => ( { CreatePanel: () => <Panel name="Create" /> } ) );
vi.mock( './connect-panel', () => ( { ConnectPanel: () => <Panel name="Connect" /> } ) );
vi.mock( './import-panel', () => ( {
	BackupDropZone: () => <Panel name="Import" />,
	ImportPanel: () => <Panel name="Import setup" />,
} ) );

describe( 'AddSiteDialog', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		mocks.search = {};
	} );

	it( 'opens on the section in the URL and moves between starting points', () => {
		mocks.search = { addSite: 'connect' };
		render( <AddSiteDialog /> );
		expect( screen.getByText( 'Connect panel' ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Create' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Personal Blog card' } ) );

		expect( screen.getByText( 'Details panel' ) ).toBeVisible();
		expect( screen.queryByRole( 'navigation' ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Blueprints' } ) );
		expect( screen.getByRole( 'button', { name: 'Personal Blog card' } ) ).toBeVisible();
	} );

	it( 'closes by clearing the URL', () => {
		mocks.search = { addSite: 'connect', pin: true, settings: 'general' };
		render( <AddSiteDialog /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Close Add site' } ) );

		const { search } = mocks.navigate.mock.calls[ 0 ][ 0 ];
		expect( search( mocks.search ) ).toEqual( { settings: 'general' } );
	} );

	it( 'stays open while a panel is working', () => {
		mocks.search = { addSite: 'connect' };
		render( <AddSiteDialog /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Start work' } ) );

		expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'Creating site…' );
		expect( screen.getByRole( 'button', { name: 'Close Add site' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
	} );

	it( 'shows the progress the CLI publishes for the site a panel follows', () => {
		mocks.search = { addSite: 'connect' };
		render( <AddSiteDialog /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Start work' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Follow site' } ) );
		act( () => {
			applySyncActivity( 'importing', {
				kind: 'pending',
				direction: 'import',
				message: '25% · Extracting…',
			} );
		} );

		expect( screen.getByRole( 'status' ) ).toHaveTextContent( '25% · Extracting…' );
	} );

	it( 'pins the new site only when opened from the Pinned group', () => {
		mocks.search = { addSite: 'connect', pin: true };
		const { unmount } = render( <AddSiteDialog /> );
		fireEvent.click( screen.getByRole( 'button', { name: 'Finish' } ) );
		expect( mocks.setPins ).toHaveBeenCalledWith( [ 'site:new', 'site:old' ] );
		unmount();

		mocks.setPins.mockClear();
		mocks.search = { addSite: 'connect' };
		render( <AddSiteDialog /> );
		fireEvent.click( screen.getByRole( 'button', { name: 'Finish' } ) );
		expect( mocks.setPins ).not.toHaveBeenCalled();
	} );
} );
