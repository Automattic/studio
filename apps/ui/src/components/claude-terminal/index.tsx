import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { useSessionUIDispatch } from '@/hooks/use-session-ui';
import styles from './style.module.css';
import '@xterm/xterm/css/xterm.css';

// Embedded terminal running the official `claude` CLI against the active
// site. The interactive CLI is the one surface Anthropic bills against the
// full Pro/Max subscription pool (programmatic use — ACP / Agent SDK — is
// slated for a separate capped credit), so Studio embeds the real thing and
// contributes cwd, the wordpress-studio MCP server, and preview refresh.

function getApiBaseUrl(): string {
	if ( import.meta.env.VITE_STUDIO_API_URL ) {
		return import.meta.env.VITE_STUDIO_API_URL;
	}
	return import.meta.env.DEV ? 'http://localhost:8081' : window.location.origin;
}

function isDarkMode(): boolean {
	const attribute = document.documentElement.dataset.theme;
	if ( attribute === 'dark' || attribute === 'light' ) {
		return attribute === 'dark';
	}
	return window.matchMedia( '(prefers-color-scheme: dark)' ).matches;
}

const DARK_THEME = {
	background: '#1e1e1e',
	foreground: '#e5e5e5',
	cursor: '#e5e5e5',
};

const LIGHT_THEME = {
	background: '#ffffff',
	foreground: '#1e1e1e',
	cursor: '#1e1e1e',
	selectionBackground: '#b3d4fc',
};

export function ClaudeTerminal( { siteId }: { siteId: string } ) {
	const containerRef = useRef< HTMLDivElement >( null );
	const [ error, setError ] = useState< string | null >( null );
	const connector = useConnector();
	const dispatch = useSessionUIDispatch();

	// File changes in the site directory arrive as synthetic preview.reload
	// events on the shared agent SSE channel; refresh the preview panel.
	useEffect( () => {
		return connector.onAgentEvent( ( payload ) => {
			if (
				payload.sessionId === `terminal-${ siteId }` &&
				payload.event.type === 'preview.reload'
			) {
				dispatch( { type: 'preview/reload' } );
			}
		} );
	}, [ connector, siteId, dispatch ] );

	useEffect( () => {
		const container = containerRef.current;
		if ( ! container ) {
			return;
		}

		let disposed = false;
		let socket: WebSocket | undefined;
		let resizeObserver: ResizeObserver | undefined;

		const terminal = new Terminal( {
			fontFamily: 'Menlo, Monaco, "Courier New", monospace',
			fontSize: 13,
			cursorBlink: true,
			theme: isDarkMode() ? DARK_THEME : LIGHT_THEME,
		} );
		const fitAddon = new FitAddon();
		terminal.loadAddon( fitAddon );
		terminal.open( container );
		fitAddon.fit();

		const base = getApiBaseUrl();

		const connect = async () => {
			const response = await fetch( `${ base }/api/terminals`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { siteId } ),
			} );
			if ( ! response.ok ) {
				const body = ( await response.json().catch( () => null ) ) as { error?: string } | null;
				throw new Error( body?.error ?? `Terminal request failed (${ response.status })` );
			}
			const { terminalId } = ( await response.json() ) as { terminalId: string };
			if ( disposed ) {
				return;
			}

			const wsUrl = `${ base.replace( /^http/, 'ws' ) }/api/terminals/${ terminalId }/ws`;
			socket = new WebSocket( wsUrl );
			socket.onmessage = ( event ) => {
				const message = JSON.parse( event.data as string ) as {
					type: string;
					data?: string;
					exitCode?: number;
				};
				if ( message.type === 'output' && typeof message.data === 'string' ) {
					terminal.write( message.data );
				} else if ( message.type === 'exit' ) {
					terminal.write( `\r\n[claude exited with code ${ message.exitCode }]\r\n` );
				}
			};
			socket.onopen = () => {
				sendResize();
			};

			terminal.onData( ( data ) => {
				if ( socket?.readyState === WebSocket.OPEN ) {
					socket.send( JSON.stringify( { type: 'input', data } ) );
				}
			} );

			const sendResize = () => {
				fitAddon.fit();
				if ( socket?.readyState === WebSocket.OPEN ) {
					socket.send(
						JSON.stringify( { type: 'resize', cols: terminal.cols, rows: terminal.rows } )
					);
				}
			};
			resizeObserver = new ResizeObserver( sendResize );
			resizeObserver.observe( container );
		};

		connect().catch( ( connectError: unknown ) => {
			if ( ! disposed ) {
				setError( connectError instanceof Error ? connectError.message : String( connectError ) );
			}
		} );

		return () => {
			disposed = true;
			resizeObserver?.disconnect();
			socket?.close();
			terminal.dispose();
		};
	}, [ siteId ] );

	if ( error ) {
		return (
			<div className={ styles.error } role="alert">
				{ error }
			</div>
		);
	}

	return <div ref={ containerRef } className={ styles.terminal } />;
}
