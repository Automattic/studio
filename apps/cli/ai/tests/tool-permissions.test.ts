import { readSharedConfig } from '@studio/common/lib/shared-config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolPermissionsExtension } from 'cli/ai/extensions/tool-permissions';
import { resolveToolPermission } from 'cli/ai/permissions/policy';
import { classifyWpCliCommand } from 'cli/ai/permissions/wp-cli-classifier';
import { runCommand as runDeleteSiteCommand } from 'cli/commands/site/delete';
import { deleteSiteTool } from '../tools/delete-site';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { PermissionRequestData } from '@studio/common/ai/tool-permissions';

vi.mock( '@studio/common/lib/shared-config', () => ( {
	readSharedConfig: vi.fn( async () => ( {} ) ),
	saveSharedConfig: vi.fn(),
	lockSharedConfig: vi.fn(),
	unlockSharedConfig: vi.fn(),
	readAuthToken: vi.fn( async () => null ),
} ) );

vi.mock( '@studio/common/lib/connected-sites', () => ( {
	getConnectedWpcomSitesForLocalSite: vi.fn( async () => [] ),
} ) );

vi.mock( 'cli/commands/site/delete', () => ( {
	runCommand: vi.fn(),
} ) );

vi.mock( 'cli/lib/cli-config/core', () => ( {
	readCliConfig: vi.fn( async () => ( {
		sites: [ { id: 'site-1', name: 'Sunset Bakery', path: '/sites/sunset-bakery' } ],
		snapshots: [],
	} ) ),
} ) );

vi.mock( 'cli/lib/cli-config/sites', () => ( {
	getSiteByFolder: vi.fn( async () => {
		throw new Error( 'not found' );
	} ),
} ) );

vi.mock( 'cli/lib/cli-config/snapshots', () => ( {
	getSnapshotsFromConfig: vi.fn( async () => [] ),
} ) );

const mockReadSharedConfig = vi.mocked( readSharedConfig );

beforeEach( () => {
	vi.clearAllMocks();
	mockReadSharedConfig.mockResolvedValue( { version: 1 } );
} );

describe( 'classifyWpCliCommand', () => {
	it.each( [
		'post list',
		'option get blogname',
		'plugin install woocommerce --activate',
		'user list --format=json',
		// Trash-aware deletes are routine during builds and recoverable.
		'post delete 1',
		'comment delete 5',
		'theme activate twentytwentyfive',
	] )( 'allows safe command: %s', ( command ) => {
		expect( classifyWpCliCommand( command ) ).toBe( 'allow' );
	} );

	it.each( [
		'db reset --yes',
		'db drop',
		'db query "DELETE FROM wp_posts"',
		'site empty',
		'plugin delete woocommerce',
		'plugin uninstall woocommerce',
		'theme delete twentytwenty',
		'user delete 2',
		'option delete blogname',
		'post delete 1 --force',
		'comment delete 5 --force',
		'search-replace old.example new.example',
		'eval "wp_delete_post(1, true);"',
		'eval-file /tmp/script.php',
		'--exec="dangerous()" post list',
		'--require=/tmp/evil.php option get blogname',
	] )( 'escalates destructive command: %s', ( command ) => {
		expect( classifyWpCliCommand( command ) ).toBe( 'ask' );
	} );

	it( 'escalates an empty command rather than guessing', () => {
		expect( classifyWpCliCommand( '' ) ).toBe( 'ask' );
	} );
} );

describe( 'resolveToolPermission', () => {
	it( 'allows ungated tools without any lookup', async () => {
		await expect( resolveToolPermission( 'site_info', {} ) ).resolves.toBe( 'allow' );
		await expect( resolveToolPermission( 'take_screenshot', {} ) ).resolves.toBe( 'allow' );
	} );

	it( 'asks for gated tools by default', async () => {
		await expect( resolveToolPermission( 'site_push', {} ) ).resolves.toBe( 'ask' );
		await expect( resolveToolPermission( 'preview_delete', {} ) ).resolves.toBe( 'ask' );
	} );

	it( 'honors a stored "allow" override', async () => {
		mockReadSharedConfig.mockResolvedValue( {
			version: 1,
			toolPermissions: { site_push: 'allow' },
		} );
		await expect( resolveToolPermission( 'site_push', {} ) ).resolves.toBe( 'allow' );
	} );

	it( 'always asks for site_delete, even with a stored override', async () => {
		mockReadSharedConfig.mockResolvedValue( {
			version: 1,
			toolPermissions: { site_delete: 'allow' },
		} );
		await expect( resolveToolPermission( 'site_delete', {} ) ).resolves.toBe( 'ask' );
	} );

	it( 'asks when the shared config is unreadable', async () => {
		mockReadSharedConfig.mockRejectedValue( new Error( 'corrupt' ) );
		await expect( resolveToolPermission( 'site_push', {} ) ).resolves.toBe( 'ask' );
	} );

	it( 'only escalates wp_cli for destructive commands', async () => {
		await expect( resolveToolPermission( 'wp_cli', { command: 'post list' } ) ).resolves.toBe(
			'allow'
		);
		await expect( resolveToolPermission( 'wp_cli', { command: 'db reset --yes' } ) ).resolves.toBe(
			'ask'
		);
	} );
} );

