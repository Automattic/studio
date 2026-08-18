import { getToolResultDiff } from '@studio/common/ai/tools';
import { _n, __, sprintf } from '@wordpress/i18n';
import { arrowDown, arrowUp, chevronDownSmall } from '@wordpress/icons';
import { Button, Icon, IconButton, Popover, Tooltip, VisuallyHidden } from '@wordpress/ui';
import { useId, useMemo, useRef, useState } from 'react';
import styles from './changes-tracker.module.css';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

const MAX_RENDERED_DIFF_LINES = 5000;
const MAX_RENDERED_DIFF_LINES_PER_EDGE = MAX_RENDERED_DIFF_LINES / 2;
const MAX_PREVIEW_DIFF_LINES = 40;

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
	diff: string;
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
			diff: previous ? `${ previous.diff }\n\n${ diff }` : diff,
		} );
	}

	return [ ...changes.values() ];
}

function DiffLine( { line }: { line: string } ) {
	const isHeader = line.startsWith( '+++' ) || line.startsWith( '---' );
	const className =
		! isHeader && line.startsWith( '+' )
			? styles.diffAddition
			: ! isHeader && line.startsWith( '-' )
			? styles.diffDeletion
			: styles.diffContext;
	return <span className={ className }>{ line || ' ' }</span>;
}

function ChangeDiff( { change }: { change: SessionFileChange } ) {
	const [ showAll, setShowAll ] = useState( false );
	const diffLines = change.diff.split( '\n' );
	const previewIsTruncated = diffLines.length > MAX_PREVIEW_DIFF_LINES;
	const renderedDiffLines = showAll ? diffLines : diffLines.slice( 0, MAX_PREVIEW_DIFF_LINES );
	const omittedDiffLineCount = Math.max( 0, renderedDiffLines.length - MAX_RENDERED_DIFF_LINES );
	const leadingDiffLines = omittedDiffLineCount
		? renderedDiffLines.slice( 0, MAX_RENDERED_DIFF_LINES_PER_EDGE )
		: renderedDiffLines;
	const trailingDiffLines = omittedDiffLineCount
		? renderedDiffLines.slice( -MAX_RENDERED_DIFF_LINES_PER_EDGE )
		: [];

	return (
		<div className={ styles.diffPanel }>
			<pre className={ styles.diff } dir="ltr">
				{ leadingDiffLines.map( ( line, index ) => (
					<DiffLine key={ `start-${ index }` } line={ line } />
				) ) }
				{ omittedDiffLineCount > 0 && (
					<span className={ styles.diffTruncated }>
						{ sprintf(
							_n( '%d diff line omitted.', '%d diff lines omitted.', omittedDiffLineCount ),
							omittedDiffLineCount
						) }
					</span>
				) }
				{ trailingDiffLines.map( ( line, index ) => (
					<DiffLine key={ `end-${ index }` } line={ line } />
				) ) }
			</pre>
			{ previewIsTruncated && (
				<div className={ styles.showMore }>
					<Button
						variant="minimal"
						tone="neutral"
						size="small"
						onClick={ () => setShowAll( ( current ) => ! current ) }
					>
						{ showAll ? __( 'Show less' ) : __( 'Show more' ) }
					</Button>
				</div>
			) }
		</div>
	);
}

export function ChangesReview( { changes }: { changes: SessionFileChange[] } ) {
	const reviewId = useId();
	const listRef = useRef< HTMLDivElement >( null );
	const sectionRefs = useRef< Array< HTMLElement | null > >( [] );
	const [ activePath, setActivePath ] = useState( changes[ 0 ]?.path );
	const [ expandedPaths, setExpandedPaths ] = useState(
		() => new Set( changes[ 0 ] ? [ changes[ 0 ].path ] : [] )
	);
	const activeIndex = Math.max(
		0,
		changes.findIndex( ( change ) => change.path === activePath )
	);

	if ( changes.length === 0 ) {
		return null;
	}

	const toggleChange = ( path: string ) => {
		setActivePath( path );
		setExpandedPaths( ( current ) => {
			const next = new Set( current );
			if ( next.has( path ) ) {
				next.delete( path );
			} else {
				next.add( path );
			}
			return next;
		} );
	};

	const navigateToChange = ( index: number ) => {
		const change = changes[ index ];
		if ( ! change ) {
			return;
		}
		setActivePath( change.path );
		setExpandedPaths( ( current ) => new Set( current ).add( change.path ) );
		window.requestAnimationFrame( () => {
			sectionRefs.current[ index ]?.scrollIntoView?.( {
				behavior: 'auto',
				block: 'start',
			} );
		} );
	};

	const handleListScroll = () => {
		const list = listRef.current;
		if ( ! list ) {
			return;
		}
		const threshold = list.scrollTop + 80;
		let visibleIndex = 0;
		for ( let index = 0; index < sectionRefs.current.length; index += 1 ) {
			const section = sectionRefs.current[ index ];
			if ( section && section.offsetTop <= threshold ) {
				visibleIndex = index;
			}
		}
		setActivePath( changes[ visibleIndex ]?.path );
	};

	return (
		<div className={ styles.review }>
			<nav className={ styles.reviewNav } aria-label={ __( 'Changed file navigation' ) }>
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					icon={ arrowUp }
					label={ __( 'Previous changed file' ) }
					disabled={ activeIndex === 0 }
					onClick={ () => navigateToChange( activeIndex - 1 ) }
				/>
				<span className={ styles.reviewNavPosition } aria-live="polite">
					{ sprintf( __( '%1$d of %2$d' ), activeIndex + 1, changes.length ) }
				</span>
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					icon={ arrowDown }
					label={ __( 'Next changed file' ) }
					disabled={ activeIndex === changes.length - 1 }
					onClick={ () => navigateToChange( activeIndex + 1 ) }
				/>
			</nav>
			<div
				ref={ listRef }
				className={ styles.changeList }
				aria-label={ __( 'Files changed' ) }
				onScroll={ handleListScroll }
			>
				{ changes.map( ( change, index ) => {
					const { directory, fileName } = getPathParts( change.displayPath );
					const isExpanded = expandedPaths.has( change.path );
					const panelId = `${ reviewId }-change-${ index }`;
					return (
						<section
							key={ change.path }
							ref={ ( node ) => {
								sectionRefs.current[ index ] = node;
							} }
							className={ styles.changeSection }
							data-active={ activeIndex === index || undefined }
						>
							<button
								type="button"
								className={ styles.changeHeader }
								aria-expanded={ isExpanded }
								aria-controls={ panelId }
								onClick={ () => toggleChange( change.path ) }
							>
								<Icon className={ styles.disclosureIcon } icon={ chevronDownSmall } size={ 18 } />
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
							</button>
							{ isExpanded && (
								<div
									id={ panelId }
									aria-label={ sprintf( __( 'Diff for %s' ), change.displayPath ) }
								>
									<ChangeDiff change={ change } />
								</div>
							) }
						</section>
					);
				} ) }
			</div>
		</div>
	);
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
	onOpenReview,
}: {
	entries: SessionEntry[];
	ownerSitePath?: string;
	onOpenReview: () => void;
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
					<div className={ styles.popupFooter }>
						<Button
							variant="minimal"
							tone="neutral"
							size="small"
							className={ styles.reviewAction }
							onClick={ () => {
								setOpen( false );
								onOpenReview();
							} }
						>
							{ __( 'Review changes' ) }
						</Button>
					</div>
				</Popover.Popup>
			</Popover.Root>
		</div>
	);
}
