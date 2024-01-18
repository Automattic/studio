import { Component } from 'react';
import DefaultErrorFallback from './default-error-fallback';

interface ErrorLoggerProps {
	children: React.ReactNode;
	fallback?: React.ReactNode;
}

export default class ErrorBoundary extends Component< ErrorLoggerProps > {
	state = { hasError: false };

	static getDerivedStateFromError() {
		return { hasError: true };
	}

	componentDidCatch( error: Error, info: React.ErrorInfo ) {
		// Error will be written to log by the main process
		console.error( error, info.componentStack );
	}

	render() {
		if ( this.state.hasError ) {
			return this.props.fallback || <DefaultErrorFallback />;
		}

		return this.props.children;
	}
}
