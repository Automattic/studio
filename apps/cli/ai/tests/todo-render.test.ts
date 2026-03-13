import chalk from 'chalk';
import { buildTodoUpdateLines } from 'cli/ai/todo-render';

describe( 'todo render helpers', () => {
	it( 'renders only the updated todo snapshot for TodoWrite output', () => {
		const lines = buildTodoUpdateLines( [
			{
				content: 'Write tests',
				activeForm: 'Writing tests',
				status: 'in_progress',
			},
			{
				content: 'Ship fix',
				activeForm: 'Shipping fix',
				status: 'completed',
			},
		] );

		expect( lines ).toEqual( [
			{ text: 'Todo list:', dim: true },
			{ text: `${ chalk.yellow( '◐' ) } ${ chalk.dim( 'Writing tests' ) }` },
			{
				text: `${ chalk.green( '✓' ) } ${ chalk.dim( chalk.strikethrough( 'Ship fix' ) ) }`,
			},
		] );
		expect(
			lines.some(
				( line ) => line.text.includes( 'Added todo' ) || line.text.includes( 'Completed todo' )
			)
		).toBe( false );
	} );

	it( 'omits the TodoWrite detail block when the snapshot is empty', () => {
		expect( buildTodoUpdateLines( [] ) ).toEqual( [] );
	} );
} );
