import { useState } from 'react';
import { getAppGlobals } from 'src/lib/app-globals';

const PLATFORMS: { key: NodeJS.Platform; label: string }[] = [
	{ key: 'darwin', label: 'macOS' },
	{ key: 'win32', label: 'Windows' },
];

function setDevPlatform( p: NodeJS.Platform ) {
	window.appGlobals = { ...window.appGlobals, platform: p };
	window.dispatchEvent( new Event( 'dev-platform-change' ) );
}

export function DevController() {
	const [ platform, setPlatform ] = useState< NodeJS.Platform >( getAppGlobals().platform );
	const [ collapsed, setCollapsed ] = useState( false );

	if ( process.env.NODE_ENV !== 'development' ) {
		return null;
	}

	const handlePlatformChange = ( p: NodeJS.Platform ) => {
		setDevPlatform( p );
		setPlatform( p );
	};

	if ( collapsed ) {
		return (
			<button
				onClick={ () => setCollapsed( false ) }
				className="fixed bottom-3 right-3 z-50 w-7 h-7 rounded-full bg-black/80 text-white text-xs flex items-center justify-center hover:bg-black/90 shadow-lg"
				title="Dev Controller"
			>
				D
			</button>
		);
	}

	return (
		<div className="fixed bottom-3 right-3 z-50 bg-black/85 backdrop-blur-sm text-white rounded-lg shadow-lg p-2 flex items-center gap-2 text-xs">
			<span className="text-white/50 pl-1">Platform:</span>
			{ PLATFORMS.map( ( p ) => (
				<button
					key={ p.key }
					onClick={ () => handlePlatformChange( p.key ) }
					className={ `px-2 py-1 rounded transition-colors ${
						platform === p.key
							? 'bg-white/20 text-white'
							: 'text-white/50 hover:text-white/80 hover:bg-white/10'
					}` }
				>
					{ p.label }
				</button>
			) ) }
			<button
				onClick={ () => setCollapsed( true ) }
				className="text-white/30 hover:text-white/60 px-1"
				title="Collapse"
			>
				&times;
			</button>
		</div>
	);
}
