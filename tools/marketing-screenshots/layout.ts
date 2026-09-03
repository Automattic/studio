export type PreviewPanelState = 'open' | 'closed';
export type SidebarPanelState = 'expanded' | 'collapsed';

export interface PanelLayoutOverrides {
	previewWidthRatio?: number;
	sidebarWidth?: number;
	preview?: PreviewPanelState;
	sidebar?: SidebarPanelState;
}

export interface EffectivePanelLayout {
	sidebar: {
		state: SidebarPanelState;
		width: number;
	};
	preview: {
		state: PreviewPanelState;
		requestedWidthRatio: number;
		contentWidth: number;
		width: number;
	};
}

export function parsePreviewWidthRatio( value: string ): number {
	const ratio = Number( value );
	if ( ! Number.isFinite( ratio ) || ratio < 0.2 || ratio > 0.8 ) {
		throw new Error( '--preview-width-ratio must be a number from 0.2 through 0.8.' );
	}
	return ratio;
}

export function parseSidebarWidth( value: string ): number {
	const width = Number( value );
	if ( ! Number.isInteger( width ) || width < 240 || width > 600 ) {
		throw new Error( '--sidebar-width must be an integer from 240 through 600 logical pixels.' );
	}
	return width;
}

export function parsePreviewPanelState( value: string ): PreviewPanelState {
	if ( value !== 'open' && value !== 'closed' ) {
		throw new Error( '--preview must be either open or closed.' );
	}
	return value;
}

export function parseSidebarPanelState( value: string ): SidebarPanelState {
	if ( value !== 'expanded' && value !== 'collapsed' ) {
		throw new Error( '--sidebar must be either expanded or collapsed.' );
	}
	return value;
}

export function addPanelLayoutSearchParams( url: URL, overrides: PanelLayoutOverrides ): void {
	if ( overrides.previewWidthRatio !== undefined ) {
		url.searchParams.set( 'previewWidthRatio', String( overrides.previewWidthRatio ) );
	}
	if ( overrides.sidebarWidth !== undefined ) {
		url.searchParams.set( 'sidebarWidth', String( overrides.sidebarWidth ) );
	}
	if ( overrides.preview !== undefined ) {
		url.searchParams.set( 'preview', overrides.preview );
	}
	if ( overrides.sidebar !== undefined ) {
		url.searchParams.set( 'sidebar', overrides.sidebar );
	}
}

export function parseEffectivePanelLayout( value: unknown ): EffectivePanelLayout {
	if ( ! isRecord( value ) || ! isRecord( value.sidebar ) || ! isRecord( value.preview ) ) {
		throw new Error( 'Marketing UI did not expose resolved panel layout metadata.' );
	}

	const sidebarState = value.sidebar.state;
	const previewState = value.preview.state;
	if ( sidebarState !== 'expanded' && sidebarState !== 'collapsed' ) {
		throw new Error( 'Marketing UI exposed an invalid sidebar panel state.' );
	}
	if ( previewState !== 'open' && previewState !== 'closed' ) {
		throw new Error( 'Marketing UI exposed an invalid preview panel state.' );
	}

	return {
		sidebar: {
			state: sidebarState,
			width: readNonNegativeNumber( value.sidebar.width, 'sidebar width' ),
		},
		preview: {
			state: previewState,
			requestedWidthRatio: readBoundedNumber(
				value.preview.requestedWidthRatio,
				'preview requested width ratio',
				0.2,
				0.8
			),
			contentWidth: readNonNegativeNumber( value.preview.contentWidth, 'preview content width' ),
			width: readNonNegativeNumber( value.preview.width, 'preview width' ),
		},
	};
}

function readNonNegativeNumber( value: unknown, label: string ): number {
	return readBoundedNumber( value, label, 0, Number.POSITIVE_INFINITY );
}

function readBoundedNumber(
	value: unknown,
	label: string,
	minimum: number,
	maximum: number
): number {
	if (
		typeof value !== 'number' ||
		! Number.isFinite( value ) ||
		value < minimum ||
		value > maximum
	) {
		throw new Error( `Marketing UI exposed an invalid ${ label }.` );
	}
	return value;
}

function isRecord( value: unknown ): value is Record< string, unknown > {
	return typeof value === 'object' && value !== null;
}
