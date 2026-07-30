import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './panel.module.css';
import { PUSH_SEQUENCE, SCENARIOS } from './preview-state';
import { getTweaks, resetTweaks, setTweaks, useTweaks } from './store';
import type { ToolbarTweaks } from './store';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';

/**
 * TEMPORARY design scaffolding (STU-2162): a floating, draggable panel that
 * drives the site toolbar's status pill and action button through every state
 * they can be in, without having to reproduce each one for real.
 *
 * Dev builds only, and inert until its master switch is on. To remove: delete
 * this folder and the two `dev-tweaks` references in `../index.tsx`.
 */

const PANEL_MARGIN = 8;

function clampPosition( x: number, y: number ): { x: number; y: number } {
	const maxX = Math.max( PANEL_MARGIN, window.innerWidth - 120 );
	const maxY = Math.max( PANEL_MARGIN, window.innerHeight - 44 );
	return {
		x: Math.min( Math.max( x, PANEL_MARGIN ), maxX ),
		y: Math.min( Math.max( y, PANEL_MARGIN ), maxY ),
	};
}

function useDragHandle() {
	const draggedRef = useRef( false );

	const onPointerDown = ( event: ReactPointerEvent< HTMLElement > ) => {
		// Let the panel's own controls keep their clicks; only bare chrome drags.
		if ( event.button !== 0 || ( event.target as HTMLElement ).closest( 'input, select, label' ) ) {
			return;
		}
		event.preventDefault();
		draggedRef.current = false;
		const startX = event.clientX;
		const startY = event.clientY;
		const { x: originX, y: originY } = getTweaks();

		const onMove = ( moveEvent: PointerEvent ) => {
			const dx = moveEvent.clientX - startX;
			const dy = moveEvent.clientY - startY;
			if ( Math.abs( dx ) + Math.abs( dy ) > 3 ) {
				draggedRef.current = true;
			}
			setTweaks( clampPosition( originX + dx, originY + dy ) );
		};
		const onUp = () => {
			window.removeEventListener( 'pointermove', onMove );
			window.removeEventListener( 'pointerup', onUp );
		};
		window.addEventListener( 'pointermove', onMove );
		window.addEventListener( 'pointerup', onUp );
	};

	// True when the click that follows was the end of a drag, so the collapsed
	// chip doesn't expand every time it's moved.
	const consumedDrag = () => {
		const dragged = draggedRef.current;
		draggedRef.current = false;
		return dragged;
	};

	return { onPointerDown, consumedDrag };
}

type Option< T extends string > = { value: T; label: string };

function Field( { label, children }: { label: string; children: ReactNode } ) {
	return (
		<div className={ styles.field }>
			<span className={ styles.fieldLabel }>{ label }</span>
			<div className={ styles.fieldControl }>{ children }</div>
		</div>
	);
}

function Segmented< T extends string >( {
	value,
	options,
	onChange,
}: {
	value: T;
	options: Option< T >[];
	onChange: ( value: T ) => void;
} ) {
	return (
		<div className={ styles.segmented }>
			{ options.map( ( option ) => (
				<button
					key={ option.value }
					type="button"
					className={ option.value === value ? styles.segmentActive : styles.segment }
					onClick={ () => onChange( option.value ) }
				>
					{ option.label }
				</button>
			) ) }
		</div>
	);
}

function Choice< T extends string >( {
	value,
	options,
	onChange,
}: {
	value: T;
	options: Option< T >[];
	onChange: ( value: T ) => void;
} ) {
	return (
		<select
			className={ styles.select }
			value={ value }
			onChange={ ( event ) => onChange( event.target.value as T ) }
		>
			{ options.map( ( option ) => (
				<option key={ option.value } value={ option.value }>
					{ option.label }
				</option>
			) ) }
		</select>
	);
}

function Group( { title, children }: { title: string; children: ReactNode } ) {
	return (
		<div className={ styles.group }>
			<div className={ styles.groupTitle }>{ title }</div>
			{ children }
		</div>
	);
}

const AUTO_ON_OFF: Option< ToolbarTweaks[ 'actionBusy' ] >[] = [
	{ value: 'auto', label: 'Auto' },
	{ value: 'on', label: 'On' },
	{ value: 'off', label: 'Off' },
];

