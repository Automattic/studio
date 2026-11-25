import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { SiteSkillsLibrary } from './site-skills-library';
import type { SiteAgentFile } from '@/data/core';

const lookbook: SiteAgentFile = {
	id: 'lookbook-post',
	displayName: 'Lookbook post',
	description: 'Lay out a seasonal lookbook post.',
	installed: true,
	enabled: true,
};
const sizeGuide: SiteAgentFile = {
	id: 'size-guide',
	displayName: 'Size guide',
	description: '',
	installed: true,
	enabled: true,
};

function setup(
	initial: SiteAgentFile[] = [ lookbook, sizeGuide ],
	fail = false,
	overrides: Parameters< typeof createFakeConnector >[ 1 ] = {}
) {
	let files = initial.map( ( file ) => ( { ...file } ) );
	const connector = createFakeConnector(
		{ preferences: { editor: null, terminal: null } as never },
		{
			...overrides,
			getSiteAgentFiles: async () => files.map( ( file ) => ( { ...file } ) ),
			setSiteAgentFileEnabled: async ( _siteId, _kind, id, enabled ) => {
				if ( fail ) {
					throw new Error( 'Could not update skill' );
				}
				files = files.map( ( file ) => ( file.id === id ? { ...file, enabled } : file ) );
			},
			removeSiteAgentFile: async ( _siteId, _kind, id ) => {
				files = files.filter( ( file ) => file.id !== id );
			},
		}
	);
	const onManageAll = vi.fn();
	const onCreateInChat = vi.fn();
	renderWithProviders(
		<SiteSkillsLibrary
			site={ makeSite( { id: 'one', name: 'Moiré Journal' } ) }
			onManageAll={ onManageAll }
			onCreateInChat={ onCreateInChat }
		/>,
		{ connector }
	);
	return { connector, onManageAll, onCreateInChat };
}

