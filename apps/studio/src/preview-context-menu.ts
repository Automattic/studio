import {
	clipboard,
	Menu,
	type MenuItemConstructorOptions,
	type WebContents,
	ContextMenuParams,
} from 'electron';
import { __, sprintf } from '@wordpress/i18n';

// The site preview is a <webview> — its own webContents in its own process, so
// the agentic UI's right-click handling never sees these events. Here the main
// process can own the menu outright: unlike the chat panel, everything the menu
// needs is already in `params`, so nothing has to be asked of a renderer.

// Long enough to recognise the phrase, short enough that the menu doesn't
// stretch across the screen. macOS truncates its own Look Up label similarly.
const LOOK_UP_LABEL_MAX_LENGTH = 24;

export interface PreviewContextMenuState {
	canGoBack: boolean;
	canGoForward: boolean;
}

export interface PreviewContextMenuActions {
	goBack: () => void;
	goForward: () => void;
	reload: () => void;
	openLinkExternally: ( url: string ) => void;
	copyToClipboard: ( text: string ) => void;
	copyImage: () => void;
	lookUpSelection: () => void;
	inspectElement: () => void;
}

export interface PreviewContextMenuEnvironment {
	platform: NodeJS.Platform;
	isDevelopment: boolean;
}

type PreviewContextMenuParams = Pick<
	ContextMenuParams,
	| 'selectionText'
	| 'isEditable'
	| 'editFlags'
	| 'linkURL'
	| 'srcURL'
	| 'mediaType'
	| 'hasImageContents'
>;

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
 * Browser-style context menu for the previewed site.
 *
 * Follows Chrome's shape: whatever the pointer is actually on comes first, and
 * the page-level navigation items only appear when the click landed on nothing
 * in particular — otherwise every right-click grows a Back/Forward tail the
 * preview's own toolbar buttons already cover.
 */
export function buildPreviewContextMenuTemplate(
	params: PreviewContextMenuParams,
	state: PreviewContextMenuState,
	actions: PreviewContextMenuActions,
	environment: PreviewContextMenuEnvironment
): MenuItemConstructorOptions[] {
	const selection = params.selectionText.trim();
	const linkUrl = params.linkURL;
	const isImage = params.mediaType === 'image' && params.hasImageContents;

	// Built as sections and joined with separators, so an inapplicable section
	// can't leave a stray divider behind.
	const sections: MenuItemConstructorOptions[][] = [];

	if ( linkUrl ) {
		sections.push( [
			{ label: __( 'Open Link in Browser' ), click: () => actions.openLinkExternally( linkUrl ) },
			{ label: __( 'Copy Link Address' ), click: () => actions.copyToClipboard( linkUrl ) },
		] );
	}

	if ( isImage ) {
		const imageItems: MenuItemConstructorOptions[] = [
			{ label: __( 'Copy Image' ), click: actions.copyImage },
		];
		if ( params.srcURL ) {
			const srcUrl = params.srcURL;
			imageItems.push( {
				label: __( 'Copy Image Address' ),
				click: () => actions.copyToClipboard( srcUrl ),
			} );
		}
		sections.push( imageItems );
	}

	if ( environment.platform === 'darwin' && selection ) {
		sections.push( [ { label: toLookUpLabel( selection ), click: actions.lookUpSelection } ] );
	}

	const editItems: MenuItemConstructorOptions[] = [];
	if ( params.isEditable && params.editFlags.canCut ) {
		editItems.push( { role: 'cut' } );
	}
	if ( params.editFlags.canCopy ) {
		editItems.push( { role: 'copy' } );
	}
	if ( params.isEditable && params.editFlags.canPaste ) {
		editItems.push( { role: 'paste' } );
	}
	if ( params.editFlags.canSelectAll ) {
		editItems.push( { role: 'selectAll' } );
	}
	if ( editItems.length > 0 ) {
		sections.push( editItems );
	}

	const isPlainPageClick = ! linkUrl && ! isImage && ! selection && ! params.isEditable;
	if ( isPlainPageClick ) {
		sections.push( [
			{ label: __( 'Back' ), enabled: state.canGoBack, click: actions.goBack },
			{ label: __( 'Forward' ), enabled: state.canGoForward, click: actions.goForward },
			{ label: __( 'Reload' ), click: actions.reload },
		] );
	}

	if ( environment.isDevelopment ) {
		sections.push( [ { label: __( 'Inspect Element' ), click: actions.inspectElement } ] );
	}

	return sections.flatMap( ( section, index ) =>
		index === 0 ? section : [ { type: 'separator' }, ...section ]
	);
}

/**
 * Attaches the browser-style context menu to a site-preview <webview>.
 */
export function registerPreviewContextMenu(
	contents: WebContents,
	openLinkExternally: ( url: string ) => void
): void {
	contents.on( 'context-menu', ( _event, params ) => {
		const template = buildPreviewContextMenuTemplate(
			params,
			{
				canGoBack: contents.navigationHistory.canGoBack(),
				canGoForward: contents.navigationHistory.canGoForward(),
			},
			{
				goBack: () => contents.navigationHistory.goBack(),
				goForward: () => contents.navigationHistory.goForward(),
				reload: () => contents.reload(),
				openLinkExternally,
				copyToClipboard: ( text ) => clipboard.writeText( text ),
				copyImage: () => contents.copyImageAt( params.x, params.y ),
				lookUpSelection: () => contents.showDefinitionForSelection(),
				inspectElement: () => contents.inspectElement( params.x, params.y ),
			},
			{ platform: process.platform, isDevelopment: process.env.NODE_ENV === 'development' }
		);

		if ( template.length === 0 ) {
			return;
		}

		Menu.buildFromTemplate( template ).popup();
	} );
}
