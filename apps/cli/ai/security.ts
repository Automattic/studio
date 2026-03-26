import os from 'os';
import path from 'path';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import type {
	CanUseTool,
	PermissionResult,
	PermissionUpdate,
} from '@anthropic-ai/claude-agent-sdk';

export interface AskUserQuestion {
	question: string;
	options: { label: string; description: string }[];
	allowFreeForm?: boolean;
}

export type AskUserHandler = (
	questions: AskUserQuestion[]
) => Promise< Record< string, string > >;

export type PathGatedApprovalDecision = 'allow_once' | 'allow_session' | 'deny';

export interface PathGatedPermissionRequest {
	toolName: string;
	outsidePath: string;
	approvalPath: string;
	updatedPermissions?: PermissionUpdate[];
}

// Tools that can run without permissions (read access)
export const ALLOWED_TOOLS = [
	'mcp__studio__*',
	'Read',
	'Glob',
	'Grep',
	'WebFetch',
	'WebSearch',
	'TodoRead',
	'NotebookRead',
	'AskUserQuestion',
	'Skill',
	'Agent',
	'Task',
] as const;

// Tools that should not manipulate files outside trusted roots without permission (write access)
const PATH_GATED_TOOLS = [ 'Write', 'Edit', 'Bash', 'NotebookEdit' ] as const;
const PATH_INPUT_KEYS = [ 'path', 'file_path', 'filePath' ] as const;

const APPROVE_ONCE_LABEL = 'Allow once';
const APPROVE_SESSION_LABEL = 'Allow for this session';
const DENY_LABEL = 'Deny';

export const STUDIO_ROOT = path.resolve( STUDIO_SITES_ROOT );
export const TMP_ROOT = path.resolve( os.tmpdir() );
const TRUSTED_TEMP_ROOT_CANDIDATES = [ TMP_ROOT, '/tmp' ];
export const TRUSTED_TEMP_ROOTS = Array.from(
	new Set( TRUSTED_TEMP_ROOT_CANDIDATES.map( ( trustedRoot ) => path.resolve( trustedRoot ) ) )
);

const TRUSTED_ROOTS = [ STUDIO_ROOT, ...TRUSTED_TEMP_ROOTS ];
const TRUSTED_ROOT_PREFIXES = TRUSTED_ROOTS.map( ( trustedRoot ) =>
	trustedRoot.endsWith( path.sep ) ? trustedRoot : `${ trustedRoot }${ path.sep }`
);

export const ACCESS_DENIED_MESSAGE = 'Access denied outside trusted directories';

export interface PathApprovalSession {
	hasApprovedPath: ( toolName: string, requestedPath: string ) => boolean;
	rememberApprovedPath: ( toolName: string, approvedPath: string ) => void;
}

export function isPathGatedTool( toolName: string ): boolean {
	return ( PATH_GATED_TOOLS as readonly string[] ).includes( toolName );
}

export function resolveToolPath( rawPath: string ): string {
	const expandedPath = rawPath.startsWith( '~/' )
		? path.join( os.homedir(), rawPath.slice( 2 ) )
		: rawPath;

	return path.isAbsolute( expandedPath )
		? path.resolve( expandedPath )
		: path.resolve( STUDIO_ROOT, expandedPath );
}

export function isPathWithinTrustedRoot( filePath: string ): boolean {
	const normalizedPath = resolveToolPath( filePath );
	return TRUSTED_ROOTS.some(
		( trustedRoot, index ) =>
			normalizedPath === trustedRoot || normalizedPath.startsWith( TRUSTED_ROOT_PREFIXES[ index ] )
	);
}

function getToolInputPaths( input: Record< string, unknown > ): string[] {
	return PATH_INPUT_KEYS.map( ( key ) => input[ key ] )
		.filter( ( value ) => typeof value === 'string' )
		.map( ( value ) => value as string )
		.filter( ( value ) => value.trim().length > 0 );
}

export function findFirstPathOutsideTrustedRoots(
	input: Record< string, unknown >,
	blockedPath?: string
): string | undefined {
	if ( blockedPath && ! isPathWithinTrustedRoot( blockedPath ) ) {
		return blockedPath;
	}

	for ( const toolPath of getToolInputPaths( input ) ) {
		if ( ! isPathWithinTrustedRoot( toolPath ) ) {
			return toolPath;
		}
	}

	return undefined;
}

function getFirstSuggestedDirectory( suggestions?: PermissionUpdate[] ): string | undefined {
	return suggestions?.find(
		( suggestion ): suggestion is Extract< PermissionUpdate, { type: 'addDirectories' } > =>
			suggestion.type === 'addDirectories'
	)?.directories?.[ 0 ];
}

