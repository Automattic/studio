import '@/lib/theme/tokens.css';
import '@/lib/theme/base.css';
import '@/index.css';
import { useState } from 'react';
import { PreviewParticles } from '@/features/sites';
import { Button } from '@/lib/ui';
import { renderPlayground } from './playground';
import styles from './style.module.css';

function Stage( { title, children }: { title: string; children: React.ReactNode } ) {
	return (
		<section className={ styles.section } aria-label={ title }>
			<h2 className={ styles.sectionTitle }>{ title }</h2>
			<div className={ styles.stage }>{ children }</div>
		</section>
	);
}

function SelectionWave() {
	const [ selectionTime, setSelectionTime ] = useState< number >();
	return (
		<>
			<PreviewParticles selectionTime={ selectionTime } />
			<Button variant="outline" size="sm" onClick={ () => setSelectionTime( performance.now() ) }>
				Send a wave
			</Button>
		</>
	);
}

function Toggle() {
	const [ active, setActive ] = useState( false );
	return (
		<>
			<PreviewParticles active={ active } showLogo={ active } />
			<Button variant="outline" size="sm" onClick={ () => setActive( ! active ) }>
				{ active ? 'Settle' : 'Start loading' }
			</Button>
		</>
	);
}

renderPlayground(
	'Preview loading animation',
	<>
		<Stage title="Loading a site: active with the logo">
			<PreviewParticles active showLogo />
		</Stage>
		<Stage title="Navigating: active without the logo">
			<PreviewParticles active />
		</Stage>
		<Stage title="Still field">
			<PreviewParticles />
		</Stage>
		<Stage title="Easing in and out">
			<Toggle />
		</Stage>
		<Stage title="Selection wave">
			<SelectionWave />
		</Stage>
	</>
);
