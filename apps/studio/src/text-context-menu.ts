import {
	BrowserWindow,
	clipboard,
	Menu,
	type MenuItemConstructorOptions,
	IpcMainInvokeEvent,
} from 'electron';
import { __, sprintf } from '@wordpress/i18n';

// Electron ships no default context menu — the one Chrome shows is built by
// Chrome's browser layer, which isn't part of the embedded content layer. The
// items below are declared by us, but the menu itself is the real native
// widget on every platform (NSMenu, Win32, GTK).
//
// The renderer drives this rather than `webContents.on( 'context-menu' )`,
// matching `showSiteContextMenu`: only the renderer knows which message was
// clicked, and pushing that to the main process afterwards would race the
// browser's own context-menu request.

// Long enough to recognise the phrase, short enough that the menu doesn't
// stretch across the screen. macOS truncates its own Look Up label similarly.
const LOOK_UP_LABEL_MAX_LENGTH = 24;

export interface TextContextMenuContext {
	selectionText: string;
	isEditable: boolean;
	// The full message the click landed on, when it landed on one at all.
	messageText?: string;
}

export interface TextContextMenuActions {
	lookUpSelection: () => void;
	copyMessage: ( text: string ) => void;
	quoteSelection: () => void;
}

export interface TextContextMenuEnvironment {
	platform: NodeJS.Platform;
	canPaste: boolean;
}

export type TextContextMenuResult =
	| { action: 'quote-selection'; selectionText: string }
	| undefined;

function toLookUpLabel( selection: string ): string {
	const collapsed = selection.replace( /\s+/g, ' ' ).trim();
	const truncated =
		collapsed.length > LOOK_UP_LABEL_MAX_LENGTH
			? `${ collapsed.slice( 0, LOOK_UP_LABEL_MAX_LENGTH - 1 ).trimEnd() }…`
			: collapsed;
	/* translators: %s: the text the user selected. */
	return sprintf( __( 'Look Up “%s”' ), truncated );
}

/**
 * Text-only context menu: copy the selection, copy the whole message, and look
 * a word up. Look Up is macOS-only because Windows and Linux expose no system
 * dictionary to apps — their native text menus really are just the edit
 * commands, so gating on platform yields what each OS would natively show.
 */
export function buildTextContextMenuTemplate(
	context: TextContextMenuContext,
	actions: TextContextMenuActions,
	environment: TextContextMenuEnvironment
): MenuItemConstructorOptions[] {
	const selection = context.selectionText.trim();
	const messageText = context.messageText;

	// Built as sections and joined with separators, so an inapplicable section
	// can't leave a stray divider behind.
	const sections: MenuItemConstructorOptions[][] = [];

	if ( environment.platform === 'darwin' && selection ) {
		sections.push( [ { label: toLookUpLabel( selection ), click: actions.lookUpSelection } ] );
	}

	const clipboardItems: MenuItemConstructorOptions[] = [];
	if ( selection ) {
		clipboardItems.push( { label: __( 'Copy' ), role: 'copy' } );
	}
	if ( messageText ) {
		clipboardItems.push( {
			label: __( 'Copy All' ),
			click: () => actions.copyMessage( messageText ),
		} );
	}
	if ( context.isEditable && environment.canPaste ) {
		clipboardItems.push( { label: __( 'Paste' ), role: 'paste' } );
	}
	if ( clipboardItems.length > 0 ) {
		sections.push( clipboardItems );
	}
	if ( selection && ! context.isEditable ) {
		sections.push( [ { label: __( 'Quote in composer' ), click: actions.quoteSelection } ] );
	}

	return sections.flatMap( ( section, index ) =>
		index === 0 ? section : [ { type: 'separator' }, ...section ]
	);
}

export async function showTextContextMenu(
	event: IpcMainInvokeEvent,
	context: TextContextMenuContext
): Promise< TextContextMenuResult > {
	let result: TextContextMenuResult;
	const template = buildTextContextMenuTemplate(
		context,
		{
			lookUpSelection: () => event.sender.showDefinitionForSelection(),
			copyMessage: ( text ) => clipboard.writeText( text ),
			quoteSelection: () => {
				result = { action: 'quote-selection', selectionText: context.selectionText.trim() };
			},
		},
		{ platform: process.platform, canPaste: clipboard.readText().length > 0 }
	);

	if ( template.length === 0 ) {
		return undefined;
	}

	const window = BrowserWindow.fromWebContents( event.sender );
	return new Promise( ( resolve ) => {
		Menu.buildFromTemplate( template ).popup( {
			...( window ? { window } : {} ),
			callback: () => resolve( result ),
		} );
	} );
}
