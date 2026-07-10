import { closeSmall } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import Button from 'src/components/button';
import { DotGrid } from 'src/components/dot-grid';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { PixelLogo } from './pixel-logo';
import styles from './style.module.css';

type Stage = 'entering' | 'entered' | 'exiting';

interface AgenticUiBannerProps {
	onDismiss: () => void;
}

export function AgenticUiBanner( { onDismiss }: AgenticUiBannerProps ) {
	const { __ } = useI18n();
	const [ stage, setStage ] = useState< Stage >( 'entering' );

	const handleDismissClick = () => {
		setStage( 'exiting' );
	};

	const handleAnimationEnd = ( event: React.AnimationEvent< HTMLDivElement > ) => {
		if ( event.target !== event.currentTarget ) {
			return;
		}
		if ( stage === 'exiting' ) {
			onDismiss();
		} else if ( stage === 'entering' ) {
			setStage( 'entered' );
		}
	};

	return (
		<div
			className={ cx(
				'absolute bottom-2 right-2 z-20 pointer-events-none',
				stage === 'entering' && styles.rise,
				stage === 'exiting' && styles.sink
			) }
		>
			<div
				className={ cx(
					styles.card,
					// Animation classes are stripped once entered: a lingering filled
					// animation keeps the card composited, which can break the descendant
					// backdrop-filter blur in Chromium.
					stage === 'entering' && styles.enter,
					stage === 'exiting' && styles.exit,
					'pointer-events-auto w-[320px] rounded-lg border border-[var(--color-frame-border)] bg-[var(--color-frame-bg)] shadow-lg'
				) }
				onAnimationEnd={ handleAnimationEnd }
			>
				{ /* Mounted after the card lands so its intro sweep plays as a second beat. */ }
				{ ( stage === 'entered' || stage === 'exiting' ) && (
					<DotGrid
						spacing={ 16 }
						crossSize={ 3 }
						opacity={ 0.25 }
						className="text-frame-text-secondary z-0"
					/>
				) }
				<div className={ styles.hero } style={ { top: 16 } }>
					<PixelLogo size={ 160 } />
				</div>
				<div className={ styles.blur } aria-hidden="true">
					<span className={ `${ styles.blurLayer } ${ styles.blurSoft }` } />
					<span className={ `${ styles.blurLayer } ${ styles.blurMedium }` } />
					<span className={ `${ styles.blurLayer } ${ styles.blurStrong }` } />
					<span className={ `${ styles.blurLayer } ${ styles.blurIntense }` } />
				</div>

				<div
					className={ `${ styles.content } flex flex-col items-center text-center px-6 pt-6 pb-5 pointer-events-none` }
				>
					<Button
						icon={ closeSmall }
						onClick={ handleDismissClick }
						label={ __( 'Dismiss' ) }
						className="!absolute top-1.5 right-1.5 pointer-events-auto"
					/>
					<div className="h-[128px]" />
					<p className="m-0 font-semibold text-[var(--color-frame-text)]">
						{ __( 'There’s a new way to build in Studio' ) }
					</p>
					<p className="m-0 mt-1.5 text-xs text-[var(--color-frame-text-secondary)]">
						{ __(
							'The new workbench gives you Studio Code, an expert WordPress agent, with a new in-app browser to watch it work.'
						) }
					</p>
					<Button
						variant="primary"
						onClick={ () => getIpcApi().enableAgenticUi() }
						className="mt-4 justify-center w-full pointer-events-auto"
					>
						{ __( 'Try it' ) }
					</Button>
				</div>
			</div>
		</div>
	);
}
