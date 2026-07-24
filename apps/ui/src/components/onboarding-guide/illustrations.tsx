import styles from './style.module.css';
import type { OrientationIllustrationId } from '@/data/onboarding/orientation-guide';

// Placeholder for the guide's header art. Real illustrations (keyed by the
// page's illustration id) drop in here; until then this is just the tinted
// slot at the correct size.
export function OrientationIllustration( { id }: { id: OrientationIllustrationId } ) {
	return <div className={ styles.illustration } data-illustration={ id } />;
}
