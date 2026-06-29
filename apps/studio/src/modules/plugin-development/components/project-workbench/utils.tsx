import { AI_SKILL_COMMANDS } from '@studio/common/ai/slash-commands';
import { __, sprintf } from '@wordpress/i18n';
import type {
	AiPatchItem,
	DevelopmentChatMessage,
	DiffHunk,
	DiffHunkLine,
	DiffLine,
} from './types';
import type { SkillSlashCommand } from '@studio/common/ai/slash-commands';
import type {
	DevelopmentProject,
	DevelopmentProjectAiPatch,
	DevelopmentProjectFile,
	DevelopmentProjectValidationFinding,
	DevelopmentProjectValidationResult,
} from '@studio/common/types/publishing';

const FIX_PLUGIN_COMMAND_NAME = 'fix-plugin';
const MAX_CHAT_SESSION_TITLE_LENGTH = 72;

export const PLUGIN_DEVELOPMENT_SLASH_COMMANDS: SkillSlashCommand[] = [
	...AI_SKILL_COMMANDS,
	{
		name: FIX_PLUGIN_COMMAND_NAME,
		description: __( 'Fix Plugin Check errors in this plugin' ),
	},
];

function normalizeRendererPath( value?: string ) {
	return value?.replace( /\\/g, '/' );
}

export function resolvePluginDevelopmentAiPrompt( prompt: string ): {
	displayPrompt: string;
	reviewPrompt: string;
} {
	const displayPrompt = prompt.trim();
	const commandPattern = new RegExp( `^/${ FIX_PLUGIN_COMMAND_NAME }(?:\\s+|$)` );

	if ( ! commandPattern.test( displayPrompt ) ) {
		return { displayPrompt, reviewPrompt: displayPrompt };
	}

	const extraInstruction = displayPrompt.replace( commandPattern, '' ).trim();
	const reviewPrompt = [
		__(
			'Fix the current Plugin Check errors for this plugin. Use the validation results as the source of truth, make focused code changes only, preserve existing behavior, and do not publish, commit, tag, release, bump versions, or change unrelated files.'
		),
		extraInstruction
			? sprintf(
					// translators: %s is additional user-provided text after the /fix-plugin command.
					__( 'Additional instruction: %s' ),
					extraInstruction
			  )
			: '',
	]
		.filter( Boolean )
		.join( '\n\n' );

	return { displayPrompt, reviewPrompt };
}

export function isFixPluginSlashCommand( prompt: string ): boolean {
	return new RegExp( `^/${ FIX_PLUGIN_COMMAND_NAME }(?:\\s+|$)` ).test( prompt.trim() );
}

export function getDevelopmentChatSessionTitle( messages: DevelopmentChatMessage[] ): string {
	const latestUserPrompt = [ ...messages ]
		.reverse()
		.find( ( message ) => message.role === 'user' )
		?.content.replace( /\s+/g, ' ' )
		.trim();

	if ( ! latestUserPrompt ) {
		return __( 'Studio Code' );
	}

	if ( isFixPluginSlashCommand( latestUserPrompt ) ) {
		return __( 'Fix plugin check issues' );
	}

	if ( latestUserPrompt.length <= MAX_CHAT_SESSION_TITLE_LENGTH ) {
		return latestUserPrompt;
	}

	return `${ latestUserPrompt.slice( 0, MAX_CHAT_SESSION_TITLE_LENGTH - 1 ).trimEnd() }…`;
}

function getProjectRelativePath( project: DevelopmentProject, filePath?: string ) {
	const rootDir = normalizeRendererPath( project.info?.rootDir || project.path );
	const normalizedFilePath = normalizeRendererPath( filePath );
	if ( ! rootDir || ! normalizedFilePath ) {
		return undefined;
	}

	if ( normalizedFilePath === rootDir ) {
		return '';
	}

	return normalizedFilePath.startsWith( `${ rootDir }/` )
		? normalizedFilePath.slice( rootDir.length + 1 )
		: normalizedFilePath.split( '/' ).pop();
}

export function choosePreferredProjectFile(
	project: DevelopmentProject,
	files: DevelopmentProjectFile[]
): DevelopmentProjectFile | undefined {
	if ( files.length === 0 ) {
		return undefined;
	}

	const preferredPaths = [
		getProjectRelativePath( project, project.info?.mainFile ),
		'readme.txt',
		'README.md',
		'package.json',
	].filter( ( value ): value is string => Boolean( value ) );

	for ( const preferredPath of preferredPaths ) {
		const matchingFile = files.find(
			( file ) => file.path.toLowerCase() === preferredPath.toLowerCase()
		);
		if ( matchingFile ) {
			return matchingFile;
		}
	}

	return files[ 0 ];
}

