import { generateDefaultBlueprintDescription } from '@studio/common/lib/blueprint-settings';
import { BlueprintValidationWarning } from '@studio/common/lib/blueprint-validation';
import { Button as WpButton } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useRef } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';

interface Blueprint {
	slug: string;
	title: string;
	excerpt: string;
	image: string;
	playground_url: string;
	blueprint: {
		meta?: { categories?: string[]; [ key: string ]: unknown };
		[ key: string ]: unknown;
	};
	filePath?: string;
}

interface UploadBlueprintButtonProps {
	onFileBlueprintSelect: ( blueprint: Blueprint, warnings?: BlueprintValidationWarning[] ) => void;
	onError: ( error: string | undefined ) => void;
}

export function UploadBlueprintButton( {
	onFileBlueprintSelect,
	onError,
}: UploadBlueprintButtonProps ) {
	const { __ } = useI18n();
	const fileRef = useRef< HTMLInputElement | null >( null );

	const handleFileSelect = async ( event: React.ChangeEvent< HTMLInputElement > ) => {
		const file = event.target.files?.[ 0 ];
		onError( undefined );

		if ( file && file.type === 'application/json' ) {
			try {
				const text = await file.text();
				const blueprintJson = JSON.parse( text );

				if ( blueprintJson.version === 2 ) {
					onError( __( 'Blueprint v2 format is not supported yet. Please use v1.' ) );
					return;
				}

				const validation = await getIpcApi().validateBlueprint( blueprintJson );
				if ( ! validation.valid ) {
					onError( validation.error || __( 'Invalid Blueprint format' ) );
					return;
				}

				const fileBlueprint: Blueprint = {
					slug: `file:${ file.name }`,
					title: blueprintJson.meta?.title || file.name.replace( '.json', '' ),
					excerpt:
						blueprintJson.meta?.description || generateDefaultBlueprintDescription( blueprintJson ),
					image: '',
					playground_url: '',
					blueprint: blueprintJson,
					filePath: getIpcApi().getPathForFile( file ),
				};

				onFileBlueprintSelect(
					fileBlueprint,
					validation.warnings?.length ? validation.warnings : undefined
				);
			} catch ( error ) {
				if ( error instanceof SyntaxError ) {
					onError( sprintf( __( 'Invalid JSON: %s' ), error.message ) );
				} else {
					onError( __( 'Failed to load Blueprint file.' ) );
				}
			}
		}
		if ( fileRef.current ) {
			fileRef.current.value = '';
		}
	};

	return (
		<label>
			<input
				ref={ fileRef }
				type="file"
				accept=".json,application/json"
				onChange={ handleFileSelect }
				className="hidden"
			/>
			<WpButton
				variant="tertiary"
				className="cursor-pointer"
				onClick={ () => fileRef.current?.click() }
			>
				{ __( 'Upload a blueprint' ) }
			</WpButton>
		</label>
	);
}
