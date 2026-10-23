import { clsx } from 'clsx';
import { CheckIcon } from 'lucide-react';
import styles from './style.module.css';

interface FeatureListProps {
	features: { title: string; body: string }[];
	className?: string;
}

// The onboarding flow's checkmark feature columns, shared by the welcome
// screen and the tour steps so the two can't drift apart.
export function FeatureList( { features, className }: FeatureListProps ) {
	return (
		<ul className={ clsx( styles.features, className ) }>
			{ features.map( ( { title, body } ) => (
				<li key={ title }>
					<h3 className={ styles.featureTitle }>
						<CheckIcon />
						{ title }
					</h3>
					<p className={ styles.featureBody }>{ body }</p>
				</li>
			) ) }
		</ul>
	);
}
