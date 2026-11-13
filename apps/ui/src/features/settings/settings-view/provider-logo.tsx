import { AppIcon } from '@/features/sites';
import { GlobeIcon } from '@/lib/icons';
import styles from './style.module.css';
import type { ProviderId } from '@studio/providers';

export function ProviderLogo( { provider }: { provider: ProviderId } ) {
	return (
		<AppIcon
			app={ provider }
			fallback={
				<span className={ styles.appIconFallback } aria-hidden="true">
					<GlobeIcon />
				</span>
			}
		/>
	);
}
