import {
	DESK_SETTINGS_VERSION,
	DESK_TOOLBAR_BUTTONS,
	type DeskSettings,
	type DeskToolbarButtonId,
	type DeskToolbarLayout,
} from '@studio/common/types/desk';

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

function isDeskToolbarButtonId( value: unknown ): value is DeskToolbarButtonId {
	return typeof value === 'string' && DESK_TOOLBAR_BUTTONS.includes( value as DeskToolbarButtonId );
}

export function normalizeDeskToolbarLayout( value: unknown ): DeskToolbarLayout {
	if ( ! isRecord( value ) || ! Array.isArray( value.left ) || ! Array.isArray( value.right ) ) {
		return cloneToolbarLayout( DEFAULT_DESK_TOOLBAR_LAYOUT );
	}

	const layout = value as Record< keyof DeskToolbarLayout, unknown[] >;
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

export function moveDeskToolbarButton(
	layout: DeskToolbarLayout,
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
