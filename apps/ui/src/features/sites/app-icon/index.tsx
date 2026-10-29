import { useState, type ReactNode } from 'react';
import cursor from './assets/cursor.png';
import finder from './assets/finder.png';
import ghostty from './assets/ghostty.png';
import phpmyadmin from './assets/phpmyadmin.png';
import terminal from './assets/terminal.png';
import vscode from './assets/vscode.png';
import warp from './assets/warp.png';
import styles from './style.module.css';

const icons: Record< string, string > = {
	cursor,
	finder,
	ghostty,
	phpmyadmin,
	terminal,
	vscode,
	warp,
};

/** An app's bundled logo, or `fallback` when there is none or it fails to load. */
export function AppIcon( {
	app,
	src: source,
	fallback,
}: {
	app?: string;
	src?: string;
	fallback: ReactNode;
} ) {
	const [ failedSource, setFailedSource ] = useState< string >();
	const src = source ?? ( app ? icons[ app ] : undefined );
	if ( ! src || failedSource === src ) {
		return fallback;
	}
	return (
		<img
			src={ src }
			alt=""
			aria-hidden="true"
			className={ styles.icon }
			onError={ () => setFailedSource( src ) }
		/>
	);
}
