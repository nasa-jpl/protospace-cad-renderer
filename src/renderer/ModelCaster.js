import * as THREE from 'three';
import MeshPool from './MeshPool.js';
import GeometryUtilities from '../utilities/GeometryUtilities.js';

// Static helper class for casting a ray against a model
export default class ModelCaster {

	// pixel must be a -1 to 1 vector representing where in the camera view to cast from
	// returns { hitNode, hitMesh, hitPoint, hitNormal }
	// hitNode: the model hierarchy tree node that was hit
	// hitMesh: index of mesh on hitNode that was hit
	// hitPoint: 3D hit point in world frame
	// hitNormal: model surface normal at hitPoint in world frame
	// modelToWorld: Matrix4 taking model frame to world frame
	// worldToModel: Matrix4 taking world frame to model frame, or omit to infer as inverse of modelToWorld
	static raycast( model, camera, pixel, modelToWorld, worldToModel ) {

		worldToModel = worldToModel || new THREE.Matrix4().copy( modelToWorld ).invert();

		const modelFrame = new THREE.Object3D();
		modelFrame.matrix = modelFrame.matrixWorld = modelToWorld;
		modelFrame.matrixAutoUpdate = false;

		const scene = new THREE.Scene();
		scene.add( modelFrame );

		model.refreshTransforms();
		model.refreshBounds();

		// find candidates to cast against
		const candidates = [];
		const ray = new THREE.Ray();
		const raycaster = new THREE.Raycaster();
		raycaster.setFromCamera( pixel, camera );
		model.iterateOverHierarchy( n => {

			if ( ! n || ! n.cached.enabledInTree || ! n.cached.visibleInTree ) {

				return true;

			} // prune

			ray.copy( raycaster.ray );
			ray.applyMatrix4( worldToModel );
			ray.applyMatrix4( n.cached.modelToOBB );

			if ( ! ray.intersectsBox( n.cached.threejsOBB ) ) {

				return true;

			} // prune

			if ( n.geometry && n.cached.ownTriangles > 0 && n.cached.pendingMeshLoads <= 0 ) {

				for ( let i = 0; i < n.geometry.length; i ++ ) {

					const mi = n.geometry[ i ];
					if ( ! mi.cached.triangles || ! mi.cached.threejsGeometry ) continue;

					const mesh = MeshPool.allocate();
					mesh.geometry = mi.cached.threejsGeometry;
					mesh.material = mi.cached.threejsMaterial;
					mesh.matrix = mi.cached.meshToModel;
					mesh.visible = true;
					modelFrame.add( mesh );
					mesh.updateMatrixWorld( true );
					mesh._treeNode = n;
					mesh._meshIndex = i;

					candidates.push( mesh );

				}

			}

			return false;

		} );

		// run the ray cast
		const intersects = raycaster.intersectObjects( candidates, true );

		let hitNode = null,
			hitMesh = - 1,
			hitPoint = null,
			hitNormal = null;
		if ( intersects.length > 0 ) {

			const intersection = intersects[ 0 ];
			hitPoint = intersection.point;

			const mesh = intersection.object;
			hitNode = mesh._treeNode;
			hitMesh = mesh._meshIndex;

			const geom = mesh.geometry;
			const face = intersection.face,
				indices = intersection.indices;
			let tri = null;
			if ( face ) tri = [ face.a, face.b, face.c ];
			else if ( indices ) tri = indices;
			if ( tri ) {

				const verts = tri.map( index => GeometryUtilities.extractVertex( geom, index, mesh.matrixWorld ) );
				const positions = verts.map( v => v.position ),
					normals = verts.map( v => v.normal );
				if ( normals[ 0 ] ) {

					//if we got one normal, we should have gotten them all
					hitNormal = GeometryUtilities.barycentricInterpolate( positions, hitPoint, normals );

				} else if ( face && face.normal ) {

					hitNormal = face.normal.transformDirection( mesh.matrixWorld );

				} else {

					positions[ 1 ].sub( positions[ 0 ] ); //use positions array as workspace
					positions[ 2 ].sub( positions[ 0 ] ); //to avoid more allocations
					hitNormal = positions[ 0 ].crossVectors( positions[ 1 ], positions[ 2 ] ).normalize();

				}

			}

		}

		MeshPool.releaseAll( mesh => {

			delete mesh._treeNode;
			delete mesh._meshIndex;

		} );

		return { hitNode, hitMesh, hitPoint, hitNormal };

	}

}
