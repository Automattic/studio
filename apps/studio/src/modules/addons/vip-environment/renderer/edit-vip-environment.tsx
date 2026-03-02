import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useState } from 'react';
import Button from 'src/components/button';
import Modal from 'src/components/modal';
import { cx } from 'src/lib/cx';
import { useVipContext } from './vip-context';
import { getVipIpcApi } from './vip-ipc';
import type { VipEnvironment } from '../types';

const PHP_VERSIONS = [
	{ label: 'PHP 8.2', value: '8.2' },
	{ label: 'PHP 8.3', value: '8.3' },
	{ label: 'PHP 8.4', value: '8.4' },
];

const WP_VERSIONS = [
	{ label: 'Latest', value: 'latest' },
	{ label: '6.7', value: '6.7' },
	{ label: '6.6', value: '6.6' },
	{ label: '6.5', value: '6.5' },
	{ label: '6.4', value: '6.4' },
];

interface EditVipEnvironmentProps {
	environment: VipEnvironment;
}

export function EditVipEnvironment( { environment }: EditVipEnvironmentProps ) {
	const { __ } = useI18n();
	const { refresh } = useVipContext();
	const [ isOpen, setIsOpen ] = useState( false );
	const [ isUpdating, setIsUpdating ] = useState( false );
	const [ error, setError ] = useState< string | null >( null );

	const [ phpVersion, setPhpVersion ] = useState( environment.phpVersion || '8.2' );
	const [ wordpressVersion, setWordpressVersion ] = useState(
		environment.wordpressVersion || 'latest'
	);
	const [ elasticsearch, setElasticsearch ] = useState( environment.elasticsearch );
	const [ phpmyadmin, setPhpmyadmin ] = useState( environment.phpmyadmin );
	const [ xdebug, setXdebug ] = useState( environment.xdebug );
	const [ mailpit, setMailpit ] = useState( environment.mailpit );

	const hasChanges =
		phpVersion !== environment.phpVersion ||
		wordpressVersion !== environment.wordpressVersion ||
		elasticsearch !== environment.elasticsearch ||
		phpmyadmin !== environment.phpmyadmin ||
		xdebug !== environment.xdebug ||
		mailpit !== environment.mailpit;

	const resetForm = useCallback( () => {
		setPhpVersion( environment.phpVersion || '8.2' );
		setWordpressVersion( environment.wordpressVersion || 'latest' );
		setElasticsearch( environment.elasticsearch );
		setPhpmyadmin( environment.phpmyadmin );
		setXdebug( environment.xdebug );
		setMailpit( environment.mailpit );
		setError( null );
	}, [ environment ] );

	const openModal = () => {
		resetForm();
		setIsOpen( true );
	};

	const closeModal = useCallback( () => {
		if ( isUpdating ) return;
		setIsOpen( false );
	}, [ isUpdating ] );

	const handleSubmit = async ( event: FormEvent ) => {
		event.preventDefault();
		setIsUpdating( true );
		setError( null );

		try {
			const args = [ 'dev-env', 'update', `--slug=${ environment.slug }` ];

			if ( phpVersion !== environment.phpVersion ) args.push( `--php=${ phpVersion }` );
			if ( wordpressVersion !== environment.wordpressVersion )
				args.push( `--wordpress=${ wordpressVersion }` );
			if ( elasticsearch !== environment.elasticsearch )
				args.push( `--elasticsearch=${ elasticsearch ? 'y' : 'n' }` );
			if ( phpmyadmin !== environment.phpmyadmin )
				args.push( `--phpmyadmin=${ phpmyadmin ? 'y' : 'n' }` );
			if ( xdebug !== environment.xdebug ) args.push( `--xdebug=${ xdebug ? 'y' : 'n' }` );
			if ( mailpit !== environment.mailpit ) args.push( `--mailpit=${ mailpit ? 'y' : 'n' }` );
			args.push( '--yes' );

			const result = await getVipIpcApi().vipExecuteVipCliCommand( args );

			if ( result.success ) {
				await refresh();
				closeModal();
			} else {
				setError( result.stderr || __( 'Failed to update environment settings.' ) );
			}
		} catch ( err ) {
			setError( err instanceof Error ? err.message : __( 'An unexpected error occurred.' ) );
		} finally {
			setIsUpdating( false );
		}
	};

	return (
		<>
			<Button variant="secondary" onClick={ openModal } label={ __( 'Edit site' ) }>
				{ __( 'Edit site' ) }
			</Button>

			{ isOpen && (
				<Modal
					size="medium"
					title={ __( 'Edit site' ) }
					isDismissible
					focusOnMount="firstContentElement"
					onRequestClose={ closeModal }
					className={ cx(
						isUpdating &&
							'[&_[aria-label="Close"]_svg]:opacity-50 [&_[aria-label="Close"]]:cursor-not-allowed'
					) }
				>
					<form
						onSubmit={ ( e ) => {
							void handleSubmit( e );
						} }
					>
						<div className="flex flex-col gap-6">
							{ error && (
								<div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
									{ error }
								</div>
							) }

							<div className="flex flex-row gap-x-6">
								<label
									htmlFor="vip-php-version-select"
									className="flex flex-1 flex-col gap-1.5 leading-4"
								>
									<span className="font-semibold">{ __( 'PHP version' ) }</span>
									<SelectControl< string >
										id="vip-php-version-select"
										disabled={ isUpdating }
										value={ phpVersion }
										options={ PHP_VERSIONS }
										onChange={ setPhpVersion }
										__next40pxDefaultSize
										__nextHasNoMarginBottom
									/>
								</label>

								<label
									htmlFor="vip-wp-version-select"
									className="flex flex-1 flex-col gap-1.5 leading-4"
								>
									<span className="font-semibold">{ __( 'WordPress version' ) }</span>
									<SelectControl< string >
										id="vip-wp-version-select"
										disabled={ isUpdating }
										value={ wordpressVersion }
										options={ WP_VERSIONS }
										onChange={ setWordpressVersion }
										__next40pxDefaultSize
										__nextHasNoMarginBottom
									/>
								</label>
							</div>

							<fieldset className="flex flex-col gap-3">
								<legend className="font-semibold mb-2">{ __( 'Services' ) }</legend>

								<label className="flex items-center gap-2">
									<input
										type="checkbox"
										checked={ elasticsearch }
										onChange={ ( e ) => setElasticsearch( e.target.checked ) }
										disabled={ isUpdating }
									/>
									<span>{ __( 'Elasticsearch' ) }</span>
									<span className="text-a8c-gray-50 text-sm">{ __( '(Enterprise Search)' ) }</span>
								</label>

								<label className="flex items-center gap-2">
									<input
										type="checkbox"
										checked={ phpmyadmin }
										onChange={ ( e ) => setPhpmyadmin( e.target.checked ) }
										disabled={ isUpdating }
									/>
									<span>{ __( 'phpMyAdmin' ) }</span>
									<span className="text-a8c-gray-50 text-sm">
										{ __( '(Database management)' ) }
									</span>
								</label>

								<label className="flex items-center gap-2">
									<input
										type="checkbox"
										checked={ xdebug }
										onChange={ ( e ) => setXdebug( e.target.checked ) }
										disabled={ isUpdating }
									/>
									<span>{ __( 'Xdebug' ) }</span>
									<span className="text-a8c-gray-50 text-sm">{ __( '(PHP debugging)' ) }</span>
								</label>

								<label className="flex items-center gap-2">
									<input
										type="checkbox"
										checked={ mailpit }
										onChange={ ( e ) => setMailpit( e.target.checked ) }
										disabled={ isUpdating }
									/>
									<span>{ __( 'Mailpit' ) }</span>
									<span className="text-a8c-gray-50 text-sm">{ __( '(Email capture)' ) }</span>
								</label>
							</fieldset>

							<div className="text-sm text-a8c-gray-50">
								{ __(
									'Changes to these settings require restarting the environment to take effect.'
								) }
							</div>
						</div>

						<div className="flex flex-row justify-end gap-x-5 mt-8">
							<Button onClick={ closeModal } disabled={ isUpdating } variant="tertiary">
								{ __( 'Cancel' ) }
							</Button>
							<Button
								type="submit"
								variant="primary"
								isBusy={ isUpdating }
								disabled={ isUpdating || ! hasChanges }
							>
								{ isUpdating ? __( 'Saving…' ) : __( 'Save' ) }
							</Button>
						</div>
					</form>
				</Modal>
			) }
		</>
	);
}
