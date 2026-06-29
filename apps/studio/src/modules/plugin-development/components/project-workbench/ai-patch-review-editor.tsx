import { __, sprintf } from '@wordpress/i18n';
import { check, close } from '@wordpress/icons';
import { useEffect, useMemo, useState } from 'react';
import Button from 'src/components/button';
import { cx } from 'src/lib/cx';
import workbenchStyles from '../development-workbench.module.css';
import { renderFallbackCodeBlockHtml, renderMonacoCodeBlockHtml } from './monaco-highlighting';
import { getPatchStats } from './utils';
import type { AiPatchItem, DiffHunk, DiffHunkLine } from './types';

const MAX_VISIBLE_PATCH_LINES = 600;

function formatDiffHunkHeader( hunk: DiffHunk ) {
	return `@@ -${ hunk.oldStart },${ hunk.oldLines } +${ hunk.newStart },${ hunk.newLines } @@`;
}

function splitHighlightedLines( highlightedHtml: string, lineCount: number ) {
	const lines = highlightedHtml.split( '\n' );
	while ( lines.length < lineCount ) {
		lines.push( ' ' );
	}
	return lines.slice( 0, lineCount );
}

function DiffCodeHunk( { filePath, lines }: { filePath: string; lines: DiffHunkLine[] } ) {
	const hunkContent = useMemo(
		() => lines.map( ( line ) => line.content || ' ' ).join( '\n' ),
		[ lines ]
	);
	const [ highlightedHtml, setHighlightedHtml ] = useState( () =>
		renderFallbackCodeBlockHtml( hunkContent, filePath )
	);
	const highlightedLines = useMemo(
		() => splitHighlightedLines( highlightedHtml, lines.length ),
		[ highlightedHtml, lines.length ]
	);

	useEffect( () => {
		let isCancelled = false;
		setHighlightedHtml( renderFallbackCodeBlockHtml( hunkContent, filePath ) );

		void renderMonacoCodeBlockHtml( hunkContent, filePath )
			.then( ( html ) => {
				if ( ! isCancelled ) {
					setHighlightedHtml( html );
				}
			} )
			.catch( () => {
				if ( ! isCancelled ) {
					setHighlightedHtml( renderFallbackCodeBlockHtml( hunkContent, filePath ) );
				}
			} );

		return () => {
			isCancelled = true;
		};
	}, [ filePath, hunkContent ] );

	return (
		<>
			{ lines.map( ( line, lineIndex ) => (
				<div
					key={ `${ line.type }:${ line.oldNumber ?? '' }:${
						line.newNumber ?? ''
					}:${ lineIndex }` }
					className={ cx(
						workbenchStyles.aiReviewLine,
						line.type === 'add' && workbenchStyles.aiReviewAdd,
						line.type === 'delete' && workbenchStyles.aiReviewDelete,
						line.type === 'context' && workbenchStyles.aiReviewContext
					) }
				>
					<span className={ workbenchStyles.aiReviewLineNumber }>{ line.oldNumber ?? '' }</span>
					<span className={ workbenchStyles.aiReviewLineNumber }>{ line.newNumber ?? '' }</span>
					<span className={ workbenchStyles.aiReviewLinePrefix }>
						{ line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ' }
					</span>
					<code
						className={ cx(
							workbenchStyles.codeEditorHighlight,
							workbenchStyles.codeSyntaxHighlight
						) }
						dangerouslySetInnerHTML={ {
							__html: highlightedLines[ lineIndex ] || ' ',
						} }
					/>
				</div>
			) ) }
		</>
	);
}

type AiPatchReviewEditorProps = {
	patch: AiPatchItem;
	hunks: DiffHunk[];
	applyingPatchId: string | null;
	variant?: 'editor' | 'sidebar';
	onAcceptPatch: ( patch: AiPatchItem ) => void;
	onRejectPatch: ( patch: AiPatchItem ) => void;
	onAcceptPatchHunk: ( patch: AiPatchItem, hunk: DiffHunk, hunkIndex: number ) => void;
	onRejectPatchHunk: ( patch: AiPatchItem, hunkIndex: number ) => void;
};

export function AiPatchReviewEditor( {
	patch,
	hunks,
	applyingPatchId,
	variant = 'editor',
	onAcceptPatch,
	onRejectPatch,
	onAcceptPatchHunk,
	onRejectPatchHunk,
}: AiPatchReviewEditorProps ) {
	const stats = getPatchStats( patch );
	const totalLineCount = hunks.reduce( ( count, hunk ) => count + hunk.lines.length, 0 );
	let remainingVisibleLines = MAX_VISIBLE_PATCH_LINES;
	const isPatchApplying = Boolean( applyingPatchId?.startsWith( patch.id ) );
	const isReleaseReview = patch.source === 'release';
	const acceptFileLabel = isReleaseReview ? __( 'Keep file' ) : __( 'Accept file' );
	const rejectFileLabel = isReleaseReview ? __( 'Revert file' ) : __( 'Reject file' );
	const acceptChunkLabel = isReleaseReview ? __( 'Keep chunk' ) : __( 'Accept chunk' );
	const rejectChunkLabel = isReleaseReview ? __( 'Revert chunk' ) : __( 'Reject chunk' );

	return (
		<section
			className={ cx(
				workbenchStyles.aiReviewPane,
				variant === 'editor' ? workbenchStyles.aiReviewEditor : workbenchStyles.aiReviewSidebar
			) }
			aria-label={ sprintf(
				// translators: %s is a file path.
				__( 'Proposed changes for %s' ),
				patch.path
			) }
		>
			<header className={ workbenchStyles.aiReviewHeader }>
				<div className={ workbenchStyles.aiReviewFileMeta }>
					<strong>{ patch.path }</strong>
					<span>
						{ patch.status }, +{ stats.added } -{ stats.deleted }
					</span>
					{ patch.prompt && <small>{ patch.prompt }</small> }
				</div>
				<div className={ workbenchStyles.aiReviewActions }>
					<Button
						variant="primary"
						icon={ check }
						iconSize={ 18 }
						disabled={ isPatchApplying }
						onClick={ () => onAcceptPatch( patch ) }
					>
						{ isPatchApplying ? __( 'Applying…' ) : acceptFileLabel }
					</Button>
					<Button
						variant="secondary"
						icon={ close }
						iconSize={ 18 }
						disabled={ isPatchApplying }
						onClick={ () => onRejectPatch( patch ) }
					>
						{ rejectFileLabel }
					</Button>
				</div>
			</header>
			<div className={ workbenchStyles.aiReviewBody }>
				{ hunks.length === 0 ? (
					<p className={ workbenchStyles.aiReviewEmpty }>
						{ __( 'No textual patch was produced.' ) }
					</p>
				) : (
					hunks.map( ( hunk, hunkIndex ) => {
						if ( remainingVisibleLines <= 0 ) {
							return null;
						}
						const visibleLines = hunk.lines.slice( 0, Math.max( 0, remainingVisibleLines ) );
						remainingVisibleLines -= visibleLines.length;
						return (
							<div
								key={ `${ hunk.oldStart }:${ hunk.newStart }:${ hunkIndex }` }
								className={ workbenchStyles.aiReviewHunk }
							>
								<div className={ workbenchStyles.aiReviewHunkHeader }>
									<code>{ formatDiffHunkHeader( hunk ) }</code>
									<div className={ workbenchStyles.aiReviewHunkActions }>
										<Button
											variant="secondary"
											icon={ check }
											iconSize={ 16 }
											disabled={ isPatchApplying }
											onClick={ () => onAcceptPatchHunk( patch, hunk, hunkIndex ) }
										>
											{ acceptChunkLabel }
										</Button>
										<Button
											variant="secondary"
											icon={ close }
											iconSize={ 16 }
											disabled={ isPatchApplying }
											onClick={ () => onRejectPatchHunk( patch, hunkIndex ) }
										>
											{ rejectChunkLabel }
										</Button>
									</div>
								</div>
								<DiffCodeHunk filePath={ patch.path } lines={ visibleLines } />
							</div>
						);
					} )
				) }
				{ totalLineCount > MAX_VISIBLE_PATCH_LINES && (
					<p className={ workbenchStyles.aiReviewEmpty }>
						{ sprintf(
							// translators: %d is the number of hidden diff lines.
							__( '%d more patch lines hidden' ),
							totalLineCount - MAX_VISIBLE_PATCH_LINES
						) }
					</p>
				) }
			</div>
		</section>
	);
}
