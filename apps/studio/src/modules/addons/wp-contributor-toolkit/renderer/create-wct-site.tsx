/**
 * Add Site flow form for the WordPress Contributor Toolkit addon.
 */
import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from 'src/components/button';
import TextControlComponent from 'src/components/text-control';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useContributorContext } from './contributor-context';
import type { AddonAddSiteFlowProps } from 'src/modules/addons/addon-api';

export function CreateWctSite( { onSubmit, onValidityChange, submitRef }: AddonAddSiteFlowProps ) {
	const { addSite, clone, chooseRepoFolder, sites } = useContributorContext();

	const [ name, setName ] = useState( '' );
	const [ repoSource, setRepoSource ] = useState< 'existing' | 'clone' >( 'existing' );
	const [ repoPath, setRepoPath ] = useState< string | null >( null );
	const [ isSubmitting, setIsSubmitting ] = useState( false );
	const [ submitError, setSubmitError ] = useState< string | null >( null );

	const duplicatePath = useMemo( () => {
		if ( ! repoPath ) {
			return null;
		}
		return sites.find( ( s ) => s.repoPath === repoPath ) ?? null;
	}, [ repoPath, sites ] );

	const isValid = name.trim() !== '' && repoPath !== null && duplicatePath === null;

	useEffect( () => {
		onValidityChange( isValid );
	}, [ isValid, onValidityChange ] );

	const handleChooseExisting = useCallback( async () => {
		const path = await chooseRepoFolder();
		if ( path ) {
			setRepoPath( path );
		}
	}, [ chooseRepoFolder ] );

	const handleChooseCloneDestination = useCallback( async () => {
		const result = await getIpcApi().showOpenFolderDialog(
			__( 'Choose destination folder for wordpress-develop clone' ),
			''
		);
		if ( result?.path ) {
			setRepoPath( `${ result.path }/wordpress-develop` );
		}
	}, [] );

	const handleSubmit = useCallback( async () => {
		if ( isSubmitting || ! isValid || ! repoPath ) {
			return;
		}
		setIsSubmitting( true );
		setSubmitError( null );
		try {
			const site = await addSite( name.trim(), repoPath );
			if ( ! site ) {
				setSubmitError( __( 'Failed to add site.' ) );
				return;
			}
			if ( repoSource === 'clone' ) {
				// Start clone in background — progress shown in Build panel after modal closes
				void clone( site.id, repoPath );
			}
			onSubmit();
		} catch ( err ) {
			setSubmitError( err instanceof Error ? err.message : String( err ) );
		} finally {
			setIsSubmitting( false );
		}
	}, [ isSubmitting, isValid, repoPath, name, repoSource, addSite, clone, onSubmit ] );

	// Register submit function with parent stepper via submitRef
	const submitRefCurrent = useRef( handleSubmit );
	submitRefCurrent.current = handleSubmit;

	useEffect( () => {
		if ( submitRef ) {
			submitRef.current = () => void submitRefCurrent.current();
		}
		return () => {
			if ( submitRef ) {
				submitRef.current = null;
			}
		};
	}, [ submitRef ] );

	return (
		<div className="w-full max-w-md mx-auto flex flex-col gap-6 text-gray-900">
			<div className="text-center">
				<h2 className="text-2xl font-medium text-gray-900">{ __( 'Add WP Contribution Site' ) }</h2>
				<p className="text-[13px] text-a8c-gray-50 mt-1">
					{ __(
						'Connect a wordpress-develop checkout to build and contribute to WordPress core.'
					) }
				</p>
			</div>

			<label className="flex flex-col gap-1.5 leading-4">
				<span className="font-semibold">{ __( 'Site name' ) }</span>
				<TextControlComponent
					value={ name }
					onChange={ setName }
					placeholder={ __( 'e.g. trunk' ) }
				/>
				<span className="text-a8c-gray-50 text-xs">
					{ __( 'A label for this checkout, shown in the sidebar.' ) }
				</span>
			</label>

			<div className="flex flex-col gap-3">
				<span className="font-semibold">{ __( 'Repository source' ) }</span>

				<label className="flex items-start gap-3 cursor-pointer border border-gray-200 rounded-lg p-4">
					<input
						type="radio"
						name="repoSource"
						value="existing"
						checked={ repoSource === 'existing' }
						onChange={ () => {
							setRepoSource( 'existing' );
							setRepoPath( null );
						} }
						className="mt-0.5"
					/>
					<div className="flex-1 min-w-0">
						<div className="font-medium text-sm">{ __( 'Use existing checkout' ) }</div>
						<div className="text-xs text-gray-500 mt-0.5">
							{ __( 'Point to a wordpress-develop directory already on your machine.' ) }
						</div>
						{ repoSource === 'existing' && (
							<div className="mt-3 flex items-center gap-2 flex-wrap">
								<Button
									variant="secondary"
									onClick={ () => {
										void handleChooseExisting();
									} }
								>
									{ __( 'Choose Folder' ) }
								</Button>
								{ repoPath && (
									<span
										className={ `text-xs truncate ${
											duplicatePath ? 'text-red-600' : 'text-gray-600'
										}` }
									>
										{ repoPath }
									</span>
								) }
							</div>
						) }
					</div>
				</label>

				<label className="flex items-start gap-3 cursor-pointer border border-gray-200 rounded-lg p-4">
					<input
						type="radio"
						name="repoSource"
						value="clone"
						checked={ repoSource === 'clone' }
						onChange={ () => {
							setRepoSource( 'clone' );
							setRepoPath( null );
						} }
						className="mt-0.5"
					/>
					<div className="flex-1 min-w-0">
						<div className="font-medium text-sm">{ __( 'Clone from GitHub' ) }</div>
						<div className="text-xs text-gray-500 mt-0.5">
							{ __( 'Download wordpress/wordpress-develop (~500 MB, shallow clone).' ) }
						</div>
						{ repoSource === 'clone' && (
							<div className="mt-3 flex items-center gap-2 flex-wrap">
								<Button
									variant="secondary"
									onClick={ () => {
										void handleChooseCloneDestination();
									} }
								>
									{ __( 'Choose Destination' ) }
								</Button>
								{ repoPath && (
									<span
										className={ `text-xs truncate ${
											duplicatePath ? 'text-red-600' : 'text-gray-600'
										}` }
									>
										{ repoPath }
									</span>
								) }
							</div>
						) }
					</div>
				</label>
			</div>

			{ duplicatePath && (
				<div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
					{ sprintf(
						/* translators: %s: site name */
						__( 'This directory is already used by "%s". Choose a different folder.' ),
						duplicatePath.name
					) }
				</div>
			) }

			{ submitError && (
				<div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
					{ submitError }
				</div>
			) }

			{ /* Hidden submit for keyboard accessibility */ }
			<button
				type="submit"
				className="sr-only"
				onClick={ () => {
					void handleSubmit();
				} }
				disabled={ isSubmitting || ! isValid }
				aria-hidden
			/>
		</div>
	);
}
