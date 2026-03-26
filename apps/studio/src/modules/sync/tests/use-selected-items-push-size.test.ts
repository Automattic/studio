import { SYNC_PUSH_SIZE_LIMIT_BYTES } from '@studio/common/lib/sync/constants';
import { renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { TreeNode } from 'src/components/tree-view';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useSelectedItemsPushSize } from 'src/modules/sync/hooks/use-selected-items-push-size';

vi.mock( 'src/lib/get-ipc-api' );

const createMockTreeState = (
	options: {
		databaseSelected?: boolean;
		filesAndFoldersSelected?: boolean;
		pluginsSelected?: boolean;
		themesSelected?: boolean;
		uploadsSelected?: boolean;
		allSelected?: boolean;
	} = {}
): TreeNode[] => {
	const {
		databaseSelected = false,
		filesAndFoldersSelected = false,
		allSelected = false,
	} = options;

	const wpContentIndeterminate =
		! filesAndFoldersSelected &&
		! allSelected &&
		( options.pluginsSelected || options.themesSelected || options.uploadsSelected );

	return [
		{
			id: 'filesAndFolders',
			name: 'filesAndFolders',
			label: 'Files and folders',
			checked: allSelected || filesAndFoldersSelected,
			indeterminate: false,
			expanded: false,
			type: 'folder',
			children: [
				{
					id: 'wp-content',
					name: 'wp-content',
					label: 'wp-content',
					checked: allSelected || filesAndFoldersSelected,
					indeterminate: wpContentIndeterminate,
					type: 'folder',
					children: [
						{
							id: 'plugins',
							name: 'plugins',
							label: 'plugins',
							checked: allSelected || options.pluginsSelected || false,
							type: 'folder',
							expanded: false,
						},
						{
							id: 'themes',
							name: 'themes',
							label: 'themes',
							checked: allSelected || options.themesSelected || false,
							type: 'folder',
							expanded: false,
						},
						{
							id: 'uploads',
							name: 'uploads',
							label: 'uploads',
							checked: allSelected || options.uploadsSelected || false,
							type: 'folder',
							expanded: false,
						},
					],
				},
			],
		},
		{
			id: 'sqls',
			name: 'sqls',
			label: 'Database',
			checked: allSelected || databaseSelected,
		},
	];
};

describe( 'useSelectedItemsPushSize Hook Tests', () => {
	const mockSiteId = 'test-site-id';

	beforeEach( () => {
		vi.resetAllMocks();

		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			getDirectorySize: vi.fn().mockResolvedValue( 1024 ), // 1KB by default
		} );
	} );

	describe( 'Push operation size checking', () => {
		it( 'returns false for pull operations', async () => {
			const treeState = createMockTreeState( { allSelected: true } );

			const { result } = renderHook( () =>
				useSelectedItemsPushSize( mockSiteId, treeState, 'pull' )
			);

			expect( result.current.isPushSelectionOverLimit ).toBe( false );
			expect( result.current.isLoading ).toBe( false );
		} );

		it( 'checks size for push operations when everything is selected', async () => {
			const mockGetDirectorySize = vi.fn().mockResolvedValue( SYNC_PUSH_SIZE_LIMIT_BYTES + 1000 );
			vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
				getDirectorySize: mockGetDirectorySize,
			} );

			const treeState = createMockTreeState( { allSelected: true } );

			const { result } = renderHook( () =>
				useSelectedItemsPushSize( mockSiteId, treeState, 'push' )
			);

			expect( result.current.isLoading ).toBe( true );

			await waitFor( () => {
				expect( result.current.isLoading ).toBe( false );
			} );

			expect( mockGetDirectorySize ).toHaveBeenCalledWith( mockSiteId, [ 'wp-content' ] );
			expect( result.current.isPushSelectionOverLimit ).toBe( true );
		} );

		it( 'checks database size when only database is selected', async () => {
			const mockGetDirectorySize = vi.fn().mockResolvedValue( 500000 ); // Under limit
			vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
				getDirectorySize: mockGetDirectorySize,
			} );

			const treeState = createMockTreeState( { databaseSelected: true } );

			const { result } = renderHook( () =>
				useSelectedItemsPushSize( mockSiteId, treeState, 'push' )
			);

			await waitFor( () => {
				expect( result.current.isLoading ).toBe( false );
			} );

			expect( mockGetDirectorySize ).toHaveBeenCalledWith( mockSiteId, [
				'wp-content',
				'database',
			] );
			expect( result.current.isPushSelectionOverLimit ).toBe( false );
		} );

		it( 'checks specific folder sizes when individual folders are selected', async () => {
			const mockGetDirectorySize = vi.fn().mockResolvedValue( 500000 ); // Under limit
			vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
				getDirectorySize: mockGetDirectorySize,
			} );

			const treeState = createMockTreeState( {
				pluginsSelected: true,
				themesSelected: true,
			} );

			const { result } = renderHook( () =>
				useSelectedItemsPushSize( mockSiteId, treeState, 'push' )
			);

			await waitFor( () => {
				expect( result.current.isLoading ).toBe( false );
			} );

			expect( mockGetDirectorySize ).toHaveBeenCalledWith( mockSiteId, [
				'wp-content',
				'plugins',
			] );
			expect( mockGetDirectorySize ).toHaveBeenCalledWith( mockSiteId, [ 'wp-content', 'themes' ] );
			expect( result.current.isPushSelectionOverLimit ).toBe( false );
		} );

		it( 'sums multiple directory sizes and detects when over limit', async () => {
			const mockGetDirectorySize = vi
				.fn()
				.mockResolvedValueOnce( SYNC_PUSH_SIZE_LIMIT_BYTES / 2 ) // Database
				.mockResolvedValueOnce( SYNC_PUSH_SIZE_LIMIT_BYTES / 2 + 1000 ); // Plugins (total exceeds limit)

			vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
				getDirectorySize: mockGetDirectorySize,
			} );

			const treeState = createMockTreeState( { databaseSelected: true, pluginsSelected: true } );

			const { result } = renderHook( () =>
				useSelectedItemsPushSize( mockSiteId, treeState, 'push' )
			);

			await waitFor( () => {
				expect( result.current.isLoading ).toBe( false );
			} );

			expect( result.current.isPushSelectionOverLimit ).toBe( true );
		} );

		it( 'returns false when nothing is selected', async () => {
			const treeState = createMockTreeState( {} ); // Nothing selected

			const { result } = renderHook( () =>
				useSelectedItemsPushSize( mockSiteId, treeState, 'push' )
			);

			// Should not be loading and not over limit when nothing is selected
			expect( result.current.isPushSelectionOverLimit ).toBe( false );
			expect( result.current.isLoading ).toBe( false );
		} );
	} );

	describe( 'Edge cases', () => {
		it( 'handles empty site ID', async () => {
			const treeState = createMockTreeState( { databaseSelected: true } );

			const { result } = renderHook( () => useSelectedItemsPushSize( '', treeState, 'push' ) );

			expect( result.current.isPushSelectionOverLimit ).toBe( false );
			expect( result.current.isLoading ).toBe( false );
		} );

		it( 'handles empty tree state', async () => {
			const { result } = renderHook( () => useSelectedItemsPushSize( mockSiteId, [], 'push' ) );

			expect( result.current.isPushSelectionOverLimit ).toBe( false );
			expect( result.current.isLoading ).toBe( false );
		} );
	} );
} );
