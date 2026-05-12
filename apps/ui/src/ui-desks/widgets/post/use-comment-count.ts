import apiFetch from '@wordpress/api-fetch';
import { useEffect, useState } from 'react';

const cache = new Map< number, number >();
const inflight = new Map< number, Promise< number > >();

export function useCommentCount( postId: number | null ): number {
	const [ count, setCount ] = useState( () => ( postId ? cache.get( postId ) ?? 0 : 0 ) );

	useEffect( () => {
		if ( ! postId ) {
			setCount( 0 );
			return;
		}

		if ( cache.has( postId ) ) {
			setCount( cache.get( postId ) ?? 0 );
			return;
		}

		setCount( 0 );

		let cancelled = false;
		let promise = inflight.get( postId );
		if ( ! promise ) {
			promise = fetchCommentCount( postId ).then( ( value ) => {
				cache.set( postId, value );
				inflight.delete( postId );
				return value;
			} );
			inflight.set( postId, promise );
		}

		void promise.then( ( value ) => {
			if ( ! cancelled ) {
				setCount( value );
			}
		} );

		return () => {
			cancelled = true;
		};
	}, [ postId ] );

	return count;
}

async function fetchCommentCount( postId: number ): Promise< number > {
	try {
		const response = await apiFetch< unknown, false >( {
			path: `/wp/v2/comments?post=${ postId }&per_page=1&status=approve`,
			parse: false,
		} );
		const total = response.headers.get( 'X-WP-Total' );
		return total ? Number.parseInt( total, 10 ) || 0 : 0;
	} catch {
		return 0;
	}
}
