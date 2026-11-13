import { ProviderLogo as DefaultProviderLogo } from '@/features/account';
import { AppIcon } from '@/features/sites';
import type { ProviderId } from '@studio/providers';

export function ProviderLogo( { provider }: { provider: ProviderId } ) {
	return <AppIcon app={ provider } fallback={ <DefaultProviderLogo provider={ provider } /> } />;
}