function Body( { tweaks }: { tweaks: ToolbarTweaks } ) {
	const timers = useRef< ReturnType< typeof setTimeout >[] >( [] );

	useEffect(
		() => () => {
			timers.current.forEach( clearTimeout );
		},
		[]
	);

	const stopSequence = () => {
		timers.current.forEach( clearTimeout );
		timers.current = [];
	};

	const playPush = () => {
		stopSequence();
		setTweaks( { enabled: true } );
		for ( const step of PUSH_SEQUENCE ) {
			timers.current.push( setTimeout( () => setTweaks( step.tweaks ), step.at ) );
		}
	};

	return (
		<div className={ styles.body }>
			<Group title="Scenarios">
				<div className={ styles.presets }>
					{ SCENARIOS.map( ( scenario ) => (
						<button
							key={ scenario.id }
							type="button"
							className={ styles.preset }
							onClick={ () => {
								stopSequence();
								setTweaks( { enabled: true, ...scenario.tweaks } );
							} }
						>
							{ scenario.label }
						</button>
					) ) }
				</div>
				<div className={ styles.rowButtons }>
					<button type="button" className={ styles.rowButton } onClick={ playPush }>
						▶ Play a push
					</button>
					<button
						type="button"
						className={ styles.rowButton }
						onClick={ () => {
							stopSequence();
							resetTweaks();
						} }
					>
						Reset
					</button>
				</div>
			</Group>

			<Group title="Site">
				<Field label="Live site">
					<Segmented
						value={ tweaks.connection }
						onChange={ ( connection ) => setTweaks( { connection } ) }
						options={ [
							{ value: 'none', label: 'None' },
							{ value: 'live', label: 'Live' },
							{ value: 'staging', label: 'Staging' },
						] }
					/>
				</Field>
				<Field label="Last push">
					<Segmented
						value={ tweaks.history }
						onChange={ ( history ) => setTweaks( { history } ) }
						options={ [
							{ value: 'never', label: 'Never' },
							{ value: 'just-now', label: 'Now' },
							{ value: 'hours', label: '3h' },
							{ value: 'days', label: '6d' },
						] }
					/>
				</Field>
				<Field label="Run state">
					<Segmented
						value={ tweaks.run }
						onChange={ ( run ) => setTweaks( { run } ) }
						options={ [
							{ value: 'running', label: 'Running' },
							{ value: 'stopped', label: 'Stopped' },
							{ value: 'starting', label: 'Starting' },
							{ value: 'stopping', label: 'Stopping' },
						] }
					/>
				</Field>
			</Group>

			<Group title="Activity">
				<Field label="Direction">
					<Segmented
						value={ tweaks.direction }
						onChange={ ( direction ) => setTweaks( { direction } ) }
						options={ [
							{ value: 'push', label: 'Push' },
							{ value: 'pull', label: 'Pull' },
						] }
					/>
				</Field>
				<Field label="State">
					<Choice
						value={ tweaks.activity }
						onChange={ ( activity ) => setTweaks( { activity } ) }
						options={ [
							{ value: 'none', label: 'Idle' },
							{ value: 'push-exporting', label: 'Push · preparing' },
							{ value: 'push-uploading', label: 'Push · uploading' },
							{ value: 'push-paused', label: 'Push · paused' },
							{ value: 'push-importing', label: 'Push · applying' },
							{ value: 'push-success', label: 'Push · done' },
							{ value: 'push-error', label: 'Push · failed' },
							{ value: 'pull-pending', label: 'Pull · running' },
							{ value: 'pull-success', label: 'Pull · done' },
							{ value: 'pull-error', label: 'Pull · failed' },
							{ value: 'preview-pending', label: 'Preview · running' },
							{ value: 'preview-success', label: 'Preview · done' },
							{ value: 'preview-error', label: 'Preview · failed' },
						] }
					/>
				</Field>
				<Field label="Progress">
					<Segmented
						value={ tweaks.determinate ? 'on' : 'off' }
						onChange={ ( value ) => setTweaks( { determinate: value === 'on' } ) }
						options={ [
							{ value: 'on', label: '%' },
							{ value: 'off', label: 'Indeterminate' },
						] }
					/>
				</Field>
				<Field label={ `${ tweaks.progress }%` }>
					<input
						type="range"
						className={ styles.slider }
						min={ 0 }
						max={ 100 }
						step={ 1 }
						disabled={ ! tweaks.determinate }
						value={ tweaks.progress }
						onChange={ ( event ) => setTweaks( { progress: Number( event.target.value ) } ) }
					/>
				</Field>
				<Field label="Sync lock">
					<Segmented
						value={ tweaks.isSyncing ? 'on' : 'off' }
						onChange={ ( value ) => setTweaks( { isSyncing: value === 'on' } ) }
						options={ [
							{ value: 'off', label: 'Free' },
							{ value: 'on', label: 'Busy' },
						] }
					/>
				</Field>
			</Group>

			<Group title="Context">
				<Field label="Account">
					<Segmented
						value={ tweaks.auth }
						onChange={ ( auth ) => setTweaks( { auth } ) }
						options={ [
							{ value: 'ok', label: 'Signed in' },
							{ value: 'signed-out', label: 'Signed out' },
							{ value: 'offline', label: 'Offline' },
						] }
					/>
				</Field>
			</Group>

			<Group title="Status text">
				<Field label="Tone">
					<Choice
						value={ tweaks.statusTone }
						onChange={ ( statusTone ) => setTweaks( { statusTone } ) }
						options={ [
							{ value: 'auto', label: 'Auto' },
							{ value: 'neutral', label: 'Neutral' },
							{ value: 'pending', label: 'Pending' },
							{ value: 'success', label: 'Success' },
							{ value: 'warning', label: 'Warning' },
							{ value: 'error', label: 'Error' },
						] }
					/>
				</Field>
			</Group>

			<Group title="Action button">
				<Field label="Variant">
					<Segmented
						value={ tweaks.actionVariant }
						onChange={ ( actionVariant ) => setTweaks( { actionVariant } ) }
						options={ [
							{ value: 'auto', label: 'Auto' },
							{ value: 'solid', label: 'Solid' },
							{ value: 'outline', label: 'Outline' },
						] }
					/>
				</Field>
				<Field label="Tone">
					<Segmented
						value={ tweaks.actionTone }
						onChange={ ( actionTone ) => setTweaks( { actionTone } ) }
						options={ [
							{ value: 'auto', label: 'Auto' },
							{ value: 'brand', label: 'Brand' },
							{ value: 'neutral', label: 'Neutral' },
						] }
					/>
				</Field>
				<Field label="Spinner">
					<Segmented
						value={ tweaks.actionBusy }
						onChange={ ( actionBusy ) => setTweaks( { actionBusy } ) }
						options={ AUTO_ON_OFF }
					/>
				</Field>
				<Field label="Disabled">
					<Segmented
						value={ tweaks.actionDisabled }
						onChange={ ( actionDisabled ) => setTweaks( { actionDisabled } ) }
						options={ AUTO_ON_OFF }
					/>
				</Field>
			</Group>
		</div>
	);
}

