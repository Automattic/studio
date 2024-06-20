import riveWASMResource from '@rive-app/canvas/rive.wasm';
import { useRive, useStateMachineInput, RuntimeLoader } from '@rive-app/react-canvas';
import { useCallback, useEffect } from '@wordpress/element';
import aiImage from '../../assets/ai-icon.riv';

RuntimeLoader.setWasmUrl( riveWASMResource );

const useRiveIcon = () => {
	const stateMachineName = 'State Machine A';
	const { rive, RiveComponent } = useRive( {
		src: aiImage,
		stateMachines: stateMachineName,
		autoplay: false,
	} );

	const inactiveInput = useStateMachineInput( rive, stateMachineName, '00_inactive' );
	const idleInput = useStateMachineInput( rive, stateMachineName, '01_idle' );
	const typingInput = useStateMachineInput( rive, stateMachineName, '02_typing' );
	const typingToIdleInput = useStateMachineInput(
		rive,
		stateMachineName,
		'03_from_typing_to_idle'
	);
	const generateInput = useStateMachineInput( rive, stateMachineName, '04_generate' );
	const doneInput = useStateMachineInput(
		rive,
		stateMachineName,
		'05_( type 1 to inactive from gen )_( type 2 to idle from gen )',
		0
	);

	useEffect( () => {
		if ( rive ) {
			rive.on( 'statechange', ( event ) => {
				console.log( 'statechange', event );
			} );
		}
	}, [ rive ] );

	useEffect( () => {
		return () => {
			if ( rive ) {
				rive.cleanup();
			}
		};
	}, [ rive ] );

	const startStateMachine = useCallback( () => {
		if ( rive ) {
			rive.play( stateMachineName );
		}
	}, [ rive, stateMachineName ] );

	const pauseStateMachine = useCallback( () => {
		console.log( 'Pause state machine' );

		if ( rive ) {
			rive.pause( stateMachineName );
		}
	}, [ rive, stateMachineName ] );

	const playInactive = useCallback( () => {
		console.log( 'Play inactive' );

		if ( inactiveInput ) {
			inactiveInput.fire();
		}
	}, [ inactiveInput ] );

	const playIdle = useCallback( () => {
		console.log( 'Play idle', idleInput );

		if ( idleInput ) {
			idleInput.fire();
		}
	}, [ idleInput ] );

	const playTyping = useCallback( () => {
		console.log( 'Play typing', typingInput );

		if ( typingInput ) {
			typingInput.fire();
		}
	}, [ typingInput ] );

	const playTypingToIdle = useCallback( () => {
		console.log( 'Play typing to idle', typingToIdleInput );

		if ( typingToIdleInput ) {
			typingToIdleInput.fire();
		}
	}, [ typingToIdleInput ] );

	const playGenerate = useCallback( () => {
		console.log( 'Play generate' );

		if ( generateInput && doneInput ) {
			doneInput.value = 2;
			generateInput.fire();
		}
	}, [ generateInput ] );

	const playDone = useCallback( () => {
		console.log( 'Play done' );

		if ( doneInput ) {
			doneInput.value = 0;
            idleInput.fire();
		}
	}, [ doneInput ] );

	return {
		rive,
		RiveComponent,
		playInactive,
		playIdle,
		playTyping,
		playTypingToIdle,
		playDone,
		playGenerate,
		startStateMachine,
		pauseStateMachine,
	};
};

export default useRiveIcon;
