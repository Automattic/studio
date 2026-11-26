import {
	Button,
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	Input,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@studio/ds';
import { PlusIcon } from '@studio/ds/icons';
import { __ } from '@wordpress/i18n';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { getFormFields, type FormField } from '../connection';
import { sshHostInput, type SshHost } from './address';
import styles from './connect-form.module.css';
import { sshProvider } from './descriptor';
import type { ConnectFormProps } from '../types';

type Values = Record< string, string >;

const ADD_HOST = '\0add';

const isReady = ( fields: FormField[], values: Values ) =>
	fields.every( ( field ) =>
		values[ field.name ]?.trim() ? ! field.validate( values[ field.name ] ) : ! field.required
	);

function TextFields( {
	fields,
	values,
	disabled,
	onChange,
}: {
	fields: FormField[];
	values: Values;
	disabled: boolean;
	onChange: ( values: Values ) => void;
} ) {
	const id = useId();
	return fields.map( ( field ) => {
		const error = values[ field.name ] ? field.validate( values[ field.name ] ) : undefined;
		return (
			<Field key={ field.name }>
				<FieldLabel htmlFor={ `${ id }-${ field.name }` }>{ field.title }</FieldLabel>
				<Input
					id={ `${ id }-${ field.name }` }
					autoComplete="off"
					spellCheck={ false }
					placeholder={ field.placeholder }
					value={ values[ field.name ] ?? '' }
					disabled={ disabled }
					onChange={ ( event ) => onChange( { ...values, [ field.name ]: event.target.value } ) }
				/>
				{ ( field.description || error ) && (
					<FieldDescription error={ error }>{ field.description }</FieldDescription>
				) }
			</Field>
		);
	} );
}

function Form( {
	label,
	description,
	error,
	actions,
	onSubmit,
	children,
}: {
	label: string;
	description: string;
	error?: string;
	actions: ReactNode;
	onSubmit: () => void;
	children: ReactNode;
} ) {
	return (
		<form
			className={ styles.form }
			aria-label={ label }
			onSubmit={ ( event ) => {
				event.preventDefault();
				onSubmit();
			} }
		>
			<p>{ description }</p>
			<FieldGroup>{ children }</FieldGroup>
			<FieldError>{ error }</FieldError>
			<div className={ styles.actions }>{ actions }</div>
		</form>
	);
}

// Saves a host to the user's SSH config, once `ssh` reached it.
function AddHostForm( {
	run,
	onAdded,
	onCancel,
}: Pick< ConnectFormProps, 'run' > & {
	onAdded: ( host: SshHost ) => void;
	onCancel: () => void;
} ) {
	const fields = getFormFields( sshHostInput() );
	const [ values, setValues ] = useState< Values >( {} );
	const [ pending, setPending ] = useState( false );
	const [ error, setError ] = useState< string >();
	const ready = isReady( fields, values );
	const add = async () => {
		setPending( true );
		setError( undefined );
		try {
			onAdded( ( await run( 'addHost', values ) ) as SshHost );
		} catch ( failure ) {
			setError( ( failure as Error ).message );
			setPending( false );
		}
	};

	return (
		<Form
			label={ __( 'Add SSH host' ) }
			description={ __(
				'Studio checks the host, then saves it to your SSH config, so it works from your terminal too.'
			) }
			error={ error }
			onSubmit={ () => ready && ! pending && void add() }
			actions={
				<>
					<Button variant="outline" disabled={ pending } onClick={ onCancel }>
						{ __( 'Cancel' ) }
					</Button>
					<Button
						type="submit"
						variant="accent"
						disabled={ ! ready }
						loading={ pending }
						loadingAnnouncement={ __( 'Checking the host' ) }
					>
						{ __( 'Add SSH host' ) }
					</Button>
				</>
			}
		>
			<TextFields fields={ fields } values={ values } disabled={ pending } onChange={ setValues } />
		</Form>
	);
}

// A site on a host of the user's SSH config, or one they add to it.
export function SshConnectForm( { disabled, pending, error, onSubmit, run }: ConnectFormProps ) {
	const id = useId();
	const { intro, connect } = sshProvider.sites!;
	const [ host, ...fields ] = getFormFields( connect!.input() );
	const [ hosts, setHosts ] = useState< SshHost[] >( [] );
	const [ hostsError, setHostsError ] = useState< string >();
	const [ values, setValues ] = useState< Values >( {} );
	const [ adding, setAdding ] = useState( false );

	useEffect( () => {
		let active = true;
		run( 'hosts' ).then(
			( list ) => active && setHosts( list as SshHost[] ),
			( failure: Error ) => active && setHostsError( failure.message )
		);
		return () => {
			active = false;
		};
	}, [ run ] );

	if ( adding ) {
		return (
			<AddHostForm
				run={ run }
				onCancel={ () => setAdding( false ) }
				onAdded={ ( added ) => {
					setHosts( [ ...hosts, added ] );
					setValues( { ...values, [ host.name ]: added.name } );
					setAdding( false );
				} }
			/>
		);
	}
	const ready = !! values[ host.name ] && isReady( fields, values );
	return (
		<Form
			label={ intro.title() }
			description={ intro.description() }
			error={ error }
			onSubmit={ () => ready && ! pending && onSubmit( values ) }
			actions={
				<Button
					type="submit"
					variant="accent"
					disabled={ disabled || ! ready }
					loading={ pending }
					loadingAnnouncement={ __( 'Connecting' ) }
				>
					{ __( 'Connect' ) }
				</Button>
			}
		>
			<Field>
				<FieldLabel htmlFor={ `${ id }-host` }>{ host.title }</FieldLabel>
				<Select
					value={ values[ host.name ] ?? null }
					disabled={ disabled || pending }
					onValueChange={ ( value ) => {
						if ( value === ADD_HOST ) {
							setAdding( true );
						} else if ( value ) {
							setValues( { ...values, [ host.name ]: value } );
						}
					} }
				>
					<SelectTrigger id={ `${ id }-host` } fullWidth>
						<SelectValue placeholder={ __( 'Choose a host' ) } />
					</SelectTrigger>
					<SelectContent>
						{ hosts.map( ( item ) => (
							<SelectItem key={ item.name } value={ item.name } description={ item.description }>
								{ item.name }
							</SelectItem>
						) ) }
						<SelectItem value={ ADD_HOST } icon={ <PlusIcon /> }>
							{ __( 'Add SSH host…' ) }
						</SelectItem>
					</SelectContent>
				</Select>
				<FieldDescription error={ hostsError }>
					{ __( 'A host from your SSH config.' ) }
				</FieldDescription>
			</Field>
			<TextFields
				fields={ fields }
				values={ values }
				disabled={ disabled || pending }
				onChange={ setValues }
			/>
		</Form>
	);
}
