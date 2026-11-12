import { __ } from '@wordpress/i18n';

// A Space: a static site on Spacefast, served at `url`, in one of the account's teams.
export interface Space {
	id: string;
	name: string;
	url: string;
	slug: string;
	teamId: string;
	teamName?: string;
}

export function spaceAddress( space: Space ): string {
	return space.url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );
}

export function spaceDetails( space: Space ): { title: string; value: string }[] {
	return space.teamName ? [ { title: __( 'Team' ), value: space.teamName } ] : [];
}

// A Space renamed on Spacefast shows its new name; one gone from the account keeps the stored one.
export function withSpaceDetails< Connection extends Space >(
	connections: Connection[],
	spaces: Space[]
): Connection[] {
	return connections.map( ( connection ) => ( {
		...connection,
		...spaces.find( ( space ) => space.id === connection.id ),
	} ) );
}
