import { useEffect, useState } from 'react';
import { useSha256 } from './use-sha256';

const defaultImageUri = 'https://s0.wp.com/i/studio-app/profile-icon.png';
const defaultImageUriDark = 'https://s0.wp.com/i/studio-app/profile-icon-black.png';

export function useGravatarUrl( email?: string, isBlack = false ) {
	const sha256 = useSha256();
	const [ gravatarUrl, setGravatarUrl ] = useState( '' );
	useEffect( () => {
		if ( email ) {
			sha256( email ).then( ( emailHash ) =>
				setGravatarUrl(
					`https://www.gravatar.com/avatar/${ emailHash }?d=${ encodeURI(
						isBlack ? defaultImageUriDark : defaultImageUri
					) }`
				)
			);
		}
	}, [ isBlack, email, sha256 ] );
	return gravatarUrl;
}
