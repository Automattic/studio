import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useState } from 'react';
import {
	usePairedPhones,
	usePhoneAccess,
	usePhonePairingCode,
	useRemovePairedPhone,
	useSetPhoneAccess,
} from '@/data/queries/use-phone-access';
import { RelativeTime } from '@/features/site-card';
import { TriangleAlertIcon } from '@/lib/icons';
import { Alert, AlertActions, AlertDescription, Button, Spinner, VisuallyHidden } from '@/lib/ui';
import { SettingsGroup, SettingsRow, SettingsToggle } from './rows';
import styles from './style.module.css';
import type { PairedPhone } from '@/data/core';

const PLATFORM_NAMES: Record< string, string > = { ios: 'iOS', android: 'Android' };

// Whole seconds until `expiresAt`, counting down once a second.
function useSecondsLeft( expiresAt: number | undefined ) {
	const [ now, setNow ] = useState( Date.now );
	useEffect( () => {
		if ( expiresAt === undefined ) return;
		setNow( Date.now() );
		const timer = setInterval( () => setNow( Date.now() ), 1000 );
		return () => clearInterval( timer );
	}, [ expiresAt ] );
	return expiresAt === undefined ? 0 : Math.max( 0, Math.ceil( ( expiresAt - now ) / 1000 ) );
}

function PairingCode( { url }: { url: string } ) {
	const code = usePhonePairingCode( url );
	const phones = usePairedPhones();
	const secondsLeft = useSecondsLeft( code.data?.expiresAt );
	// A code works once: a phone that paired after it was shown used it.
	const used = ( phones.data ?? [] ).some( ( phone ) => phone.pairedAt > code.dataUpdatedAt );
	const spent = !! code.data && ( secondsLeft === 0 || used );
	const { refetch } = code;
	useEffect( () => {
		if ( spent ) {
			void refetch();
		}
	}, [ spent, refetch ] );

	let content;
	if ( code.isError ) {
		content = (
			<div className={ styles.errorMessage }>{ __( 'Couldn’t make a pairing code.' ) }</div>
		);
	} else if ( ! code.data || spent ) {
		content = <div className={ styles.state }>{ __( 'Loading…' ) }</div>;
	} else {
		const minutes = Math.floor( secondsLeft / 60 );
		const seconds = String( secondsLeft % 60 ).padStart( 2, '0' );
		content = (
			<div className={ styles.phonePairing }>
				<img
					className={ styles.phoneQrCode }
					src={ `data:image/svg+xml;utf8,${ encodeURIComponent( code.data.qrSvg ) }` }
					alt={ __( 'QR code to pair the Studio phone app' ) }
				/>
				<dl className={ styles.phoneDetails }>
					<dt>{ __( 'Address' ) }</dt>
					<dd>{ code.data.address }</dd>
					<dt>{ __( 'Code' ) }</dt>
					<dd className={ styles.phoneCode }>{ code.data.code }</dd>
					<dd className={ styles.phoneExpiry }>
						{ sprintf(
							/* translators: %s: minutes and seconds until the pairing code expires, like 4:59. */
							__( 'Expires in %s' ),
							`${ minutes }:${ seconds }`
						) }
					</dd>
				</dl>
			</div>
		);
	}

	return (
		<SettingsGroup
			title={ __( 'Pair a phone' ) }
			description={ __(
				'Scan the QR code with the Studio phone app, or type the address and the code. A code works once.'
			) }
		>
			<SettingsRow title={ __( 'Pairing code' ) } stacked>
				<div className={ styles.phonePairingBody }>
					{ /* Stays mounted, so a screen reader hears each new code. */ }
					<VisuallyHidden aria-live="polite">
						{ code.data && ! spent && ! code.isError
							? sprintf(
									/* translators: %s: a pairing code, like ABCD-2345-EFGH. */
									__( 'Pairing code %s' ),
									code.data.code
							  )
							: '' }
					</VisuallyHidden>
					{ content }
					<div>
						<Button
							variant="secondary"
							size="sm"
							loading={ code.isFetching }
							onClick={ () => void refetch() }
						>
							{ __( 'New code' ) }
						</Button>
					</div>
				</div>
			</SettingsRow>
		</SettingsGroup>
	);
}

