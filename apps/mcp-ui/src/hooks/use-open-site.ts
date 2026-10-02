import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import type { SiteKind } from '@/data/core';

export function useOpenSite() {
	const navigate = useNavigate();
	return useCallback(
		( kind: SiteKind, id: string | number, options: { replace?: boolean } = {} ) => {
			void navigate( {
				to: kind === 'local' ? '/sites/local/$id' : '/sites/wpcom/$id',
				params: { id: String( id ) },
				replace: options.replace,
			} );
			window.scrollTo( 0, 0 );
		},
		[ navigate ]
	);
}
