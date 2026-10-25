import { describe, expect, it } from 'vitest';
import {
	applyCommandToDraft,
	getCommandGroups,
	getComposerCommands,
} from '@/features/composer/composer-commands';

const names = ( commands: { name: string }[] ) => commands.map( ( command ) => command.name );

describe( 'getComposerCommands', () => {
	const base = {
		canAutoStart: false,
		autoStartOn: false,
		canChooseModel: false,
		environment: 'local' as const,
		canChangeEnvironment: false,
	};

	it( 'always offers connecting a provider', () => {
		expect( names( getComposerCommands( base ) ) ).toEqual( [ 'connect-provider' ] );
	} );

	it( 'offers auto-start until it is on, and the model when it can be chosen', () => {
		expect(
			names( getComposerCommands( { ...base, canAutoStart: true, canChooseModel: true } ) )
		).toEqual( [ 'auto-start', 'model', 'connect-provider' ] );
		expect(
			names( getComposerCommands( { ...base, canAutoStart: true, autoStartOn: true } ) )
		).toEqual( [ 'connect-provider' ] );
	} );

	it( 'offers the other environment, the live one only with a live site', () => {
		const local = { ...base, canChangeEnvironment: true };
		expect( names( getComposerCommands( local ) ) ).toEqual( [ 'connect-provider' ] );
		expect(
			getComposerCommands( { ...local, liveUrl: 'https://example.com' } ).at( -1 )
		).toMatchObject( { name: 'live', description: 'https://example.com' } );
		expect( names( getComposerCommands( { ...local, environment: 'live' } ) ) ).toEqual( [
			'connect-provider',
			'local',
		] );
	} );
} );

describe( 'getCommandGroups', () => {
	const command = ( name: string ) => ( { name, description: '' } );
	const commands = [ command( 'model' ), command( 'connect-provider' ) ];
	const skills = [ command( 'annotate' ), command( 'liberate' ) ];
	const values = ( group: { items: { value: string }[] } ) =>
		group.items.map( ( item ) => item.value );

	it( 'lists every command and skill in the add menu, after adding files', () => {
		const [ actions, skillGroup ] = getCommandGroups( {
			addOpen: true,
			commands,
			skills,
			matches: [],
			isDisabled: () => false,
		} );
		expect( values( actions ) ).toEqual( [ 'add-files', 'model', 'connect-provider' ] );
		expect( values( skillGroup ) ).toEqual( [ 'annotate', 'liberate' ] );
	} );

	it( 'splits slash matches into commands and skills', () => {
		const [ actions, skillGroup ] = getCommandGroups( {
			addOpen: false,
			commands,
			skills,
			matches: [ command( 'liberate' ), command( 'model' ) ],
			isDisabled: ( name ) => name === 'model',
		} );
		expect( actions.items ).toEqual( [
			expect.objectContaining( { value: 'model', disabled: true } ),
		] );
		expect( values( skillGroup ) ).toEqual( [ 'liberate' ] );
	} );
} );

describe( 'applyCommandToDraft', () => {
	it( 'replaces the fragment before the cursor with the skill', () => {
		expect( applyCommandToDraft( 'Please /ran', 11, 11, 'rank-me-up', true ) ).toEqual( {
			text: 'Please /rank-me-up ',
			cursor: 19,
		} );
	} );

	it( 'inserts a skill at the cursor, spaced from the text around it', () => {
		expect( applyCommandToDraft( 'Fixthis', 3, 3, 'annotate', true ) ).toEqual( {
			text: 'Fix /annotate this',
			cursor: 14,
		} );
	} );

	it( 'drops the fragment of an action, and leaves a draft without one', () => {
		expect( applyCommandToDraft( 'Hi /mo', 6, 6, 'model', false ) ).toEqual( {
			text: 'Hi ',
			cursor: 3,
		} );
		expect( applyCommandToDraft( 'Hi', 2, 2, 'model', false ) ).toBeNull();
	} );
} );
