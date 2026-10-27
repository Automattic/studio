import { describe, expect, it } from 'vitest';
import { PendingWork } from '../pending-work';

const WRITES = [
	'wp-content/uploads/2026/10/hero.png',
	'wp-content/themes/oak/assets/texture.png',
];

describe( 'a call naming a file that work left running writes', () => {
	it.each< { name: string; input: unknown; waits: boolean } >( [
		{
			name: 'waits for it, named in a command',
			input: {
				command: 'cd /sites/oak && wp media import wp-content/themes/oak/assets/texture.png',
			},
			waits: true,
		},
		{
			name: 'waits for it, named by its absolute path in a nested argument',
			input: { images: [ { path: '/sites/oak/wp-content/uploads/2026/10/hero.png' } ] },
			waits: true,
		},
		{
			name: 'does not wait for it otherwise',
			input: { command: 'ls wp-content/uploads' },
			waits: false,
		},
		{ name: 'does not wait for a call without arguments', input: undefined, waits: false },
	] )( '$name', async ( { input, waits } ) => {
		const work = new PendingWork();
		let finish!: () => void;
		work.add( new Promise( ( resolve ) => ( finish = () => resolve( undefined ) ) ), WRITES );
		work.add( new Promise( () => {} ), [ 'wp-content/uploads/other.png' ] );
		let settled = false;
		const settling = work.settleFilesIn( input ).then( () => ( settled = true ) );
		await new Promise( ( resolve ) => setTimeout( resolve, 10 ) );
		expect( settled ).toBe( ! waits );
		finish();
		await settling;
		expect( settled ).toBe( true );
	} );
} );
