import { clsx } from 'clsx';
import { ProviderLogo as AccountProviderLogo } from '@/features/account';
import styles from './style.module.css';
import type { SitesProviderId } from '@studio/providers';

export function ProviderLogo( {
	provider,
	compact = false,
}: {
	provider: SitesProviderId;
	branded?: boolean;
	compact?: boolean;
} ) {
	return (
		<AccountProviderLogo
			provider={ provider }
			className={ clsx( styles.providerLogo, compact && styles.providerLogoCompact ) }
		/>
	);
}
