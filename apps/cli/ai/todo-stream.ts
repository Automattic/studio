import type { TodoWriteInput } from '@anthropic-ai/claude-agent-sdk/sdk-tools';

export type TodoEntry = TodoWriteInput[ 'todos' ][ number ];

export interface TodoChange {
	content: string;
	activeForm: string;
}

export interface TodoDiff {
	added: TodoChange[];
	completed: TodoChange[];
	hasVisibleChanges: boolean;
	signature: string;
	snapshot: TodoEntry[];
}

interface TodoCounts {
	total: number;
	completed: number;
	incomplete: number;
	entry: TodoChange;
}

function compareTodoEntries( left: TodoEntry, right: TodoEntry ): number {
	return (
		left.content.localeCompare( right.content ) ||
		left.activeForm.localeCompare( right.activeForm ) ||
		left.status.localeCompare( right.status )
	);
}

function buildIdentityKey( todo: TodoChange ): string {
	return JSON.stringify( [ todo.content, todo.activeForm ] );
}

function buildCounts( todos: TodoEntry[] ): Map< string, TodoCounts > {
	const counts = new Map< string, TodoCounts >();

	for ( const todo of todos ) {
		const identity = buildIdentityKey( todo );
		const existing = counts.get( identity );

		if ( existing ) {
			existing.total += 1;
			if ( todo.status === 'completed' ) {
				existing.completed += 1;
			}
			continue;
		}

		counts.set( identity, {
			total: 1,
			completed: todo.status === 'completed' ? 1 : 0,
			incomplete: 0,
			entry: {
				content: todo.content,
				activeForm: todo.activeForm,
			},
		} );
	}

	for ( const value of counts.values() ) {
		value.incomplete = value.total - value.completed;
	}

	return counts;
}

function repeatChange( change: TodoChange, count: number ): TodoChange[] {
	return Array.from( { length: count }, () => ( { ...change } ) );
}

export function normalizeTodoSnapshot( todos: TodoEntry[] ): TodoEntry[] {
	return [ ...todos ].map( ( todo ) => ( {
		content: todo.content,
		status: todo.status,
		activeForm: todo.activeForm,
	} ) );
}

function buildChangeOrder( todos: TodoEntry[] ): Map< string, number > {
	const order = new Map< string, number >();

	todos.forEach( ( todo, index ) => {
		const identity = buildIdentityKey( todo );
		if ( ! order.has( identity ) ) {
			order.set( identity, index );
		}
	} );

	return order;
}

function sortTodoChangesByOrder(
	changes: TodoChange[],
	changeOrder: Map< string, number >
): TodoChange[] {
	return changes.sort(
		( left, right ) =>
			( changeOrder.get( buildIdentityKey( left ) ) ?? Number.MAX_SAFE_INTEGER ) -
				( changeOrder.get( buildIdentityKey( right ) ) ?? Number.MAX_SAFE_INTEGER ) ||
			left.content.localeCompare( right.content ) ||
			left.activeForm.localeCompare( right.activeForm )
	);
}

export function diffTodoSnapshot( previous: TodoEntry[], next: TodoEntry[] ): TodoDiff {
	const snapshot = normalizeTodoSnapshot( next );
	const previousCounts = buildCounts( normalizeTodoSnapshot( previous ) );
	const nextCounts = buildCounts( snapshot );
	const changeOrder = buildChangeOrder( snapshot );
	const identities = new Set( [ ...previousCounts.keys(), ...nextCounts.keys() ] );
	const added: TodoChange[] = [];
	const completed: TodoChange[] = [];

	for ( const identity of identities ) {
		const previousCount = previousCounts.get( identity );
		const nextCount = nextCounts.get( identity );
		const previousTotal = previousCount?.total ?? 0;
		const nextTotal = nextCount?.total ?? 0;
		const previousCompleted = previousCount?.completed ?? 0;
		const nextCompleted = nextCount?.completed ?? 0;
		const previousIncomplete = previousCount?.incomplete ?? 0;
		const completedCount = Math.min(
			previousIncomplete,
			Math.max( nextCompleted - previousCompleted, 0 )
		);
		const addedCount = Math.max( nextTotal - previousTotal, 0 );
		const entry = nextCount?.entry ?? previousCount?.entry;

		if ( ! entry ) {
			continue;
		}

		completed.push( ...repeatChange( entry, completedCount ) );
		added.push( ...repeatChange( entry, addedCount ) );
	}

	sortTodoChangesByOrder( added, changeOrder );
	sortTodoChangesByOrder( completed, changeOrder );

	return {
		added,
		completed,
		hasVisibleChanges: added.length > 0 || completed.length > 0,
		signature: JSON.stringify( [ ...snapshot ].sort( compareTodoEntries ) ),
		snapshot,
	};
}
