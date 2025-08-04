import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
	Tooltip,
	Button,
	Card,
	CardBody,
	CardHeader,
	CardFooter,
	CardMedia,
} from '@wordpress/components';
import { Icon, info, external } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useRef } from 'react';
import StudioButton from 'src/components/button';
import { getIpcApi } from 'src/lib/get-ipc-api';

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

interface AddSiteBlueprintProps {
	onSelectBlueprint: ( blueprintId: string ) => void;
	blueprints: Blueprint[];
	isLoading: boolean;
}

function BlueprintCard( { blueprint, onSelect }: { blueprint: Blueprint; onSelect: () => void } ) {
	const { __ } = useI18n();

	const handlePlaygroundLink = ( e: React.MouseEvent ) => {
		e.stopPropagation();
		getIpcApi().openURL( blueprint.playground_url );
	};

	return (
		<Card isBorderless onClick={ onSelect } size="xSmall" className="cursor-pointer">
			<CardMedia>
				<img src={ blueprint.image } alt={ blueprint.title } className="object-contain" />
			</CardMedia>

			<CardHeader className="px-0">
				<Heading level={ 3 } className="text-xl" weight={ 500 }>
					{ blueprint.title }
				</Heading>
			</CardHeader>

			<CardBody className="px-0">
				<HStack spacing={ 3 } wrap alignment="left">
					{ ( blueprint.blueprint.meta?.categories || [] )
						.filter( ( category ) => category !== 'Studio' )
						.map( ( category ) => (
							<Text
								as="span"
								key={ category }
								className="px-2.5 py-1 text-xs bg-gray-100 text-gray-700 rounded-sm flex items-center"
							>
								{ category }
							</Text>
						) ) }
				</HStack>
			</CardBody>
			<CardBody className="px-0 h-20">
				<Text
					className="text-base text-gray-600"
					weight={ 400 }
					truncate
					numberOfLines={ 3 }
					title={ blueprint.excerpt }
				>
					{ blueprint.excerpt }
				</Text>
			</CardBody>

			<CardFooter className="px-0">
				<StudioButton variant="link" size="small" className="!p-0" onClick={ handlePlaygroundLink }>
					{ __( 'Preview blueprint' ) }
					<Icon icon={ external } size={ 16 } className="ml-1" />
				</StudioButton>
			</CardFooter>
		</Card>
	);
}

export default function AddSiteBlueprint( {
	onSelectBlueprint,
	blueprints,
	isLoading,
}: AddSiteBlueprintProps ) {
	const { __ } = useI18n();
	const fileRef = useRef< HTMLInputElement | null >( null );

	const handleFileSelect = ( event: React.ChangeEvent< HTMLInputElement > ) => {
		const file = event.target.files?.[ 0 ];
		if ( file && file.type === 'application/json' ) {
			// TODO: Handle JSON file upload
			console.log( 'Selected JSON file:', file.name );
		}
	};

	if ( isLoading ) {
		return (
			<VStack className="w-full max-w-6xl mx-auto" spacing={ 6 }>
				<Heading className="text-center text-4xl">{ __( 'Start from a blueprint' ) }</Heading>
				<Text>{ __( 'Loading blueprints...' ) }</Text>
			</VStack>
		);
	}

	return (
		<VStack className="w-full max-w-6xl mx-auto" spacing={ 6 }>
			<Heading className="text-center text-4xl">{ __( 'Start from a blueprint' ) }</Heading>

			<HStack spacing={ 2 } alignment="edge" className="w-full pr-1">
				<HStack alignment="left" className="flex-1">
					<Text className="text-xl" weight={ 500 }>
						{ __( 'Suggested blueprints' ) }
					</Text>
					<Tooltip
						text={ __(
							'Blueprints are pre-configured WordPress sites with themes, plugins, and content ready to use.'
						) }
						placement="top-start"
					>
						<Icon icon={ info } size={ 20 } className="fill-[#3858E9]" />
					</Tooltip>
				</HStack>
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
			</HStack>

			<div className="grid grid-cols-3 gap-6 items-stretch">
				{ blueprints.map( ( blueprint ) => (
					<div key={ blueprint.slug } className="h-full">
						<BlueprintCard
							blueprint={ blueprint }
							onSelect={ () => onSelectBlueprint( blueprint.slug ) }
						/>
					</div>
				) ) }
			</div>
		</VStack>
	);
}
