import os from 'os';
import path from 'path';
import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import { buildSystemPrompt } from 'cli/ai/system-prompt';
import { createStudioTools } from 'cli/ai/tools';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';

export interface AskUserQuestion {
	question: string;
	options: { label: string; description: string }[];
}

export interface AiAgentConfig {
	prompt: string;
	env?: Record< string, string >;
	model?: AiModelId;
	maxTurns?: number;
	resume?: string;
	onAskUser?: ( questions: AskUserQuestion[] ) => Promise< Record< string, string > >;
}

export const AI_MODELS = {
	'claude-sonnet-4-6': 'Sonnet 4.6',
	'claude-opus-4-6': 'Opus 4.6',
} as const;

export type AiModelId = keyof typeof AI_MODELS;

export const DEFAULT_MODEL: AiModelId = 'claude-sonnet-4-6';
const STUDIO_ROOT = path.resolve( STUDIO_SITES_ROOT );
const STUDIO_ROOT_PREFIX = STUDIO_ROOT.endsWith( path.sep )
	? STUDIO_ROOT
	: `${ STUDIO_ROOT }${ path.sep }`;

const PATH_INPUT_KEYS = [ 'path', 'file_path', 'filePath' ] as const;
const BUILTIN_TOOLS = [
	'Read',
	'Write',
	'Edit',
	'Bash',
	'Glob',
	'Grep',
	'AskUserQuestion',
] as const;
const PATH_GATED_TOOLS = [ 'Write', 'Edit', 'Bash' ] as const; // Tools that should not manipulate files outside of ~/Studio
const ALLOWED_TOOLS = [ 'mcp__studio__*', 'Read', 'Glob', 'Grep', 'AskUserQuestion' ]; // Tools that can run without permissions
const sessionApprovedPathsByTool = new Map< string, Set< string > >();

const ACCESS_DENIED_MESSAGE = `Access denied outside ${ STUDIO_ROOT }`;
const APPROVE_ONCE_LABEL = 'Allow once';
const APPROVE_SESSION_LABEL = 'Allow for this session';
const DENY_LABEL = 'Deny';

type PathGatedApprovalDecision = 'allow_once' | 'allow_session' | 'deny';

function isPathGatedTool( toolName: string ): boolean {
	return ( PATH_GATED_TOOLS as readonly string[] ).includes( toolName );
}

function resolveToolPath( rawPath: string ): string {
	const expandedPath = rawPath.startsWith( '~/' )
		? path.join( os.homedir(), rawPath.slice( 2 ) )
		: rawPath;
	return path.isAbsolute( expandedPath )
		? path.resolve( expandedPath )
		: path.resolve( STUDIO_ROOT, expandedPath );
}

function isPathWithinScope( filePath: string, scopePath: string ): boolean {
	return filePath === scopePath || filePath.startsWith( `${ scopePath }${ path.sep }` );
}

function rememberSessionApprovedPath( toolName: string, approvedPath: string ): void {
	const normalizedPath = resolveToolPath( approvedPath );
	const approvedPaths = sessionApprovedPathsByTool.get( toolName ) ?? new Set< string >();
	approvedPaths.add( normalizedPath );
	sessionApprovedPathsByTool.set( toolName, approvedPaths );
}

function hasSessionApprovedPath( toolName: string, requestedPath: string ): boolean {
	const approvedPaths = sessionApprovedPathsByTool.get( toolName );
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
}

function isPathWithinStudioRoot( filePath: string ): boolean {
	const normalizedPath = resolveToolPath( filePath );
	return normalizedPath === STUDIO_ROOT || normalizedPath.startsWith( STUDIO_ROOT_PREFIX );
}

function getToolInputPaths( input: Record< string, unknown > ): string[] {
	return PATH_INPUT_KEYS.map( ( key ) => input[ key ] )
		.filter( ( value ) => typeof value === 'string' )
		.map( ( value ) => value as string )
		.filter( ( value ) => value.trim().length > 0 );
}

function findFirstPathOutsideStudioRoot(
	input: Record< string, unknown >,
	blockedPath?: string
): string | undefined {
	if ( blockedPath && ! isPathWithinStudioRoot( blockedPath ) ) {
		return blockedPath;
	}

	for ( const toolPath of getToolInputPaths( input ) ) {
		if ( ! isPathWithinStudioRoot( toolPath ) ) {
			return toolPath;
		}
	}

	return undefined;
}

async function askForPathGatedToolApproval( {
	toolName,
	outsidePath,
	onAskUser,
}: {
	toolName: string;
	outsidePath: string;
	onAskUser?: ( questions: AskUserQuestion[] ) => Promise< Record< string, string > >;
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
					description: `Run ${ toolName } outside ${ STUDIO_ROOT } for this step.`,
				},
				{
					label: APPROVE_SESSION_LABEL,
					description: `Allow this kind of ${ toolName } action for the rest of this session.`,
				},
				{
					label: DENY_LABEL,
					description: 'Keep filesystem access restricted to Studio sites.',
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

/**
 * Start the AI agent and return the Query object.
 * Caller can iterate messages with `for await` and call `interrupt()` to stop.
 */
export function startAiAgent( config: AiAgentConfig ): Query {
	const { prompt, env, model = DEFAULT_MODEL, maxTurns = 50, resume, onAskUser } = config;
	const resolvedEnv = env ?? { ...( process.env as Record< string, string > ) };

	return query( {
		prompt,
		options: {
			env: resolvedEnv,
			systemPrompt: {
				type: 'preset',
				preset: 'claude_code',
				append: buildSystemPrompt(),
			},
			mcpServers: {
				studio: createStudioTools(),
			},
			maxTurns,
			cwd: STUDIO_ROOT,
			sandbox: {
				enabled: true,
				allowUnsandboxedCommands: false,
				filesystem: {
					allowWrite: [ STUDIO_ROOT ],
				},
			},
			tools: [ ...BUILTIN_TOOLS ],
			allowedTools: [ ...ALLOWED_TOOLS ],
			permissionMode: 'default',
			canUseTool: async ( toolName, input, metadata ) => {
				if ( toolName === 'AskUserQuestion' && onAskUser ) {
					const typedInput = input as {
						questions?: AskUserQuestion[];
						answers?: Record< string, string >;
					};
					const questions = typedInput.questions ?? [];
					const answers = await onAskUser( questions );
					return {
						behavior: 'allow' as const,
						updatedInput: { ...input, answers },
					};
				}

				const outsidePath = findFirstPathOutsideStudioRoot( input, metadata.blockedPath );
				if ( outsidePath && isPathGatedTool( toolName ) ) {
					if ( hasSessionApprovedPath( toolName, outsidePath ) ) {
						return { behavior: 'allow' as const, updatedInput: input };
					}

					const approvalDecision = await askForPathGatedToolApproval( {
						toolName,
						outsidePath,
						onAskUser,
					} );

					if ( approvalDecision === 'deny' ) {
						return {
							behavior: 'deny' as const,
							message: ACCESS_DENIED_MESSAGE,
						};
					}

					if ( approvalDecision === 'allow_session' ) {
						rememberSessionApprovedPath( toolName, outsidePath );
						if ( metadata.suggestions?.length ) {
							return {
								behavior: 'allow' as const,
								updatedInput: input,
								updatedPermissions: metadata.suggestions,
							};
						}
					}

					return { behavior: 'allow' as const, updatedInput: input };
				}

				if ( outsidePath ) {
					return {
						behavior: 'deny' as const,
						message: ACCESS_DENIED_MESSAGE,
					};
				}

				return { behavior: 'allow' as const, updatedInput: input };
			},
			model,
			resume,
		},
	} );
}
