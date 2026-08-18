import { getToolResultDiff } from '@studio/common/ai/tools';
import { _n, __, sprintf } from '@wordpress/i18n';
import { Button, Popover, Tooltip, VisuallyHidden } from '@wordpress/ui';
import { useId, useMemo, useRef, useState } from 'react';
import styles from './changes-tracker.module.css';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

interface FileToolCall {
	path: string;
	name: 'Edit' | 'Write';
	arguments: Record< string, unknown >;
}

export interface SessionFileChange {
	path: string;
	displayPath: string;
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

function getPathParts( filePath: string ): { directory?: string; fileName: string } {
	const separatorIndex = filePath.lastIndexOf( '/' );
	if ( separatorIndex < 0 ) {
		return { fileName: filePath };
	}
	return {
		directory: filePath.slice( 0, separatorIndex ),
		fileName: filePath.slice( separatorIndex + 1 ),
	};
}

function DirectoryPath( { directory }: { directory: string } ) {
	const separatorIndex = directory.lastIndexOf( '/' );
	if ( separatorIndex < 0 ) {
		return <span className={ styles.fileDirectory }>{ directory }</span>;
	}

	return (
		<span className={ styles.fileDirectory } aria-label={ directory }>
			<span className={ styles.directoryStart }>{ directory.slice( 0, separatorIndex ) }</span>
			<span className={ styles.directoryEnd }>{ directory.slice( separatorIndex ) }</span>
		</span>
	);
}

function getDisplayPath( filePath: string, ownerSitePath?: string ): string {
	const normalizedPath = normalizePath( filePath );
	const normalizedRoot = ownerSitePath?.replace( /\\/g, '/' ).replace( /\/$/, '' );
	if ( normalizedRoot && normalizedPath.startsWith( `${ normalizedRoot }/` ) ) {
		return normalizedPath.slice( normalizedRoot.length + 1 );
	}
	return normalizedPath.split( '/' ).filter( Boolean ).slice( -2 ).join( '/' ) || normalizedPath;
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

export function getSessionFileChanges(
	entries: SessionEntry[],
	ownerSitePath?: string
): SessionFileChange[] {
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
			displayPath: getDisplayPath( normalizedPath, ownerSitePath ),
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

export function ChangesTracker( {
	entries,
	ownerSitePath,
}: {
	entries: SessionEntry[];
	ownerSitePath?: string;
} ) {
	const changes = useMemo(
		() => getSessionFileChanges( entries, ownerSitePath ),
		[ entries, ownerSitePath ]
	);
	const triggerRef = useRef< HTMLButtonElement >( null );
	const popupId = useId();
	const [ open, setOpen ] = useState( false );
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
			<Popover.Root open={ open } modal={ false } onOpenChange={ setOpen }>
				<Tooltip.Root disabled={ open }>
					<Tooltip.Trigger
						render={
							<Button
								ref={ triggerRef }
								type="button"
								variant="outline"
								tone="neutral"
								size="small"
								className={ styles.trigger }
								aria-label={ sprintf( __( 'View changed files: %s' ), fileCountLabel ) }
								aria-expanded={ open }
								aria-controls={ open ? popupId : undefined }
								aria-haspopup="dialog"
								onClick={ () => setOpen( ( current ) => ! current ) }
							/>
						}
					>
						<span>{ fileCountLabel }</span>
						<span className={ styles.lineCounts }>
							<span className={ styles.additions }>+{ formatChangeCount( additions ) }</span>
							<span className={ styles.deletions }>-{ formatChangeCount( deletions ) }</span>
						</span>
					</Tooltip.Trigger>
					<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
						{ __( 'View changed files' ) }
					</Tooltip.Popup>
				</Tooltip.Root>
				<Popover.Popup
					id={ popupId }
					className={ styles.popup }
					initialFocus={ false }
					positioner={
						<Popover.Positioner anchor={ triggerRef } side="top" align="end" sideOffset={ 8 } />
					}
				>
					<VisuallyHidden render={ <Popover.Title /> }>
						{ __( 'Files changed in this chat' ) }
					</VisuallyHidden>
					<div className={ styles.fileList } role="list">
						{ changes.map( ( change ) => {
							const { directory, fileName } = getPathParts( change.displayPath );
							return (
								<div key={ change.path } className={ styles.fileRow } role="listitem">
									<span className={ styles.fileIdentity } dir="ltr" title={ change.displayPath }>
										<span className={ styles.fileName }>{ fileName }</span>
										{ directory ? <DirectoryPath directory={ directory } /> : null }
									</span>
									<span className={ styles.lineCounts }>
										<span className={ styles.additions }>
											+{ formatChangeCount( change.additions ) }
										</span>
										<span className={ styles.deletions }>
											-{ formatChangeCount( change.deletions ) }
										</span>
									</span>
								</div>
							);
						} ) }
					</div>
				</Popover.Popup>
			</Popover.Root>
		</div>
	);
}