export function formatFileSize( size: number ) {
	if ( size < 1024 ) {
		return sprintf(
			// translators: %d is the file size in bytes.
			__( '%d B' ),
			size
		);
	}

	return sprintf(
		// translators: %s is the file size in kilobytes.
		__( '%s KB' ),
		( size / 1024 ).toFixed( 1 )
	);
}

function splitDiffLines( content = '' ) {
	if ( content.length === 0 ) {
		return [];
	}
	return content.replace( /\r\n/g, '\n' ).replace( /\r/g, '\n' ).split( '\n' );
}

function buildFallbackDiffOperations(
	beforeLines: string[],
	afterLines: string[]
): DiffHunkLine[] {
	const lines: DiffHunkLine[] = [];
	let prefixLength = 0;

	while (
		prefixLength < beforeLines.length &&
		prefixLength < afterLines.length &&
		beforeLines[ prefixLength ] === afterLines[ prefixLength ]
	) {
		prefixLength += 1;
	}

	let beforeSuffixIndex = beforeLines.length - 1;
	let afterSuffixIndex = afterLines.length - 1;
	while (
		beforeSuffixIndex >= prefixLength &&
		afterSuffixIndex >= prefixLength &&
		beforeLines[ beforeSuffixIndex ] === afterLines[ afterSuffixIndex ]
	) {
		beforeSuffixIndex -= 1;
		afterSuffixIndex -= 1;
	}

	for ( let index = 0; index < prefixLength; index += 1 ) {
		lines.push( {
			type: 'context',
			oldNumber: index + 1,
			newNumber: index + 1,
			content: beforeLines[ index ],
		} );
	}

	for ( let index = prefixLength; index <= beforeSuffixIndex; index += 1 ) {
		lines.push( {
			type: 'delete',
			oldNumber: index + 1,
			content: beforeLines[ index ],
		} );
	}

	for ( let index = prefixLength; index <= afterSuffixIndex; index += 1 ) {
		lines.push( {
			type: 'add',
			newNumber: index + 1,
			content: afterLines[ index ],
		} );
	}

	for ( let index = beforeSuffixIndex + 1; index < beforeLines.length; index += 1 ) {
		const afterIndex = afterSuffixIndex + 1 + ( index - beforeSuffixIndex - 1 );
		lines.push( {
			type: 'context',
			oldNumber: index + 1,
			newNumber: afterIndex + 1,
			content: beforeLines[ index ],
		} );
	}

	return lines;
}

function buildLineDiffOperations( beforeLines: string[], afterLines: string[] ): DiffHunkLine[] {
	const cellCount = ( beforeLines.length + 1 ) * ( afterLines.length + 1 );

	if ( cellCount > 2_000_000 ) {
		return buildFallbackDiffOperations( beforeLines, afterLines );
	}

	const columnCount = afterLines.length + 1;
	const matrix = new Uint32Array( cellCount );
	const matrixIndex = ( beforeIndex: number, afterIndex: number ) =>
		beforeIndex * columnCount + afterIndex;

	for ( let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1 ) {
		for ( let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1 ) {
			matrix[ matrixIndex( beforeIndex, afterIndex ) ] =
				beforeLines[ beforeIndex ] === afterLines[ afterIndex ]
					? matrix[ matrixIndex( beforeIndex + 1, afterIndex + 1 ) ] + 1
					: Math.max(
							matrix[ matrixIndex( beforeIndex + 1, afterIndex ) ],
							matrix[ matrixIndex( beforeIndex, afterIndex + 1 ) ]
					  );
		}
	}

	const lines: DiffHunkLine[] = [];
	let beforeIndex = 0;
	let afterIndex = 0;

	while ( beforeIndex < beforeLines.length && afterIndex < afterLines.length ) {
		if ( beforeLines[ beforeIndex ] === afterLines[ afterIndex ] ) {
			lines.push( {
				type: 'context',
				oldNumber: beforeIndex + 1,
				newNumber: afterIndex + 1,
				content: beforeLines[ beforeIndex ],
			} );
			beforeIndex += 1;
			afterIndex += 1;
			continue;
		}

		if (
			matrix[ matrixIndex( beforeIndex + 1, afterIndex ) ] >=
			matrix[ matrixIndex( beforeIndex, afterIndex + 1 ) ]
		) {
			lines.push( {
				type: 'delete',
				oldNumber: beforeIndex + 1,
				content: beforeLines[ beforeIndex ],
			} );
			beforeIndex += 1;
			continue;
		}

		lines.push( {
			type: 'add',
			newNumber: afterIndex + 1,
			content: afterLines[ afterIndex ],
		} );
		afterIndex += 1;
	}

	for ( ; beforeIndex < beforeLines.length; beforeIndex += 1 ) {
		lines.push( {
			type: 'delete',
			oldNumber: beforeIndex + 1,
			content: beforeLines[ beforeIndex ],
		} );
	}

	for ( ; afterIndex < afterLines.length; afterIndex += 1 ) {
		lines.push( {
			type: 'add',
			newNumber: afterIndex + 1,
			content: afterLines[ afterIndex ],
		} );
	}

	return lines;
}

