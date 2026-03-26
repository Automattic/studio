import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import {
	ACCESS_DENIED_MESSAGE,
	STUDIO_ROOT,
	TMP_ROOT,
	askForPathGatedToolApproval,
	createPathApprovalSession,
	findFirstPathOutsideTrustedRoots,
	getPathGatedPermissionRequest,
	isPathGatedTool,
	isPathWithinTrustedRoot,
	promptForApproval,
	resolveToolPath,
	type AskUserQuestion,
} from 'cli/ai/security';
import type { CanUseTool, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

function createCanUseToolMetadata(
	overrides: Partial< Parameters< CanUseTool >[ 2 ] > = {}
): Parameters< CanUseTool >[ 2 ] {
	const abortController = new AbortController();
	return {
		signal: abortController.signal,
		toolUseID: 'test-tool-use-id',
		...overrides,
	};
}

describe( 'AI security helpers', () => {
	it( 'resolves home-relative and Studio-relative paths', () => {
		const homeRelativePath = '~/Documents/outside.txt';
		expect( resolveToolPath( homeRelativePath ) ).toBe(
			path.resolve( os.homedir(), 'Documents', 'outside.txt' )
		);

		const studioRelativePath = 'example-site/wp-config.php';
		expect( resolveToolPath( studioRelativePath ) ).toBe(
			path.resolve( STUDIO_ROOT, 'example-site/wp-config.php' )
		);
	} );

	it( 'identifies paths inside trusted roots and outside paths', () => {
		expect( isPathWithinTrustedRoot( 'example-site/wp-config.php' ) ).toBe( true );
		expect( isPathWithinTrustedRoot( path.resolve( STUDIO_ROOT, 'example-site' ) ) ).toBe( true );
		expect( isPathWithinTrustedRoot( path.resolve( TMP_ROOT, 'studio-ai-temp.txt' ) ) ).toBe(
			true
		);
		expect( isPathWithinTrustedRoot( path.resolve( os.homedir(), 'Downloads/outside.txt' ) ) ).toBe(
			false
		);
	} );

	it( 'does not treat temporary directory paths as outside', () => {
		const tempPath = path.resolve( TMP_ROOT, 'studio-ai-temp.txt' );

		expect( findFirstPathOutsideTrustedRoots( { path: tempPath } ) ).toBeUndefined();
	} );

	it( 'does not treat /tmp paths as outside', () => {
		expect(
			findFirstPathOutsideTrustedRoots( { path: '/tmp/studio-ai-temp.txt' } )
		).toBeUndefined();
	} );

	it( 'prefers blockedPath when it is outside trusted roots', () => {
		const outsidePath = path.resolve( os.homedir(), 'Downloads/outside.txt' );
		expect(
			findFirstPathOutsideTrustedRoots(
				{ path: path.resolve( STUDIO_ROOT, 'inside.txt' ) },
				outsidePath
			)
		).toBe( outsidePath );
	} );

	it( 'identifies path-gated tools', () => {
		expect( isPathGatedTool( 'Write' ) ).toBe( true );
		expect( isPathGatedTool( 'NotebookEdit' ) ).toBe( true );
		expect( isPathGatedTool( 'Read' ) ).toBe( false );
	} );

	it( 'builds a permission request when a path-gated tool targets an outside path', () => {
		const outsidePath = path.resolve( os.homedir(), 'Downloads/outside.txt' );
		const suggestions: PermissionUpdate[] = [
			{
				type: 'addDirectories',
				directories: [ path.resolve( os.homedir(), 'Downloads' ) ],
				destination: 'session',
			},
		];

		const request = getPathGatedPermissionRequest( {
			toolName: 'Write',
			input: { path: outsidePath },
			blockedPath: outsidePath,
			suggestions,
		} );

		expect( request ).toEqual( {
			toolName: 'Write',
			outsidePath,
			approvalPath: path.resolve( os.homedir(), 'Downloads' ),
			updatedPermissions: suggestions,
		} );
	} );

	it( 'does not build a permission request when tool is not path-gated', () => {
		const outsidePath = path.resolve( os.homedir(), 'Downloads/outside.txt' );

		const request = getPathGatedPermissionRequest( {
			toolName: 'Read',
			input: { path: outsidePath },
			blockedPath: outsidePath,
		} );

		expect( request ).toBeUndefined();
	} );

	it( 'tracks session approvals by tool and directory scope', () => {
		const session = createPathApprovalSession();
		const approvedDirectory = path.resolve( os.homedir(), 'Downloads' );
		const approvedFile = path.resolve( approvedDirectory, 'one.txt' );
		const nestedFile = path.resolve( approvedDirectory, 'nested/two.txt' );
		const otherDirectoryFile = path.resolve( os.homedir(), 'Desktop/three.txt' );

		expect( session.hasApprovedPath( 'Write', approvedFile ) ).toBe( false );

		session.rememberApprovedPath( 'Write', approvedDirectory );

		expect( session.hasApprovedPath( 'Write', approvedFile ) ).toBe( true );
		expect( session.hasApprovedPath( 'Write', nestedFile ) ).toBe( true );
		expect( session.hasApprovedPath( 'Bash', approvedFile ) ).toBe( false );
		expect( session.hasApprovedPath( 'Write', otherDirectoryFile ) ).toBe( false );
	} );
} );

describe( 'askForPathGatedToolApproval', () => {
	it( 'denies when no user callback is provided', async () => {
		const result = await askForPathGatedToolApproval( {
			toolName: 'Write',
			outsidePath: path.resolve( os.homedir(), 'Downloads/outside.txt' ),
		} );

		expect( result ).toBe( 'deny' );
	} );

	it( 'returns allow_once when user selects Allow once', async () => {
		const onAskUser = vi.fn( async ( questions: AskUserQuestion[] ) => ( {
			[ questions[ 0 ].question ]: 'Allow once',
		} ) );

		const result = await askForPathGatedToolApproval( {
			toolName: 'Write',
			outsidePath: '~/Downloads/outside.txt',
			onAskUser,
		} );

		expect( result ).toBe( 'allow_once' );
		expect( onAskUser ).toHaveBeenCalledOnce();
	} );

	it( 'returns allow_session when user selects Allow for this session', async () => {
		const onAskUser = vi.fn( async ( questions: AskUserQuestion[] ) => ( {
			[ questions[ 0 ].question ]: 'Allow for this session',
		} ) );

		const result = await askForPathGatedToolApproval( {
			toolName: 'Bash',
			outsidePath: path.resolve( os.homedir(), 'Downloads/outside.txt' ),
			onAskUser,
		} );

		expect( result ).toBe( 'allow_session' );
	} );

	it( 'returns deny for any other answer', async () => {
		const onAskUser = vi.fn( async ( questions: AskUserQuestion[] ) => ( {
			[ questions[ 0 ].question ]: 'No',
		} ) );

		const result = await askForPathGatedToolApproval( {
			toolName: 'Edit',
			outsidePath: path.resolve( os.homedir(), 'Downloads/outside.txt' ),
			onAskUser,
		} );

		expect( result ).toBe( 'deny' );
	} );
} );

describe( 'promptForApproval', () => {
	it( 'allows when no permission request is needed', async () => {
		const input = { questions: [] };

		const result = await promptForApproval( {
			toolName: 'AskUserQuestion',
			input,
			pathApprovalSession: createPathApprovalSession(),
		} );

		expect( result ).toEqual( {
			behavior: 'allow',
			updatedInput: input,
		} );
	} );

	it( 'allows outside path access when user selects Allow once', async () => {
		const outsidePath = path.resolve( os.homedir(), 'Downloads/outside.txt' );
		const onAskUser = vi.fn( async ( questions: AskUserQuestion[] ) => ( {
			[ questions[ 0 ].question ]: 'Allow once',
		} ) );

		const result = await promptForApproval( {
			toolName: 'Write',
			input: { path: outsidePath },
			metadata: createCanUseToolMetadata( { blockedPath: outsidePath } ),
			onAskUser,
			pathApprovalSession: createPathApprovalSession(),
		} );

		expect( result ).toEqual( {
			behavior: 'allow',
			updatedInput: { path: outsidePath },
		} );
	} );

	it( 'denies outside path access when user selects Deny', async () => {
		const outsidePath = path.resolve( os.homedir(), 'Downloads/outside.txt' );
		const onAskUser = vi.fn( async ( questions: AskUserQuestion[] ) => ( {
			[ questions[ 0 ].question ]: 'Deny',
		} ) );

		const result = await promptForApproval( {
			toolName: 'Write',
			input: { path: outsidePath },
			metadata: createCanUseToolMetadata( { blockedPath: outsidePath } ),
			onAskUser,
			pathApprovalSession: createPathApprovalSession(),
		} );

		expect( result ).toEqual( {
			behavior: 'deny',
			message: ACCESS_DENIED_MESSAGE,
		} );
	} );

	it( 'reuses Allow for this session for repeated access in the same directory', async () => {
		const outsideDirectory = path.resolve( os.homedir(), 'Downloads' );
		const outsidePath = path.resolve( outsideDirectory, 'outside.txt' );
		const nestedPath = path.resolve( outsideDirectory, 'nested/again.txt' );
		const suggestions: PermissionUpdate[] = [
			{
				type: 'addDirectories',
				directories: [ outsideDirectory ],
				destination: 'session',
			},
		];
		const session = createPathApprovalSession();
		let askCount = 0;
		const onAskUser = vi.fn( async ( questions: AskUserQuestion[] ) => {
			const answer = askCount === 0 ? 'Allow for this session' : 'Deny';
			askCount += 1;
			return {
				[ questions[ 0 ].question ]: answer,
			};
		} );

		const firstResult = await promptForApproval( {
			toolName: 'Write',
			input: { path: outsidePath },
			metadata: createCanUseToolMetadata( { blockedPath: outsidePath, suggestions } ),
			onAskUser,
			pathApprovalSession: session,
		} );
		const secondResult = await promptForApproval( {
			toolName: 'Write',
			input: { path: nestedPath },
			metadata: createCanUseToolMetadata( {
				blockedPath: nestedPath,
				suggestions,
			} ),
			onAskUser,
			pathApprovalSession: session,
		} );

		expect( firstResult ).toEqual( {
			behavior: 'allow',
			updatedInput: { path: outsidePath },
			updatedPermissions: suggestions,
		} );
		expect( secondResult ).toEqual( {
			behavior: 'allow',
			updatedInput: { path: nestedPath },
			updatedPermissions: suggestions,
		} );
	} );

	it( 'does not reuse session approval for a different directory', async () => {
		const downloadsDirectory = path.resolve( os.homedir(), 'Downloads' );
		const desktopDirectory = path.resolve( os.homedir(), 'Desktop' );
		const downloadsPath = path.resolve( downloadsDirectory, 'outside.txt' );
		const desktopPath = path.resolve( desktopDirectory, 'outside.txt' );
		const downloadsSuggestions: PermissionUpdate[] = [
			{
				type: 'addDirectories',
				directories: [ downloadsDirectory ],
				destination: 'session',
			},
		];
		const desktopSuggestions: PermissionUpdate[] = [
			{
				type: 'addDirectories',
				directories: [ desktopDirectory ],
				destination: 'session',
			},
		];
		const session = createPathApprovalSession();
		const onAskUser = vi.fn( async ( questions: AskUserQuestion[] ) => {
			const question = questions[ 0 ].question;
			return {
				[ question ]: question.includes( downloadsDirectory ) ? 'Allow for this session' : 'Deny',
			};
		} );

		const firstResult = await promptForApproval( {
			toolName: 'Write',
			input: { path: downloadsPath },
			metadata: createCanUseToolMetadata( {
				blockedPath: downloadsPath,
				suggestions: downloadsSuggestions,
			} ),
			onAskUser,
			pathApprovalSession: session,
		} );
		const secondResult = await promptForApproval( {
			toolName: 'Write',
			input: { path: desktopPath },
			metadata: createCanUseToolMetadata( {
				blockedPath: desktopPath,
				suggestions: desktopSuggestions,
			} ),
			onAskUser,
			pathApprovalSession: session,
		} );

		expect( firstResult ).toEqual( {
			behavior: 'allow',
			updatedInput: { path: downloadsPath },
			updatedPermissions: downloadsSuggestions,
		} );
		expect( secondResult ).toEqual( {
			behavior: 'deny',
			message: ACCESS_DENIED_MESSAGE,
		} );
	} );
} );
