import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { SkillsPanel } from './skills-panel';
import type { Connector, GlobalSkill } from '@/data/core';

const skill = ( id: string, source: GlobalSkill[ 'source' ], enabled: boolean ): GlobalSkill => ( {
	id,
	displayName: id.charAt( 0 ).toUpperCase() + id.slice( 1 ).replace( /-/g, ' ' ),
	description: `Use ${ id }.`,
	enabled,
	source,
	directory: `/skills/${ id }`,
} );

function setup( {
	initial = [
		skill( 'brand-voice', 'studio', true ),
		skill( 'client-handoff', 'studio', false ),
		skill( 'changelog', 'agents', false ),
	],
	fail = false,
	capabilities = {},
}: {
	initial?: GlobalSkill[];
	fail?: boolean;
	capabilities?: Partial< Connector[ 'capabilities' ] >;
} = {} ) {
	let skills = initial;
	const connector = createFakeConnector(
		{},
		{
			capabilities,
			getGlobalSkills: async () => skills.map( ( entry ) => ( { ...entry } ) ),
			setGlobalSkillEnabled: async ( source, id, enabled ) => {
				if ( fail ) {
					throw new Error( 'Could not update skill' );
				}
				skills = skills.map( ( entry ) =>
					entry.source === source && entry.id === id ? { ...entry, enabled } : entry
				);
			},
			removeGlobalSkill: async ( id ) => {
				skills = skills.filter( ( entry ) => entry.source !== 'studio' || entry.id !== id );
			},
		}
	);
	const onManageSite = vi.fn();
	renderWithProviders( <SkillsPanel onManageSite={ onManageSite } />, { connector } );
	return { connector, onManageSite };
}

const toggle = ( name: string ) => screen.getByRole( 'switch', { name } );

