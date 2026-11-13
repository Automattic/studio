import { useState, type ReactNode } from 'react';
import arc from './assets/arc.png';
import brave from './assets/brave.png';
import chatgpt from './assets/chatgpt.png';
import chrome from './assets/chrome.png';
import chromium from './assets/chromium.png';
import claude from './assets/claude.png';
import copilot from './assets/copilot.png';
import cursor from './assets/cursor.png';
import dia from './assets/dia.png';
import duckduckgo from './assets/duckduckgo.png';
import edge from './assets/edge.png';
import finder from './assets/finder.png';
import firefoxDeveloper from './assets/firefox-developer.png';
import firefox from './assets/firefox.png';
import gemini from './assets/gemini.png';
import ghostty from './assets/ghostty.png';
import github from './assets/github.png';
import grok from './assets/grok.svg';
import opera from './assets/opera.png';
import phpmyadmin from './assets/phpmyadmin.png';
import safari from './assets/safari.png';
import spacefast from './assets/spacefast.png';
import terminal from './assets/terminal.png';
import vivaldi from './assets/vivaldi.png';
import vscode from './assets/vscode.png';
import warp from './assets/warp.png';
import wordpressCom from './assets/wordpress-com.png';
import zen from './assets/zen.png';
import styles from './style.module.css';

const icons: Record< string, string > = {
	anthropic: claude,
	arc,
	brave,
	chrome,
	chromium,
	'claude-code': claude,
	codex: chatgpt,
	cursor,
	dia,
	duckduckgo,
	edge,
	finder,
	firefox,
	'firefox-developer': firefoxDeveloper,
	gemini,
	ghostty,
	github,
	'github-copilot': copilot,
	'grok-build': grok,
	openai: chatgpt,
	opera,
	phpmyadmin,
	safari,
	spacefast,
	terminal,
	vivaldi,
	vscode,
	warp,
	wpcom: wordpressCom,
	zen,
};

const tileIcons = new Set( [ copilot, gemini, spacefast, wordpressCom ] );

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
			className={ tileIcons.has( src ) ? styles.tile : styles.icon }
			onError={ () => setFailedSource( src ) }
		/>
	);
}
