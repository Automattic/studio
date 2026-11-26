import {
	describeMissingConnection,
	remoteConnectionName,
	type RemoteConnectionKind,
	type RemoteConnectionRequest,
} from '@studio/common/lib/remote-connection';
import {
	Alert,
	AlertActions,
	AlertDescription,
	Badge,
	Button,
	Spinner,
	VisuallyHidden,
} from '@studio/ds';
import { TriangleAlertIcon } from '@studio/ds/icons';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useState } from 'react';
import { useConnector } from '@/data/core';
import {
	usePairedPhones,
	usePhoneAccess,
	usePhoneConnections,
	usePhonePairingCode,
	useRemovePairedPhone,
	useSetPhoneAccess,
	useSetPhoneConnection,
} from '@/data/queries/use-phone-access';
import { RelativeTime } from '@/features/site-card';
import { SettingsGroup, SettingsRow, SettingsToggle } from './rows';
import styles from './style.module.css';
import type { PairedPhone, PhoneAccessState, PhoneConnections } from '@/data/core';

const PLATFORM_NAMES: Record< string, string > = { ios: 'iOS', android: 'Android' };

const TAILSCALE_DOWNLOAD_URL = 'https://tailscale.com/download';
// The admin console's DNS page, where MagicDNS and HTTPS certificates are turned on.
const TAILSCALE_DNS_URL = 'https://login.tailscale.com/admin/dns';

function connectionDescription( kind: RemoteConnectionKind ): string {
	switch ( kind ) {
		case 'https':
			return __(
				'Encrypted, for your devices on Tailscale. Your computer’s name is in public certificate logs.'
			);
		case 'tailnet':
			// iOS allows the phone app plain HTTP only to local addresses, and a
			// tailnet address is not one. Android allows it.
			return __(
				'Encrypted by Tailscale, for your devices on Tailscale. The Studio phone app on iPhone needs Tailscale HTTPS instead.'
			);
		case 'local':
			return __( 'For phones on the same network as this computer. Not encrypted.' );
	}
}

// The connection that runs, or the one that would run if the switch went on.
function currentConnection(
	state: PhoneAccessState,
	connections: PhoneConnections | undefined
): RemoteConnectionKind | undefined {
	if ( state.status === 'on' || state.status === 'terminal' ) {
		return state.connection;
	}
	return connections?.request === 'auto' ? connections.automatic : connections?.request;
}

function ConnectionChoices( {
	connections,
	onUse,
	disabled,
	checking,
	onCheckAgain,
}: {
	connections: PhoneConnections;
	onUse: ( request: RemoteConnectionRequest ) => void;
	disabled: boolean;
	checking: boolean;
	onCheckAgain: () => void;
} ) {
	const connector = useConnector();
	const selected = ( request: RemoteConnectionRequest ) =>
		connections.request === request ? <Badge variant="accent">{ __( 'Selected' ) }</Badge> : null;
	const choiceButton = ( request: RemoteConnectionRequest, name: string ) =>
		connections.request === request ? null : (
			<Button
				variant="secondary"
				size="sm"
				disabled={ disabled }
				aria-label={ sprintf(
					/* translators: %s: a connection, like "Tailscale HTTPS". */
					__( 'Use %s' ),
					name
				) }
				onClick={ () => onUse( request ) }
			>
				{ __( 'Use' ) }
			</Button>
		);
	const linkButton = ( label: string, url: string ) => (
		<Button variant="secondary" size="sm" onClick={ () => void connector.openExternalUrl( url ) }>
			{ label }
		</Button>
	);

	return (
		<>
			<SettingsRow
				title={ __( 'Automatic' ) }
				badge={ selected( 'auto' ) }
				description={ __(
					'The safest one that is ready: Tailscale HTTPS, then Tailnet, then Local network.'
				) }
				additionalContent={
					connections.automatic
						? sprintf(
								/* translators: %s: a connection, like "Tailscale HTTPS". */
								__( 'Now: %s' ),
								remoteConnectionName( connections.automatic )
						  )
						: __( 'No connection is ready now.' )
				}
			>
				{ choiceButton( 'auto', __( 'Automatic' ) ) }
			</SettingsRow>
			{ connections.options.map( ( { kind, missing } ) => (
				<SettingsRow
					key={ kind }
					title={ remoteConnectionName( kind ) }
					badge={ selected( kind ) }
					description={ connectionDescription( kind ) }
					additionalContent={ missing ? describeMissingConnection( missing ) : __( 'Ready' ) }
				>
					{ missing === 'tailscale'
						? linkButton( __( 'Install Tailscale' ), TAILSCALE_DOWNLOAD_URL )
						: missing === 'tailscale-https'
						? linkButton( __( 'Turn on HTTPS' ), TAILSCALE_DNS_URL )
						: missing
						? null
						: choiceButton( kind, remoteConnectionName( kind ) ) }
				</SettingsRow>
			) ) }
			<div className={ styles.phoneConnectionActions }>
				<Button variant="secondary" size="sm" loading={ checking } onClick={ onCheckAgain }>
					{ __( 'Check again' ) }
				</Button>
			</div>
		</>
	);
}

