import { useState, type ReactNode } from 'react';
import arc from './assets/arc.png';
import brave from './assets/brave.png';
import chrome from './assets/chrome.png';
import chromium from './assets/chromium.png';
import cursor from './assets/cursor.png';
import edge from './assets/edge.png';
import finder from './assets/finder.png';
import firefox from './assets/firefox.png';
import ghostty from './assets/ghostty.png';
import phpmyadmin from './assets/phpmyadmin.png';
import safari from './assets/safari.png';
import terminal from './assets/terminal.png';
import vscode from './assets/vscode.png';
import warp from './assets/warp.png';
import styles from './style.module.css';

const icons: Record< string, string > = {
	arc,
	brave,
	chrome,
	chromium,
	cursor,
	edge,
	finder,
	firefox,
	ghostty,
	phpmyadmin,
	safari,
	terminal,
	vscode,
	warp,
};

/** An app's bundled logo, or `fallback` when there is none or it fails to load. */
export function AppIcon( { app, fallback }: { app?: string; fallback: ReactNode } ) {
	const [ failedSource, setFailedSource ] = useState< string >();
	const src = app ? icons[ app ] : undefined;
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
