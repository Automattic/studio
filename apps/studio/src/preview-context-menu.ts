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
let previewInspectorReady = false;

export function setPreviewInspectorReady( ready: boolean ): void {
	previewInspectorReady = ready;
}

export function isPreviewInspectorReady(): boolean {
	return previewInspectorReady;
}

export interface PreviewContextMenuState {
	// False while the annotation inspector isn't injected into the guest page
	// (during a load, or on a page it couldn't attach to). Only it knows which
	// element was clicked, so Annotate is left out rather than offered and
	// doing nothing.
	inspectorReady: boolean;
}

export interface PreviewContextMenuActions {
	annotateElement: () => void;
	openExternally: ( url: string ) => void;
	copyToClipboard: ( text: string ) => void;
	copyImage: () => void;
	lookUpSelection: () => void;
	inspectElement: () => void;
}

export interface PreviewContextMenuEnvironment {
	platform: NodeJS.Platform;
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
 * Context menu for the previewed site.
 *
 * Annotating comes first — it's why you'd right-click here — followed by
 * whatever the pointer is actually on. Every item is conditional on doing
 * something, so nothing is offered greyed out or inert.
 */
export function buildPreviewContextMenuTemplate(
	params: PreviewContextMenuParams,
	state: PreviewContextMenuState,
	actions: PreviewContextMenuActions,
	environment: PreviewContextMenuEnvironment
): MenuItemConstructorOptions[] {
	const selection = params.selectionText.trim();
	const linkUrl = params.linkURL;
	const imageUrl = params.mediaType === 'image' && params.hasImageContents ? params.srcURL : '';

	// Built as sections and joined with separators, so an inapplicable section
	// can't leave a stray divider behind.
	const sections: MenuItemConstructorOptions[][] = [];

	if ( state.inspectorReady ) {
		sections.push( [ { label: __( 'Annotate Element' ), click: actions.annotateElement } ] );
	}

	if ( linkUrl ) {
		sections.push( [
			{ label: __( 'Open Link in Browser' ), click: () => actions.openExternally( linkUrl ) },
			{ label: __( 'Copy Link Address' ), click: () => actions.copyToClipboard( linkUrl ) },
		] );
	}

	if ( imageUrl ) {
		sections.push( [
			{ label: __( 'Copy Image' ), click: actions.copyImage },
			{ label: __( 'Copy Image Address' ), click: () => actions.copyToClipboard( imageUrl ) },
			{ label: __( 'Open Image in Browser' ), click: () => actions.openExternally( imageUrl ) },
		] );
	}

	if ( environment.platform === 'darwin' && selection ) {
		sections.push( [ { label: toLookUpLabel( selection ), click: actions.lookUpSelection } ] );
	}

	// Cut, Paste and Select All only mean anything in a field the user can type
	// in; on page text, Copy is the only one worth offering.
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
	if ( params.isEditable && params.editFlags.canSelectAll ) {
		editItems.push( { role: 'selectAll' } );
	}
	if ( editItems.length > 0 ) {
		sections.push( editItems );
	}

	// Not gated to development builds: inspecting the page you're building is
	// the point of the preview, and Electron keeps DevTools available when
	// packaged.
	sections.push( [ { label: __( 'Inspect Element' ), click: actions.inspectElement } ] );

	return sections.flatMap( ( section, index ) =>
		index === 0 ? section : [ { type: 'separator' }, ...section ]
	);
}

/**
 * Attaches the context menu to a site-preview <webview>.
 */
export function registerPreviewContextMenu(
	contents: WebContents,
	{
		openExternally,
		annotateElement,
	}: {
		openExternally: ( url: string ) => void;
		annotateElement: () => void;
	}
): void {
	contents.on( 'context-menu', ( _event, params ) => {
		const template = buildPreviewContextMenuTemplate(
			params,
			{ inspectorReady: isPreviewInspectorReady() },
			{
				annotateElement,
				openExternally,
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
			{ platform: process.platform }
		);

		Menu.buildFromTemplate( template ).popup();
	} );
}
