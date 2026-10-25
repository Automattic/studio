import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useId } from 'react';
import { useConnector } from '@/data/core';
import { usePathValidator } from '@/data/queries/use-create-site-helpers';
import { useSites } from '@/data/queries/use-sites';
import { LearnMoreLink } from '@/features/onboarding';
import { Button, Field, FieldDescription, FieldLabel, Input } from '@/lib/ui';
import styles from './style.module.css';
import type { FormData } from './form-data';

// On the desktop the path comes from the name→path auto-gen or the native
// folder dialog, never typed. In the browser (`studio ui`) there's no native
// picker, so it is edited as text, still prefilled from the site name.
export function PathField( {
	data: item,
	error,
	requiresEmptyPath,
	onChange,
}: {
	data: FormData;
	error: string;
	requiresEmptyPath?: boolean;
	onChange: ( update: Partial< FormData > ) => void;
} ) {
	const id = useId();
	const connector = useConnector();
	const { data: sites } = useSites();
	const { selectPath } = usePathValidator( sites );
	const isNative = connector.capabilities.nativeFolderPicker;

	const handleSelect = useCallback( async () => {
		const result = await selectPath( item.hasCustomPath ? item.path : '' );
		if ( ! result ) return;
		onChange( {
			path: result.path,
			hasCustomPath: true,
			pathError: result.error ?? '',
			isWordPress: result.isWordPress,
			...( ! item.name && result.name ? { name: result.name } : {} ),
		} );
	}, [ item.hasCustomPath, item.name, item.path, onChange, selectPath ] );

	const help =
		item.path && item.isWordPress && ! requiresEmptyPath ? (
			__( 'The existing WordPress site at this path will be added.' )
		) : (
			<>
				{ requiresEmptyPath
					? __( 'Select an empty directory.' )
					: __(
							'Select an empty directory or a directory with an existing WordPress site.'
					  ) }{ ' ' }
				<LearnMoreLink docsLinksKey="docsSites" />
			</>
		);

	return (
		<Field>
			<FieldLabel htmlFor={ id }>{ __( 'Local path' ) }</FieldLabel>
			<div className={ styles.pathRow }>
				<Input
					id={ id }
					value={ item.path }
					readOnly={ isNative }
					placeholder={ isNative ? __( 'Choose a folder…' ) : undefined }
					aria-invalid={ error ? true : undefined }
					aria-describedby={ `${ id }-description` }
					onChange={ ( event ) =>
						onChange( {
							path: event.target.value,
							hasCustomPath: true,
							pathError: '',
							isWordPress: false,
						} )
					}
				/>
				{ isNative && (
					<Button
						variant="outline"
						onClick={ handleSelect }
						aria-label={
							item.path
								? sprintf(
										// translators: %s is the currently selected folder path.
										__( '%s, select a different folder' ),
										item.path
								  )
								: __( 'Select a folder' )
						}
					>
						{ __( 'Choose…' ) }
					</Button>
				) }
			</div>
			<FieldDescription id={ `${ id }-description` } error={ error }>
				{ help }
			</FieldDescription>
		</Field>
	);
}