type ToolCallHandler = (
	event: {
		type: 'tool_call';
		toolCallId: string;
		toolName: string;
		input: Record< string, unknown >;
	},
	ctx: unknown
) => Promise< { block?: boolean; reason?: string } | void >;

function getToolCallHandler(
	onRequestPermission?: (
		request: PermissionRequestData
	) => Promise< 'allow_once' | 'always_allow' | 'deny' >
): ToolCallHandler {
	let handler: ToolCallHandler | undefined;
	const factory = createToolPermissionsExtension( { onRequestPermission } );
	const pi = {
		on: ( event: string, callback: unknown ) => {
			if ( event === 'tool_call' ) {
				handler = callback as ToolCallHandler;
			}
		},
	} as unknown as ExtensionAPI;
	// The factory only registers handlers; the runtime context is unused.
	void factory( pi );
	if ( ! handler ) {
		throw new Error( 'tool_call handler was not registered' );
	}
	return handler;
}

function toolCallEvent( toolName: string, input: Record< string, unknown > = {} ) {
	return { type: 'tool_call' as const, toolCallId: 'call-1', toolName, input };
}

describe( 'createToolPermissionsExtension', () => {
	it( 'lets ungated tools run without consulting the user', async () => {
		const onRequestPermission = vi.fn();
		const handler = getToolCallHandler( onRequestPermission );
		await expect( handler( toolCallEvent( 'site_info' ), {} ) ).resolves.toBeUndefined();
		expect( onRequestPermission ).not.toHaveBeenCalled();
	} );

	it( 'fails closed when no interactive channel exists', async () => {
		const handler = getToolCallHandler( undefined );
		const result = await handler(
			toolCallEvent( 'site_delete', { nameOrPath: 'Sunset Bakery' } ),
			{}
		);
		expect( result ).toMatchObject( { block: true } );
		expect( result?.reason ).toContain( 'interactive user confirmation' );
	} );

	it( 'runs the tool when the user allows once', async () => {
		const onRequestPermission = vi.fn().mockResolvedValue( 'allow_once' );
		const handler = getToolCallHandler( onRequestPermission );
		await expect(
			handler( toolCallEvent( 'site_delete', { nameOrPath: 'Sunset Bakery' } ), {} )
		).resolves.toBeUndefined();
		expect( onRequestPermission ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'blocks the tool when the user denies', async () => {
		const onRequestPermission = vi.fn().mockResolvedValue( 'deny' );
		const handler = getToolCallHandler( onRequestPermission );
		const result = await handler(
			toolCallEvent( 'site_delete', { nameOrPath: 'Sunset Bakery' } ),
			{}
		);
		expect( result ).toMatchObject( { block: true } );
		expect( result?.reason ).toContain( 'declined permission' );
	} );

	it( 'builds a consequence-aware request for site_delete', async () => {
		const onRequestPermission = vi.fn().mockResolvedValue( 'deny' );
		const handler = getToolCallHandler( onRequestPermission );
		await handler( toolCallEvent( 'site_delete', { nameOrPath: 'Sunset Bakery' } ), {} );
		const request = onRequestPermission.mock.calls[ 0 ][ 0 ] as PermissionRequestData;
		expect( request.toolName ).toBe( 'site_delete' );
		expect( request.title ).toContain( 'Sunset Bakery' );
		// Decision 1: site_delete never offers "Always allow".
		expect( request.allowAlways ).toBe( false );
		// Decision 3: default keeps files on disk, and the copy says so.
		expect( request.consequences.join( ' ' ) ).toContain( 'files will stay on your computer' );
	} );

	it( 'offers "Always allow" for tools that support it', async () => {
		const onRequestPermission = vi.fn().mockResolvedValue( 'deny' );
		const handler = getToolCallHandler( onRequestPermission );
		await handler( toolCallEvent( 'preview_delete', { host: 'x.wordpress.com' } ), {} );
		const request = onRequestPermission.mock.calls[ 0 ][ 0 ] as PermissionRequestData;
		expect( request.allowAlways ).toBe( true );
	} );
} );

describe( 'deleteSiteTool', () => {
	it( 'keeps site files by default (decision 3)', async () => {
		await deleteSiteTool.rawHandler( { nameOrPath: 'Sunset Bakery' } as never );
		expect( runDeleteSiteCommand ).toHaveBeenCalledWith( '/sites/sunset-bakery', false );
	} );

	it( 'trashes files only when explicitly requested', async () => {
		await deleteSiteTool.rawHandler( { nameOrPath: 'Sunset Bakery', deleteFiles: true } as never );
		expect( runDeleteSiteCommand ).toHaveBeenCalledWith( '/sites/sunset-bakery', true );
	} );
} );
