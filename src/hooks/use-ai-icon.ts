import { RuntimeLoader } from '@rive-app/canvas';
import { useRive, useStateMachineInput } from '@rive-app/react-canvas';
import { useCallback, useEffect } from '@wordpress/element';
// eslint-disable-next-line import/no-unresolved
import aiImage from '/assets/ai-icon.riv';

const useAiIcon = () => {
	const stateMachineName = 'State Machine A';

	// Configure Rive to use local WASM files
	useEffect( () => {
		RuntimeLoader.setWasmUrl( './assets/rive.wasm' );
	}, [] );

	const { rive, RiveComponent } = useRive( {
		src: aiImage,
		stateMachines: stateMachineName,
		autoplay: false,
	} );

	const inactiveInput = useStateMachineInput( rive, stateMachineName, 'inactive', false );
	const thinkingInput = useStateMachineInput( rive, stateMachineName, 'thinking', false );
	const typingInput = useStateMachineInput( rive, stateMachineName, 'typing', false );

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
		if ( rive ) {
			rive.pause( stateMachineName );
		}
	}, [ rive, stateMachineName ] );

	return {
		rive,
		RiveComponent,
		inactiveInput,
		typingInput,
		thinkingInput,
		startStateMachine,
		pauseStateMachine,
	};
};

export default useAiIcon;
