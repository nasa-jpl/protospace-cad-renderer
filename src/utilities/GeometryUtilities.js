import * as THREE from 'three';

/* a lot of this is translated from C++; it's more important to match that than to strictly follow naming conventions */
/* eslint-disable camelcase */
export default {
	epsilon: 1e-11,

	swapVec( v ) {

		return { x: v.x, y: v.z, z: v.y };

	},

	swapQuat( q ) {

		return { w: q.w, x: - q.x, y: - q.z, z: - q.y };

	},

	getTransform( n, swapYZ ) {

		const source = n.transform ? n.transform : n;
		return {
			translation: swapYZ ? this.swapVec( source.translation ) : source.translation,
			rotation: swapYZ ? this.swapQuat( source.rotation ) : source.rotation,
			scale: swapYZ ? this.swapVec( source.scale ) : source.scale,
		};

	},

	deleteTransform( n ) {

		if ( n.transform ) delete n.transform;
		if ( n.translation ) delete n.translation;
		if ( n.rotation ) delete n.rotation;
		if ( n.scale ) delete n.scale;

	},

	getAABB( n, swapYZ ) {

		const box = n.bounds ? { min: n.bounds.min, max: n.bounds.max } : { min: n.bounds_min, max: n.bounds_max };
		if ( swapYZ ) {

			box.min = this.swapVec( box.min );
			box.max = this.swapVec( box.max );

		}

		return box;

	},

	getOBB( n, swapYZ ) {

		let box = {};
		if ( n.oriented_bounds ) {

			box = { min: n.oriented_bounds.min, max: n.oriented_bounds.max, rotation: n.oriented_bounds_rotation };

		} else {

			box = this.getAABB( n, false );
			box.rotation = null;

		}

		if ( swapYZ ) {

			box.min = this.swapVec( box.min );
			box.max = this.swapVec( box.max );
			if ( box.rotation ) box.rotation = this.swapQuat( box.rotation );

		}

		return box;

	},

	aabbContainsPt( /* THREE.Box3 */ aabb, /* THREE.Vector3 */ pt ) {

		return ! (
			pt.x < aabb.min.x - this.epsilon ||
      pt.x > aabb.max.x + this.epsilon ||
      pt.y < aabb.min.y - this.epsilon ||
      pt.y > aabb.max.y + this.epsilon ||
      pt.z < aabb.min.z - this.epsilon ||
      pt.z > aabb.max.z + this.epsilon
		);

	},

	boxCorner( /* THREE.Box3 */ box, /* 0-7 */ idx ) {

		const c = new THREE.Vector3().copy( box.min );
		if ( idx & ( 1 << 0 ) ) c.x = box.max.x; //eslint-disable-line no-bitwise
		if ( idx & ( 1 << 1 ) ) c.y = box.max.y; //eslint-disable-line no-bitwise
		if ( idx & ( 1 << 2 ) ) c.z = box.max.z; //eslint-disable-line no-bitwise
		return c;

	},

	aabbCorners( /* THREE.Box3 */ aabb ) {

		const corners = [];
		for ( let i = 0; i < 8; ++ i ) corners.push( this.boxCorner( aabb, i ) );
		return corners;

	},

	extendLimits( limits, loc ) {

		limits.min = Math.min( limits.min, loc );
		limits.max = Math.max( limits.max, loc );
		return limits;

	},

	initLimits( /* THREE.Box3 */ aabb, /* 0-2 */ dim, /* THREE.Vector3[] */ points, /* THREE.Vector3 */ axis ) {

		const limits = { min: Infinity, max: - Infinity };
		if ( aabb && dim ) {

			this.extendLimits( limits, aabb.min.getComponent( dim ) );
			this.extendLimits( limits, aabb.max.getComponent( dim ) );

		}

		if ( points && axis ) for ( let i = 0; i < points.length; ++ i ) this.extendLimits( limits, points[ i ].dot( axis ) );
		return limits;

	},

	aabbContainsOBB( /* THREE.Box3 */ aabb, /* THREE.Box3 */ obb, /* THREE.Matrix4 */ obbMatrix ) {

		for ( let i = 0; i < 8; ++ i ) {

			if ( ! this.aabbContainsPt( aabb, this.boxCorner( obb, i ).applyMatrix4( obbMatrix ) ) ) return false;

		}

		return true;

	},

	aabbIntersectsOBB( /* THREE.Box3 */ aabb, /* THREE.Box3 */ obb, /* THREE.Matrix4 */ obbMatrix ) {

		const aabbCorners = [];
		const obbCorners = [];
		for ( let i = 0; i < 8; ++ i ) {

			aabbCorners.push( this.boxCorner( aabb, i ) );
			obbCorners.push( this.boxCorner( obb, i ).applyMatrix4( obbMatrix ) );

		}

		const self = this;
		function axisSeparates( axis, aabbDim, obbDim ) {

			if ( axis.lengthSq() < self.epsilon ) return false;
			const al = self.initLimits( aabb, aabbDim, aabbCorners, axis );
			const ol = self.initLimits( obb, obbDim, obbCorners, axis );
			return al.max < ol.min || al.min > ol.max;

		}

		const axis = new THREE.Vector3();
		function setAxis( dim ) {

			axis.set( 0, 0, 0 ).setComponent( dim, 1 );
			return axis;

		}

		for ( let i = 0; i < 3; ++ i ) if ( axisSeparates( setAxis( i ), i ) ) return false;

		const obbAxis = [];
		for ( let i = 0; i < 3; ++ i ) {

			const a = new THREE.Vector3( 0, 0, 0 );
			a.setComponent( i, 1 );
			a.transformDirection( obbMatrix );
			if ( axisSeparates( a, null, i ) ) return false;
			obbAxis.push( a );

		}

		for ( let i = 0; i < 3; ++ i ) {

			for ( let j = 0; j < 3; ++ j ) {

				if ( axisSeparates( setAxis( i ).cross( obbAxis[ j ] ) ) ) return false;

			}

		}

		return true;

	},

	aabbContainsMesh(
		/* THREE.Box3 */ aabb,
		/* THREE.Geometry|THREE.BufferGeometry */ mesh,
		/* THREE.Matrix4 */ meshMatrix
	) {

		const vert = new THREE.Vector3();
		if ( mesh.vertices ) {

			for ( let i = 0; i < mesh.vertices.length; ++ i ) {

				if ( ! this.aabbContainsPt( aabb, vert.copy( mesh.vertices[ i ] ).applyMatrix4( meshMatrix ) ) ) return false;

			}

		} else if ( mesh.attributes && mesh.attributes.position ) {

			const positions = mesh.attributes.position.array;
			for ( let i = 0; i < positions.length; i += 3 ) {

				if ( ! this.aabbContainsPt( aabb, vert.fromArray( positions, i ).applyMatrix4( meshMatrix ) ) ) return false;

			}

		} else throw new Error( 'threejs geometry has neither vertices nor attributes.position' );
		return true;

	},

	_aabbContainsTri( /* THREE.Box3 */ aabb, /* THREE.Vector3[3] */ triVerts ) {

		for ( let i = 0; i < 3; i ++ ) if ( ! this.aabbContainsPt( aabb, triVerts[ i ] ) ) return false;
		return true;

	},

	aabbContainsTri( /* THREE.Box3 */ aabb, /* THREE.Vector3[3] */ tri, /* THREE.Matrix4 */ triMatrix ) {

		const triVerts = [ new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3() ];
		for ( let i = 0; i < 3; i ++ ) triVerts[ i ].copy( tri[ i ] ).applyMatrix4( triMatrix );
		return this._aabbContainsTri( aabb, triVerts );

	},

	_aabbIntersectsTri(
		/* THREE.Box3 */ aabb,
		/* THREE.Vector3[8] */ aabbCorners,
		/* THREE.Vector3[3] */ triVerts,
		/* THREE.Vector3[3] (workspace) */ triEdges,
		/* THREE.Vector3 (workspace) */ axis
	) {

		const self = this;
		function axisSeparates( _axis, aabbDim, triNormal ) {

			if ( _axis.lengthSq() < self.epsilon ) return false;
			const bl = self.initLimits( aabb, aabbDim, aabbCorners, _axis );
			const tl = triNormal
				? self.initLimits( null, null, [ triVerts[ 0 ] ], _axis )
				: self.initLimits( null, null, triVerts, _axis );
			return bl.max < tl.min || bl.min > tl.max;

		}

		function setAxis( dim ) {

			axis.set( 0, 0, 0 ).setComponent( dim, 1 );
			return axis;

		}

		for ( let i = 0; i < 3; ++ i ) if ( axisSeparates( setAxis( i ), i ) ) return false; //box face normals

		triEdges[ 0 ].subVectors( triVerts[ 1 ], triVerts[ 0 ] );
		triEdges[ 1 ].subVectors( triVerts[ 2 ], triVerts[ 0 ] );

		if ( axisSeparates( axis.crossVectors( triEdges[ 0 ], triEdges[ 1 ] ), null, true ) ) return false; //triangle normal

		triEdges[ 2 ].subVectors( triVerts[ 2 ], triVerts[ 1 ] );

		for ( let i = 0; i < 3; i ++ ) {

			for ( let j = 0; j < 3; j ++ ) {

				if ( axisSeparates( setAxis( i ).cross( triEdges[ j ] ) ) ) return false; //edge cross products

			}

		}

		return true;

	},

	aabbIntersectsTri( /* THREE.Box3 */ aabb, /* THREE.Vector3[3] */ tri, /* THREE.Matrix4 */ triMatrix ) {

		const triVerts = [ new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3() ];
		for ( let i = 0; i < 3; i ++ ) triVerts[ i ].copy( tri[ i ] ).applyMatrix4( triMatrix );
		const triEdges = [ new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3() ];
		return this._aabbIntersectsTri( aabb, this.aabbCorners( aabb ), triVerts, triEdges, new THREE.Vector3() );

	},

	_forEachTriangle(
		/* THREE.Geometry|THREE.BufferGeometry */ mesh,
		/* THREE.Matrix4 */ meshMatrix,
		cb,
		/* THREE.Vector3[3] (workspace) */ triVerts
	) {

		if ( mesh.vertices && mesh.faces ) {

			for ( let i = 0; i < mesh.faces.length; ++ i ) {

				triVerts[ 0 ].copy( mesh.vertices[ mesh.faces[ i ].a ] ).applyMatrix4( meshMatrix );
				triVerts[ 1 ].copy( mesh.vertices[ mesh.faces[ i ].b ] ).applyMatrix4( meshMatrix );
				triVerts[ 2 ].copy( mesh.vertices[ mesh.faces[ i ].c ] ).applyMatrix4( meshMatrix );
				if ( cb( triVerts, i ) ) return true;

			}

		} else if ( mesh.attributes && mesh.attributes.position && mesh.index ) {

			const positions = mesh.attributes.position.array;
			const indices = mesh.index.array;
			for ( let i = 0; i < indices.length; i += 3 ) {

				for ( let j = 0; j < 3; ++ j ) triVerts[ j ].fromArray( positions, indices[ i + j ] * 3 ).applyMatrix4( meshMatrix );
				if ( cb( triVerts, i / 3 ) ) return true;

			}

		} else if ( mesh.attributes && mesh.attributes.position ) {

			const positions = mesh.attributes.position.array;
			for ( let i = 0; i < positions.length; i += 9 ) {

				for ( let j = 0; j < 3; ++ j ) triVerts[ j ].fromArray( positions, i + j * 3 ).applyMatrix4( meshMatrix );
				if ( cb( triVerts, i / 9 ) ) return true;

			}

		} else throw new Error( 'threejs geometry has neither vertices/faces nor attributes.position' );
		return false;

	},

	//callback cb has signature (THREE.Vector3[3] tri, int triIndex) => bool
	//cb is called for each triangle in order from 0 through numTris-1
	//if cb returns true then further iteration is short-circuited and this function returns true
	//if cb never returns true then all triangles are enumerated and this function returns false
	forEachTriangle( /* THREE.Geometry|THREE.BufferGeometry */ mesh, /* THREE.Matrix4 */ meshMatrix, cb ) {

		const triVerts = [ new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3() ];
		return this._forEachTriangle( mesh, meshMatrix, cb, triVerts );

	},

	aabbIntersectsMesh(
		/* THREE.Box3 */ aabb,
		/* THREE.Geometry|THREE.BufferGeometry */ mesh,
		/* THREE.Matrix4 */ meshMatrix
	) {

		const triVerts = [ new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3() ];
		const triEdges = [ new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3() ];
		const corners = this.aabbCorners( aabb );
		const axis = new THREE.Vector3();
		return this._forEachTriangle(
			mesh,
			meshMatrix,
			tri => this._aabbIntersectsTri( aabb, corners, tri, triEdges, axis ),
			triVerts
		);

	},

	numTriangles( /* THREE.Geometry|THREE.BufferGeometry */ mesh ) {

		if ( mesh.vertices && mesh.faces ) return mesh.faces.length;
		else if ( mesh.attributes && mesh.attributes.position && mesh.index ) return mesh.index.array.length / 3;
		else if ( mesh.attributes && mesh.attributes.position ) return mesh.attributes.position.array.length / 9;
		throw new Error( 'threejs geometry has neither vertices/faces nor attributes.position' );

	},

	//returns { float[] vertices, int[] normals, int[] colors, int[] triangles }
	//normals/colors will either be null or will be the same length as vertices
	//length of triangles will be a multiple of 3
	extractArrays( /* THREE.Geometry|Three.BufferGeometry */ mesh ) {

		let vertices = null;
		if ( mesh.vertices ) {

			vertices = new Array( 3 * mesh.vertices.length );
			for ( let i = 0; i < mesh.vertices.length; i ++ ) {

				for ( let j = 0; j < 3; j ++ ) vertices[ 3 * i + j ] = mesh.vertices[ i ].getComponent( j );

			}

		} else if ( mesh.attributes && mesh.attributes.position ) {

			vertices = Array.from( mesh.attributes.position.array );

		} else throw new Error( 'threejs geometry has neither vertices nor attributes.position' );

		let normals = null;
		if ( mesh.faces ) {

			normals = new Array( 9 * mesh.faces.length );
			for ( let i = 0; i < mesh.faces.length; ++ i ) {

				const f = mesh.faces[ i ];
				if ( f.vertexNormals ) {

					for ( let j = 0; j < 3; j ++ ) {

						for ( let k = 0; k < 3; k ++ ) {

							normals[ 9 * i + 3 * j + k ] = f.vertexNormals[ j ].getComponent( k );

						}

					}

				} else {

					for ( let j = 0; j < 3; j ++ ) {

						for ( let k = 0; k < 3; k ++ ) {

							normals[ 9 * i + 3 * j + k ] = f.normal.getComponent( k );

						}

					}

				}

			}

		} else if ( mesh.normals ) {

			normals = new Array( 3 * mesh.normals.length );
			for ( let i = 0; i < mesh.normals.length; ++ i ) {

				for ( let j = 0; j < 3; ++ j ) {

					normals[ 3 * i + j ] = mesh.normals[ i ].getComponent( j );

				}

			}

		} else if ( mesh.attributes && mesh.attributes.normal ) {

			normals = Array.from( mesh.attributes.normal.array );

		}

		if ( normals && normals.length !== vertices.length ) normals = null;

		let colors = null;
		if ( mesh.faces ) {

			colors = new Array( 9 * mesh.faces.length );
			for ( let i = 0; i < mesh.faces.length; ++ i ) {

				const f = mesh.faces[ i ];
				if ( f.vertexColors ) {

					for ( let j = 0; j < 3; j ++ ) {

						for ( let k = 0; k < 3; k ++ ) colors[ 9 * i + 3 * j + k ] = f.vertexColors[ j ].getComponent( k );

					}

				} else {

					for ( let j = 0; j < 3; j ++ ) {

						for ( let k = 0; k < 3; k ++ ) colors[ 9 * i + 3 * j + k ] = f.color.getComponent( k );

					}

				}

			}

		} else if ( mesh.colors ) {

			colors = new Array( 3 * mesh.colors.length );
			for ( let i = 0; i < mesh.colors.length; ++ i ) {

				for ( let j = 0; j < 3; ++ j ) colors[ 3 * i + j ] = mesh.colors[ i ].getComponent( j );

			}

		} else if ( mesh.attributes && mesh.attributes.color ) {

			colors = Array.from( mesh.attributes.color.array );

		}

		if ( colors && colors.length !== vertices.length ) colors = null;

		let triangles = null;
		if ( mesh.faces ) {

			triangles = new Array( 3 * mesh.faces.length );
			for ( let i = 0; i < mesh.faces.length; ++ i ) {

				triangles[ 3 * i + 0 ] = mesh.faces[ i ].a;
				triangles[ 3 * i + 1 ] = mesh.faces[ i ].b;
				triangles[ 3 * i + 2 ] = mesh.faces[ i ].c;

			}

		} else if ( mesh.attributes && mesh.attributes.position && mesh.index ) {

			triangles = Array.from( mesh.index.array );

		} else if ( mesh.attributes && mesh.attributes.position ) {

			const nv = mesh.attributes.position.array.length / 3;
			triangles = new Array( nv );
			for ( let i = 0; i < nv; ++ i ) triangles[ i ] = i;

		} else throw new Error( 'threejs geometry has neither faces nor attributes.position' );

		return { vertices, normals, colors, triangles };

	},

	//extract the position, normal, and color of a vertex from a mesh
	//the returned normal and/or color will be null if those attributes were not present in the mesh
	//xform is an optional transform to apply to the returned position and normal
	//the optional passed THREE.Vector3 position and normal and/or THREE.Color color avoid allocation
	extractVertex( /* THREE.Geometry|Three.BufferGeometry */ mesh, index, xform, position, normal, color ) {

		position = position || new THREE.Vector3();
		if ( mesh.vertices ) position.copy( mesh.vertices[ index ] );
		else if ( mesh.attributes && mesh.attributes.position ) {

			const arr = mesh.attributes.position.array;
			position.x = arr[ 3 * index + 0 ];
			position.y = arr[ 3 * index + 1 ];
			position.z = arr[ 3 * index + 2 ];

		} else throw new Error( 'threejs geometry has neither vertices nor attributes.position' );

		if ( mesh.faces ) {

			normal = normal || new THREE.Vector3();
			const f = mesh.faces[ Math.floor( index / 3 ) ];
			normal.copy( f.vertexNormals ? f.vertexNormals[ index % 3 ] : f.normal );

		} else if ( mesh.normals ) {

			normal = normal || new THREE.Vector3();
			normal.copy( mesh.normals[ index ] );

		} else if ( mesh.attributes && mesh.attributes.normal ) {

			normal = normal || new THREE.Vector3();
			const arr = mesh.attributes.normal.array;
			normal.x = arr[ 3 * index + 0 ];
			normal.y = arr[ 3 * index + 1 ];
			normal.z = arr[ 3 * index + 2 ];

		} else normal = null;

		if ( normal ) normal.normalize(); //handles case of Int8 encoded normals

		if ( mesh.faces ) {

			color = color || new THREE.Color();
			const f = mesh.faces[ Math.floor( index / 3 ) ];
			color.copy( f.vertexColors ? f.vertexColors[ index % 3 ] : f.color );

		} else if ( mesh.colors ) {

			color = color || new THREE.Color();
			color.copy( mesh.colors[ index ] );

		} else if ( mesh.attributes && mesh.attributes.color ) {

			color = color || new THREE.Color();
			const arr = mesh.attributes.color.array;
			color.r = arr[ 3 * index + 0 ];
			color.g = arr[ 3 * index + 1 ];
			color.b = arr[ 3 * index + 2 ];

		} else color = null;

		if ( xform ) {

			position.applyMatrix4( xform );
			if ( normal ) normal.transformDirection( xform );

		}

		return { position, normal, color };

	},

	//mode: 'keepInside'|'keepIntersecting'|'deleteInside'|'deleteIntersecting'|'clipInside'|'clipOutside'
	//returns { cut_mesh, tris }
	aabbCutMesh(
		/* THREE.Box3 */ aabb,
		/* THREE.Geometry|THREE.BufferGeometry */ mesh,
		/* THREE.Matrix4 */ meshMatrix,
		mode,
		dbg
	) {

		const inside = mode === 'keepInside' || mode === 'keepIntersecting' || mode === 'clipInside';
		const intersecting = mode === 'keepIntersecting' || mode === 'deleteInside';
		const clip = mode === 'clipInside' || mode === 'clipOutside';

		const nt = this.numTriangles( mesh );
		if ( nt === 0 ) return { cut_mesh: mesh, tris: nt };

		//compute status of each triangle (note it is not correct to just consider
		//whether each vertex is in the box because a triangle whose vertices are
		//all outside the box can still intersect the box)
		const tri_status = { OUT: 0, IN: 1, CROSSING: 2 };
		const status = new Array( nt );
		let crossing_tris = 0;
		let full_tris = 0;
		const triVerts = [ new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3() ];
		const triEdges = [ new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3() ];
		const corners = this.aabbCorners( aabb );
		const axis = new THREE.Vector3();
		this._forEachTriangle(
			mesh,
			meshMatrix,
			( tri, i ) => {

				let s = tri_status.CROSSING;
				if ( this._aabbContainsTri( aabb, tri ) ) s = tri_status.IN;
				else if ( ! this._aabbIntersectsTri( aabb, corners, tri, triEdges, axis ) ) s = tri_status.OUT;
				status[ i ] = s;
				if ( s === tri_status.CROSSING ) ++ crossing_tris;
				else if ( ( inside && s === tri_status.IN ) || ( ! inside && s === tri_status.OUT ) ) ++ full_tris;
				return false;

			},
			triVerts
		);

		if ( dbg ) console.log( `${nt} tris, ${full_tris} full tris, ${crossing_tris} crossing tris` );

		const makeMesh = ( /* float[] */ vertices, /* int[] */ indices, /* int[] */ normals, /* int[] */ colors ) => {

			const m = new THREE.BufferGeometry();
			m.normals = []; //IDK why this is necessary, copied from PLYLoader.js
			delete m.normals; //IDK why this is necessary, copied from PLYLoader.js
			m.setIndex( new THREE.BufferAttribute( Uint32Array.from( indices ), 1 ) );
			m.addAttribute( 'position', new THREE.BufferAttribute( Float32Array.from( vertices ), 3 ) );
			if ( normals ) m.addAttribute( 'normal', new THREE.BufferAttribute( Int8Array.from( normals ), 3, true ) );
			if ( colors ) m.addAttribute( 'color', new THREE.BufferAttribute( Uint8Array.from( colors ), 3, true ) );
			return m;

		};

		if ( full_tris === nt || ( full_tris === 0 && crossing_tris === 0 ) ) {

			if ( status[ 0 ] === tri_status.IN ) {

				//mesh is entirely inside box
				if ( inside ) {

					if ( dbg ) console.log( 'entirely inside box, keeping whole mesh' );
					return { cut_mesh: mesh, tris: nt };

				}

				if ( dbg ) console.log( 'entirely inside box, returning empty mesh' );
				return { cut_mesh: makeMesh( [], [] ), tris: 0 };

			} //mesh is entirely outside box

			if ( ! inside ) {

				if ( dbg ) console.log( 'entirely outside box, keeping whole mesh' );
				return { cut_mesh: mesh, tris: nt };

			}

			if ( dbg ) console.log( 'entirely outside box, returning empty mesh' );
			return { cut_mesh: makeMesh( [], [] ), tris: 0 };

		}

		//get here iff some part of the mesh is inside the box and some part is outside

		let { vertices: ret_verts, normals: ret_normals, colors: ret_colors, triangles } = this.extractArrays( mesh ); //eslint-disable-line prefer-const

		const has_normals = ret_normals != null,
			has_colors = ret_colors != null;
		if ( dbg ) console.log( `normals: ${has_normals}, colors: ${has_colors}` );

		//init new index array
		let ret_tris = new Array( 3 * ( full_tris + ( intersecting ? crossing_tris : 0 ) ) );
		let t = 0; //next write index in ret_tris

		//copy all fully included triangles
		for ( let i = 0; i < nt; ++ i ) {

			if ( ( inside && status[ i ] === tri_status.IN ) || ( ! inside && status[ i ] === tri_status.OUT ) ) {

				for ( let j = 0; j < 3; ++ j ) ret_tris[ t ++ ] = triangles[ 3 * i + j ];

			}

		}

		if ( intersecting ) {

			//copy all crossing triangles
			for ( let i = 0; i < nt; ++ i ) {

				if ( status[ i ] === tri_status.CROSSING ) for ( let j = 0; j < 3; ++ j ) ret_tris[ t ++ ] = triangles[ 3 * i + j ];

			}

		} else if ( clip ) {

			//clip all crossing triangles & copy the results
			const clipped_verts = [],
				clipped_tris = [],
				clipped_normals = [],
				clipped_colors = [];

			const triNormals = has_normals ? [ new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3() ] : null;
			const triColors = has_colors ? [ new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3() ] : null;
			const tmp = has_normals || has_colors ? new THREE.Vector3() : null;
			const tmp3 = has_normals || has_colors ? [ new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3() ] : null;

			const box_to_mesh = new THREE.Matrix4();
			box_to_mesh.getInverse( meshMatrix, /* throwOnDegenerate */ true );

			const self = this;
			function addClippedTri( child ) {

				for ( let j = 0; j < 3; j ++ ) {

					for ( let k = 0; k < 3; k ++ ) clipped_verts.push( child[ j ].getComponent( k ) );
					clipped_tris.push( t ++ );
					if ( has_normals ) {

						const normal = self._barycentricInterpolate( triVerts, child[ j ], triNormals, tmp, tmp3 );
						for ( let k = 0; k < 3; k ++ ) clipped_normals.push( normal.getComponent( k ) );

					}

					if ( has_colors ) {

						const color = self._barycentricInterpolate( triVerts, child[ j ], triColors, tmp, tmp3 );
						for ( let k = 0; k < 3; k ++ ) clipped_colors.push( color.getComponent( k ) );

					}

				}

			}

			t = ret_verts.length / 3;
			for ( let i = 0; i < nt; ++ i ) {

				if ( status[ i ] === tri_status.CROSSING ) {

					for ( let j = 0; j < 3; ++ j ) triVerts[ j ].fromArray( ret_verts, 3 * triangles[ 3 * i + j ] );
					if ( has_normals ) for ( let j = 0; j < 3; ++ j ) triNormals[ j ].fromArray( ret_normals, 3 * triangles[ 3 * i + j ] );
					if ( has_colors ) for ( let j = 0; j < 3; ++ j ) triColors[ j ].fromArray( ret_colors, 3 * triangles[ 3 * i + j ] );
					this.aabbClipTri( aabb, triVerts, addClippedTri, inside, box_to_mesh );

				}

			}

			ret_verts = ret_verts.concat( clipped_verts );
			ret_tris = ret_tris.concat( clipped_tris );
			if ( has_normals ) ret_normals = ret_normals.concat( clipped_normals );
			if ( has_colors ) ret_colors = ret_colors.concat( clipped_colors );

		}

		//reindex to drop orphan vertices
		const index_map = new Map();
		let unique_verts = 0;
		for ( let i = 0; i < ret_tris.length; ++ i ) {

			const old_index = ret_tris[ i ];
			if ( ! index_map.has( old_index ) ) {

				const new_index = unique_verts ++;
				index_map.set( old_index, new_index );
				ret_tris[ i ] = new_index;

			} else ret_tris[ i ] = index_map.get( old_index );

		}

		const tmp_verts = new Array( 3 * unique_verts );
		index_map.forEach( ( /* value */ new_index, /* key */ old_index ) => {

			for ( let i = 0; i < 3; ++ i ) tmp_verts[ 3 * new_index + i ] = ret_verts[ 3 * old_index + i ];

		} );
		ret_verts = tmp_verts;

		if ( has_normals ) {

			const tmp_normals = new Array( 3 * unique_verts );
			index_map.forEach( ( /* value */ new_index, /* key */ old_index ) => {

				for ( let i = 0; i < 3; ++ i ) tmp_normals[ 3 * new_index + i ] = ret_normals[ 3 * old_index + i ];

			} );
			ret_normals = tmp_normals;

		}

		if ( has_colors ) {

			const tmp_colors = new Array( 3 * unique_verts );
			index_map.forEach( ( /* value */ new_index, /* key */ old_index ) => {

				for ( let i = 0; i < 3; ++ i ) tmp_colors[ 3 * new_index + i ] = ret_colors[ 3 * old_index + i ];

			} );
			ret_colors = tmp_colors;

		}

		const ret = makeMesh( ret_verts, ret_tris, ret_normals, ret_colors );
		ret.computeBoundingSphere();
		return { cut_mesh: ret, tris: ret_tris.length / 3 };

	},

	//planeDistance is the perpendicular distance from the origin to the plane in the direction of planeNormal
	//emits 0, 1, or 2 triangles on the side of the plane where planeNormal points out
	//callback cb takes an array THREE.Vector3[3] of the vertices of an emitted triangle
	triClipPlane( /* THREE.Vector3[3] */ tri, /* THREE.Vector3 */ planeNormal, planeDistance, cb ) {

		const eps = 1e-7;
		const clippedPts = [];
		const addPoint = pt => {

			for ( let i = 0; i < clippedPts.length; i ++ ) if ( clippedPts[ i ].distanceToSquared( pt ) < eps ) return;
			clippedPts.push( pt );

		};

		function clipEdge( e0, e1 ) {

			const e0_dist = e0.dot( planeNormal ) - planeDistance;
			const e1_dist = e1.dot( planeNormal ) - planeDistance;

			if ( e0_dist < 0 && e1_dist < 0 ) return; // both below plane
			if ( e0_dist >= 0 && e1_dist >= 0 ) {

				addPoint( e0 );
				addPoint( e1 );
				return;

			} // both above plane

			//const denom = planeNormal.dot(e1 - e0)
			const denom = planeNormal.x * ( e1.x - e0.x ) + planeNormal.y * ( e1.y - e0.y ) + planeNormal.z * ( e1.z - e0.z );
			const t = ( planeDistance - e0.dot( planeNormal ) ) / denom;
			if ( t < eps || t > 1 + eps || isNaN( t ) ) {

				// degenerate case
				addPoint( e0 );
				addPoint( e1 );

			} else {

				//cont p = e0 + (e1 - e0) * t
				const p = new THREE.Vector3()
					.copy( e1 )
					.sub( e0 )
					.multiplyScalar( t )
					.add( e0 );
				if ( e0_dist >= 0 ) {

					// e0 is above the plane
					addPoint( e0 );
					addPoint( p );

				} else {

					// e1 is above the plane
					addPoint( p );
					addPoint( e1 );

				}

			}

		}

		clipEdge( tri[ 0 ], tri[ 1 ] );
		clipEdge( tri[ 1 ], tri[ 2 ] );
		clipEdge( tri[ 2 ], tri[ 0 ] );

		if ( clippedPts.length > 4 ) throw new Error( 'too many points created in triClipPlane()' );
		else if ( clippedPts.length === 3 ) cb( [ clippedPts[ 0 ], clippedPts[ 1 ], clippedPts[ 2 ] ] );
		else if ( clippedPts.length === 4 ) {

			cb( [ clippedPts[ 0 ], clippedPts[ 1 ], clippedPts[ 3 ] ] );
			cb( [ clippedPts[ 1 ], clippedPts[ 2 ], clippedPts[ 3 ] ] );

		}
		//do nothing if clippedPts.length < 3

	},

	//probably only correct if box_to_tri has no shear
	//callback cb takes an array THREE.Vector3[3] of the vertices of an emitted triangle
	aabbClipTri( /* THREE.Box3 */ aabb, /* THREE.Vector3[3] */ tri, cb, keep_inside, /* THREE.Matrix4 */ box_to_tri ) {

		let tris_in = [];
		let tris_out = [];

		tris_in.push( tri );

		const box_ctr = aabb.getCenter( new THREE.Vector3() );
		const box_size = aabb.getSize( new THREE.Vector3() );

		const dir = new THREE.Vector3();
		const planeNormal = new THREE.Vector3();

		function addTri( dest ) {

			return child => dest.push( child );

		}

		for ( let i = 0; i < 3; ++ i ) {

			for ( let j = - 1; j <= 1; j += 2 ) {

				dir.set( 0, 0, 0 ).setComponent( i, j );

				//planeNormal = (box_to_tri * dir).normalized() //outward-pointing
				planeNormal.copy( dir ).transformDirection( box_to_tri );

				//planeDistance = (box_to_tri * (box_ctr + dir*(box_size[i]/2))).dot(planeNormal)
				let planeDistance = dir
					.multiplyScalar( box_size.getComponent( i ) / 2 )
					.add( box_ctr )
					.applyMatrix4( box_to_tri )
					.dot( planeNormal );

				//if we're keeping the triangles inside the box we take the
				//intersection of the results from each of the 6 planes, so the output
				//from the previous plane becomes the input to the next
				if ( keep_inside ) {

					planeNormal.multiplyScalar( - 1 );
					planeDistance = - planeDistance; //inward-pointing
					if ( ! ( i === 0 && j === - 1 ) ) {

						tris_in = tris_out;
						tris_out = [];

					}

				}

				for ( const p of tris_in ) this.triClipPlane( p, planeNormal, planeDistance, addTri( tris_out ) );

				//if we're keeping the triangles outside the box we accumulate the union
				//of the 6 plane intersections in tris_out, but also at each stage we
				//update tris_in to only contain the remaining portion of the
				//triangles inside the intersection of all the already-processed planes
				if ( ! keep_inside ) {

					planeNormal.multiplyScalar( - 1 );
					planeDistance = - planeDistance; //inward-pointing

					const tris_tmp = [];
					for ( const p of tris_in ) this.triClipPlane( p, planeNormal, planeDistance, addTri( tris_tmp ) );

					tris_in = tris_tmp;

				}

			}

		}

		tris_out.forEach( t => cb( t ) );

	},

	_barycentricInterpolate(
		/* THREE.Vector3[3] */ tri,
		/* THREE.Vector3 */ p,
		/* THREE.Vector3[3] */ q,
		/* THREE.Vector3 (workspace) */ ret,
		/* THREE.Vector3[3] (workspace) */ vv
	) {

		//non-degenerate codepath here is from Real Time Collision Detection p. 47
		//v0 = tri[1] - tri[0], v1 = tri[2] - tri[0], v2 = p - tri[0]
		vv[ 0 ].subVectors( tri[ 1 ], tri[ 0 ] );
		vv[ 1 ].subVectors( tri[ 2 ], tri[ 0 ] );
		vv[ 2 ].subVectors( p, tri[ 0 ] );
		const v00 = vv[ 0 ].dot( vv[ 0 ] ),
			v01 = vv[ 0 ].dot( vv[ 1 ] ),
			v11 = vv[ 1 ].dot( vv[ 1 ] ),
			v20 = vv[ 2 ].dot( vv[ 0 ] ),
			v21 = vv[ 2 ].dot( vv[ 1 ] );
		const d = v00 * v11 - v01 * v01;
		if ( d < 10e-7 ) {

			//ret = abs(v20) > abs(v21) ? v20*q[1] + (1-v20)*q[0] : v21*q[2] + (1-v21)*q[0];
			if ( Math.abs( v20 ) > Math.abs( v21 ) )
				ret
					.copy( q[ 1 ] )
					.multiplyScalar( v20 )
					.addScaledVector( q[ 0 ], 1 - v20 );
			else
				ret
					.copy( q[ 2 ] )
					.multiplyScalar( v21 )
					.addScaledVector( q[ 0 ], 1 - v21 );

		} else {

			const v = ( v11 * v20 - v01 * v21 ) / d;
			const w = ( v00 * v21 - v01 * v20 ) / d;
			const u = 1 - v - w;
			//ret = u*q[0] + v*q[1] + w*q[2]
			ret
				.copy( q[ 0 ] )
				.multiplyScalar( u )
				.addScaledVector( q[ 1 ], v )
				.addScaledVector( q[ 2 ], w );

		}

		return ret;

	},

	//interpolate q at p in tri
	//tri is an array of the vertices of the triangle
	//p is a 3d point in the same coordinate frame as the vertices
	//q is an array of three vectors to interpolate
	//the vectors in q are associated to the vertices in order, but don't need to be in the same coordinate frame
	//returns an interpolated vector in the same coordinate frame as the vectors in q
	barycentricInterpolate( /* THREE.Vector3[3] */ tri, /* THREE.Vector3 */ p, /* THREE.Vector3[3] */ q ) {

		return this._barycentricInterpolate( tri, p, q, new THREE.Vector3(), [
			new THREE.Vector3(),
			new THREE.Vector3(),
			new THREE.Vector3(),
		] );

	},
};
