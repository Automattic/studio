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

export default useRiveIcon;
