import { __ } from '@wordpress/i18n';

const siteNames = [
	__( 'My Bold Website' ),
	__( 'My Bright Website' ),
	__( 'My Blissful Website' ),
	__( 'My Calm Website' ),
	__( 'My Cool Website' ),
	__( 'My Dreamy Website' ),
	__( 'My Elite Website' ),
	__( 'My Fresh Website' ),
	__( 'My Glowing Website' ),
	__( 'My Happy Website' ),
	__( 'My Joyful Website' ),
	__( 'My Noble Website' ),
	__( 'My Pure Website' ),
	__( 'My Peak Website' ),
	__( 'My Prime Website' ),
	__( 'My Serene Website' ),
	__( 'My Shiny Website' ),
	__( 'My Sparkly Website' ),
	__( 'My Swift Website' ),
	__( 'My True Website' ),
];

export function generateSiteName( usedSiteNames: string[] ): string {
	let proposedName = __( 'My WordPress Website' );
	let tryCount = 0;

	while ( usedSiteNames.includes( proposedName ) && tryCount < siteNames.length ) {
		tryCount++;
		proposedName = siteNames[ Math.floor( Math.random() * siteNames.length ) ];
	}

	return proposedName;
}
