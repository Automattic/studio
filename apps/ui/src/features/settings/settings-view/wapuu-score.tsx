import { __, sprintf } from '@wordpress/i18n';
import { useConnector } from '@/data/core';
import { useWapuuScore } from '@/data/queries/use-wapuu-score';
import wapuuIdleUrl from '@/features/settings/wapuu-world/assets/wapuu-player-idle-sprite.png';
import { MAX_SCORE } from '@/features/settings/wapuu-world/engine/game-loop';
import {
	Button,
	Field,
	FieldContent,
	FieldDescription,
	FieldGroup,
	FieldLegend,
	FieldSet,
	Progress,
} from '@/lib/ui';
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
		<FieldSet>
			<FieldLegend variant="label">
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
			</FieldLegend>
			<FieldGroup variant="settings">
				<Field orientation="horizontal">
					<FieldContent className={ styles.wapuuScoreMeter }>
						<FieldDescription>
							{ sprintf( __( '%1$d of %2$d points' ), score, MAX_SCORE ) }
						</FieldDescription>
						<Progress value={ clamped } max={ MAX_SCORE } aria-label={ __( 'Wapuu score' ) } />
					</FieldContent>
					<Button
						variant="outline"
						onClick={ () => void connector.openExternalUrl( WAPUU_STUDIO_URL ) }
					>
						{ __( 'Visit wapuu.studio' ) }
					</Button>
				</Field>
			</FieldGroup>
		</FieldSet>
	);
}
