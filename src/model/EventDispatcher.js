// EventDispatcher
// Adds hooks for listening and dispatching events
// Uses a div as a helper to use the addEventListeners, etc
export class EventDispatcher {

	/* Life Cycle */
	constructor() {

		this._events = {};
		this._eventHelper = new EventTarget();
		this._debounces = {};

	}

	dispose() {

		// remove all registered events
		Object.keys( this._events ).forEach( name => {

			const events = [ ...this._events[ name ] ];
			events.forEach( ev => {

				this.unlisten( name, ev );

			} );

		} );

		// clear debounces
		Object.keys( this._debounces ).forEach( name => this.clearDebounce( name ) );

	}

	/* Event Handler Helpers */
	listen( ev, cb ) {

		this._events[ ev ] = this._events[ ev ] || [];
		this._events[ ev ].push( cb );
		this._eventHelper.addEventListener( ev, cb );

	}

	unlisten( ev, cb ) {

		this._eventHelper.removeEventListener( ev, cb );
		if ( ! this._events[ ev ] ) return;
		const index = this._events[ ev ].indexOf( cb );
		this._events[ ev ].splice( index, 1 );

	}

	_dispatch( ev, detail ) {

		this._eventHelper.dispatchEvent( new CustomEvent( ev, { detail } ) );

	}

	/* Debounce Helpers */
	debounce( name, func, timeout ) {

		this.clearDebounce( name );
		this._debounces[ name ] = {
			func,
			id: setTimeout( () => {

				func();
				this.clearDebounce( name );

			}, timeout ),
		};

	}

	flushDebounce( name ) {

		const exists = !! this._debounces[ name ];
		if ( this._debounces[ name ] ) {

			this._debounces[ name ].func();
			this.clearDebounce( name );

		}

		return exists;

	}

	clearDebounce( name ) {

		if ( this._debounces[ name ] ) clearTimeout( this._debounces[ name ].id );
		delete this._debounces[ name ];

	}

}
