/**
 * @vitest-environment node
 */
import { IpcMainInvokeEvent, BrowserWindow, MenuItem } from 'electron';
import { vi } from 'vitest';
import { showSiteContextMenu } from 'src/ipc-handlers';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';

// Track menu items and menu instance
let menuItems: MenuItem[] = [];
let mockMenu: {
	append: ReturnType< typeof vi.fn >;
	popup: ReturnType< typeof vi.fn >;
};

vi.mock( 'electron', () => {
	class MockMenu {
		append = vi.fn().mockImplementation( ( item: MenuItem ) => menuItems.push( item ) );
		popup = vi.fn();

		constructor() {
			// Store the instance in the outer mockMenu variable
			// eslint-disable-next-line @typescript-eslint/no-this-alias
			mockMenu = this;
		}
	}

	class MockMenuItem {
		constructor( config: Record< string, unknown > ) {
			Object.assign( this, config );
		}
	}

	class MockBrowserWindow {
		static fromWebContents = vi.fn();
		isDestroyed = vi.fn().mockReturnValue( false );
	}

	return {
		Menu: MockMenu,
		MenuItem: MockMenuItem,
		BrowserWindow: MockBrowserWindow,
		app: {
			getPath: vi.fn().mockReturnValue( '/mock/app/path' ),
		},
	};
} );

vi.mock( 'src/ipc-utils' );
vi.mock( 'fs' );

const mockIpcMainInvokeEvent = {
	sender: { isDestroyed: vi.fn().mockReturnValue( false ) },
	// Double assert the type with `unknown` to simplify mocking this value
} as unknown as IpcMainInvokeEvent;

