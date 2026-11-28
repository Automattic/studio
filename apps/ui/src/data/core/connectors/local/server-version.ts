// The oldest `studio serve` this UI supports. One UI build talks to every Studio Cloud machine,
// and machines update when they wake, so some run an older Studio for a while: this connector
// keeps working with them, gating newer features on `serverVersion`, and the minimum moves up
// once no machine needs the older behavior.
const MIN_SERVER_VERSION = '1.0.0';

function parts( version: string ): number[] {
	return version
		.split( '-' )[ 0 ]
		.split( '.' )
		.map( ( part ) => Number.parseInt( part, 10 ) || 0 );
}

function compareVersions( a: string, b: string ): number {
	const [ left, right ] = [ parts( a ), parts( b ) ];
	for ( let index = 0; index < Math.max( left.length, right.length ); index++ ) {
		const difference = ( left[ index ] ?? 0 ) - ( right[ index ] ?? 0 );
		if ( difference !== 0 ) {
			return difference;
		}
	}
	return 0;
}

// The first Studio whose server keeps the user's skills for all sites (`/api/global-skills`),
// and makes and changes a skill (`/api/sites/:id/skills`).
const USER_SKILLS_SERVER_VERSION = '2.5.0';
const MESSAGE_REPLIES_SERVER_VERSION = '2.5.0';

export function supportsUserSkills( version: string | null ): boolean {
	return !! version && compareVersions( version, USER_SKILLS_SERVER_VERSION ) >= 0;
}

export function supportsMessageReplies( version: string | null ): boolean {
	return !! version && compareVersions( version, MESSAGE_REPLIES_SERVER_VERSION ) >= 0;
}

export function isSupportedServerVersion( version: string | null ): boolean {
	return !! version && compareVersions( version, MIN_SERVER_VERSION ) >= 0;
}

export class UnsupportedServerError extends Error {
	constructor( readonly version: string | null ) {
		super( `This Studio machine runs version ${ version ?? 'unknown' }, which is too old.` );
		this.name = 'UnsupportedServerError';
	}
}