function createDiffHunk( lines: DiffHunkLine[] ): DiffHunk {
	const oldNumbers = lines
		.map( ( line ) => line.oldNumber )
		.filter( ( value ): value is number => value !== undefined );
	const newNumbers = lines
		.map( ( line ) => line.newNumber )
		.filter( ( value ): value is number => value !== undefined );
	const oldLineCount = lines.filter( ( line ) => line.type !== 'add' ).length;
	const newLineCount = lines.filter( ( line ) => line.type !== 'delete' ).length;

	return {
		oldStart: oldNumbers[ 0 ] ?? 0,
		oldLines: oldLineCount,
		newStart: newNumbers[ 0 ] ?? 0,
		newLines: newLineCount,
		lines,
	};
}

export function buildDiffHunks(
	beforeContent = '',
	afterContent = '',
	contextLineCount = 3
): DiffHunk[] {
	if ( beforeContent === afterContent ) {
		return [];
	}

	const operations = buildLineDiffOperations(
		splitDiffLines( beforeContent ),
		splitDiffLines( afterContent )
	);
	const changeIndexes = operations
		.map( ( line, index ) => ( line.type === 'context' ? -1 : index ) )
		.filter( ( index ) => index >= 0 );

	if ( changeIndexes.length === 0 ) {
		return [];
	}

	const ranges: Array< { start: number; end: number } > = [];
	let groupStart = changeIndexes[ 0 ];
	let groupEnd = changeIndexes[ 0 ];

	for ( const changeIndex of changeIndexes.slice( 1 ) ) {
		if ( changeIndex - groupEnd <= contextLineCount * 2 + 1 ) {
			groupEnd = changeIndex;
			continue;
		}

		ranges.push( {
			start: Math.max( 0, groupStart - contextLineCount ),
			end: Math.min( operations.length - 1, groupEnd + contextLineCount ),
		} );
		groupStart = changeIndex;
		groupEnd = changeIndex;
	}

	ranges.push( {
		start: Math.max( 0, groupStart - contextLineCount ),
		end: Math.min( operations.length - 1, groupEnd + contextLineCount ),
	} );

	const mergedRanges = ranges.reduce< Array< { start: number; end: number } > >(
		( merged, range ) => {
			const previous = merged[ merged.length - 1 ];
			if ( previous && range.start <= previous.end + 1 ) {
				previous.end = Math.max( previous.end, range.end );
				return merged;
			}

			merged.push( range );
			return merged;
		},
		[]
	);

	return mergedRanges.map( ( range ) =>
		createDiffHunk( operations.slice( range.start, range.end + 1 ) )
	);
}

export function buildDiffLines( beforeContent = '', afterContent = '' ): DiffLine[] {
	return buildDiffHunks( beforeContent, afterContent, 4 ).flatMap( ( hunk, index, hunks ) => {
		const lines = hunk.lines.map( ( line ) => ( {
			type: line.type,
			beforeNumber: line.oldNumber,
			afterNumber: line.newNumber,
			text: line.content,
		} ) );

		if ( index === 0 ) {
			return lines;
		}

		return [
			{
				type: 'context' as const,
				text: '…',
			},
			...lines,
			...( index === hunks.length - 1
				? []
				: [
						{
							type: 'context' as const,
							text: '…',
						},
				  ] ),
		];
	} );
}

export function countDiffHunkLines( hunks: DiffHunk[], type: 'add' | 'delete' ) {
	return hunks.reduce(
		( count, hunk ) => count + hunk.lines.filter( ( line ) => line.type === type ).length,
		0
	);
}

export function getPatchHunks( patch: DevelopmentProjectAiPatch | AiPatchItem ): DiffHunk[] {
	return 'hunks' in patch && Array.isArray( patch.hunks ) && patch.hunks.length > 0
		? patch.hunks
		: buildDiffHunks( patch.beforeContent, patch.afterContent );
}

export function getPatchStats( patch: DevelopmentProjectAiPatch ) {
	const hunks = getPatchHunks( patch );
	return {
		added:
			'additions' in patch && typeof patch.additions === 'number'
				? patch.additions
				: countDiffHunkLines( hunks, 'add' ),
		deleted:
			'deletions' in patch && typeof patch.deletions === 'number'
				? patch.deletions
				: countDiffHunkLines( hunks, 'delete' ),
	};
}