// The connection phones use, with a list to change it.
function PhoneConnection( {
	state,
	busy,
	setConnection,
}: {
	state: PhoneAccessState;
	busy: boolean;
	setConnection: ReturnType< typeof useSetPhoneConnection >;
} ) {
	const connections = usePhoneConnections();
	const [ open, setOpen ] = useState( false );
	const data = connections.data;
	const terminal = state.status === 'terminal';
	const current = currentConnection( state, data );

	let summary: string;
	if ( terminal ) {
		summary = current ? remoteConnectionName( current ) : __( 'Set in the terminal' );
	} else if ( ! data ) {
		summary = connections.isError ? __( 'Couldn’t read the connections.' ) : __( 'Loading…' );
	} else if ( data.request === 'auto' ) {
		summary = current
			? sprintf(
					/* translators: %s: a connection, like "Tailscale HTTPS". */
					__( 'Automatic: %s' ),
					remoteConnectionName( current )
			  )
			: __( 'Automatic: no connection is ready' );
	} else {
		summary = remoteConnectionName( current ?? data.request );
	}

	return (
		<>
			<SettingsRow
				title={ __( 'Connection' ) }
				description={ summary }
				additionalContent={
					( state.status === 'on' || state.status === 'terminal' ) && state.fallbackReason
						? state.fallbackReason
						: undefined
				}
				error={ setConnection.isError ? __( 'Couldn’t change the connection.' ) : undefined }
			>
				<Button
					variant="secondary"
					size="sm"
					disabled={ terminal || busy || ! data }
					loading={ setConnection.isPending }
					aria-expanded={ open }
					onClick={ () => {
						if ( ! open ) {
							void connections.refetch();
						}
						setOpen( ! open );
					} }
				>
					{ open ? __( 'Done' ) : __( 'Change' ) }
				</Button>
			</SettingsRow>
			{ open && data && ! terminal ? (
				<ConnectionChoices
					connections={ data }
					disabled={ busy || setConnection.isPending }
					checking={ connections.isFetching }
					onCheckAgain={ () => void connections.refetch() }
					onUse={ ( request ) =>
						setConnection.mutate( request, { onSuccess: () => setOpen( false ) } )
					}
				/>
			) : null }
		</>
	);
}

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
	// Here, so the switch waits while a new connection restarts remote mode.
	const setConnection = useSetPhoneConnection();
	const connections = usePhoneConnections();
	const phones = usePairedPhones();
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
	// A failed turn on or off, shown until the state says otherwise. Turning off
	// can stop remote mode and still fail to save the switch, which would start
	// it again at the next launch.
	const failed =
		setAccess.isError &&
		setAccess.variables !== undefined &&
		( setAccess.variables !== !! url || setAccess.variables === false )
			? setAccess.variables
			: undefined;
	const error =
		state.status === 'error'
			? state.message
			: failed === true
			? __( 'Remote mode could not start.' )
			: failed === false && url
			? __( 'Remote mode could not stop.' )
			: failed === false
			? __(
					'Remote mode stopped, but Studio could not save the switch, so remote mode would start again when Studio opens.'
			  )
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
							: state.status === 'on' && state.movedFrom && phones.data?.length
							? sprintf(
									/* translators: %s: the address remote mode had before, like http://192.168.1.20:8082. */
									__(
										'The address changed from %s. Phones paired at that address must pair again.'
									),
									state.movedFrom
							  )
							: undefined
					}
				>
					<div className={ styles.phoneSwitch }>
						{ starting ? <Spinner aria-label={ __( 'Starting remote mode' ) } /> : null }
						<SettingsToggle
							label={ __( 'Let your phone connect' ) }
							checked={ checked }
							disabled={ terminal || starting || setAccess.isPending || setConnection.isPending }
							onChange={ ( on ) => setAccess.mutate( on ) }
						/>
					</div>
				</SettingsRow>
				<PhoneConnection
					state={ state }
					busy={ starting || setAccess.isPending }
					setConnection={ setConnection }
				/>
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
					{ /* The connections through Tailscale are encrypted. */ }
					{ ( currentConnection( state, connections.data ) ?? 'local' ) === 'local' ? (
						<p>
							{ __(
								'On a shared network this connection is not encrypted. Use Tailscale or another VPN when you can.'
							) }
						</p>
					) : null }
				</AlertDescription>
			</Alert>
			{ url ? <PairingCode url={ url } /> : null }
			<PairedPhones />
		</div>
	);
}
