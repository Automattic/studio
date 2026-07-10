import { useEffect, useState } from 'react';
import styles from './style.module.css';

// The `-black` asset has dark pixels (visible on a light background) and the
// plain asset has light pixels (visible on a dark background), so each is used
// under the opposite theme.
const PROFILE_ICON_FOR_LIGHT = 'https://s0.wp.com/i/studio-app/profile-icon-black.png';
const PROFILE_ICON_FOR_DARK = 'https://s0.wp.com/i/studio-app/profile-icon.png';

async function sha256Hex( input: string ): Promise< string > {
	const digest = await crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( input ) );
	return Array.from( new Uint8Array( digest ) )
		.map( ( b ) => b.toString( 16 ).padStart( 2, '0' ) )
		.join( '' );
}

function useGravatarUrl( email: string | undefined, isDark: boolean ): string | undefined {
	const [ url, setUrl ] = useState< string | undefined >( undefined );

	useEffect( () => {
		if ( ! email ) {
			setUrl( undefined );
			return;
		}
		let cancelled = false;
		const fallback = isDark ? PROFILE_ICON_FOR_DARK : PROFILE_ICON_FOR_LIGHT;
		void sha256Hex( email.trim().toLowerCase() ).then( ( hash ) => {
			if ( cancelled ) {
				return;
			}
			setUrl( `https://www.gravatar.com/avatar/${ hash }?d=${ encodeURIComponent( fallback ) }` );
		} );
		return () => {
			cancelled = true;
		};
	}, [ email, isDark ] );

	return url;
}

type GravatarProps = {
	email: string;
	isDark: boolean;
	className?: string;
};

export function Gravatar( { email, isDark, className }: GravatarProps ) {
	const url = useGravatarUrl( email, isDark );
	const [ errored, setErrored ] = useState( false );
	const rootClassName = `${ styles.root } ${ className ?? '' }`;

	if ( ! url || errored ) {
		return <span aria-hidden="true" className={ rootClassName } />;
	}

	return (
		<img
			aria-hidden="true"
			className={ rootClassName }
			src={ url }
			alt=""
			onError={ () => setErrored( true ) }
		/>
	);
}
