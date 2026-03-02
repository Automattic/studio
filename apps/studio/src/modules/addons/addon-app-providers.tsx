/**
 * <AddonAppProviders /> — Wraps the app tree with all addon context providers.
 * Each addon can register React context providers via `appProviders`.
 * They are applied in addon registration order (first = outermost wrapper).
 */
import { getBundledAddons } from 'src/modules/addons/registry';
import type { ReactNode } from 'react';

interface AddonAppProvidersProps {
	children: ReactNode;
}

export function AddonAppProviders( { children }: AddonAppProvidersProps ) {
	const providers = getBundledAddons().flatMap( ( addon ) => addon.appProviders ?? [] );

	// Wrap children with each provider from innermost to outermost
	return providers.reduceRight(
		( wrappedChildren, Provider ) => <Provider>{ wrappedChildren }</Provider>,
		children
	);
}
