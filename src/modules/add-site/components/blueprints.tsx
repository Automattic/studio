import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
	Button,
	Modal,
	Notice,
} from '@wordpress/components';
import { DataViews, View } from '@wordpress/dataviews';
import { createInterpolateElement } from '@wordpress/element';
import { sprintf } from '@wordpress/i18n';
import { Icon, external, upload, caution } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useRef, useState, useMemo } from 'react';
import StudioButton from 'src/components/button';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useGetBlueprints } from 'src/stores/wpcom-api';

import './blueprints.css';

interface Blueprint {
	slug: string;
	title: string;
	excerpt: string;
	image: string;
	playground_url: string;
	blueprint: {
		meta?: {
			categories?: string[];
			[ key: string ]: unknown;
		};
		[ key: string ]: unknown;
	};
}

interface DataViewBlueprint extends Blueprint {
	isSelected: boolean;
	categories: string[];
}

interface BlueprintIssuesModalProps {
	warnings: Array< { feature: string; reason: string } > | undefined;
	fileName: string;
	isOpen: boolean;
	onClose: () => void;
}

function BlueprintIssuesModal( {
	warnings,
	fileName,
	isOpen,
	onClose,
}: BlueprintIssuesModalProps ) {
	const { __ } = useI18n();

	if ( ! isOpen ) {
		return null;
	}

	return (
		<Modal
			className="blueprints-issues-modal"
			title={ __( 'Blueprint Details' ) }
			onRequestClose={ onClose }
			size="medium"
		>
			<div className="h-full flex flex-col gap-1">
				<Text className="font-medium text-gray-900">{ fileName }</Text>
				<Text>
					{ warnings?.length &&
						__(
							'The following features are not supported in Studio and will be automatically removed:'
						) }
				</Text>
				<div className="flex-1 overflow-y-auto">
					<VStack spacing={ 3 } className="divide-y divide-gray-200">
						{ warnings?.map( ( warningItem, index ) => (
							<div key={ index } className={ index > 0 ? 'pt-3' : '' }>
								<HStack alignment="topLeft" spacing={ 2 }>
									<Icon
										icon={ caution }
										className="text-orange-500 mt-1 flex-shrink-0"
										size={ 20 }
									/>
									<VStack spacing={ 1 }>
										<Text weight={ 600 } className="text-base">
											{ warningItem.feature }
										</Text>
										<Text className="text-sm text-gray-700">{ warningItem.reason }</Text>
									</VStack>
								</HStack>
							</div>
						) ) }
					</VStack>
				</div>
				<div className="pt-4 border-t border-gray-200">
					<Text className="text-sm text-gray-600">
						{ __(
							'Your Blueprint will still work, but these features will be skipped during site creation.'
						) }
					</Text>
				</div>
				<HStack alignment="right">
					<Button variant="primary" onClick={ onClose }>
						{ __( 'Got it' ) }
					</Button>
				</HStack>
			</div>
		</Modal>
	);
}

interface BlueprintWarningNoticeProps {
	warnings: Array< { feature: string; reason: string } > | undefined;
	fileName: string;
	className?: string;
}

export function BlueprintWarningNotice( {
	warnings,
	fileName,
	className,
}: BlueprintWarningNoticeProps ) {
	const { __ } = useI18n();
	const [ showIssuesModal, setShowIssuesModal ] = useState( false );

	if ( ! warnings || warnings.length === 0 ) {
		return null;
	}

	return (
		<>
			<BlueprintIssuesModal
				warnings={ warnings }
				fileName={ fileName }
				isOpen={ showIssuesModal }
				onClose={ () => setShowIssuesModal( false ) }
			/>
			<Notice status="warning" isDismissible={ false } className={ className }>
				<div className="flex justify-between items-center w-full">
					<span>
						{ __(
							'This Blueprint uses unsupported features in Studio and might not work as expected.'
						) }
					</span>
					<Button
						variant="link"
						onClick={ () => setShowIssuesModal( true ) }
						className="!text-inherit !p-0 !underline"
					>
						{ __( 'View details' ) }
					</Button>
				</div>
			</Notice>
		</>
	);
}

interface AddSiteBlueprintProps {
	blueprints: Blueprint[];
	errorMessage?: string;
	isLoading: boolean;
	selectedBlueprint: string | null;
	onBlueprintChange: ( blueprintId: string ) => void;
	onFileBlueprintSelect?: ( blueprint: Blueprint ) => void;
}

