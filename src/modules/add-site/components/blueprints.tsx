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
import { sprintf } from '@wordpress/i18n';
import { Icon, external } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useRef, useState, useMemo } from 'react';
import StudioButton from 'src/components/button';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useOverflowItems } from '../hooks/use-overflow-items';

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

function CategoryBadges( { categories }: { categories: string[] } ) {
	const { __ } = useI18n();
	const containerRef = useRef< HTMLDivElement >( null );
	const { visible, hidden, hiddenCount, itemRefs } = useOverflowItems( categories, containerRef );

	return (
		<HStack ref={ containerRef } spacing={ 3 } alignment="left" className="w-full">
			{ categories.map( ( category, index ) => (
				<Text
					as="span"
					key={ category }
					ref={ ( el ) => {
						itemRefs.current[ index ] = el;
					} }
					className="px-2.5 py-1 text-xs bg-gray-100 text-gray-700 rounded-sm flex items-center flex-shrink-0 max-w-32 truncate"
					style={ {
						visibility: index < visible.length ? 'visible' : 'hidden',
						position: index >= visible.length ? 'absolute' : 'static',
					} }
				>
					{ category }
				</Text>
			) ) }
			{ hiddenCount > 0 && (
				<Tooltip
					text={ hidden.join( ', ' ) }
					delay={ 200 }
					placement="top-end"
					className="max-w-xs"
				>
					<Text
						as="span"
						className="px-2.5 py-1 text-xs bg-gray-100 text-gray-700 rounded-sm flex items-center font-medium whitespace-nowrap flex-shrink-0"
					>
						{ /* translators: %d: Number of hidden categories */ }
						{ sprintf( __( '+%d more' ), hiddenCount ) }
					</Text>
				</Tooltip>
			) }
		</HStack>
	);
}

export default function AddSiteBlueprint( {
	blueprints,
	errorMessage,
	isLoading,
	selectedBlueprint,
	onBlueprintChange,
	onFileBlueprintSelect,
}: AddSiteBlueprintProps ) {
	const { __ } = useI18n();
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
							'[@media(min-height:680px)]:h-48',
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
					return <CategoryBadges categories={ categories } />;
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

			<div className="w-full px-3 [&_.dataviews-view-grid]:!grid [&_.dataviews-view-grid]:!grid-cols-3 [&_.dataviews-view-grid]:!gap-4 [&_.dataviews-view-grid]:!items-start [&_.components-badge]:!bg-transparent [&_.components-badge]:!p-0 [&_.components-badge]:!w-full [&_.components-badge_.components-badge__content]:!w-full [&_.components-badge>*]:!w-full">
				{ errorMessage && (
					<Text className="text-red-500 text-[14px] block text-center py-[100px]">
						{ sprintf( __( 'Error loading featured blueprints: %s' ), errorMessage ) }
						<br />
						{ __( 'You can use your own blueprint by uploading a file.' ) }
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
