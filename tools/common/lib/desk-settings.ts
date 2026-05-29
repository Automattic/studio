import {
	DESK_SETTINGS_VERSION,
	type DeskSettings,
	type DeskToolbarLayout,
} from '@studio/common/types/desk';

const DEFAULT_DESK_TOOLBAR_LAYOUT: DeskToolbarLayout = {
	left: [],
	right: [],
};

function cloneToolbarLayout( layout: DeskToolbarLayout ): DeskToolbarLayout {
	return {
		left: [ ...layout.left ],
		right: [ ...layout.right ],
	};
}

export function createDefaultDeskSettings( updatedAt = new Date().toISOString() ): DeskSettings {
	return {
		version: DESK_SETTINGS_VERSION,
		updatedAt,
		showSiteName: true,
		toolbarLayout: cloneToolbarLayout( DEFAULT_DESK_TOOLBAR_LAYOUT ),
	};
}

function isRecord( value: unknown ): value is Record< string, unknown > {
	return Boolean( value ) && typeof value === 'object' && ! Array.isArray( value );
}

export function normalizeDeskToolbarLayout( value: unknown ): DeskToolbarLayout {
	if ( ! isRecord( value ) || ! Array.isArray( value.left ) || ! Array.isArray( value.right ) ) {
		return cloneToolbarLayout( DEFAULT_DESK_TOOLBAR_LAYOUT );
	}

	const layout = value as Record< keyof DeskToolbarLayout, unknown[] >;
	const next: DeskToolbarLayout = { left: [], right: [] };
	const seen = new Set< string >();

	for ( const side of [ 'left', 'right' ] as const ) {
		for ( const buttonId of layout[ side ] ) {
			if ( typeof buttonId === 'string' && buttonId && ! seen.has( buttonId ) ) {
				next[ side ].push( buttonId );
				seen.add( buttonId );
			}
		}
	}

	return next;
}

export function normalizeDeskSettings( value: unknown ): DeskSettings {
	const defaults = createDefaultDeskSettings();

	if ( ! isRecord( value ) ) {
		return defaults;
	}

	return {
		version: DESK_SETTINGS_VERSION,
		updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : defaults.updatedAt,
		showSiteName:
			typeof value.showSiteName === 'boolean' ? value.showSiteName : defaults.showSiteName,
		toolbarLayout: normalizeDeskToolbarLayout( value.toolbarLayout ),
	};
}
