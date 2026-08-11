import { MARKETING_SCENARIO_IDS } from '../../apps/ui/src/marketing/scenarios.ts';

export const SCENARIO_IDS = MARKETING_SCENARIO_IDS;

export type ScenarioId = ( typeof SCENARIO_IDS )[ number ];

export const DEFAULT_SCENARIO_IDS = [
	'add-site',
	'site-overview',
] as const satisfies readonly ScenarioId[];

export const THEMES = [ 'light', 'dark' ] as const;

export type Theme = ( typeof THEMES )[ number ];

export interface CapturePreset {
	id: string;
	description: string;
	viewport: {
		width: number;
		height: number;
	};
	deviceScaleFactor: number;
	output: {
		width: number;
		height: number;
	};
}

export const CAPTURE_PRESETS = {
	smoke: definePreset( {
		id: 'smoke',
		description: "Fast local validation at Studio's minimum supported height",
		viewport: { width: 900, height: 600 },
		deviceScaleFactor: 1,
	} ),
	'raw-compact-2x': definePreset( {
		id: 'raw-compact-2x',
		description: 'High-resolution compact desktop source for narrow marketing layouts',
		viewport: { width: 900, height: 600 },
		deviceScaleFactor: 2,
	} ),
	'raw-default-2x': definePreset( {
		id: 'raw-default-2x',
		description: "Exact 2x capture of Studio's default 1100 by 820 window",
		viewport: { width: 1100, height: 820 },
		deviceScaleFactor: 2,
	} ),
	'raw-wide-2x': definePreset( {
		id: 'raw-wide-2x',
		description: 'High-resolution wide source for flexible marketing crops',
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 2,
	} ),
	'store-4k': definePreset( {
		id: 'store-4k',
		description: '4K 16:9 source for the Microsoft Store and other wide placements',
		viewport: { width: 1920, height: 1080 },
		deviceScaleFactor: 2,
	} ),
} as const satisfies Record< string, CapturePreset >;

export type PresetId = keyof typeof CAPTURE_PRESETS;

export const DEFAULT_PRESET_IDS: readonly PresetId[] = [ 'smoke' ];

interface PresetInput {
	id: string;
	description: string;
	viewport: CapturePreset[ 'viewport' ];
	deviceScaleFactor: number;
}

function definePreset( input: PresetInput ): CapturePreset {
	const { width, height } = input.viewport;
	const outputWidth = width * input.deviceScaleFactor;
	const outputHeight = height * input.deviceScaleFactor;

	if ( ! Number.isInteger( outputWidth ) || ! Number.isInteger( outputHeight ) ) {
		throw new Error( `Preset ${ input.id } produces fractional output dimensions.` );
	}

	return {
		...input,
		output: {
			width: outputWidth,
			height: outputHeight,
		},
	};
}

export function resolveSelection< T extends string >(
	requested: readonly string[] | undefined,
	available: readonly T[],
	defaults: readonly T[],
	label: string
): T[] {
	if ( ! requested?.length ) {
		return [ ...defaults ];
	}

	const expanded = requested.flatMap( ( value ) =>
		value
			.split( ',' )
			.map( ( item ) => item.trim() )
			.filter( Boolean )
	);

	if ( expanded.includes( 'all' ) ) {
		return [ ...available ];
	}

	const invalid = expanded.filter( ( value ) => ! available.includes( value as T ) );
	if ( invalid.length ) {
		throw new Error(
			`Unknown ${ label } ${ invalid.map( ( value ) => `"${ value }"` ).join( ', ' ) }. ` +
				`Available values: ${ available.join( ', ' ) }, all.`
		);
	}

	return [ ...new Set( expanded as T[] ) ];
}
