import chalk from 'chalk';
import type { TodoEntry } from 'cli/ai/todo-stream';

export interface TodoRenderLine {
	text: string;
	dim?: boolean;
}

export function formatTodoSnapshotLine( todo: TodoEntry ): string {
	switch ( todo.status ) {
		case 'completed':
			return `${ chalk.green( '✓' ) } ${ chalk.dim( chalk.strikethrough( todo.content ) ) }`;
		case 'in_progress':
			return `${ chalk.bold( '→' ) } ${ chalk.bold( todo.activeForm ) }`;
		default:
			return `${ chalk.dim( '○' ) } ${ chalk.dim( todo.content ) }`;
	}
}

export function buildTodoUpdateLines( snapshot: TodoEntry[] ): TodoRenderLine[] {
	if ( snapshot.length === 0 ) {
		return [];
	}

	return [
		{ text: 'Todo list:', dim: true },
		...snapshot.map( ( todo ) => ( {
			text: formatTodoSnapshotLine( todo ),
		} ) ),
	];
}
