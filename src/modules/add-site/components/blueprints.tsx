import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
	Button,
	Notice,
} from '@wordpress/components';
import { DataViews, View } from '@wordpress/dataviews';
import { createInterpolateElement } from '@wordpress/element';
import { sprintf } from '@wordpress/i18n';
import { Icon, external, upload } from '@wordpress/icons';
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
							{ __( 'Preview blueprint' ) }
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
		<VStack className="w-full max-w-4xl mx-auto px-0.5" spacing={ 0 }>
			<Heading className="text-center text-[32px] text-gray-900 mb-5" weight={ 500 }>
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

			<HStack alignment="edge" className="w-full mb-5 ">
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
							icon={ upload }
						>
							{ __( 'Choose blueprint file' ) }
						</Button>
					</label>
				) }
			</HStack>

			<div className="blueprints-container w-full pb-1">
				{ isFetchingBlueprints && (
					<Text className="text-[14px] block text-center py-[100px]">
						{ __( 'Loading blueprints...' ) }
					</Text>
				) }
				{ errorMessage && ! isFetchingBlueprints && (
					<Text className="text-[14px] block text-center py-[100px]">
						{ createInterpolateElement(
							__(
								'Studio could not load blueprints. <button>Try again</button> or use your own blueprint.'
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