export function ToolbarTweaksPanel() {
	const tweaks = useTweaks();
	const { onPointerDown, consumedDrag } = useDragHandle();

	if ( ! import.meta.env.DEV ) {
		return null;
	}

	const position = { insetInlineStart: `${ tweaks.x }px`, insetBlockStart: `${ tweaks.y }px` };

	if ( ! tweaks.open ) {
		return createPortal(
			<button
				type="button"
				className={ styles.chip }
				style={ position }
				onPointerDown={ onPointerDown }
				onClick={ () => {
					if ( ! consumedDrag() ) {
						setTweaks( { open: true } );
					}
				} }
			>
				<span className={ tweaks.enabled ? styles.chipDotOn : styles.chipDot } />
				{ tweaks.enabled ? 'Tweaks: driving' : 'Tweaks' }
			</button>,
			document.body
		);
	}

	return createPortal(
		<div className={ styles.panel } style={ position }>
			<div className={ styles.header } onPointerDown={ onPointerDown }>
				<span className={ styles.grip } aria-hidden="true">
					⠿
				</span>
				<span className={ styles.title }>Toolbar tweaks</span>
				<label className={ styles.switch }>
					<input
						type="checkbox"
						checked={ tweaks.enabled }
						onChange={ ( event ) => setTweaks( { enabled: event.target.checked } ) }
					/>
					{ tweaks.enabled ? 'On' : 'Off' }
				</label>
				<button
					type="button"
					className={ styles.close }
					aria-label="Collapse tweaks panel"
					onClick={ () => setTweaks( { open: false } ) }
				>
					×
				</button>
			</div>
			<Body tweaks={ tweaks } />
		</div>,
		document.body
	);
}
