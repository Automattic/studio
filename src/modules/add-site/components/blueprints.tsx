import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
	Button,
	Notice,
	Tooltip,
} from '@wordpress/components';
import { DataViews, View } from '@wordpress/dataviews';
import { createInterpolateElement } from '@wordpress/element';
import { sprintf } from '@wordpress/i18n';
import { Icon, external } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useRef, useState, useMemo } from 'react';
import StudioButton from 'src/components/button';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useGetBlueprints } from 'src/stores/wpcom-api';

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

interface AddSiteBlueprintProps {
	blueprints: Blueprint[];
	errorMessage?: string;
	isLoading: boolean;
	selectedBlueprint: string | null;
	onBlueprintChange: ( blueprintId: string ) => void;
	onFileBlueprintSelect?: ( blueprint: Blueprint ) => void;
}

const MAX_BLUEPRINTS_CATEGORIES = 3;

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
	const [ validationError, setValidationError ] = useState< string | null >( null );

	// Check if current selection is a file-based blueprint
	const isFileBasedSelection = selectedBlueprint && selectedBlueprint.startsWith( 'file:' );
	const selectedFileName = isFileBasedSelection ? selectedBlueprint.replace( 'file:', '' ) : null;

	const handleRemoveFile = useCallback( () => {
		onBlueprintChange( '' );
		setValidationError( null );
		if ( fileRef.current ) {
			fileRef.current.value = '';
		}
	}, [ onBlueprintChange ] );

	const handleBlueprintClick = useCallback(
		( item: DataViewBlueprint ) => {
			setValidationError( null );
			onBlueprintChange( item.slug );
		},
		[ onBlueprintChange ]
	);

	const [ view, setView ] = useState< View >( {
		type: 'grid',
		perPage: 9,
		page: 1,
		fields: [ 'categories', 'excerpt', 'preview' ],
		mediaField: 'image',
		titleField: 'title',
		search: '',
		filters: [],
		layout: {
			badgeFields: [ 'categories', 'excerpt', 'preview' ],
		},
	} );

	const fields = useMemo(
		() => [
			{
				id: 'image',
				label: __( 'Thumbnail' ),
				type: 'media' as const,
				render: ( { item }: { item: DataViewBlueprint } ) => (
					<img
						src={ item.image }
						alt={ item.title }
						className={ cx(
							'w-full h-32 object-cover object-top cursor-pointer transition-all duration-150 rounded-lg group',
							'hover:shadow-md hover:outline hover:outline-2 hover:outline-blue-500',
							'transition-transform duration-150',
							'hover:scale-105',
							item.isSelected && 'outline outline-2 outline-blue-500 shadow-md scale-105'
						) }
					/>
				),
			},
			{
				id: 'title',
				label: __( 'Title' ),
				type: 'text' as const,
				render: ( { item }: { item: DataViewBlueprint } ) => (
					<Heading level={ 3 } className="text-[13px] mt-3 mb-2 text-gray-800" weight={ 500 }>
						{ item.title }
					</Heading>
				),
			},
			{
				id: 'excerpt',
				label: __( 'Description' ),
				type: 'text' as const,
				render: ( { item }: { item: DataViewBlueprint } ) => (
					<Text
						className="text-[13px] text-gray-600 h-[54px]"
						weight={ 400 }
						truncate
						numberOfLines={ 3 }
						title={ item.excerpt }
					>
						{ item.excerpt }
					</Text>
				),
			},
			{
				id: 'categories',
				label: __( 'Categories' ),
				type: 'array' as const,
				elements: blueprints
					.flatMap( ( blueprint ) => blueprint.blueprint.meta?.categories || [] )
					.filter( ( category, index, arr ) => arr.indexOf( category ) === index )
					.map( ( category ) => ( { label: category, value: category } ) ),
				render: ( { item }: { item: DataViewBlueprint } ) => {
					const categories = ( item.blueprint.meta?.categories || [] ).filter(
						( category ) => category !== 'Studio'
					);
					const visibleCategories = categories.slice( 0, MAX_BLUEPRINTS_CATEGORIES );
					const remainingCount = categories.length - MAX_BLUEPRINTS_CATEGORIES;

					return (
						<HStack spacing={ 3 } wrap alignment="left">
							{ visibleCategories.map( ( category ) => (
								<Text
									as="span"
									key={ category }
									className="px-2.5 py-1 text-xs bg-gray-100 text-gray-700 rounded-sm flex items-center"
								>
									{ category }
								</Text>
							) ) }
							{ remainingCount > 0 && (
								<Tooltip
									text={ categories.slice( MAX_BLUEPRINTS_CATEGORIES ).join( ', ' ) }
									delay={ 200 }
									position="top right"
									className="max-w-xs"
								>
									<Text
										as="span"
										className="px-2.5 py-1 text-xs bg-gray-100 text-gray-700 rounded-sm flex items-center font-medium"
									>
										+{ remainingCount } more
									</Text>
								</Tooltip>
							) }
						</HStack>
					);
				},
			},
			{
				id: 'preview',
				label: __( 'Preview' ),
				type: 'text' as const,
				render: ( { item }: { item: DataViewBlueprint } ) => (
					<StudioButton
						variant="link"
						className="!p-0 text-[12px]"
						onClick={ () => getIpcApi().openURL( item.playground_url ) }
					>
						{ __( 'Preview blueprint' ) }
						<Icon icon={ external } size={ 16 } className="ml-1" />
					</StudioButton>
				),
			},
		],
		[ blueprints, __ ]
	);

	const handleFileSelect = async ( event: React.ChangeEvent< HTMLInputElement > ) => {
		const file = event.target.files?.[ 0 ];
		setValidationError( null );

		if ( file && file.type === 'application/json' && onFileBlueprintSelect ) {
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

				// Create a "fake" Blueprint object from the file
				const fileBlueprint: Blueprint = {
					slug: `file:${ file.name }`, // Use filename as part of the slug
					title: blueprintJson.meta?.title || file.name.replace( '.json', '' ),
					excerpt: blueprintJson.meta?.description || __( 'Blueprint loaded from file' ),
					image: '', // No image for file-based blueprints
					playground_url: '', // No playground URL for file-based blueprints
					blueprint: blueprintJson, // The actual blueprint JSON
				};

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
					setValidationError( __( 'Failed to load blueprint file. Please try again.' ) );
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
					{ __( 'Start from a blueprint' ) }
				</Heading>
				<Text>{ __( 'Loading blueprints...' ) }</Text>
			</VStack>
		);
	}

	return (
		<VStack className="w-full max-w-6xl mx-auto" spacing={ 0 }>
			<Heading className="text-center text-[32px] text-gray-900 mb-[28px]" weight={ 500 }>
				{ __( 'Start from a blueprint' ) }
			</Heading>

			{ validationError && (
				<Notice
					status="error"
					isDismissible={ true }
					onRemove={ () => setValidationError( null ) }
					className="mx-3 mb-4"
				>
					<strong>{ __( 'Blueprint validation failed' ) }</strong>
					<br />
					{ validationError }
				</Notice>
			) }

			<HStack alignment="edge" className="w-full mb-[22px] px-3">
				<HStack alignment="left" className="flex-1">
					<Text className="text-[16px]" weight={ 500 }>
						{ __( 'Featured blueprints' ) }
					</Text>
				</HStack>
				{ selectedFileName ? (
					<HStack className="h-9 w-fit flex-shrink-0 items-center">
						<Text
							className="text-sm font-medium text-gray-900 truncate max-w-48"
							title={ selectedFileName }
						>
							{ selectedFileName }
						</Text>
						<button
							type="button"
							className="text-sm text-blue-600 hover:text-blue-700 focus:outline-none"
							onClick={ handleRemoveFile }
						>
							{ __( 'Remove' ) }
						</button>
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
						>
							{ __( 'Choose blueprint file' ) }
						</Button>
					</label>
				) }
			</HStack>

			<div className="w-full px-3 [&_.dataviews-view-grid]:!grid [&_.dataviews-view-grid]:!grid-cols-3 [&_.dataviews-view-grid]:!gap-4 [&_.dataviews-view-grid]:!items-start [&_.components-badge]:!bg-transparent [&_.components-badge]:!p-0">
				{ isFetchingBlueprints && (
					<Text className="text-[14px] block text-center py-[100px]">
						{ __( 'Loading blueprints...' ) }
					</Text>
				) }
				{ errorMessage && ! isFetchingBlueprints && (
					<Text className="text-[14px] block text-center py-[100px]">
						{ createInterpolateElement(
							__(
								'Studio could not load blueprints. <button>Try again</button> or use your own blueprint'
							),
							{
								button: <Button variant="link" className="text-xs" onClick={ refetchBlueprints } />,
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
