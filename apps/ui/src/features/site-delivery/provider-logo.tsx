import { clsx } from 'clsx';
import { ProviderLogo as AccountProviderLogo } from '@/features/account';
import { LogoTile } from '@/lib/ui';
import pressableLogo from './pressable-logo.svg?raw';
import styles from './style.module.css';
import type { RemoteSiteConnection } from '@/data/core';
import type { SitesProviderId } from '@studio/providers';

export function ProviderLogo( {
	provider,
	site,
	compact = false,
}: {
	provider: SitesProviderId;
	site?: RemoteSiteConnection< SitesProviderId >;
	branded?: boolean;
	compact?: boolean;
} ) {
	const className = clsx( styles.providerLogo, compact && styles.providerLogoCompact );
	return site && 'isPressable' in site && site.isPressable ? (
		<LogoTile svg={ pressableLogo } className={ className } />
	) : (
		<AccountProviderLogo provider={ provider } className={ className } />
	);
}
