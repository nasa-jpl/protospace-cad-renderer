// Job queue for running functions over time
// up to a max duration per frame. Used
// to replace Threading-js when SharedArrayBuffers
// are unavailable
export default class JobQueue {

	constructor( processingTime = 30 ) {

		this._jobs = [];
		this._handle = null;

		// Create the generator that will run through
		// the task queue
		const self = this;
		this._process = ( function*() {

			while ( true ) {

				const startTime = performance.now();
				do {

					const job = self._jobs.shift();
					if ( job ) job();

				} while ( self._jobs.length && performance.now() - startTime < processingTime );

				yield null;

			}

		} )();

	}

	/* Public API */

	// Add a job
	run( job ) {

		// Create a promise to resolve after
		// the job is run
		let resolve, reject;
		const promise = new Promise( ( res, rej ) => {

			resolve = res;
			reject = rej;

		} );

		// Add it to the job queue and resolve
		// the promise once the job is finished
		this._jobs.push( () => {

			let result = null;
			let err = null;

			try {

				result = job();

			} catch ( e ) {

				err = e;

			}

			if ( err ) reject( err );
			else resolve( result );

		} );
		this._runProcessing();

		return promise;

	}

	/* Private Functions */

	// run the jobs
	_runProcessing() {

		if ( this._handle === null && this._jobs.length ) {

			this._handle = requestAnimationFrame( () => {

				this._process.next();
				this._handle = null;
				this._runProcessing();

			} );

		}

	}

}
