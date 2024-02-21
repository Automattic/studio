import { useEffect, useState } from 'react';
import { useSha256 } from './use-sha256';

export function useGravatarUrl( email?: string ) {
	const sha256 = useSha256();
	const [ emailDigest, setEmailDigest ] = useState( '' );
	useEffect( () => {
		if ( email ) {
			sha256( email ).then( setEmailDigest );
		}
	}, [ email, sha256 ] );
	return `https://www.gravatar.com/avatar/${ emailDigest }`;
}