describe( 'skills for all sites', () => {
	it( "lists Studio's own skills with their commands, and not the other agents'", async () => {
		const { onManageSite } = setup();
		expect( await screen.findByText( '/brand-voice' ) ).toBeVisible();
		expect( toggle( 'Brand voice' ) ).toBeChecked();
		expect( toggle( 'Client handoff' ) ).not.toBeChecked();
		expect( screen.queryByText( '/changelog' ) ).not.toBeInTheDocument();
		expect(
			screen.getByText( 'Skills that work on every site. Switches here change all sites.', {
				exact: false,
			} )
		).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'In Studio 2' } ) ).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Skills for this site' } ) );
		expect( onManageSite ).toHaveBeenCalled();
	} );

	it( 'switches a skill off and on for all sites', async () => {
		const { connector } = setup();
		await screen.findByText( '/brand-voice' );
		fireEvent.click( toggle( 'Brand voice' ) );
		await waitFor( () => expect( toggle( 'Brand voice' ) ).not.toBeChecked() );
		expect( connector.setGlobalSkillEnabled ).toHaveBeenCalledWith(
			'studio',
			'brand-voice',
			false
		);
		expect( connector.removeGlobalSkill ).not.toHaveBeenCalled();
	} );

	it( 'shows the skills found on this computer, off until switched on, and never deletes them', async () => {
		const { connector } = setup();
		await screen.findByText( '/brand-voice' );
		fireEvent.click( screen.getByRole( 'button', { name: 'On this computer 1' } ) );
		expect( screen.getByText( '/changelog' ) ).toBeVisible();
		expect( screen.queryByText( '/brand-voice' ) ).not.toBeInTheDocument();
		expect( screen.getByText( /Skills in ~\/\.agents\/skills/ ) ).toBeVisible();

		fireEvent.click( toggle( 'Changelog' ) );
		await waitFor( () => expect( toggle( 'Changelog' ) ).toBeChecked() );
		expect( connector.setGlobalSkillEnabled ).toHaveBeenCalledWith( 'agents', 'changelog', true );

		fireEvent.click( screen.getByRole( 'button', { name: 'Actions for Changelog' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Open in' } ) );
		expect( screen.queryByRole( 'menuitem', { name: 'Delete' } ) ).not.toBeInTheDocument();
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Finder' } ) );
		await waitFor( () =>
			expect( connector.openGlobalSkill ).toHaveBeenCalledWith( 'agents', 'changelog' )
		);
	} );

	it( "asks before it deletes one of Studio's own", async () => {
		const { connector } = setup();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Actions for Brand voice' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Delete' } ) );
		const dialog = await screen.findByRole( 'alertdialog', { name: 'Delete skill' } );
		expect( dialog ).toHaveTextContent( 'Delete “Brand voice” from all sites?' );
		expect( connector.removeGlobalSkill ).not.toHaveBeenCalled();
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Delete skill' } ) );
		await waitFor( () =>
			expect( connector.removeGlobalSkill ).toHaveBeenCalledWith( 'brand-voice' )
		);
		await waitFor( () => expect( screen.queryByText( '/brand-voice' ) ).not.toBeInTheDocument() );
	} );

	it( "adds a skill for all sites from the form, and opens one of Studio's to change it", async () => {
		const { connector } = setup();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Add skill' } ) );
		const form = await screen.findByRole( 'form', { name: 'New skill' } );
		expect( within( form ).getByText( 'All sites' ) ).toBeVisible();
		for ( const [ name, value ] of [
			[ 'Name', 'Launch checklist' ],
			[ 'When should agents use it?', 'Check a site before it goes live.' ],
			[ 'Instructions', '1. Check the forms.' ],
		] ) {
			fireEvent.change( screen.getByRole( 'textbox', { name } ), { target: { value } } );
		}
		fireEvent.click( within( form ).getByRole( 'button', { name: 'Create skill' } ) );
		await waitFor( () =>
			expect( connector.createSkill ).toHaveBeenCalledWith( null, {
				name: 'Launch checklist',
				description: 'Check a site before it goes live.',
				instructions: '1. Check the forms.',
			} )
		);

		fireEvent.click( await screen.findByRole( 'button', { name: 'Actions for Brand voice' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Edit' } ) );
		await waitFor( () => expect( connector.getSkill ).toHaveBeenCalledWith( null, 'brand-voice' ) );
	} );

	it( "never offers to change another agent's skill here", async () => {
		setup();
		fireEvent.click( await screen.findByRole( 'button', { name: 'On this computer 1' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Actions for Changelog' } ) );
		expect( await screen.findByRole( 'menuitem', { name: 'Open in' } ) ).toBeVisible();
		expect( screen.queryByRole( 'menuitem', { name: 'Edit' } ) ).not.toBeInTheDocument();
	} );

	it( 'searches the list', async () => {
		setup();
		fireEvent.change( await screen.findByRole( 'searchbox', { name: 'Search skills' } ), {
			target: { value: 'handoff' },
		} );
		expect( screen.getByText( '/client-handoff' ) ).toBeVisible();
		expect( screen.queryByText( '/brand-voice' ) ).not.toBeInTheDocument();
	} );

	it( 'explains where skills go when there are none', async () => {
		setup( { initial: [] } );
		expect( await screen.findByText( 'No skills for all sites yet' ) ).toBeVisible();
		expect( screen.queryByRole( 'searchbox' ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'On this computer 0' } ) );
		expect( screen.getByText( 'No skills found on this computer' ) ).toBeVisible();
	} );

	it( "leaves out another computer's skills and folders", async () => {
		setup( { capabilities: { localMachine: false } } );
		await screen.findByText( '/brand-voice' );
		expect( screen.queryByRole( 'button', { name: /On this computer/ } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Actions for Brand voice' } ) );
		expect( await screen.findByRole( 'menuitem', { name: 'Delete' } ) ).toBeVisible();
		expect( screen.queryByRole( 'menuitem', { name: 'Open in' } ) ).not.toBeInTheDocument();
	} );

	it( 'keeps the original state and shows an error when updating fails', async () => {
		setup( { fail: true } );
		await screen.findByText( '/brand-voice' );
		fireEvent.click( toggle( 'Brand voice' ) );
		await screen.findByText( 'Could not update skill' );
		expect( toggle( 'Brand voice' ) ).toBeChecked();
	} );
} );