export function AddSiteBlueprintSelector( {
	blueprints,
	errorMessage,
	isLoading,
	selectedBlueprint,
	onBlueprintChange,
	onFileBlueprintSelect,
}: AddSiteBlueprintProps ) {
	const { __ } = useI18n();
	const { refetch: refetchBlueprints, isFetching: isFetchingBlueprints } = useGetBlueprints();
	const fileRef = useRef< HTMLInputElement | null >( null );
	const [ validationError, setValidationError ] = useState< string | undefined >( undefined );
	const [ blueprintWarnings, setBlueprintWarnings ] = useState<
		| Array< {
				feature: string;
				reason: string;
				alternative?: string;
		  } >
		| undefined
	>( undefined );
	const [ uploadedFileName, setUploadedFileName ] = useState< string | null >( null );

	// Check if current selection is a file-based blueprint
	const isFileBasedSelection = selectedBlueprint && selectedBlueprint.startsWith( 'file:' );
	const selectedFileName =
		uploadedFileName || ( isFileBasedSelection ? selectedBlueprint.replace( 'file:', '' ) : null );

	const handleRemoveFile = useCallback( () => {
		onBlueprintChange( '' );
		setValidationError( undefined );
		setBlueprintWarnings( undefined );
		setUploadedFileName( null );
		if ( fileRef.current ) {
			fileRef.current.value = '';
		}
	}, [ onBlueprintChange ] );

	const handleBlueprintClick = useCallback(
		( item: DataViewBlueprint ) => {
			setValidationError( undefined );
			setBlueprintWarnings( undefined );
			onBlueprintChange( item.slug );
		},
		[ onBlueprintChange ]
	);

	const handlePreviewClick = useCallback(
		( e: React.MouseEvent< HTMLButtonElement >, item: DataViewBlueprint ) => {
			e.stopPropagation();
			getIpcApi().openURL( item.playground_url );
		},
		[]
	);

	const [ view, setView ] = useState< View >( {
		type: 'grid',
		perPage: 9,
		page: 1,
		fields: [ 'excerpt' ],
		mediaField: 'image',
		titleField: 'title',
		search: '',
		filters: [],
		layout: {
			badgeFields: [ 'excerpt' ],
		},
	} );

	const fields = useMemo(
		() => [
			{
				id: 'image',
				label: __( 'Thumbnail' ),
				type: 'media' as const,
				render: ( { item }: { item: DataViewBlueprint } ) => (
					<div
						className={ cx(
							'w-full bg-gray-50 h-32 rounded-t overflow-hidden',
							'[@media(min-height:680px)]:h-[175px]',
							item.isSelected && 'is-selected'
						) }
					>
						<img
							src={ item.image }
							alt={ item.title }
							className="w-full h-full object-cover object-center"
						/>
					</div>
				),
			},
			{
				id: 'title',
				label: __( 'Title' ),
				type: 'text' as const,
				render: ( { item }: { item: DataViewBlueprint } ) => (
					<HStack
						alignment="edge"
						style={ { alignItems: 'baseline', paddingTop: '24px', paddingBottom: '10px' } }
						wrap
					>
						<Heading level={ 3 } className="text-[13px] text-a8c-gray-800" weight={ 500 }>
							{ item.title }
						</Heading>
						<StudioButton
							variant="link"
							className="!p-0 text-[12px] [&.is-link]:text-a8c-gray-30 [&.is-link]:hover:text-a8c-blue-50 whitespace-nowrap"
							onClick={ ( e: React.MouseEvent< HTMLButtonElement > ) =>
								handlePreviewClick( e, item )
							}
						>
							{ __( 'Preview Blueprint' ) }
							<Icon icon={ external } size={ 16 } className="ml-1" />
						</StudioButton>
					</HStack>
				),
			},
			{
				id: 'excerpt',
				label: __( 'Description' ),
				type: 'text' as const,
				render: ( { item }: { item: DataViewBlueprint } ) => (
					<div className="px-5 pb-5" onClick={ () => handleBlueprintClick( item ) }>
						<Text
							className="text-[13px] text-a8c-gray-700 h-[80px] leading-5"
							weight={ 400 }
							truncate
							numberOfLines={ 4 }
							title={ item.excerpt }
						>
							{ item.excerpt }
						</Text>
					</div>
				),
			},
		],
		[ handleBlueprintClick, handlePreviewClick, __ ]
	);

	const handleFileSelect = async ( event: React.ChangeEvent< HTMLInputElement > ) => {
		const file = event.target.files?.[ 0 ];
		setValidationError( undefined );
		setBlueprintWarnings( undefined );
		setUploadedFileName( null );

		if ( file && file.type === 'application/json' && onFileBlueprintSelect ) {
			setUploadedFileName( file.name );

			try {
				const text = await file.text();
				const blueprintJson = JSON.parse( text );

				if ( blueprintJson.version === 2 ) {
					setValidationError(
						__( 'Blueprint v2 format is not supported yet. Please use Blueprint v1 format.' )
					);
					if ( fileRef.current ) {
						fileRef.current.value = '';
					}
					return;
				}

				const validation = await getIpcApi().validateBlueprint( blueprintJson );
				if ( ! validation.valid ) {
					setValidationError( validation.error || __( 'Invalid Blueprint format' ) );
					if ( fileRef.current ) {
						fileRef.current.value = '';
					}
					return;
				}

				if ( validation.warnings && validation.warnings.length > 0 ) {
					setBlueprintWarnings( validation.warnings );
				}

				const fileBlueprint: Blueprint = {
					slug: `file:${ file.name }`, // Use filename as part of the slug
					title: blueprintJson.meta?.title || file.name.replace( '.json', '' ),
					excerpt: blueprintJson.meta?.description || __( 'Blueprint loaded from file' ),
					image: '', // No image for file-based blueprints
					playground_url: '', // No playground URL for file-based blueprints
					blueprint: blueprintJson, // The actual blueprint JSON
				};

				setUploadedFileName( null );
				onFileBlueprintSelect( fileBlueprint );
			} catch ( error ) {
				if ( error instanceof SyntaxError ) {
					setValidationError(
						sprintf(
							// translators: %s is error message of the JSON parsing error
							__( 'Invalid JSON format: %s' ),
							error.message
						)
					);
				} else {
					setValidationError( __( 'Failed to load Blueprint file. Please try again.' ) );
				}
				console.error( 'Failed to parse blueprint file:', error );
			}
		}
		if ( fileRef.current ) {
			fileRef.current.value = '';
		}
	};

	const paginationInfo = useMemo(
		() => ( {
			totalItems: blueprints.length,
			totalPages: Math.ceil( blueprints.length / ( view.perPage || 9 ) ),
		} ),
		[ blueprints.length, view.perPage ]
	);

	const dataViewBlueprints = useMemo(
		() =>
			blueprints.map( ( blueprint ) => ( {
				...blueprint,
				isSelected: blueprint.slug === selectedBlueprint,
				categories: blueprint.blueprint.meta?.categories || [],
			} ) ),
		[ blueprints, selectedBlueprint ]
	);

	if ( isLoading ) {
		return (
			<VStack className="w-full max-w-6xl mx-auto">
				<Heading className="text-center text-[32px] text-gray-900 mb-[28px]" weight={ 500 }>
					{ __( 'Start from a Blueprint' ) }
				</Heading>
				<Text>{ __( 'Loading Blueprints...' ) }</Text>
			</VStack>
		);
	}

	return (
		<VStack className="w-full max-w-4xl mx-auto px-0.5" spacing={ 0 }>
			<Heading className="text-center text-[32px] text-gray-900 mb-5" weight={ 500 }>
				{ __( 'Start from a Blueprint' ) }
			</Heading>

			{ validationError && (
				<Notice
					status="error"
					isDismissible={ false }
					onRemove={ () => setValidationError( undefined ) }
					className="mx-0 mb-4"
				>
					<strong>{ __( 'Blueprint validation failed' ) }</strong>
					<br />
					{ validationError }
				</Notice>
			) }

			{ ! validationError && (
				<BlueprintWarningNotice
					warnings={ blueprintWarnings }
					fileName={ selectedFileName || '' }
					className="mx-0 mb-4"
				/>
			) }

			<HStack alignment="edge" className="w-full mb-5 ">
				<HStack alignment="left" className="flex-1">
					<Text className="text-[16px]" weight={ 500 }>
						{ __( 'Featured Blueprints' ) }
					</Text>
				</HStack>
				{ selectedFileName ? (
					<HStack className="flex-1 items-center justify-end gap-1">
						<Text
							className="text-sm font-medium text-gray-900 truncate max-w-48"
							title={ selectedFileName }
						>
							{ selectedFileName }
						</Text>
						<Button variant="tertiary" size="small" onClick={ handleRemoveFile } isDestructive>
							{ __( 'Remove' ) }
						</Button>
					</HStack>
				) : (
					<label className="flex-shrink-0">
						<input
							ref={ fileRef }
							type="file"
							accept=".json,application/json"
							onChange={ handleFileSelect }
							className="hidden"
						/>
						<Button
							variant="secondary"
							className="flex-shrink-0 cursor-pointer"
							onClick={ () => {
								fileRef.current?.click();
							} }
							icon={ upload }
						>
							{ __( 'Choose Blueprint file' ) }
						</Button>
					</label>
				) }
			</HStack>

			<div className="blueprints-container w-full pb-1">
				{ isFetchingBlueprints && (
					<Text className="text-[14px] block text-center py-[100px]">
						{ __( 'Loading Blueprints...' ) }
					</Text>
				) }
				{ errorMessage && ! isFetchingBlueprints && (
					<Text className="text-[14px] block text-center py-[100px]">
						{ createInterpolateElement(
							__(
								'Studio could not load Blueprints. <button>Try again</button> or use your own Blueprint.'
							),
							{
								button: <Button variant="link" onClick={ refetchBlueprints } />,
							}
						) }
					</Text>
				) }

				<DataViews
					data={ dataViewBlueprints }
					fields={ fields }
					view={ view }
					onChangeView={ setView }
					defaultLayouts={ {
						grid: {},
					} }
					paginationInfo={ paginationInfo }
					getItemId={ ( item: DataViewBlueprint ) => item.slug }
					selection={ selectedBlueprint ? [ selectedBlueprint ] : [] }
					onClickItem={ handleBlueprintClick }
					isItemClickable={ () => true }
				>
					<DataViews.Layout />
				</DataViews>
			</div>
		</VStack>
	);
}
