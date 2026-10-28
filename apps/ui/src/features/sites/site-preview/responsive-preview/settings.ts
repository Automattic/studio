export const devicePresets = [
	{ name: 'iPhone 16e', width: 390, height: 844 },
	{ name: 'iPhone 17', width: 402, height: 874 },
	{ name: 'iPhone 17 Pro Max', width: 440, height: 956 },
	{ name: 'iPhone Duo', width: 466, height: 678 },
	{ name: 'iPhone Duo (Open)', width: 951, height: 669 },
	{ name: 'Pixel 10', width: 412, height: 923 },
	{ name: 'Galaxy S25 Ultra', width: 384, height: 832 },
	{ name: 'iPad mini', width: 744, height: 1133 },
	{ name: 'iPad Air 11"', width: 820, height: 1180 },
	{ name: 'iPad Pro 13"', width: 1032, height: 1376 },
	{ name: 'Laptop', width: 1366, height: 768 },
	{ name: 'Desktop', width: 1920, height: 1080 },
];

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
			Math.max( 1, availableWidth - 32 ) / width,
			Math.max( 1, availableHeight - 32 ) / height
		)
	);
}