describe( 'site skills library', () => {
	it( 'lists the skills in the site folder with their commands', async () => {
		setup();
		expect( await screen.findByText( '/lookbook-post' ) ).toBeVisible();
		expect( screen.getByText( 'Lay out a seasonal lookbook post.' ) ).toBeVisible();
		expect( screen.getByRole( 'switch', { name: 'Lookbook post' } ) ).toBeChecked();
		expect(
			screen.getByText(
				'Skills saved in the folder of Moiré Journal. They work on this site only.',
				{
					exact: false,
				}
			)
		).toBeVisible();
	} );

	it( 'leaves out the skills an older server lists that the site does not have', async () => {
		setup( [
			lookbook,
			{ ...sizeGuide, id: 'wp-rest-api', displayName: 'REST API', installed: false },
		] );
		await screen.findByText( '/lookbook-post' );
		expect( screen.queryByText( 'REST API' ) ).not.toBeInTheDocument();
	} );

	it( 'switches a skill off and on for this site', async () => {
		const { connector } = setup();
		fireEvent.click( await screen.findByRole( 'switch', { name: 'Lookbook post' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'switch', { name: 'Lookbook post' } ) ).not.toBeChecked()
		);
		expect( connector.setSiteAgentFileEnabled ).toHaveBeenCalledWith(
			'one',
			'skills',
			'lookbook-post',
			false
		);
		expect( connector.removeSiteAgentFile ).not.toHaveBeenCalled();
		await waitFor( () =>
			expect( screen.getByRole( 'switch', { name: 'Lookbook post' } ) ).not.toHaveAttribute(
				'data-disabled'
			)
		);
		fireEvent.click( screen.getByRole( 'switch', { name: 'Lookbook post' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'switch', { name: 'Lookbook post' } ) ).toBeChecked()
		);
	} );

	it( 'moves a switch at once and leaves the rest of the list alone while it saves', async () => {
		const saves: Array< () => void > = [];
		const { connector } = setup( [ lookbook, { ...sizeGuide, description: 'Size tables.' } ] );
		connector.setSiteAgentFileEnabled.mockImplementation(
			() => new Promise< void >( ( resolve ) => saves.push( resolve ) )
		);
		fireEvent.click( await screen.findByRole( 'switch', { name: 'Lookbook post' } ) );

		await waitFor( () =>
			expect( screen.getByRole( 'switch', { name: 'Lookbook post' } ) ).not.toBeChecked()
		);
		expect( saves ).toHaveLength( 1 );
		for ( const name of [ 'Lookbook post', 'Size guide' ] ) {
			expect( screen.getByRole( 'switch', { name } ) ).not.toHaveAttribute( 'data-disabled' );
		}
		expect( screen.getByRole( 'button', { name: 'Actions for Size guide' } ) ).toBeEnabled();

		// A second change waits for the first, and neither one snaps back meanwhile.
		fireEvent.click( screen.getByRole( 'switch', { name: 'Size guide' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'switch', { name: 'Size guide' } ) ).not.toBeChecked()
		);
		expect( saves ).toHaveLength( 1 );
		saves[ 0 ]();
		await waitFor( () => expect( saves ).toHaveLength( 2 ) );
		expect( screen.getByRole( 'switch', { name: 'Size guide' } ) ).not.toBeChecked();
		expect( connector.getSiteAgentFiles ).toHaveBeenCalledTimes( 1 );
		saves[ 1 ]();
		await waitFor( () => expect( connector.getSiteAgentFiles ).toHaveBeenCalledTimes( 2 ) );
	} );

	it( 'says what a skill without a description needs, and keeps it off', async () => {
		setup();
		expect(
			await screen.findByText( 'Add a description so agents know when to use it.' )
		).toBeVisible();
		expect( screen.getByRole( 'switch', { name: 'Size guide' } ) ).not.toBeChecked();
		expect( screen.getByRole( 'switch', { name: 'Size guide' } ) ).toHaveAttribute(
			'data-disabled'
		);
	} );

	it( 'searches by name, command and description', async () => {
		setup();
		const search = await screen.findByRole( 'textbox', { name: 'Search skills' } );
		fireEvent.change( search, { target: { value: 'seasonal' } } );
		expect( screen.getByText( '/lookbook-post' ) ).toBeVisible();
		expect( screen.queryByText( '/size-guide' ) ).not.toBeInTheDocument();
		fireEvent.change( search, { target: { value: 'size-g' } } );
		expect( screen.getByText( '/size-guide' ) ).toBeVisible();
		fireEvent.change( search, { target: { value: 'nothing like it' } } );
		expect( screen.getByText( 'No skills found' ) ).toBeVisible();
	} );

	it( 'explains where skills go when the site has none', async () => {
		const { onManageAll } = setup( [] );
		expect( await screen.findByText( 'No skills on this site yet' ) ).toBeVisible();
		expect( screen.getByRole( 'textbox', { name: 'Search skills' } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Skills for all sites' } ) );
		expect( onManageAll ).toHaveBeenCalled();
	} );

	it.each( [
		[ 'Finder', 'files' ],
		[ 'Terminal', 'terminal' ],
	] )( 'opens a skill in %s', async ( label, target ) => {
		const { connector } = setup();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Actions for Lookbook post' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Open in' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: label } ) );
		await waitFor( () =>
			expect( connector.openSiteAgentFile ).toHaveBeenCalledWith(
				'one',
				'skills',
				'lookbook-post',
				target
			)
		);
	} );

	it( 'asks before it deletes a skill', async () => {
		const { connector } = setup();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Actions for Lookbook post' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Delete' } ) );
		const dialog = await screen.findByRole( 'alertdialog', { name: 'Delete skill' } );
		expect( dialog ).toHaveTextContent( 'Delete “Lookbook post” from Moiré Journal?' );
		expect( connector.removeSiteAgentFile ).not.toHaveBeenCalled();

		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Delete skill' } ) );
		await waitFor( () =>
			expect( connector.removeSiteAgentFile ).toHaveBeenCalledWith(
				'one',
				'skills',
				'lookbook-post'
			)
		);
		await waitFor( () => expect( screen.queryByText( '/lookbook-post' ) ).not.toBeInTheDocument() );
	} );

	it( 'keeps the skill when the delete is cancelled', async () => {
		const { connector } = setup();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Actions for Lookbook post' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Delete' } ) );
		const dialog = await screen.findByRole( 'alertdialog', { name: 'Delete skill' } );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Cancel' } ) );
		await waitFor( () => expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument() );
		expect( connector.removeSiteAgentFile ).not.toHaveBeenCalled();
		expect( screen.getByText( '/lookbook-post' ) ).toBeVisible();
	} );

	describe( 'making and changing a skill', () => {
		const type = ( name: string, value: string ) =>
			fireEvent.change( screen.getByRole( 'textbox', { name } ), { target: { value } } );

		it( 'adds a skill from the form, which takes the place of the list', async () => {
			const { connector } = setup( [] );
			fireEvent.click( await screen.findByRole( 'button', { name: 'Add skill' } ) );

			const form = await screen.findByRole( 'form', { name: 'New skill' } );
			expect( screen.queryByText( 'No skills on this site yet' ) ).not.toBeInTheDocument();
			expect( within( form ).getByText( /Moiré Journal/ ) ).toBeVisible();
			const create = within( form ).getByRole( 'button', { name: 'Create skill' } );
			expect( create ).toBeDisabled();

			type( 'Name', 'Lookbook Post' );
			expect( within( form ).getByText( '/lookbook-post' ) ).toBeVisible();
			type( 'When should agents use it?', 'Lay out a seasonal lookbook post.' );
			type( 'Instructions', '1. Ask for the season.' );
			expect( within( form ).getByText( '22 / 20,000' ) ).toBeVisible();
			fireEvent.click( create );

			await waitFor( () =>
				expect( connector.createSkill ).toHaveBeenCalledWith( 'one', {
					name: 'Lookbook Post',
					description: 'Lay out a seasonal lookbook post.',
					instructions: '1. Ask for the season.',
				} )
			);
			expect( await screen.findByText( 'No skills on this site yet' ) ).toBeVisible();
		} );

		it( 'shows why a skill was not saved and keeps what was typed', async () => {
			setup( [], false, {
				createSkill: async () => {
					throw new Error( 'A skill named “lookbook-post” already exists.' );
				},
			} );
			fireEvent.click( await screen.findByRole( 'button', { name: 'Add skill' } ) );
			await screen.findByRole( 'form', { name: 'New skill' } );
			type( 'Name', 'Lookbook post' );
			type( 'When should agents use it?', 'Lay out a post.' );
			type( 'Instructions', 'Steps.' );
			fireEvent.click( screen.getByRole( 'button', { name: 'Create skill' } ) );

			expect( await screen.findByRole( 'alert' ) ).toHaveTextContent(
				'A skill named “lookbook-post” already exists.'
			);
			expect( screen.getByRole( 'textbox', { name: 'Instructions' } ) ).toHaveValue( 'Steps.' );
		} );

		it( 'hands what was typed to the chat', async () => {
			const { connector, onCreateInChat } = setup( [] );
			fireEvent.click( await screen.findByRole( 'button', { name: 'Add skill' } ) );
			await screen.findByRole( 'form', { name: 'New skill' } );
			type( 'Name', 'Lookbook post' );
			fireEvent.click( screen.getByRole( 'button', { name: 'Create in chat instead' } ) );

			expect( onCreateInChat ).toHaveBeenCalledWith( {
				name: 'Lookbook post',
				description: '',
				instructions: '',
			} );
			expect( connector.createSkill ).not.toHaveBeenCalled();
		} );

		it( 'asks before it drops what was typed', async () => {
			setup( [] );
			fireEvent.click( await screen.findByRole( 'button', { name: 'Add skill' } ) );
			await screen.findByRole( 'form', { name: 'New skill' } );
			type( 'Name', 'Lookbook post' );
			fireEvent.click( screen.getByRole( 'button', { name: 'Back to skills' } ) );

			const dialog = await screen.findByRole( 'alertdialog', { name: 'Discard changes?' } );
			fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Cancel' } ) );
			await waitFor( () => expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument() );
			expect( screen.getByRole( 'textbox', { name: 'Name' } ) ).toHaveValue( 'Lookbook post' );

			fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
			fireEvent.click(
				within( await screen.findByRole( 'alertdialog' ) ).getByRole( 'button', {
					name: 'Discard changes',
				} )
			);
			expect( await screen.findByText( 'No skills on this site yet' ) ).toBeVisible();
		} );

		it( 'opens a skill of the site to change it, with its files', async () => {
			const { connector } = setup( [ lookbook ], false, {
				getSkill: async () => ( {
					id: 'lookbook-post',
					displayName: 'Lookbook post',
					description: 'Lay out a seasonal lookbook post.',
					instructions: '1. Ask for the season.',
					files: [ 'SKILL.md', 'references/credits.md' ],
				} ),
				updateSkill: async () => 'season-post',
			} );
			fireEvent.click( await screen.findByRole( 'button', { name: 'Actions for Lookbook post' } ) );
			fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Edit' } ) );

			const form = await screen.findByRole( 'form', { name: 'Lookbook post' } );
			expect( connector.getSkill ).toHaveBeenCalledWith( 'one', 'lookbook-post' );
			expect( screen.getByRole( 'textbox', { name: 'Instructions' } ) ).toHaveValue(
				'1. Ask for the season.'
			);
			expect( within( form ).getByText( 'references/credits.md' ) ).toBeVisible();
			expect(
				within( form ).queryByRole( 'button', { name: 'Create in chat instead' } )
			).not.toBeInTheDocument();
			const save = within( form ).getByRole( 'button', { name: 'Save changes' } );
			expect( save ).toBeDisabled();

			type( 'Name', 'Season post' );
			expect( within( form ).getByText( '/season-post' ) ).toBeVisible();
			fireEvent.click( save );
			await waitFor( () =>
				expect( connector.updateSkill ).toHaveBeenCalledWith( 'one', 'lookbook-post', {
					name: 'Season post',
					description: 'Lay out a seasonal lookbook post.',
					instructions: '1. Ask for the season.',
				} )
			);
			expect( await screen.findByRole( 'textbox', { name: 'Search skills' } ) ).toBeVisible();
		} );

		it( 'offers neither where the server can only list skills', async () => {
			setup( [ lookbook ], false, { capabilities: { skillEditing: false } as never } );
			fireEvent.click( await screen.findByRole( 'button', { name: 'Actions for Lookbook post' } ) );
			expect( await screen.findByRole( 'menuitem', { name: 'Delete' } ) ).toBeVisible();
			expect( screen.queryByRole( 'menuitem', { name: 'Edit' } ) ).not.toBeInTheDocument();
			expect( screen.queryByRole( 'button', { name: 'Add skill' } ) ).not.toBeInTheDocument();
		} );
	} );

	it( 'leaves out the skills for all sites, which the App tab lists', async () => {
		setup( [
			lookbook,
			{
				id: 'brand-voice',
				displayName: 'Brand voice',
				description: 'Write in the house voice.',
				installed: true,
				enabled: true,
				globalSource: 'studio',
			},
		] );
		expect( await screen.findByText( '/lookbook-post' ) ).toBeVisible();
		expect( screen.queryByText( '/brand-voice' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'This site' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'All sites' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'group', { name: 'Filter skills' } ) ).not.toBeInTheDocument();
	} );

	it( 'keeps the original state and shows an error when updating fails', async () => {
		setup( [ lookbook ], true );
		fireEvent.click( await screen.findByRole( 'switch', { name: 'Lookbook post' } ) );
		await screen.findByText( 'Could not update skill' );
		expect( screen.getByRole( 'switch', { name: 'Lookbook post' } ) ).toBeChecked();
	} );
} );
