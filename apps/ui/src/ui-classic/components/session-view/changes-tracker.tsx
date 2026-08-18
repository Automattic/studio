import { getToolResultDiff } from '@studio/common/ai/tools';
import { _n, sprintf } from '@wordpress/i18n';
import { useMemo } from 'react';
import styles from './changes-tracker.module.css';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

interface FileToolCall {
	path: string;
	name: 'Edit' | 'Write';
	arguments: Record< string, unknown >;
}

export interface SessionFileChange {
	path: string;
	additions: number;
	deletions: number;
}

function getFilePath( input: Record< string, unknown > ): string | undefined {
	const filePath = input.file_path ?? input.path;
	return typeof filePath === 'string' && filePath.length > 0 ? filePath : undefined;
}

function normalizePath( filePath: string ): string {
	return filePath.replace( /\\/g, '/' );
}

function synthesizeDiff( call: FileToolCall ): string | undefined {
	if ( call.name === 'Edit' ) {
		const before = call.arguments.old_string ?? call.arguments.oldText;
		const after = call.arguments.new_string ?? call.arguments.newText;
		if ( typeof before === 'string' && typeof after === 'string' ) {
			return [
				`--- ${ call.path }`,
				`+++ ${ call.path }`,
				...before.split( '\n' ).map( ( line ) => `-${ line }` ),
				...after.split( '\n' ).map( ( line ) => `+${ line }` ),
			].join( '\n' );
		}
	}

	if ( call.name === 'Write' && typeof call.arguments.content === 'string' ) {
		return [
			'--- /dev/null',
			`+++ ${ call.path }`,
			...call.arguments.content.split( '\n' ).map( ( line ) => `+${ line }` ),
		].join( '\n' );
	}

	return undefined;
}

export function countDiffLines( diff: string ): { additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;
	for ( const line of diff.split( '\n' ) ) {
		if ( line.startsWith( '+' ) && ! line.startsWith( '+++' ) ) {
			additions += 1;
		} else if ( line.startsWith( '-' ) && ! line.startsWith( '---' ) ) {
			deletions += 1;
		}
	}
	return { additions, deletions };
}

export function getSessionFileChanges( entries: SessionEntry[] ): SessionFileChange[] {
	const calls = new Map< string, FileToolCall >();
	const changes = new Map< string, SessionFileChange >();

	for ( const entry of entries ) {
		if ( entry.type !== 'message' ) {
			continue;
		}
		const message = entry.message;
		if ( message?.role === 'assistant' ) {
			for ( const block of message.content ?? [] ) {
				if (
					block.type !== 'toolCall' ||
					! block.id ||
					( block.name !== 'Edit' && block.name !== 'Write' )
				) {
					continue;
				}
				const toolArguments = block.arguments ?? {};
				const filePath = getFilePath( toolArguments );
				if ( filePath ) {
					calls.set( block.id, { path: filePath, name: block.name, arguments: toolArguments } );
				}
			}
			continue;
		}

		if ( message?.role !== 'toolResult' || ! message.toolCallId ) {
			continue;
		}
		const call = calls.get( message.toolCallId );
		calls.delete( message.toolCallId );
		if ( message.isError || ! call ) {
			continue;
		}
		const diff = getToolResultDiff( message.details ) ?? synthesizeDiff( call );
		if ( ! diff ) {
			continue;
		}
		const normalizedPath = normalizePath( call.path );
		const counts = countDiffLines( diff );
		const previous = changes.get( normalizedPath );
		changes.set( normalizedPath, {
			path: normalizedPath,
			additions: ( previous?.additions ?? 0 ) + counts.additions,
			deletions: ( previous?.deletions ?? 0 ) + counts.deletions,
		} );
	}

	return [ ...changes.values() ];
}

export function formatChangeCount( count: number, locale?: string ): string {
	const resolvedLocale =
		locale ||
		( typeof document !== 'undefined' ? document.documentElement.lang || undefined : undefined );
	return new Intl.NumberFormat( resolvedLocale ).format( count );
}

export function ChangesTracker( { entries }: { entries: SessionEntry[] } ) {
	const changes = useMemo( () => getSessionFileChanges( entries ), [ entries ] );
	const additions = changes.reduce( ( total, change ) => total + change.additions, 0 );
	const deletions = changes.reduce( ( total, change ) => total + change.deletions, 0 );

	if ( changes.length === 0 ) {
		return null;
	}

	const fileCountLabel = sprintf(
		_n( '%s file', '%s files', changes.length ),
		formatChangeCount( changes.length )
	);

	return (
		<div className={ styles.anchor }>
			<div className={ styles.summary }>
				<span>{ fileCountLabel }</span>
				<span className={ styles.lineCounts }>
					<span className={ styles.additions }>+{ formatChangeCount( additions ) }</span>
					<span className={ styles.deletions }>-{ formatChangeCount( deletions ) }</span>
				</span>
			</div>
		</div>
	);
}
