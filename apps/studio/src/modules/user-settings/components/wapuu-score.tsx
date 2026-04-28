import { useEffect, useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';

export function WapuuScore() {
	const [ score, setScore ] = useState< number | undefined >( undefined );

	useEffect( () => {
		void getIpcApi()
			.getWapuuScore()
			.then( ( s: number | undefined ) => setScore( s ) );
	}, [] );

	if ( score === undefined ) {
		return null;
	}

	return (
		<div className="flex gap-3 flex-col">
			<h2 className="a8c-label-semibold">🐾 Wapuu score</h2>
			<div className="flex flex-row items-center gap-2">
				<span className="text-frame-text-secondary text-sm">Best run:</span>
				<span className="font-mono font-semibold">{ score } pts</span>
			</div>
		</div>
	);
}
