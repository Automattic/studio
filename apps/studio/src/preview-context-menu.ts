import {
	clipboard,
	Menu,
	type ContextMenuParams,
	type MenuItemConstructorOptions,
	type WebContents,
} from 'electron';
import { __, sprintf } from '@wordpress/i18n';

// The site preview is a <webview> — its own webContents in its own process, so
// the agentic UI's right-click handling never sees these events. Here the main
// process can own the menu outright: unlike the chat panel, everything the menu
// needs is already in `params`, so nothing has to be asked of a renderer.

// Long enough to recognise the phrase, short enough that the menu doesn't
// stretch across the screen. macOS truncates its own Look Up label similarly.
const LOOK_UP_LABEL_MAX_LENGTH = 24;

// Pushed by the renderer as the inspector attaches and detaches. It is plain
// state rather than something asked for at right-click time, so reading it
// while building the menu can't race the click that opened it.
let previewAnnotationAvailable = false;

export function setPreviewAnnotationAvailable( available: boolean ): void {
	previewAnnotationAvailable = available;
}

export function isPreviewAnnotationAvailable(): boolean {
	return previewAnnotationAvailable;
}

export interface PreviewContextMenuState {
	canGoBack: boolean;
	canGoForward: boolean;
	// False while the annotation inspector isn't injected into the guest page
	// (during a load, or on a page it couldn't attach to), so the item is left
	// out rather than offered and doing nothing.
	canAnnotate: boolean;
}

export interface PreviewContextMenuActions {
	annotateElement: () => void;
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

	// First, because annotating the thing under the pointer is the reason a
	// Studio user reaches for this menu — the browser items below are the
	// familiar ones they can already find by muscle memory.
	if ( state.canAnnotate ) {
		sections.push( [ { label: __( 'Annotate Element' ), click: actions.annotateElement } ] );
	}

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
	{
		openLinkExternally,
		annotateElement,
		canAnnotate,
	}: {
		openLinkExternally: ( url: string ) => void;
		annotateElement: () => void;
		canAnnotate: () => boolean;
	}
): void {
	contents.on( 'context-menu', ( _event, params ) => {
		const template = buildPreviewContextMenuTemplate(
			params,
			{
				canGoBack: contents.navigationHistory.canGoBack(),
				canGoForward: contents.navigationHistory.canGoForward(),
				canAnnotate: canAnnotate(),
			},
			{
				annotateElement,
				goBack: () => contents.navigationHistory.goBack(),
				goForward: () => contents.navigationHistory.goForward(),
				reload: () => contents.reload(),
				openLinkExternally,
				copyToClipboard: ( text ) => clipboard.writeText( text ),
				copyImage: () => contents.copyImageAt( params.x, params.y ),
				// Known cosmetic quirk: macOS anchors the dictionary panel to a
				// selection rect the guest reports in its own coordinate space,
				// and nothing translates it by the <webview>'s offset in the
				// window — so the panel and its floating text land together in
				// the wrong place. The definition itself is correct, and the
				// placement isn't ours to fix (the API takes no position).
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
