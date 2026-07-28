import { __ } from '@wordpress/i18n';
import { useEffect, useRef } from 'react';
import { useConnector } from '@/data/core';
import { useSaveWapuuScore } from '@/data/queries/use-wapuu-score';
import wapuuIdleUrl from './assets/wapuu-player-idle-sprite.png';
import { startGame, CANVAS_W, CANVAS_H } from './engine/game-loop';
import { WIN_LINK } from './engine/renderer';
import styles from './style.module.css';

interface WapuuWorldGameProps {
	onClose: () => void;
}

export function WapuuWorldGame( { onClose }: WapuuWorldGameProps ) {
	const connector = useConnector();
	const canvasRef = useRef< HTMLCanvasElement >( null );
	const saveScore = useSaveWapuuScore();

	// Keep the latest save mutation in a ref so the game loop always calls the
	// current one without re-running the mount effect (which would restart the game).
	const saveScoreRef = useRef( saveScore );
	useEffect( () => {
		saveScoreRef.current = saveScore;
	}, [ saveScore ] );

	useEffect( () => {
		const canvas = canvasRef.current;
		if ( ! canvas ) return;
		return startGame( canvas, {
			onWin: ( score ) => saveScoreRef.current.mutate( score ),
		} );
	}, [] );

	useEffect( () => {
		function onKeyDown( e: KeyboardEvent ) {
			if ( e.key === 'Escape' ) {
				onClose();
			}
		}
		window.addEventListener( 'keydown', onKeyDown );
		return () => window.removeEventListener( 'keydown', onKeyDown );
	}, [ onClose ] );

	return (
		<div className={ styles.overlay }>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={ __( 'Wapuu World' ) }
				className={ styles.dialog }
			>
				{ /* Title bar */ }
				<div className={ styles.titleBar } style={ { minWidth: CANVAS_W } }>
					<span className={ styles.title }>
						<img
							src={ wapuuIdleUrl }
							alt=""
							width={ 16 }
							height={ 16 }
							className={ styles.titleIcon }
						/>
						{ __( 'Wapuu World' ) }
					</span>
					<div className={ styles.titleActions }>
						<span>{ __( 'ESC to close' ) }</span>
						<button
							onClick={ onClose }
							className={ styles.closeButton }
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
					className={ styles.canvas }
					onClick={ ( e ) => {
						const rect = ( e.target as HTMLCanvasElement ).getBoundingClientRect();
						const y = e.clientY - rect.top;
						const x = e.clientX - rect.left;
						if ( y >= WIN_LINK.y && y <= WIN_LINK.y + WIN_LINK.h && x >= 0 && x <= CANVAS_W ) {
							void connector.openExternalUrl( WIN_LINK.url );
						}
					} }
				/>

				{ /* Controls hint */ }
				<div className={ styles.controlsHint }>
					{ __( 'Arrow keys / WASD to move · Up / W / Space to jump' ) }
				</div>
			</div>
		</div>
	);
}
