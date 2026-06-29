import { decodeHtmlEntities } from '@studio/common/lib/html-entities';
import { formatValidationSummary } from './utils';
import type { ExplorerValidationSummary, FileTreeEntry } from './types';
import type { DevelopmentProjectValidationFinding } from '@studio/common/types/publishing';

const VALIDATION_SEVERITY_RANK: Record<
	DevelopmentProjectValidationFinding[ 'severity' ],
	number
> = {
	info: 1,
	warning: 2,
	error: 3,
};

export function getExplorerIgnorePattern( kind: FileTreeEntry[ 'kind' ], path: string ): string {
	return kind === 'directory' ? `${ path.replace( /\/$/, '' ) }/**` : path;
}

export function getAncestorDirectoryPaths( entry: FileTreeEntry ): string[] {
	const parentPath = entry.kind === 'directory' ? entry.parent : entry.directory;
	if ( ! parentPath ) {
		return [];
	}

	const segments = parentPath.split( '/' );
	return segments.map( ( _, index ) => segments.slice( 0, index + 1 ).join( '/' ) );
}

function addExplorerValidationFinding(
	summaries: Map< string, ExplorerValidationSummary >,
	path: string,
	finding: DevelopmentProjectValidationFinding
) {
	const normalizedPath = path.replace( /\\/g, '/' ).replace( /^\/+/, '' );
	if ( ! normalizedPath ) {
		return;
	}

	const message = decodeHtmlEntities( finding.message );
	const existing = summaries.get( normalizedPath );
	if ( ! existing ) {
		summaries.set( normalizedPath, {
			error: finding.severity === 'error' ? 1 : 0,
			warning: finding.severity === 'warning' ? 1 : 0,
			info: finding.severity === 'info' ? 1 : 0,
			total: 1,
			severity: finding.severity,
			firstMessage: message,
		} );
		return;
	}

	existing[ finding.severity ] += 1;
	existing.total += 1;
	if (
		VALIDATION_SEVERITY_RANK[ finding.severity ] > VALIDATION_SEVERITY_RANK[ existing.severity ]
	) {
		existing.severity = finding.severity;
		existing.firstMessage = message;
	}
}

export function getExplorerValidationSummaries(
	findings: DevelopmentProjectValidationFinding[]
): Map< string, ExplorerValidationSummary > {
	const summaries = new Map< string, ExplorerValidationSummary >();

	for ( const finding of findings ) {
		if ( ! finding.file ) {
			continue;
		}

		const filePath = finding.file.replace( /\\/g, '/' ).replace( /^\/+/, '' );
		addExplorerValidationFinding( summaries, filePath, finding );

		const parentSegments = filePath.split( '/' ).slice( 0, -1 );
		for ( let index = 0; index < parentSegments.length; index += 1 ) {
			addExplorerValidationFinding(
				summaries,
				parentSegments.slice( 0, index + 1 ).join( '/' ),
				finding
			);
		}
	}

	return summaries;
}

export function getExplorerValidationTitle( summary: ExplorerValidationSummary ): string {
	return `${ formatValidationSummary( summary ) }\n${ summary.firstMessage }`;
}
