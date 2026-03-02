/**
 * <AddonAppProviders /> — Wraps the app tree with all addon context providers.
 * Each addon can register React context providers via `appProviders`.
 * They are applied in addon registration order (first = outermost wrapper).
 */
import { useEnabledAddons } from 'src/modules/addons/enabled-addons-context';
import type { ReactNode } from 'react';

interface AddonAppProvidersProps {
	children: ReactNode;
}

export function AddonAppProviders( { children }: AddonAppProvidersProps ) {
	const providers = useEnabledAddons().flatMap( ( addon ) => addon.appProviders ?? [] );

	// Wrap children with each provider from innermost to outermost
	return providers.reduceRight(
		( wrappedChildren, Provider ) => <Provider>{ wrappedChildren }</Provider>,
		children
	);
}
