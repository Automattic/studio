import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import {
	STUDIO_ROOT,
	askForPathGatedToolApproval,
	createPathApprovalSession,
	findFirstPathOutsideStudioRoot,
	getPathGatedPermissionRequest,
	isPathGatedTool,
	isPathWithinStudioRoot,
	resolveToolPath,
	type AskUserQuestion,
} from 'cli/ai/security';
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

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

	it( 'identifies paths inside and outside of the Studio root', () => {
		expect( isPathWithinStudioRoot( 'example-site/wp-config.php' ) ).toBe( true );
		expect( isPathWithinStudioRoot( path.resolve( STUDIO_ROOT, 'example-site' ) ) ).toBe( true );
		expect( isPathWithinStudioRoot( path.resolve( os.homedir(), 'Downloads/outside.txt' ) ) ).toBe(
			false
		);
	} );

	it( 'prefers blockedPath when it is outside the Studio root', () => {
		const outsidePath = path.resolve( os.homedir(), 'Downloads/outside.txt' );
		expect(
			findFirstPathOutsideStudioRoot(
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
