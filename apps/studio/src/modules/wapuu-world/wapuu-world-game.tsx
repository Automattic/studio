import { useI18n } from '@wordpress/react-i18n';
import { useEffect, useRef } from 'react';
import { useAppDispatch } from 'src/stores';
import { closeWapuuWorld } from 'src/stores/ui-slice';
import wapuuIdleUrl from './assets/wapuu-player-idle-sprite.png';
import { startGame, CANVAS_W, CANVAS_H } from './engine/game-loop';
import { WIN_LINK } from './engine/renderer';

export function WapuuWorldGame() {
	const { __ } = useI18n();
	const dispatch = useAppDispatch();
	const canvasRef = useRef< HTMLCanvasElement >( null );

	useEffect( () => {
		const canvas = canvasRef.current;
		if ( ! canvas ) return;
		return startGame( canvas );
	}, [] );

	useEffect( () => {
		function onKeyDown( e: KeyboardEvent ) {
			if ( e.key === 'Escape' ) {
				dispatch( closeWapuuWorld() );
			}
		}
		window.addEventListener( 'keydown', onKeyDown );
		return () => window.removeEventListener( 'keydown', onKeyDown );
	}, [ dispatch ] );

	return (
		<div
			className="fixed inset-0 z-[9999999] flex items-center justify-center"
			style={ { background: 'rgba(0,0,0,0.75)' } }
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={ __( 'Wapuu World' ) }
				className="relative flex flex-col"
				style={ {
					border: '4px solid #21759b',
					borderRadius: 8,
					boxShadow: '0 0 40px rgba(33,117,155,0.6)',
					background: '#000',
				} }
			>
				{ /* Title bar */ }
				<div
					className="flex items-center justify-between px-3 py-1.5"
					style={ { background: '#21759b', borderRadius: '4px 4px 0 0', minWidth: CANVAS_W } }
				>
					<span
						style={ {
							color: '#fff',
							fontFamily: 'monospace',
							fontWeight: 'bold',
							fontSize: 14,
							display: 'flex',
							alignItems: 'center',
							gap: 6,
						} }
					>
						<img
							src={ wapuuIdleUrl }
							alt=""
							width={ 16 }
							height={ 16 }
							style={ { imageRendering: 'pixelated' } }
						/>
						{ __( 'Wapuu World' ) }
					</span>
					<div
						className="flex items-center gap-1"
						style={ { color: '#cce8f4', fontFamily: 'monospace', fontSize: 11 } }
					>
						<span>{ __( 'ESC to close' ) }</span>
						<button
							onClick={ () => dispatch( closeWapuuWorld() ) }
							style={ {
								marginLeft: 8,
								background: 'rgba(255,255,255,0.2)',
								border: 'none',
								borderRadius: 4,
								color: '#fff',
								cursor: 'pointer',
								fontFamily: 'monospace',
								fontSize: 13,
								padding: '1px 7px',
							} }
							aria-label={ __( 'Close game' ) }
						>
							✕
						</button>
					</div>
				</div>

				{ /* Game canvas */ }
				<canvas
					ref={ canvasRef }
					width={ CANVAS_W }
					height={ CANVAS_H }
					style={ { display: 'block', imageRendering: 'pixelated', cursor: 'default' } }
					onClick={ ( e ) => {
						const rect = ( e.target as HTMLCanvasElement ).getBoundingClientRect();
						const y = e.clientY - rect.top;
						const x = e.clientX - rect.left;
						if ( y >= WIN_LINK.y && y <= WIN_LINK.y + WIN_LINK.h && x >= 0 && x <= CANVAS_W ) {
							void window.ipcApi.openURL( WIN_LINK.url );
						}
					} }
				/>

				{ /* Controls hint */ }
				<div
					style={ {
						background: '#21759b',
						borderRadius: '0 0 4px 4px',
						padding: '4px 12px',
						color: '#cce8f4',
						fontFamily: 'monospace',
						fontSize: 11,
						textAlign: 'center',
					} }
				>
					{ __( 'Arrow keys / WASD to move · Up / W / Space to jump' ) }
				</div>
			</div>
		</div>
	);
}