function isPathWithinScope( filePath: string, scopePath: string ): boolean {
	return filePath === scopePath || filePath.startsWith( `${ scopePath }${ path.sep }` );
}

export function createPathApprovalSession(): PathApprovalSession {
	const approvedPathsByTool = new Map< string, Set< string > >();

	return {
		hasApprovedPath( toolName, requestedPath ) {
			const approvedPaths = approvedPathsByTool.get( toolName );
			if ( ! approvedPaths?.size ) {
				return false;
			}

			const normalizedRequestedPath = resolveToolPath( requestedPath );
			for ( const approvedPath of approvedPaths ) {
				if ( isPathWithinScope( normalizedRequestedPath, approvedPath ) ) {
					return true;
				}
			}

			return false;
		},
		rememberApprovedPath( toolName, approvedPath ) {
			const normalizedPath = resolveToolPath( approvedPath );
			const approvedPaths = approvedPathsByTool.get( toolName ) ?? new Set< string >();
			approvedPaths.add( normalizedPath );
			approvedPathsByTool.set( toolName, approvedPaths );
		},
	};
}

export function getPathGatedPermissionRequest( {
	toolName,
	input,
	blockedPath,
	suggestions,
}: {
	toolName: string;
	input: Record< string, unknown >;
	blockedPath?: string;
	suggestions?: PermissionUpdate[];
} ): PathGatedPermissionRequest | undefined {
	const outsidePath = findFirstPathOutsideTrustedRoots( input, blockedPath );
	if ( ! outsidePath || ! isPathGatedTool( toolName ) ) {
		return undefined;
	}

	return {
		toolName,
		outsidePath,
		approvalPath: getFirstSuggestedDirectory( suggestions ) ?? outsidePath,
		...( suggestions?.length && { updatedPermissions: suggestions } ),
	};
}

export async function askForPathGatedToolApproval( {
	toolName,
	outsidePath,
	onAskUser,
}: {
	toolName: string;
	outsidePath: string;
	onAskUser?: AskUserHandler;
} ): Promise< PathGatedApprovalDecision > {
	if ( ! onAskUser ) {
		return 'deny';
	}

	const normalizedPath = resolveToolPath( outsidePath );
	const question = `Allow ${ toolName } to access ${ normalizedPath }?`;
	const answers = await onAskUser( [
		{
			question,
			options: [
				{
					label: APPROVE_ONCE_LABEL,
					description: `Run ${ toolName } outside trusted directories for this step.`,
				},
				{
					label: APPROVE_SESSION_LABEL,
					description: `Allow this kind of ${ toolName } action for the rest of this session.`,
				},
				{
					label: DENY_LABEL,
					description: 'Keep filesystem access restricted to trusted directories.',
				},
			],
		},
	] );

	if ( answers[ question ] === APPROVE_ONCE_LABEL ) {
		return 'allow_once';
	}

	if ( answers[ question ] === APPROVE_SESSION_LABEL ) {
		return 'allow_session';
	}

	return 'deny';
}

export async function promptForApproval( {
	toolName,
	input,
	metadata,
	onAskUser,
	pathApprovalSession,
}: {
	toolName: string;
	input: Parameters< CanUseTool >[ 1 ];
	metadata?: Parameters< CanUseTool >[ 2 ];
	onAskUser?: AskUserHandler;
	pathApprovalSession: PathApprovalSession;
} ): Promise< PermissionResult > {
	const permissionRequest = getPathGatedPermissionRequest( {
		toolName,
		input,
		blockedPath: metadata?.blockedPath,
		suggestions: metadata?.suggestions,
	} );

	if ( permissionRequest ) {
		if ( ! pathApprovalSession.hasApprovedPath( toolName, permissionRequest.approvalPath ) ) {
			const approvalDecision = await askForPathGatedToolApproval( {
				toolName,
				outsidePath: permissionRequest.approvalPath,
				onAskUser,
			} );

			if ( approvalDecision === 'deny' ) {
				return {
					behavior: 'deny' as const,
					message: ACCESS_DENIED_MESSAGE,
				};
			}

			if ( approvalDecision === 'allow_session' ) {
				pathApprovalSession.rememberApprovedPath( toolName, permissionRequest.approvalPath );
			}
		}

		return {
			behavior: 'allow' as const,
			updatedInput: input,
			...( permissionRequest.updatedPermissions && {
				updatedPermissions: permissionRequest.updatedPermissions,
			} ),
		};
	}

	return { behavior: 'allow' as const, updatedInput: input };
}
