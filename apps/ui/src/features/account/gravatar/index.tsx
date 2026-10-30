import { useEffect, useState } from 'react';
import styles from './style.module.css';

async function sha256Hex( input: string ): Promise< string > {
	const digest = await crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( input ) );
	return Array.from( new Uint8Array( digest ) )
		.map( ( b ) => b.toString( 16 ).padStart( 2, '0' ) )
		.join( '' );
}

function useGravatarUrl( email: string | undefined ): string | undefined {
	const [ url, setUrl ] = useState< string | undefined >( undefined );

	useEffect( () => {
		if ( ! email ) {
			setUrl( undefined );
			return;
		}
		let cancelled = false;
		void sha256Hex( email.trim().toLowerCase() ).then( ( hash ) => {
			if ( cancelled ) {
				return;
			}
			setUrl( `https://www.gravatar.com/avatar/${ hash }?s=64&d=404` );
		} );
		return () => {
			cancelled = true;
		};
	}, [ email ] );

	return url;
}

type GravatarProps = {
	email: string;
	className?: string;
};

export function Gravatar( { email, className }: GravatarProps ) {
	const url = useGravatarUrl( email );
	const [ erroredUrl, setErroredUrl ] = useState< string >();

	return (
		<span aria-hidden="true" className={ `${ styles.root } ${ className ?? '' }` }>
			<svg
				className={ styles.fallback }
				viewBox="0 0 24 24"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
			>
				<path
					d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22ZM15 10C15 11.6569 13.6569 13 12 13C10.3431 13 9 11.6569 9 10C9 8.34315 10.3431 7 12 7C13.6569 7 15 8.34315 15 10ZM12.0002 20C9.76181 20 7.73814 19.0807 6.28613 17.5991C7.61787 16.005 9.60491 15 12.0002 15C14.3955 15 16.3825 16.005 17.7143 17.5991C16.2623 19.0807 14.2386 20 12.0002 20Z"
					fillRule="evenodd"
					clipRule="evenodd"
					fill="currentColor"
				/>
			</svg>
			{ url && url !== erroredUrl ? (
				<img className={ styles.image } src={ url } alt="" onError={ () => setErroredUrl( url ) } />
			) : null }
		</span>
	);
}
