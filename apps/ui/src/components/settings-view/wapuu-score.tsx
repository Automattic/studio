import { __, sprintf } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useConnector } from '@/data/core';
import { useWapuuScore } from '@/data/queries/use-wapuu-score';
import wapuuIdleUrl from '@/ui-classic/components/wapuu-world/assets/wapuu-player-idle-sprite.png';
import { MAX_SCORE } from '@/ui-classic/components/wapuu-world/engine/game-loop';
import styles from './style.module.css';

const WAPUU_STUDIO_URL = 'https://wapuu.studio';

export function WapuuScore() {
	const connector = useConnector();
	const { data: score } = useWapuuScore();

	if ( score === undefined || score === null ) {
		return null;
	}

	const clamped = Math.min( score, MAX_SCORE );

	return (
		<section className={ styles.preferenceSectionGroup }>
			<h2 className={ styles.preferenceSectionHeading }>
				<span className={ styles.wapuuScoreHeading }>
					<img
						src={ wapuuIdleUrl }
						alt=""
						width={ 16 }
						height={ 16 }
						className={ styles.wapuuScoreIcon }
					/>
					{ __( 'Wapuu score' ) }
				</span>
			</h2>
			<div className={ styles.wapuuScoreBody }>
				<div className={ styles.wapuuScoreMeter }>
					<span className={ styles.wapuuScoreValue }>
						{ sprintf( __( '%1$d of %2$d points' ), score, MAX_SCORE ) }
					</span>
					<div
						className={ styles.wapuuScoreTrack }
						role="progressbar"
						aria-valuemin={ 0 }
						aria-valuemax={ MAX_SCORE }
						aria-valuenow={ clamped }
						aria-label={ __( 'Wapuu score' ) }
					>
						<div
							className={ styles.wapuuScoreFill }
							style={ { inlineSize: `${ ( clamped / MAX_SCORE ) * 100 }%` } }
						/>
					</div>
				</div>
				<Button
					type="button"
					variant="minimal"
					tone="neutral"
					size="small"
					onClick={ () => void connector.openExternalUrl( WAPUU_STUDIO_URL ) }
				>
					{ __( 'Visit wapuu.studio' ) }
				</Button>
			</div>
		</section>
	);
}
