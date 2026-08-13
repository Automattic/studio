import { PassThrough } from 'stream';
import { describe, expect, it } from 'vitest';
import treeCheckbox from 'cli/lib/tree-checkbox';
import type { TreeNode } from 'cli/lib/tree-checkbox';

const KEY = { down: '[B', space: ' ', enter: '\r' };

function tick(): Promise< void > {
	return new Promise( ( resolve ) => setTimeout( resolve, 30 ) );
}

/** `plugins/` holding one selectable file and one hint row. */
function treeWithHint(): TreeNode[] {
	return [
		{
			name: 'plugins/',
			value: 'plugins',
			isDirectory: true,
			checked: true,
			expanded: true,
			depth: 0,
			children: [
				{
					name: 'hello.php',
					value: 'plugins/hello.php',
					isDirectory: false,
					checked: true,
					expanded: false,
					depth: 1,
				},
				{
					name: '(individual files are not listed for this package)',
					value: 'plugins/jetpack/*unchanged',
					isDirectory: false,
					checked: false,
					expanded: false,
					depth: 1,
					hint: true,
				},
			],
		},
	];
}

async function renderPrompt( tree: TreeNode[] ) {
	const input = new PassThrough();
	const output = new PassThrough();
	let rendered = '';
	output.on( 'data', ( chunk ) => {
		rendered += chunk.toString();
	} );

	const answer = treeCheckbox( { message: 'Select what to pull', tree }, { input, output } );
	await tick();

	return {
		answer,
		frame: () => rendered,
		press: async ( key: string ) => {
			input.write( key );
			await tick();
		},
	};
}

describe( 'treeCheckbox hint rows', () => {
	it( 'renders the hint dimmed and without a checkbox', async () => {
		const prompt = await renderPrompt( treeWithHint() );
		const hintLine = prompt
			.frame()
			.split( '\n' )
			.find( ( line ) => line.includes( 'not listed for this package' ) );

		expect( hintLine ).toBeDefined();
		// The checkbox glyphs used for selectable rows.
		expect( hintLine ).not.toMatch( /[◉◯◐]/ );

		await prompt.press( KEY.enter );
		await prompt.answer;
	} );

	it( 'ignores space on a hint and keeps it out of the selection', async () => {
		const prompt = await renderPrompt( treeWithHint() );

		// plugins/ → hello.php → the hint row.
		await prompt.press( KEY.down );
		await prompt.press( KEY.down );
		await prompt.press( KEY.space );
		await prompt.press( KEY.enter );

		expect( ( await prompt.answer ).map( ( node ) => node.value ) ).toEqual( [
			'plugins',
			'plugins/hello.php',
		] );
	} );

	it( 'keeps a folder checked when a hint is its only child', async () => {
		const tree = treeWithHint();
		tree[ 0 ].children = [ tree[ 0 ].children![ 1 ] ];
		const prompt = await renderPrompt( tree );

		// Toggling the folder off and on again runs the checked-state propagation.
		await prompt.press( KEY.space );
		await prompt.press( KEY.space );
		await prompt.press( KEY.enter );

		expect( ( await prompt.answer ).map( ( node ) => node.value ) ).toEqual( [ 'plugins' ] );
	} );
} );