export function createReviewPatchFromContents( {
	filePath,
	beforeContent,
	afterContent,
	prompt,
	source = 'release',
	existingPatch,
}: {
	filePath: string;
	beforeContent?: string;
	afterContent?: string;
	prompt?: string;
	source?: AiPatchItem[ 'source' ];
	existingPatch?: AiPatchItem;
} ): AiPatchItem | null {
	if ( beforeContent === afterContent ) {
		return null;
	}

	const createdAt = existingPatch?.createdAt ?? new Date().toISOString();
	const hunks = buildDiffHunks( beforeContent ?? '', afterContent ?? '' );

	return {
		id: existingPatch?.id ?? `${ source ?? 'review' }:${ createdAt }:${ filePath }`,
		source,
		path: filePath,
		status:
			beforeContent === undefined ? 'created' : afterContent === undefined ? 'deleted' : 'modified',
		beforeContent,
		afterContent,
		prompt: existingPatch?.prompt ?? prompt,
		createdAt,
		hunks,
		additions: countDiffHunkLines( hunks, 'add' ),
		deletions: countDiffHunkLines( hunks, 'delete' ),
	};
}

function getHunkSegment( hunk: DiffHunk, mode: 'before' | 'after' ): string[] {
	return hunk.lines
		.filter( ( line ) => ( mode === 'before' ? line.type !== 'add' : line.type !== 'delete' ) )
		.map( ( line ) => line.content );
}

function matchesSegmentAt( lines: string[], segment: string[], startIndex: number ) {
	if ( startIndex < 0 || startIndex + segment.length > lines.length ) {
		return false;
	}

	return segment.every( ( line, index ) => lines[ startIndex + index ] === line );
}

function findSegmentIndex( lines: string[], segment: string[], preferredIndex: number ): number {
	const startIndex = Math.max( 0, Math.min( preferredIndex, lines.length ) );

	if ( segment.length === 0 ) {
		return startIndex;
	}

	if ( matchesSegmentAt( lines, segment, startIndex ) ) {
		return startIndex;
	}

	for ( let index = 0; index <= lines.length - segment.length; index += 1 ) {
		if ( matchesSegmentAt( lines, segment, index ) ) {
			return index;
		}
	}

	throw new Error( __( 'Studio could not locate this patch hunk in the current file.' ) );
}

function replaceHunkSegment(
	content: string,
	sourceSegment: string[],
	replacementSegment: string[],
	preferredIndex: number
) {
	const lines = splitDiffLines( content );
	const segmentIndex = findSegmentIndex( lines, sourceSegment, preferredIndex );
	const nextLines = [
		...lines.slice( 0, segmentIndex ),
		...replacementSegment,
		...lines.slice( segmentIndex + sourceSegment.length ),
	];

	return nextLines.join( '\n' );
}

export function applyDiffHunkToContent( content: string, hunk: DiffHunk ) {
	return replaceHunkSegment(
		content,
		getHunkSegment( hunk, 'before' ),
		getHunkSegment( hunk, 'after' ),
		Math.max( 0, hunk.oldStart - 1 )
	);
}

export function revertDiffHunkInContent( content: string, hunk: DiffHunk ) {
	return replaceHunkSegment(
		content,
		getHunkSegment( hunk, 'after' ),
		getHunkSegment( hunk, 'before' ),
		Math.max( 0, hunk.newStart - 1 )
	);
}

export function applyDiffHunksToContent( content: string, hunks: DiffHunk[] ) {
	return hunks.reduce(
		( nextContent, hunk ) => applyDiffHunkToContent( nextContent, hunk ),
		content
	);
}

export function getDirectoryDepth( entryPath: string ) {
	return entryPath ? entryPath.split( '/' ).length - 1 : 0;
}

export function summarizeFindings( findings: DevelopmentProjectValidationFinding[] ) {
	return findings.reduce(
		( summary, finding ) => ( {
			...summary,
			[ finding.severity ]: summary[ finding.severity ] + 1,
			total: summary.total + 1,
		} ),
		{ error: 0, warning: 0, info: 0, total: 0 }
	);
}

export function formatValidationSummary(
	summary: Pick<
		DevelopmentProjectValidationResult[ 'summary' ],
		'error' | 'warning' | 'info' | 'total'
	>
) {
	const parts = [
		summary.error
			? sprintf(
					// translators: %d is a number of validation errors.
					__( '%d errors' ),
					summary.error
			  )
			: '',
		summary.warning
			? sprintf(
					// translators: %d is a number of validation warnings.
					__( '%d warnings' ),
					summary.warning
			  )
			: '',
		summary.info
			? sprintf(
					// translators: %d is a number of validation notices.
					__( '%d info' ),
					summary.info
			  )
			: '',
	].filter( Boolean );

	return parts.join( ', ' ) || __( 'no findings' );
}
