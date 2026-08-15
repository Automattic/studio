import {
	Button,
	__experimentalInputControl as InputControl,
	__experimentalInputControlSuffixWrapper as InputControlSuffixWrapper,
	privateApis as componentsPrivateApis,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { seen, unseen } from '@wordpress/icons';
import { useCallback, useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { unlock } from '@/lock-unlock';
import styles from './style.module.css';
import type { DataFormControlProps } from '@wordpress/dataviews';
import type { ComponentProps, ComponentType } from 'react';

type ValidatedInputControlProps = Omit<
	ComponentProps< typeof InputControl >,
	'__next40pxDefaultSize'
> & {
	required?: boolean;
	markWhenOptional?: boolean;
	customValidity?: {
		type: 'validating' | 'valid' | 'invalid';
		message: string;
	};
};

const { ValidatedInputControl } = unlock( componentsPrivateApis ) as {
	ValidatedInputControl: ComponentType< ValidatedInputControlProps >;
};

type CredentialKind = 'username' | 'password' | 'email';

function getCopyLabel( kind: CredentialKind ): string {
	switch ( kind ) {
		case 'username':
			return __( 'Copy admin username' );
		case 'password':
			return __( 'Copy admin password' );
		case 'email':
			return __( 'Copy admin email' );
	}
}

function CopyableCredentialControl< Item >( {
	data,
	field,
	onChange,
	hideLabelFromVision,
	markWhenOptional,
	validity,
	kind,
}: DataFormControlProps< Item > & { kind?: CredentialKind } ) {
	const [ isPasswordVisible, setIsPasswordVisible ] = useState( false );
	const value = String( field.getValue( { item: data } ) ?? '' );
	const disabled = field.isDisabled( { item: data, field } );
	const requiredValidity = validity?.required;
	const customValidity =
		field.isValid.required && requiredValidity
			? requiredValidity.message
				? { type: requiredValidity.type, message: requiredValidity.message }
				: undefined
			: validity?.custom;

	const handleChange = useCallback(
		( nextValue?: string ) => {
			onChange( field.setValue( { item: data, value: nextValue ?? '' } ) );
		},
		[ data, field, onChange ]
	);

	const isPassword = kind === 'password';

	return (
		<ValidatedInputControl
			required={ !! field.isValid.required }
			markWhenOptional={ field.isValid.required ? true : markWhenOptional }
			customValidity={ customValidity }
			label={ field.label }
			placeholder={ field.placeholder }
			value={ value }
			help={ field.description }
			onChange={ handleChange }
			hideLabelFromVision={ hideLabelFromVision }
			type={ isPassword && ! isPasswordVisible ? 'password' : kind === 'email' ? 'email' : 'text' }
			disabled={ disabled }
			suffix={
				kind && (
					<InputControlSuffixWrapper variant="control">
						<div className={ styles.credentialActions }>
							{ isPassword && (
								<Button
									icon={ isPasswordVisible ? unseen : seen }
									onClick={ () => setIsPasswordVisible( ( visible ) => ! visible ) }
									size="small"
									label={ isPasswordVisible ? __( 'Hide password' ) : __( 'Show password' ) }
									disabled={ disabled }
									accessibleWhenDisabled
								/>
							) }
							<CopyButton text={ value } label={ getCopyLabel( kind ) } variant="plain" />
						</div>
					</InputControlSuffixWrapper>
				)
			}
		/>
	);
}

export function SiteNameControl< Item >( props: DataFormControlProps< Item > ) {
	return <CopyableCredentialControl { ...props } />;
}

export function AdminUsernameControl< Item >( props: DataFormControlProps< Item > ) {
	return <CopyableCredentialControl { ...props } kind="username" />;
}

export function AdminPasswordControl< Item >( props: DataFormControlProps< Item > ) {
	return <CopyableCredentialControl { ...props } kind="password" />;
}

export function AdminEmailControl< Item >( props: DataFormControlProps< Item > ) {
	return <CopyableCredentialControl { ...props } kind="email" />;
}
