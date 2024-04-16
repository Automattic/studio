import { useEffect, useState } from 'react';
import { useSha256 } from './use-sha256';

const defaultImageUri = 'https://s0.wp.com/i/studio-app/profile-icon.png';
const defaultImageUriDark = 'https://s0.wp.com/i/studio-app/profile-icon-black.png';
const defaultDetailedImageUri = 'https://s0.wp.com/i/studio-app/profile-icon-detailed.svg';

export function useGravatarUrl( email?: string, isBlack = false, detailedDefaultImage = false ) {
	const sha256 = useSha256();
	const [ gravatarUrl, setGravatarUrl ] = useState( '' );

	let fallbackImageUri: string;
	if ( detailedDefaultImage ) {
		fallbackImageUri = defaultDetailedImageUri;
	} else if ( isBlack ) {
		fallbackImageUri = defaultImageUriDark;
	} else {
		fallbackImageUri = defaultImageUri;
	}

	useEffect( () => {
		if ( email ) {
			sha256( email ).then( ( emailHash ) =>
				setGravatarUrl(
					`https://www.gravatar.com/avatar/${ emailHash }?d=${ encodeURI( fallbackImageUri ) }`
				)
			);
		}
	}, [ fallbackImageUri, email, sha256 ] );
	return gravatarUrl;
}
