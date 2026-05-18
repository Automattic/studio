import {
	DESK_CONFIG_VERSION,
	type DeskConfig,
	type DeskConnector,
	type DeskConnectorEndpoint,
	type DeskStack,
	type DeskViewport,
	type DeskWidgetBase,
} from '../types/desk';

function isRecord( value: unknown ): value is Record< string, unknown > {
	return Boolean( value ) && typeof value === 'object' && ! Array.isArray( value );
}

function isFiniteNumber( value: unknown ): value is number {
	return typeof value === 'number' && Number.isFinite( value );
}

function isDeskWidget( value: unknown ): value is DeskWidgetBase {
	if ( ! isRecord( value ) || ! isRecord( value.shapeProps ) || ! isRecord( value.widgetProps ) ) {
		return false;
	}

	return (
		typeof value.id === 'string' &&
		value.id.length > 0 &&
		typeof value.type === 'string' &&
		value.type.length > 0 &&
		isFiniteNumber( value.x ) &&
		isFiniteNumber( value.y ) &&
		typeof value.zIndex === 'string' &&
		( value.rotation === undefined || isFiniteNumber( value.rotation ) )
	);
}

function isDeskStack( value: unknown ): value is DeskStack {
	if ( ! isRecord( value ) || ! Array.isArray( value.memberIds ) ) {
		return false;
	}

	return (
		typeof value.id === 'string' &&
		value.id.length > 0 &&
		isFiniteNumber( value.x ) &&
		isFiniteNumber( value.y ) &&
		typeof value.zIndex === 'string' &&
		value.memberIds.length >= 2 &&
		value.memberIds.every( ( memberId ) => typeof memberId === 'string' ) &&
		( value.viewMode === undefined ||
			value.viewMode === 'stack' ||
			value.viewMode === 'tiles' ||
			value.viewMode === 'circle' )
	);
}

function isDeskViewport( value: unknown ): value is DeskViewport {
	if ( ! isRecord( value ) ) {
		return false;
	}

	const { x, y, z } = value;
	return isFiniteNumber( x ) && isFiniteNumber( y ) && isFiniteNumber( z ) && z > 0;
}

function isDeskConnectorEndpoint( value: unknown ): value is DeskConnectorEndpoint {
	if ( ! isRecord( value ) || ! isRecord( value.normalizedAnchor ) ) {
		return false;
	}

	const { x, y } = value.normalizedAnchor;
	return (
		typeof value.widgetId === 'string' &&
		value.widgetId.length > 0 &&
		isFiniteNumber( x ) &&
		x >= 0 &&
		x <= 1 &&
		isFiniteNumber( y ) &&
		y >= 0 &&
		y <= 1
	);
}

function isDeskConnector( value: unknown ): value is DeskConnector {
	if ( ! isRecord( value ) ) {
		return false;
	}

	return (
		typeof value.id === 'string' &&
		value.id.length > 0 &&
		isDeskConnectorEndpoint( value.from ) &&
		isDeskConnectorEndpoint( value.to ) &&
		( value.bend === undefined || isFiniteNumber( value.bend ) )
	);
}

export function assertDeskConfig( value: unknown ): asserts value is DeskConfig {
	if ( ! isRecord( value ) ) {
		throw new Error( 'Invalid desk config: expected an object.' );
	}
	if ( value.version !== DESK_CONFIG_VERSION ) {
		throw new Error( `Invalid desk config: expected version ${ DESK_CONFIG_VERSION }.` );
	}
	if ( typeof value.updatedAt !== 'string' ) {
		throw new Error( 'Invalid desk config: expected updatedAt string.' );
	}
	if ( ! Array.isArray( value.widgets ) || ! value.widgets.every( isDeskWidget ) ) {
		throw new Error( 'Invalid desk config: expected widgets array.' );
	}
	if (
		value.stacks !== undefined &&
		( ! Array.isArray( value.stacks ) || ! value.stacks.every( isDeskStack ) )
	) {
		throw new Error( 'Invalid desk config: expected stacks array.' );
	}
	if ( value.viewport !== undefined && ! isDeskViewport( value.viewport ) ) {
		throw new Error( 'Invalid desk config: expected viewport object.' );
	}
	if (
		value.connectors !== undefined &&
		( ! Array.isArray( value.connectors ) || ! value.connectors.every( isDeskConnector ) )
	) {
		throw new Error( 'Invalid desk config: expected connectors array.' );
	}
}

export function isDeskConfig( value: unknown ): value is DeskConfig {
	try {
		assertDeskConfig( value );
		return true;
	} catch {
		return false;
	}
}
