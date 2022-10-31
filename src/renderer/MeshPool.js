import * as THREE from 'three';

// THREE.Mesh pool used for allocating meshes to reuse
// Allocated meshes should be used on a single frame and
// released after using them
export class MeshPool {

	static get pool() {

		return ( this._pool = this._pool || [] );

	}

	static get nextPoolIndex() {

		return ( this._nextPoolIndex = this._nextPoolIndex || 0 );

	}

	static set nextPoolIndex( val ) {

		this._nextPoolIndex = val;

	}

	static releaseAll( cb ) {

		this.nextPoolIndex = 0;
		this.pool.forEach( m => {

			m.geometry = null;
			m.material = null;
			if ( m.parent ) m.parent.remove( m );
			if ( cb ) cb( m );

		} );

	}

	static allocate() {

		let mesh = null;
		if ( this.nextPoolIndex >= this.pool.length ) {

			mesh = new THREE.Mesh();
			mesh.name = `pool mesh ${this.nextPoolIndex}`;
			mesh.matrixAutoUpdate = false;
			this.pool.push( mesh );

		}

		mesh = this.pool[ this.nextPoolIndex ];
		this.nextPoolIndex ++;

		return mesh;

	}

}