function PairedPhoneRow( { phone }: { phone: PairedPhone } ) {
	const remove = useRemovePairedPhone();
	return (
		<SettingsRow
			title={ phone.name }
			description={
				<>
					{ PLATFORM_NAMES[ phone.platform ] ?? phone.platform }
					{ ' · ' }
					<RelativeTime
						timestamp={ phone.lastSeenAt }
						active
						compact
						formatLabel={ ( label ) =>
							sprintf(
								/* translators: %s: how long ago, like "5m ago" or "just now". */
								__( 'Last seen %s' ),
								label
							)
						}
					/>
				</>
			}
			error={ remove.isError ? __( 'Couldn’t remove this phone. Please try again.' ) : undefined }
		>
			<Button
				variant="secondary"
				size="sm"
				loading={ remove.isPending }
				aria-label={ sprintf(
					/* translators: %s: a paired phone's name. */
					__( 'Remove %s' ),
					phone.name
				) }
				onClick={ () => remove.mutate( phone.id ) }
			>
				{ __( 'Remove' ) }
			</Button>
		</SettingsRow>
	);
}

function PairedPhones() {
	const phones = usePairedPhones();
	return (
		<SettingsGroup title={ __( 'Paired phones' ) } settingId="paired-phones">
			{ phones.isPending ? (
				<div className={ styles.state }>{ __( 'Loading…' ) }</div>
			) : phones.isError && ! phones.data ? (
				<div className={ styles.errorMessage }>{ __( 'Couldn’t read the paired phones.' ) }</div>
			) : phones.data?.length ? (
				phones.data.map( ( phone ) => <PairedPhoneRow key={ phone.id } phone={ phone } /> )
			) : (
				<SettingsRow
					title={ __( 'No phones paired yet' ) }
					description={ __( 'Phones you pair show here, and you can remove them.' ) }
				/>
			) }
		</SettingsGroup>
	);
}

export function PhonePanel() {
	const access = usePhoneAccess();
	const setAccess = useSetPhoneAccess();
	const state = access.data;
	if ( ! state ) {
		return access.isError ? (
			<div className={ styles.errorMessage }>{ __( 'Couldn’t read remote mode.' ) }</div>
		) : (
			<div className={ styles.state }>{ __( 'Loading…' ) }</div>
		);
	}

	const turningOn = setAccess.isPending && setAccess.variables === true;
	const starting = state.status === 'starting' || turningOn;
	const terminal = state.status === 'terminal';
	const url = state.status === 'on' || state.status === 'terminal' ? state.url : undefined;
	const checked = setAccess.isPending ? setAccess.variables : starting || !! url;
	// A failed turn on or off, shown until the state says otherwise.
	const failed =
		setAccess.isError && setAccess.variables !== undefined && setAccess.variables !== !! url
			? setAccess.variables
			: undefined;
	const error =
		state.status === 'error'
			? state.message
			: failed === true
			? __( 'Remote mode could not start.' )
			: failed === false
			? __( 'Remote mode could not stop.' )
			: undefined;

	return (
		<div className={ styles.preferencesPanel }>
			<SettingsGroup>
				<SettingsRow
					title={ __( 'Let your phone connect' ) }
					description={ __(
						'Pair the Studio phone app to work with Studio Code from your phone.'
					) }
					additionalContent={
						terminal
							? __( 'Remote mode was started in a terminal, and stops there.' )
							: state.status === 'on' && state.portChanged
							? __(
									'The port Studio used before is taken, so it uses another one. Phones paired before must pair again.'
							  )
							: undefined
					}
				>
					<div className={ styles.phoneSwitch }>
						{ starting ? <Spinner aria-label={ __( 'Starting remote mode' ) } /> : null }
						<SettingsToggle
							label={ __( 'Let your phone connect' ) }
							checked={ checked }
							disabled={ terminal || starting || setAccess.isPending }
							onChange={ ( on ) => setAccess.mutate( on ) }
						/>
					</div>
				</SettingsRow>
			</SettingsGroup>
			{ error && ! setAccess.isPending ? (
				<Alert variant="destructive">
					<AlertDescription>{ error }</AlertDescription>
					<AlertActions>
						<Button
							variant="secondary"
							size="sm"
							onClick={ () => setAccess.mutate( failed ?? true ) }
						>
							{ __( 'Try again' ) }
						</Button>
					</AlertActions>
				</Alert>
			) : null }
			<Alert variant="warning" role="note">
				<TriangleAlertIcon />
				<AlertDescription className={ styles.phoneWarnings }>
					<p>
						{ __(
							'A paired device can send prompts to Studio Code, and Studio Code can run commands on this computer. Pair only devices you own.'
						) }
					</p>
					<p>
						{ __(
							'On a shared network this connection is not encrypted. Use Tailscale or another VPN when you can.'
						) }
					</p>
				</AlertDescription>
			</Alert>
			{ url ? <PairingCode url={ url } /> : null }
			<PairedPhones />
		</div>
	);
}
