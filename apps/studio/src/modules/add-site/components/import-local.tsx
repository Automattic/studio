import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
	Spinner,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useState } from 'react';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { LocalWPSite } from 'src/lib/import-export/import/types';

interface ImportLocalProps {
	selectedSite?: LocalWPSite;
	onSiteSelect: ( site?: LocalWPSite ) => void;
}

export default function ImportLocal( { selectedSite, onSiteSelect }: ImportLocalProps ) {
	const { __ } = useI18n();
	const [ sites, setSites ] = useState< LocalWPSite[] >( [] );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ error, setError ] = useState< string | null >( null );

	useEffect( () => {
		let cancelled = false;
		setIsLoading( true );
		setError( null );
		getIpcApi()
			.getLocalWPSites()
			.then( ( result ) => {
				if ( ! cancelled ) {
					setSites( result );
					setIsLoading( false );
				}
			} )
			.catch( () => {
				if ( ! cancelled ) {
					setError( __( 'Could not detect Local WP sites.' ) );
					setIsLoading( false );
				}
			} );
		return () => {
			cancelled = true;
		};
	}, [ __ ] );

	const handleSiteClick = useCallback(
		( site: LocalWPSite ) => {
			if ( selectedSite?.id === site.id ) {
				onSiteSelect( undefined );
			} else {
				onSiteSelect( site );
			}
		},
		[ selectedSite, onSiteSelect ]
	);

	return (
		<VStack className="text-center w-full" alignment="top" spacing={ 0 }>
			<Heading className="text-center text-[32px] text-frame-text mb-2" weight={ 500 }>
				{ __( 'Import from Local' ) }
			</Heading>
			<Text className="text-[15px] font-light text-frame-text-secondary max-w-sm mb-6 mx-auto">
				{ __( 'Select a site from Local WP to import into Studio.' ) }
			</Text>

			{ isLoading && (
				<div className="flex justify-center py-12">
					<Spinner />
				</div>
			) }

			{ error && <Text className="text-red-500 text-sm">{ error }</Text> }

			{ ! isLoading && ! error && sites.length === 0 && (
				<VStack className="py-12 items-center" spacing={ 2 }>
					<Text className="text-frame-text-secondary text-sm">
						{ __( 'No Local WP sites found.' ) }
					</Text>
					<Text className="text-frame-text-secondary text-xs max-w-sm">
						{ __( 'Make sure Local WP is installed and has sites configured.' ) }
					</Text>
				</VStack>
			) }

			{ ! isLoading && sites.length > 0 && (
				<div className="w-full max-w-[460px] mx-auto max-h-[340px] overflow-y-auto">
					<VStack spacing={ 2 }>
						{ sites.map( ( site ) => {
							const isSelected = selectedSite?.id === site.id;
							return (
								<HStack
									key={ site.id }
									as="button"
									aria-label={ site.name }
									aria-pressed={ isSelected }
									className={ cx(
										'w-full p-3 border rounded-lg text-left',
										'rtl:text-right',
										'transition-colors',
										isSelected
											? 'border-frame-theme bg-frame-surface'
											: 'border-frame-border hover:border-frame-text-secondary hover:bg-frame-surface'
									) }
									alignment="center"
									onClick={ () => handleSiteClick( site ) }
									spacing={ 3 }
								>
									<VStack className="flex-1 gap-0.5 min-w-0">
										<Text className="text-[14px] text-frame-text truncate" weight="500">
											{ site.name }
										</Text>
										<Text className="text-[12px] text-frame-text-secondary truncate">
											{ site.domain || site.path }
										</Text>
									</VStack>
									{ site.phpVersion && (
										<Text className="text-[11px] text-frame-text-secondary shrink-0">
											{ `PHP ${ site.phpVersion }` }
										</Text>
									) }
								</HStack>
							);
						} ) }
					</VStack>
				</div>
			) }
		</VStack>
	);
}
