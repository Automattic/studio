/**
 * Addon Add-Site Flows — Renderer companion for the "Add Site" modal.
 *
 * Exports:
 *   useAddonAddSiteFlows()        — returns all registered AddonAddSiteFlow[]
 *   <AddonAddSiteOptions />       — renders addon option buttons in the options screen
 *   useAddonAddSiteFlowComponent() — returns the form component for a given flow type
 */
import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
} from '@wordpress/components';
import { Icon, chevronRight, chevronLeft } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';
import { cx } from 'src/lib/cx';
import { getEnabledAddons } from 'src/modules/addons/registry';
import type { ComponentType } from 'react';
import type { AddonAddSiteFlow, AddonAddSiteFlowProps } from 'src/modules/addons/addon-api';

export function useAddonAddSiteFlows(): AddonAddSiteFlow[] {
	return useMemo( () => getEnabledAddons().flatMap( ( addon ) => addon.addSiteFlows ?? [] ), [] );
}

export function useAddonAddSiteFlowComponent(
	type: string
): ComponentType< AddonAddSiteFlowProps > | undefined {
	const flows = useAddonAddSiteFlows();
	return flows.find( ( f ) => f.type === type )?.component;
}

interface AddonAddSiteOptionsProps {
	onSelect: ( type: string ) => void;
}

export function AddonAddSiteOptions( { onSelect }: AddonAddSiteOptionsProps ) {
	const { isRTL } = useI18n();
	const flows = useAddonAddSiteFlows();
	const chevron = isRTL() ? chevronLeft : chevronRight;

	if ( flows.length === 0 ) {
		return null;
	}

	return (
		<>
			{ flows.map( ( flow ) => (
				<HStack
					key={ flow.type }
					as="button"
					className={ cx(
						'w-full max-w-[460px] p-4 border border-gray-200 rounded-xl text-left',
						'rtl:text-right',
						'hover:border-gray-300 hover:bg-gray-50'
					) }
					alignment="top"
					onClick={ () => onSelect( flow.type ) }
					spacing={ 5 }
				>
					<div className="mt-[-2px]">{ flow.icon }</div>
					<VStack className="flex-1 gap-1.5">
						<Heading className="text-[15px]" weight="500">
							{ flow.label }
						</Heading>
						<Text className="text-[13px] text-gray-500" weight="400">
							{ flow.description }
						</Text>
					</VStack>
					<Icon className="mt-0.5" icon={ chevron } size={ 24 } fill="#949494" />
				</HStack>
			) ) }
		</>
	);
}