describe( 'showSiteContextMenu', () => {
	let mockWindow: Partial< BrowserWindow >;

	beforeEach( () => {
		vi.clearAllMocks();
		menuItems = [];
		mockWindow = {
			isDestroyed: vi.fn().mockReturnValue( false ),
		};

		vi.mocked( BrowserWindow.fromWebContents, { partial: true } ).mockReturnValue(
			mockWindow as BrowserWindow
		);
	} );

	const baseContext = {
		siteId: 'test-site-id',
		isAnySiteAdding: false,
		finderLabel: 'Finder',
		editorLabel: 'Visual Studio Code',
		terminalLabel: 'Terminal',
	};

	describe( 'when site is running', () => {
		it( 'should show Stop menu item as enabled when not adding site', () => {
			showSiteContextMenu( mockIpcMainInvokeEvent, {
				...baseContext,
				isRunning: true,
				isLoading: false,
				isAddingSite: false,
				isSyncing: false,
			} );

			const stopItem = menuItems.find( ( item ) => item.label === 'Stop' );
			expect( stopItem ).toBeDefined();
			expect( stopItem?.enabled ).toBe( true );
		} );

		it( 'should send stop action when Stop is clicked', () => {
			showSiteContextMenu( mockIpcMainInvokeEvent, {
				...baseContext,
				isRunning: true,
				isLoading: false,
				isAddingSite: false,
				isSyncing: false,
			} );

			const stopItem = menuItems.find( ( item ) => item.label === 'Stop' );
			stopItem?.click?.();

			expect( sendIpcEventToRendererWithWindow ).toHaveBeenCalledWith(
				mockWindow,
				'site-context-menu-action',
				{
					action: 'stop',
					siteId: 'test-site-id',
				}
			);
		} );
	} );

	describe( 'when site is being added', () => {
		it( 'should show all menu items as disabled when adding site', () => {
			showSiteContextMenu( mockIpcMainInvokeEvent, {
				...baseContext,
				isRunning: true,
				isLoading: false,
				isAddingSite: true,
				isAnySiteAdding: true,
				isSyncing: false,
			} );

			const stopItem = menuItems.find( ( item ) => item.label === 'Stop' );
			const openSiteItem = menuItems.find( ( item ) => item.label === 'Open site' );
			const wpAdminItem = menuItems.find( ( item ) => item.label === 'WP admin' );
			const finderItem = menuItems.find( ( item ) => item.label === 'Open in Finder' );
			const editorItem = menuItems.find( ( item ) => item.label === 'Open in Visual Studio Code' );
			const terminalItem = menuItems.find( ( item ) => item.label === 'Open in Terminal' );
			const editItem = menuItems.find( ( item ) => item.label === 'Edit site…' );
			const deleteItem = menuItems.find( ( item ) => item.label === 'Delete site…' );

			expect( stopItem?.enabled ).toBe( false );
			expect( openSiteItem?.enabled ).toBe( false );
			expect( wpAdminItem?.enabled ).toBe( false );
			expect( finderItem?.enabled ).toBe( false );
			expect( editorItem?.enabled ).toBe( false );
			expect( terminalItem?.enabled ).toBe( false );
			expect( editItem?.enabled ).toBe( false );
			expect( deleteItem?.enabled ).toBe( false );

			showSiteContextMenu( mockIpcMainInvokeEvent, {
				...baseContext,
				isRunning: false,
				isLoading: false,
				isAddingSite: true,
				isAnySiteAdding: true,
				isSyncing: false,
			} );

			const startItem = menuItems.find( ( item ) => item.label === 'Start' );
			expect( startItem?.enabled ).toBe( false );
		} );
	} );

	describe( 'when another site is being added', () => {
		it( 'should disable Copy and Delete but keep other items enabled', () => {
			showSiteContextMenu( mockIpcMainInvokeEvent, {
				...baseContext,
				isRunning: true,
				isLoading: false,
				isAddingSite: false,
				isAnySiteAdding: true,
				isSyncing: false,
			} );

			const stopItem = menuItems.find( ( item ) => item.label === 'Stop' );
			const openSiteItem = menuItems.find( ( item ) => item.label === 'Open site' );
			const wpAdminItem = menuItems.find( ( item ) => item.label === 'WP admin' );
			const finderItem = menuItems.find( ( item ) => item.label === 'Open in Finder' );
			const editorItem = menuItems.find( ( item ) => item.label === 'Open in Visual Studio Code' );
			const terminalItem = menuItems.find( ( item ) => item.label === 'Open in Terminal' );
			const editItem = menuItems.find( ( item ) => item.label === 'Edit site…' );
			const copyItem = menuItems.find( ( item ) => item.label === 'Duplicate site…' );
			const deleteItem = menuItems.find( ( item ) => item.label === 'Delete site…' );

			expect( stopItem?.enabled ).toBe( true );
			expect( openSiteItem?.enabled ).toBe( true );
			expect( wpAdminItem?.enabled ).toBe( true );
			expect( finderItem?.enabled ).toBe( true );
			expect( editorItem?.enabled ).toBe( true );
			expect( terminalItem?.enabled ).toBe( true );
			expect( editItem?.enabled ).toBe( true );
			expect( copyItem?.enabled ).toBe( false );
			expect( deleteItem?.enabled ).toBe( false );
		} );
	} );

	describe( 'when site is stopped', () => {
		it( 'should show Start menu item as enabled when not loading or adding site', () => {
			showSiteContextMenu( mockIpcMainInvokeEvent, {
				...baseContext,
				isRunning: false,
				isLoading: false,
				isAddingSite: false,
				isSyncing: false,
			} );

			const startItem = menuItems.find( ( item ) => item.label === 'Start' );
			expect( startItem ).toBeDefined();
			expect( startItem?.enabled ).toBe( true );
		} );

		it( 'should show Start menu item as disabled when loading', () => {
			showSiteContextMenu( mockIpcMainInvokeEvent, {
				...baseContext,
				isRunning: false,
				isLoading: true,
				isAddingSite: false,
				isSyncing: false,
			} );

			const startItem = menuItems.find( ( item ) => item.label === 'Start' );
			expect( startItem ).toBeDefined();
			expect( startItem?.enabled ).toBe( false );
		} );

		it( 'should send start action when Start is clicked', () => {
			showSiteContextMenu( mockIpcMainInvokeEvent, {
				...baseContext,
				isRunning: false,
				isLoading: false,
				isAddingSite: false,
				isSyncing: false,
			} );

			const startItem = menuItems.find( ( item ) => item.label === 'Start' );
			startItem?.click?.();

			expect( sendIpcEventToRendererWithWindow ).toHaveBeenCalledWith(
				mockWindow,
				'site-context-menu-action',
				{
					action: 'start',
					siteId: 'test-site-id',
				}
			);
		} );
	} );

	describe( 'menu item actions', () => {
		beforeEach( () => {
			showSiteContextMenu( mockIpcMainInvokeEvent, {
				...baseContext,
				isRunning: true,
				isLoading: false,
				isAddingSite: false,
				isSyncing: false,
			} );
		} );

		it( 'should send open-site action when Open site is clicked', () => {
			const openSiteItem = menuItems.find( ( item ) => item.label === 'Open site' );
			openSiteItem?.click?.();

			expect( sendIpcEventToRendererWithWindow ).toHaveBeenCalledWith(
				mockWindow,
				'site-context-menu-action',
				{
					action: 'open-site',
					siteId: 'test-site-id',
				}
			);
		} );

		it( 'should send open-admin action when WP admin is clicked', () => {
			const wpAdminItem = menuItems.find( ( item ) => item.label === 'WP admin' );
			wpAdminItem?.click?.();

			expect( sendIpcEventToRendererWithWindow ).toHaveBeenCalledWith(
				mockWindow,
				'site-context-menu-action',
				{
					action: 'open-admin',
					siteId: 'test-site-id',
				}
			);
		} );

		it( 'should send open-finder action when Open in Finder is clicked', () => {
			const finderItem = menuItems.find( ( item ) => item.label === 'Open in Finder' );
			finderItem?.click?.();

			expect( sendIpcEventToRendererWithWindow ).toHaveBeenCalledWith(
				mockWindow,
				'site-context-menu-action',
				{
					action: 'open-finder',
					siteId: 'test-site-id',
				}
			);
		} );

		it( 'should send open-editor action when Open in Visual Studio Code is clicked', () => {
			const editorItem = menuItems.find( ( item ) => item.label === 'Open in Visual Studio Code' );
			editorItem?.click?.();

			expect( sendIpcEventToRendererWithWindow ).toHaveBeenCalledWith(
				mockWindow,
				'site-context-menu-action',
				{
					action: 'open-editor',
					siteId: 'test-site-id',
				}
			);
		} );

		it( 'should send open-terminal action when Open in Terminal is clicked', () => {
			const terminalItem = menuItems.find( ( item ) => item.label === 'Open in Terminal' );
			terminalItem?.click?.();

			expect( sendIpcEventToRendererWithWindow ).toHaveBeenCalledWith(
				mockWindow,
				'site-context-menu-action',
				{
					action: 'open-terminal',
					siteId: 'test-site-id',
				}
			);
		} );

		it( 'should send edit-site action when Edit site is clicked', () => {
			const editItem = menuItems.find( ( item ) => item.label === 'Edit site…' );
			editItem?.click?.();

			expect( sendIpcEventToRendererWithWindow ).toHaveBeenCalledWith(
				mockWindow,
				'site-context-menu-action',
				{
					action: 'edit-site',
					siteId: 'test-site-id',
				}
			);
		} );

		it( 'should send delete action when Delete site is clicked', () => {
			const deleteItem = menuItems.find( ( item ) => item.label === 'Delete site…' );
			deleteItem?.click?.();

			expect( sendIpcEventToRendererWithWindow ).toHaveBeenCalledWith(
				mockWindow,
				'site-context-menu-action',
				{
					action: 'delete',
					siteId: 'test-site-id',
				}
			);
		} );
	} );

	describe( 'when no editor is available', () => {
		it( 'should not show editor menu item when editorLabel is null', () => {
			showSiteContextMenu( mockIpcMainInvokeEvent, {
				...baseContext,
				editorLabel: null,
				isRunning: false,
				isLoading: false,
				isAddingSite: false,
				isSyncing: false,
			} );

			const editorItem = menuItems.find(
				( item ) => item.label?.includes( 'Open in' ) && item.label?.includes( 'Code' )
			);
			expect( editorItem ).toBeUndefined();
		} );
	} );

	describe( 'menu structure', () => {
		it( 'should have correct separator count', () => {
			showSiteContextMenu( mockIpcMainInvokeEvent, {
				...baseContext,
				isRunning: false,
				isLoading: false,
				isAddingSite: false,
				isSyncing: false,
			} );

			const separators = menuItems.filter( ( item ) => item.type === 'separator' );
			expect( separators.length ).toBe( 3 );
		} );

		it( 'should call popup with window', () => {
			showSiteContextMenu( mockIpcMainInvokeEvent, {
				...baseContext,
				isRunning: false,
				isLoading: false,
				isAddingSite: false,
				isSyncing: false,
			} );

			expect( mockMenu.popup ).toHaveBeenCalledWith( { window: mockWindow } );
		} );
	} );
} );
