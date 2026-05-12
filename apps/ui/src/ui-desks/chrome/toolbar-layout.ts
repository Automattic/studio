import type {
	DeskSettings,
	DeskToolbarLayout as PersistedDeskToolbarLayout,
} from '@studio/common/types/desk';

export const DESK_TOOLBAR_BUTTONS = [ 'chat', 'create', 'site-map', 'settings' ] as const;

export type DeskToolbarButtonId = ( typeof DESK_TOOLBAR_BUTTONS )[ number ];

export interface DeskToolbarLayout {
	left: DeskToolbarButtonId[];
	right: DeskToolbarButtonId[];
}

export type DeskToolbarSettings = Omit< DeskSettings, 'toolbarLayout' > & {
	toolbarLayout: DeskToolbarLayout;
};

export const DEFAULT_DESK_TOOLBAR_LAYOUT: DeskToolbarLayout = {
	left: [ 'chat', 'create' ],
	right: [ 'site-map', 'settings' ],
};

function cloneToolbarLayout( layout: DeskToolbarLayout ): DeskToolbarLayout {
	return {
		left: [ ...layout.left ],
		right: [ ...layout.right ],
	};
}

function isRecord( value: unknown ): value is Record< string, unknown > {
	return Boolean( value ) && typeof value === 'object' && ! Array.isArray( value );
}

function isDeskToolbarButtonId( value: unknown ): value is DeskToolbarButtonId {
	return typeof value === 'string' && DESK_TOOLBAR_BUTTONS.includes( value as DeskToolbarButtonId );
}

export function normalizeDeskToolbarLayout( value: unknown ): DeskToolbarLayout {
	if ( ! isRecord( value ) || ! Array.isArray( value.left ) || ! Array.isArray( value.right ) ) {
		return cloneToolbarLayout( DEFAULT_DESK_TOOLBAR_LAYOUT );
	}

	const layout = value as Record< keyof PersistedDeskToolbarLayout, unknown[] >;
	const next: DeskToolbarLayout = { left: [], right: [] };
	const seen = new Set< DeskToolbarButtonId >();

	for ( const side of [ 'left', 'right' ] as const ) {
		for ( const buttonId of layout[ side ] ) {
			if ( isDeskToolbarButtonId( buttonId ) && ! seen.has( buttonId ) ) {
				next[ side ].push( buttonId );
				seen.add( buttonId );
			}
		}
	}

	for ( const buttonId of DESK_TOOLBAR_BUTTONS ) {
		if ( ! seen.has( buttonId ) ) {
			next.right.push( buttonId );
		}
	}

	return next;
}

export function normalizeDeskToolbarSettings( settings: DeskSettings ): DeskToolbarSettings {
	return {
		...settings,
		toolbarLayout: normalizeDeskToolbarLayout( settings.toolbarLayout ),
	};
}

export function getDeskToolbarButtonSide(
	layout: PersistedDeskToolbarLayout,
	buttonId: DeskToolbarButtonId
): keyof DeskToolbarLayout {
	const normalized = normalizeDeskToolbarLayout( layout );
	return normalized.left.includes( buttonId ) ? 'left' : 'right';
}

export function moveDeskToolbarButton(
	layout: PersistedDeskToolbarLayout,
	buttonId: DeskToolbarButtonId,
	side: keyof DeskToolbarLayout,
	beforeButtonId: DeskToolbarButtonId | null
): DeskToolbarLayout {
	const next = normalizeDeskToolbarLayout( layout );
	const left = next.left.filter( ( id ) => id !== buttonId );
	const right = next.right.filter( ( id ) => id !== buttonId );
	const target = side === 'left' ? left : right;

	if ( beforeButtonId && beforeButtonId !== buttonId ) {
		const index = target.indexOf( beforeButtonId );
		if ( index >= 0 ) {
			target.splice( index, 0, buttonId );
		} else {
			target.push( buttonId );
		}
	} else {
		target.push( buttonId );
	}

	return { left, right };
}
