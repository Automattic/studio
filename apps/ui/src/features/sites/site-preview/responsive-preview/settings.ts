import type { TracksResponsivePreviewCategory } from '@studio/common/lib/record-tracks-event';

export const devicePresets = [
	{ name: 'iPhone 16e', width: 390, height: 844, category: 'phone' },
	{ name: 'iPhone 17', width: 402, height: 874, category: 'phone' },
	{ name: 'iPhone 17 Pro Max', width: 440, height: 956, category: 'phone' },
	{ name: 'iPhone Duo (Closed)', width: 466, height: 678, category: 'phone' },
	{ name: 'iPhone Duo (Open)', width: 951, height: 669, category: 'phone' },
	{ name: 'Pixel 10', width: 412, height: 924, category: 'phone' },
	{ name: 'Galaxy A55', width: 360, height: 800, category: 'phone' },
	{ name: 'Galaxy S25 Ultra', width: 384, height: 832, category: 'phone' },
	{ name: 'iPad mini', width: 744, height: 1133, category: 'tablet' },
	{ name: 'iPad Air 11"', width: 820, height: 1180, category: 'tablet' },
	{ name: 'iPad Pro 13"', width: 1032, height: 1376, category: 'tablet' },
	{ name: 'Desktop', width: 1920, height: 1080, category: 'desktop' },
] satisfies {
	name: string;
	width: number;
	height: number;
	category: Exclude< TracksResponsivePreviewCategory, 'custom' >;
}[];

export const clampDimension = ( value: number ) =>
	Math.max( 100, Math.min( 3840, Math.round( value ) ) );

export function parseDimension( value: string ) {
	if ( ! /^\d+$/.test( value.trim() ) ) return null;
	const number = Number( value );
	return Number.isInteger( number ) && number >= 100 && number <= 3840 ? number : null;
}

export function getFitScale(
	availableWidth: number,
	availableHeight: number,
	width: number,
	height: number
) {
	return Math.max(
		0.01,
		Math.min(
			100,
			Math.floor( ( Math.max( 1, availableWidth - 32 ) * 100 ) / width ),
			Math.floor( ( Math.max( 1, availableHeight - 32 ) * 100 ) / height )
		) / 100
	);
}
