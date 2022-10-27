import * as THREE from '/node_modules/three/build/three.module.js';
import EventDispatcher from './EventDispatcher.js';
import MeshLoader from './MeshLoader.js';
import GeomtryUtilities from '../utilities/GeometryUtilities.js';
import { TRANSFORM_COMPONENT } from '../utilities/constants.js';

// Model
// Handles management and dispatching events
// in updating and processing the hierarchy

// Events
// 'preprocess-begin'       : fired when the preprocessing of the hierarchy begins
// 'preprocessing'          : fired while the preprocessing is happening asynchronously with the amount of nodes processed
// 'preprocess-complete'    : fired when the preprocessing of the cache is complete
// 'node-geometry-loaded'   : fired when a set of node geometry has finished loading. Detail is the array of nodes
// 'geometry-load-complete' : fired when all geometry for all nodes has finished loading
// 'hierarchy-refreshed'    : fired after the whole hierarchy has been synchronized (total triangles, synched, etc)

export default class Model extends EventDispatcher {
  get root() {
    return this._hierarchy || null;
  }

  get metadata() {
    return this._metadata || null;
  }

  get nodes() {
    return this._indexedHierarchy || {};
  }

  get liveTriangles() {
    return this._hierarchy && 'cached' in this._hierarchy && 'enabledTrianglesInTree' in this._hierarchy.cached
      ? this._hierarchy.cached.enabledTrianglesInTree
      : 0;
  }

  get sortedNodes() {
    if (!this._sortedNodes) this._sortNodes();
    return this._sortedNodes;
  }

  get sortedVisibleNodes() {
    if (!this._sortedVisibleNodes) this._sortGeometryNodes();
    return this._sortedVisibleNodes;
  }

  get sortedGeometryNodes() {
    if (!this._sortedGeometryNodes) this._sortGeometryNodes();
    return this._sortedGeometryNodes;
  }

  get name() {
    const proj = this._metadata.project;
    const name = this._metadata.name;
    return proj ? `${proj}/${name}` : name;
  }

  get spinCenter() {
    if (!this._spinCenter) {
      this._spinCenter = new THREE.Vector3();
      const bounds = this.root.cached.aabb;
      this._spinCenter.x = (bounds.min.x + bounds.max.x) / 2;
      this._spinCenter.y = (bounds.min.y + bounds.max.y) / 2;
      this._spinCenter.z = (bounds.min.z + bounds.max.z) / 2;
      this._spinCenter.applyMatrix4(this.root.cached.origNodeToModel);
    }
    return this._spinCenter;
  }

  constructor(hierarchy, metadata, meshStats, baseURL = '/models', options = {}, ) {
    super();

    options = Object.assign({
      maxLod: Infinity,
      invertedThreshold: 0.8,
      fetchOptions: {},
    }, options);

    this.preprocessDone = false;
    this.geometryLoaded = false;

    this._modified = false;

    this._hierarchy = hierarchy;
    this._metadata = metadata;
    this._meshStats = meshStats;
    this._baseURL = baseURL;
    this._extraFetchOptions = options.fetchOptions;
    this._options = options;

    // if JtToJson converted this model to left handed (DEPRECATED) flip it back because THREE is right handed
    this.swapYZ = !('right_handed' in metadata) || !metadata.right_handed;

    this._indexedHierarchy = {};
    this._iterateOverHierarchy(this.root, n => {
      this._indexedHierarchy[n.id] = n;
    });

    this.filterTypes = {};
    this._guidMap = {};
    this._initialHighlights = [];

    this._sortedNodes = this._sortedGeometryNodes = this._sortedVisibleNodes = null;
    this._preprocessHierarchy();
  }

  dispose() {
    this.iterateOverHierarchy(n => {
      const proc = mi => {
        if (mi.cached && mi.cached.threejsGeometry) mi.cached.threejsGeometry.dispose();
      };
      (n.geometry || []).forEach(proc);
      ((n.cached && n.cached.origGeometry) || []).forEach(proc);
    });

    this._hierarchy = null;
    this._metadata = null;
    this._meshStats = null;
    this._indexedHierarchy = null;
    this._sortedNodes = this._sortedVisibleNodes = this._sortedGeometryNodes = null;
    this._guidMap = null;

    this._dispatch('dispose');

    super.dispose();
  }

  /* Public API */
  iterateFromNode(...args) {
    args[0] = this.nodes[args[0]];
    if (!args[0]) return; // ignore if not found in hierarchy
    this._iterateOverHierarchy(...args);
  }
  iterateOverHierarchy(...args) {
    this.iterateFromNode(this.root.id, ...args);
  }

  iterateFromNodeBackground(...args) {
    args[0] = this.nodes[args[0]];
    this._iterateOverHierarchyBackground(...args);
  }
  iterateOverHierarchyBackground(...args) {
    this.iterateFromNodeBackground(this.root.id, ...args);
  }

  getNode(id) {
    return this.nodes[id] || null;
  }

  getNodeByGUID(guid) {
    return this._guidMap[guid];
  }

  replaceNodeMaterial(node, ReplacementMaterialClass) {
    node.geometry = node.geometry.map(g => {
      const currentTexture = g.cached.threejsMaterial.map;
      g.cached.threejsMaterial = new ReplacementMaterialClass();
      g.cached.threejsMaterial.map = currentTexture;
      return g;
    });
  }

  // this is O(1) when called multiple times in one frame because hierarchy refresh and event sending is debounced
  // schedules (debounced) hierarchy refresh and emits (debounced) hierarchy-updated event
  setGeometry(id, newGeometry, suppressRefresh) {
    // TODO: Make sure we dispose geometry that is no longer being used

    if (newGeometry) {
      //in the current data schema, each geometry should have the following fields:
      //lod, color.{r, g, b, a}, transform
      //and the following fields we add:
      //cached.{triangles, meshToModel, threejsGeometry, threejsMaterial}
      //however, we remove transform to save memory (it gets folded into some of the cached fields below)
      //and we don't care about most of the others
      function checkFields(fieldNames, subField) {
        newGeometry.forEach(mi => {
          if (subField && !(subField in mi))
            throw new Error(`replacement mesh instance must include field ${subField}`);
          fieldNames.forEach(fn => {
            if (!(fn in (subField ? mi[subField] : mi))) {
              throw new Error(`replacement mesh instance ${subField ? subField + ' ' : ''}must include field ${fn}`);
            }
          });
        });
      }
      checkFields(['triangles', 'meshToModel', 'threejsGeometry', 'threejsMaterial'], 'cached');
    }

    this._modified = true;

    const n = this._indexedHierarchy[id];
    n.geometry = newGeometry;
    n.cached.ownTriangles = 0;
    if (n.geometry) n.geometry.forEach(mi => (n.cached.ownTriangles += mi.cached.triangles));

    this._updateModelMatrices(n);

    // TODO: maybe update cached bounding box(es) for node and its ancestors
    // or at least verify that existing bounding boxes still enclose the new geometry

    //operations like BoxCut may want to do a bunch of geometry changes over a
    //(short) period of time without triggering render restarts until the changes are done
    if (!suppressRefresh) this._refreshHierarchy();
  }

  // this is O(1) when called multiple times in one frame because hierarchy refresh and event sending is debounced
  // schedules (debounced) hierarchy refresh and emits (debounced) hierarchy-updated event
  removeNode(id, suppressRefresh) {
    this.setEnabled(id, false, suppressRefresh);
  }

  setEnabled(id, isEnabled, suppressRefresh) {
    this._modified = true;
    this.nodes[id].cached.enabled = isEnabled;
    if (!suppressRefresh) this._refreshHierarchy(); // debounced
  }

  // ids - items to set, null, number, or object of nodeIds/isVisible pairs
  // isVisible - value to set on items when `ids` is null or numeric, boolean
  // If `ids` is null, every element will be set to isVisible
  setVisibility(ids, isVisible, suppressRefresh) {
    this._modified = true;
    if (ids === null) {
      Object.keys(this.nodes).forEach(k => (this.nodes[k].cached.visible = isVisible));
    } else if (typeof ids === 'string' || typeof ids === 'number') {
      this.nodes[ids].cached.visible = isVisible;
    } else {
      Object.keys(ids).forEach(k => (this.nodes[k].cached.visible = ids[k]));
    }
    if (!suppressRefresh) this._refreshHierarchy(); // debounced
  }

  //opts may contain any of the following fields
  //* color = { r, g, b }
  //* alpha
  //* depthOnly
  //the reason alpha is separate from color is to enable modulating the transparency of vertex colored meshes
  //setting the color of a node with this function will override vertex colors, if any, of the node's meshes
  setAppearance(id, opts = {}) {
    const n = this.nodes[id];
    const geometry = n.geometry || [];
    let modified = false;

    if ('color' in opts) {
      n.cached.alphaBlended = false;
      geometry.forEach(mi => {
        let mat = mi.cached.threejsMaterial;
        const mc = mat.color;
        const oc = opts.color;
        if (!('a' in oc)) oc.a = 1;
        if (mc.r !== oc.r || mc.g !== oc.g || mc.b !== oc.b || mc.a !== oc.a) {
          mat = MeshLoader.getMaterialVariant(mat, { color: oc, ignoreVertexColors: true });
          modified = true;
        }
        if (mat.transparent) n.cached.alphaBlended = true;
        mi.cached.threejsMaterial = mat;
      });
    }

    if ('alpha' in opts) {
      n.cached.alphaBlended = false;
      geometry.forEach(mi => {
        let mat = mi.cached.threejsMaterial;
        const mc = mat.color;
        if (mc.a !== opts.alpha) {
          mat = MeshLoader.getMaterialVariant(mat, { color: { r: mc.r, g: mc.g, b: mc.b, a: opts.alpha } });
          modified = true;
        }
        if (mat.transparent) n.cached.alphaBlended = true;
        mi.cached.threejsMaterial = mat;
      });
    }

    if ('depthOnly' in opts) {
      n.cached.depthOnly = false;
      geometry.forEach(mi => {
        let mat = mi.cached.threejsMaterial;
        if (mat.depthOnly !== opts.depthOnly) {
          mat = MeshLoader.getMaterialVariant(mat, { depthOnly: opts.depthOnly });
          modified = true;
        }
        if (mat.depthOnly) n.cached.depthOnly = true;
        mi.cached.threejsMaterial = mat;
      });
    }

    if (modified) this._modified = true;
    if (modified && !opts.suppressRefresh) this._refreshHierarchy(); // debounced
  }

  // reset the hierarchy to the original state
  // useful for rerunning the script
  // forces a hierarchy refresh and emits (debounced) hierarchy-updated event
  reset() {
    if (!this._modified) return;
    this.iterateOverHierarchy(n => {
      n.geometry = n.cached.origGeometry;
      n.cached.ownTriangles = 0;
      if (n.geometry) n.geometry.forEach(mi => (n.cached.ownTriangles += mi.cached.triangles));
      n.cached.enabled = true;
      (n.geometry || []).forEach(mi => {
        mi.cached.threejsMaterial = MeshLoader.getMaterialVariant(mi.cached.threejsMaterial, {
          color: mi.color,
          depthOnly: mi.depth_only,
          ignoreVertexColors: mi.ignore_vertex_colors,
        });
      });
    });
    this._modified = false;
    this._refreshHierarchy(true);
  }

  // if a hierarchy refresh is pending then force it to execute now and emit (debounced) hierarchy-updated event
  flush() {
    this.flushDebounce('refresh-hierarchy');
  }

  // force a hierarchy refresh and emit (debounced) hierarchy-updated event
  refresh() {
    this._refreshHierarchy(true);
  }

  /* Transforms Updates */
  setLocalTransform(nodeOrID, nodeToParent) {
    const n = !isNaN(nodeOrID) ? this._indexedHierarchy[nodeOrID] : nodeOrID;

    if (!n.cached.nodeToParent.equals(nodeToParent)) {
      n.cached.nodeToParent = nodeToParent;
      this.iterateFromNode(n.id, c => {
        c.cached.transformDirty = true;
      });
      this._updateModelMatrices(n);
    }

    this._dispatch('transform-updated', { id: n.id });
  }

  setLocalTRS(nodeOrID, pos, rot, sca) {
    if (!pos.isVector3) pos = new THREE.Vector3().copy(pos);
    if (!(rot instanceof THREE.Quaternion)) rot = new THREE.Quaternion().copy(rot);
    if (!isNaN(sca)) sca = new THREE.Vector3(sca, sca, sca);
    else if (!sca.isVector3) sca = new THREE.Vector3().copy(sca);
    this.setLocalTransform(
      nodeOrID,
      new THREE.Matrix4().compose(
        pos,
        rot,
        sca
      )
    );
  }

  resetTransforms(id = 0, resetChildren = true, component = null) {
    const n = this._indexedHierarchy[id];
    this._resetMatrices(n, component);
    if (resetChildren)
      this.iterateFromNode(n.id, c => {
        this._resetMatrices(c, component);
      });
    else
      this.iterateFromNode(n.id, c => {
        c.cached.transformDirty = true;
      });
    this._dispatch('transform-updated', { id: n.id });
  }

  refreshTransforms(id = 0, refreshChildren = true, setOrig = false) {
    const node = this._indexedHierarchy[id];

    if (node.cached.transformDirty) {
      const updateParents = p => {
        if (!p || !p.cached.transformDirty) return;
        updateParents(p.cached.parent);
        this._updateModelMatrices(p);
      };
      updateParents(node.cached.parent);

      this._updateModelMatrices(node, setOrig);
    }

    if (refreshChildren)
      this.iterateFromNode(id, c => {
        if (c.cached.transformDirty) this._updateModelMatrices(c);
      });
  }

  // This is very expensive in the worst case where most or
  // every node's bounds need to be updated
  refreshBounds(nodeOrId) {
    if (!nodeOrId) nodeOrId = 0;
    const n = !isNaN(nodeOrId) ? this._indexedHierarchy[nodeOrId] : nodeOrId;
    if (n.cached.transformDirty) this._updateModelMatrices(n);
    if (!n.cached.boundsDirty) return;

    n.children.filter(n => !n.nonVolume).forEach(c => this.refreshBounds(c.id));

    let bx = null;
    const expandBox = (bounds, xform) => {
      const cbx = bounds;
      const min = cbx.min;
      const max = cbx.max;
      for (let x = 0; x <= 1; x++) {
        for (let y = 0; y <= 1; y++) {
          for (let z = 0; z <= 1; z++) {
            const vx = x ? max.x : min.x;
            const vy = y ? max.y : min.y;
            const vz = z ? max.z : min.z;
            let v = new THREE.Vector3(vx, vy, vz);
            v = v.applyMatrix4(xform);
            v = v.applyMatrix4(n.cached.modelToOBB);

            // we must clone the vector here because the
            // bounds object keeps a reference to it, so
            // modifying one will modify the other
            if (!bx) bx = new THREE.Box3(v, v.clone());
            bx = bx.expandByPoint(v);
          }
        }
      }
    };

    n.cached.obbToModel = n.cached.nodeToModel;
    n.cached.modelToOBB = new THREE.Matrix4().getInverse(n.cached.obbToModel);
    n.children.forEach(c => expandBox(c.cached.threejsOBB, c.cached.obbToModel));
    if (n.geometry) {
      n.geometry.forEach(mi => {
        if (!mi.cached.threejsGeometry.boundingBox) mi.cached.threejsGeometry.computeBoundingBox();
        expandBox(mi.cached.threejsGeometry.boundingBox, mi.cached.meshToModel);
      });
    }

    bx = bx || new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0));
    n.cached.threejsOBB = bx;
    n.cached.boundsDirty = false;
  }

  //helper function to convert the keys of a map to an array
  //the returned array contains only the "own" keys that map to values that are not falsey
  //the returned ids are always integers, not strings
  static mapToIDs(map) {
    const ids = [];
    map = map || {};
    for (const [id, v] of Object.entries(map)) if (v) ids.push(parseInt(id));
    return ids;
  }

  //expand an array of node IDs to a dictionary of those IDs and all their descendants
  //this efficently handles cases where some of the given IDs may be descendants of others
  //it also handles the results of "merged" visibility culls:
  //any ids of nodes descending from the merged VC node are *not* returned
  //unless includeDescendantsOfInternalNodesWithGeometry = true
  idsToFullMap(ids, includeDescendantsOfInternalNodesWithGeometry) {
    const map = {};
    ids = ids || [];
    const isInternalNodeWithGeometry = n => n.children.length > 0 && n.geometry && n.geometry.length > 0;
    let internalGeometryCount = 0;
    ids.forEach(id =>
      this.iterateFromNode(
        id,
        n => {
          // pre order
          //if we already marked this node then don't process it again
          if (map[n.id]) return true; // prune DFS
          //if this node is disabled and has an ancestor with geometry
          //then stop because we assume the ancestor accounts for it
          //this happens e.g. when we visibility cull something in "merge" mode
          if (!includeDescendantsOfInternalNodesWithGeometry && internalGeometryCount && !n.enabledInTree) {
            return true; //prune DFS
          }
          if (!includeDescendantsOfInternalNodesWithGeometry && isInternalNodeWithGeometry(n)) internalGeometryCount++;
          map[n.id] = true;
          return false; //continue DFS
        },
        n => {
          // post order
          if (!includeDescendantsOfInternalNodesWithGeometry && isInternalNodeWithGeometry(n)) internalGeometryCount--;
        }
      )
    );
    return map;
  }

  mapToFullMap(map, includeDescendantsOfInternalNodesWithGeometry) {
    return this.idsToFullMap(Model.mapToIDs(map), includeDescendantsOfInternalNodesWithGeometry);
  }

  /* Private Functions */

  // depth-first
  _iterateOverHierarchy(h, cbPreOrder, cbPostOrder) {
    const _rec = (n, p) => {
      if (cbPreOrder && cbPreOrder(n, p)) return; // prune
      if (n.children) n.children.forEach(c => _rec(c, n));
      if (cbPostOrder) cbPostOrder(n, p);
    };
    _rec(h, null);
  }

  _iterateOverHierarchyBackground(h, cbPreOrder, maxMS, done, onYield) {
    let numProcessed = 0;
    const hasCached = !!h.cached;

    // Creating the objects seems to have a bit of an
    // effect on performance, so if we can use the cached
    // parent reference, use that
    const queue = [hasCached ? h : { n: h, p: null }];

    const processQueue = () => {
      const startTime = new Date();
      while (queue.length > 0) {
        const item = queue.shift();
        const n = hasCached ? item : item.n;
        const p = hasCached ? n.cached.parent : item.p;
        const prune = cbPreOrder && cbPreOrder(n, p);
        ++numProcessed;
        if (!prune && n.children) {
          n.children.forEach(c => {
            queue.push(hasCached ? c : { n: c, p: n });
          });
        }
        const now = new Date();
        if (now - startTime > maxMS) break;
      }
      if (queue.length === 0) {
        if (done) done(numProcessed);
      } else {
        if (onYield) onYield(numProcessed);
        requestAnimationFrame(processQueue);
      }
    };
    processQueue();
  }

  _updateModelMatrices(n, setOrig = false) {
    const p = n.cached.parent;

    if (p) n.cached.nodeToModel = new THREE.Matrix4().multiplyMatrices(p.cached.nodeToModel, n.cached.nodeToParent);
    else n.cached.nodeToModel = n.cached.nodeToParent;

    n.cached.modelToNode = new THREE.Matrix4().getInverse(n.cached.nodeToModel);

    n.cached.obbToModel = new THREE.Matrix4().multiplyMatrices(n.cached.nodeToModel, n.cached.obbToNode);
    n.cached.modelToOBB = new THREE.Matrix4().getInverse(n.cached.obbToModel);

    if (setOrig || !n.cached.origNodeToParent) {
      if (n.orig_transform) {
        const xform = {
          translation: this.swapYZ
            ? GeomtryUtilities.swapVec(n.orig_transform.translation)
            : n.orig_transform.translation,
          rotation: this.swapYZ ? GeomtryUtilities.swapQuat(n.orig_transform.rotation) : n.orig_transform.rotation,
          scale: this.swapYZ ? GeomtryUtilities.swapVec(n.orig_transform.scale) : n.orig_transform.scale,
        };
        const pos = new THREE.Vector3(xform.translation.x, xform.translation.y, xform.translation.z);
        const rot = new THREE.Quaternion(xform.rotation.x, xform.rotation.y, xform.rotation.z, xform.rotation.w);
        const sca = new THREE.Vector3(xform.scale.x, xform.scale.y, xform.scale.z);
        n.cached.origNodeToParent = new THREE.Matrix4().compose(
          pos,
          rot,
          sca
        );
        if (p) {
          n.cached.origNodeToModel = new THREE.Matrix4().multiplyMatrices(
            p.cached.nodeToModel,
            n.cached.origNodeToParent
          );
        } else {
          n.cached.origNodeToModel = n.cached.origNodeToParent;
        }
        n.cached.origModelToNode = new THREE.Matrix4().getInverse(n.cached.origNodeToModel);
        n.cached.origOBBToModel = n.cached.origNodeToModel;
        n.cached.origModelToOBB = n.cached.origModelToNode;
      } else {
        n.cached.origNodeToParent = n.cached.nodeToParent.clone();
        n.cached.origNodeToModel = n.cached.nodeToModel.clone();
        n.cached.origModelToNode = n.cached.modelToNode.clone();
        n.cached.origOBBToModel = n.cached.obbToModel.clone();
        n.cached.origModelToOBB = n.cached.modelToOBB.clone();
      }
    }

    const updateGeometry = mi => {
      mi.cached.meshToModel = new THREE.Matrix4().multiplyMatrices(n.cached.nodeToModel, mi.cached.meshToNode);
      if (setOrig) {
        mi.cached.origMeshToModel = mi.cached.meshToModel.clone();
        mi.cached.origMeshToNode = mi.cached.meshToNode.clone();
      }
    };

    if (n.geometry) n.geometry.forEach(mi => updateGeometry(mi));
    if (n.cached.origGeometry) n.cached.origGeometry.forEach(mi => updateGeometry(mi));

    n.cached.transformDirty = false;
    if (!setOrig) this._setBoundsDirty(n);
  }

  _resetMatrixByComponent(currentMatrix, originalMatrix, component) {
    // If component specified, replace current matrix component with respective value in original
    if (typeof component === 'number') {
      const currentPosition = new THREE.Vector3();
      const currentRotation = new THREE.Quaternion();
      const currentScale = new THREE.Vector3();
      const originalScale = new THREE.Vector3();
      const originalRotation = new THREE.Quaternion();

      switch (component) {
        case TRANSFORM_COMPONENT.Position:
          return currentMatrix.copyPosition(originalMatrix);
        case TRANSFORM_COMPONENT.Rotation:
          originalMatrix.decompose(new THREE.Vector3(), originalRotation, new THREE.Vector3());
          currentMatrix.decompose(currentPosition, new THREE.Quaternion(), currentScale);
          return new THREE.Matrix4().compose(
            currentPosition,
            originalRotation,
            currentScale
          );
        case TRANSFORM_COMPONENT.Scale:
          originalMatrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), originalScale);
          currentMatrix.decompose(currentPosition, currentRotation, new THREE.Vector3());
          return new THREE.Matrix4().compose(
            currentPosition,
            currentRotation,
            originalScale
          );
        default: //ignore
      }
    }

    // Otherwise replace entire matrix with original
    return originalMatrix;
  }

  _resetMatrices(n, component = null) {
    n.cached.nodeToParent = this._resetMatrixByComponent(n.cached.nodeToParent, n.cached.origNodeToParent, component);

    n.cached.nodeToModel = this._resetMatrixByComponent(n.cached.nodeToModel, n.cached.origNodeToModel, component);
    n.cached.modelToNode = this._resetMatrixByComponent(n.cached.modelToNode, n.cached.origModelToNode, component);

    if (n.geometry) {
      const updateGeometry = mi => {
        mi.cached.meshToModel = this._resetMatrixByComponent(
          mi.cached.meshToModel,
          mi.cached.origMeshToModel,
          component
        );
      };

      n.geometry.forEach(mi => updateGeometry(mi));
      if (n.cached.origGeometry) n.cached.origGeometry.forEach(mi => updateGeometry(mi));
    }

    n.cached.transformDirty = true;
  }

  _setBoundsDirty(n) {
    let curr = n;
    while (curr != null && !curr.cached.boundsDirty) {
      curr.cached.boundsDirty = true;
      curr = curr.cached.parent;
    }
  }

  _sortNodes() {
    console.time('sort nodes');

    const depthOnlyNodes = [];
    const opaqueNodes = [];
    const alphaBlendedNodes = [];

    for (const n of Object.values(this._indexedHierarchy || {})) {
      if (n.cached && n.cached.depthOnly) depthOnlyNodes.push(n);
      else if (n.cached && n.cached.alphaBlended) alphaBlendedNodes.push(n);
      else opaqueNodes.push(n);
    }

    const sortFunc = (a, b) => {
      // larger nodes at the beginning
      const aSz = a.diameter_in_meters;
      const bSz = b.diameter_in_meters;
      if (aSz < bSz) return 1;
      else if (aSz > bSz) return -1;
      return 0;
    };

    depthOnlyNodes.sort(sortFunc);
    opaqueNodes.sort(sortFunc);
    alphaBlendedNodes.sort(sortFunc);

    this._sortedNodes = depthOnlyNodes.concat(opaqueNodes).concat(alphaBlendedNodes);

    this._sortedGeometryNodes = this._sortedVisibleNodes = null;

    console.timeEnd('sort nodes');
  }

  _sortGeometryNodes() {
    console.time('sort geometry nodes');
    const geometryNodes = [];
    const visibleNodes = [];
    this.sortedNodes.forEach(n => {
      if (n.geometry && n.geometry.length) {
        geometryNodes.push(n);
        if (n.cached.visibleInTree && n.cached.enabledInTree) visibleNodes.push(n);
      }
    });
    this._sortedGeometryNodes = geometryNodes;
    this._sortedVisibleNodes = visibleNodes;
    console.timeEnd('sort geometry nodes');
  }

  // Adds cached values onto the hierarchy and initializes
  _preprocessHierarchy() {
    // begin watching for geometry loads to come in
    let loaded = [];
    let totalLoads = 0;
    let remainingLoads = 0;
    const archivesDownloadStatus = {};

    const meshLoader = new MeshLoader(`${this._baseURL}/${this.name}`, this._extraFetchOptions);
    meshLoader.listen('model-binary-download-progress', e => {
      // printMemory(
      //   `${(e.detail.loaded / 1024).toFixed(1)}/${(e.detail.total / 1024).toFixed(1)} KB loaded for ${e.detail.archive}`
      // );
      archivesDownloadStatus[e.detail.archive] = { loaded: e.detail.loaded, total: e.detail.total };
      this._dispatch('model-binaries-download-progress', { archivesDownloadStatus });
    });

    const checkGeometryLoads = () => {
      remainingLoads -= loaded.length;

      if (loaded.length) {
        this._dispatch('node-geometry-loaded', {
          loaded,
          totalLoads,
          remainingLoads,
        });
        loaded = [];
      }

      if (!totalLoads || remainingLoads) {
        requestAnimationFrame(checkGeometryLoads);
      } else {
        this.geometryLoaded = true;
        this._dispatch('geometry-load-complete');
      }
    };
    checkGeometryLoads();

    this._dispatch('preprocess-begin');

    this.iterateOverHierarchyBackground(
      (n, p) => {
        if (n.filter_type !== '') {
          if (!this.filterTypes.hasOwnProperty(n.filter_type)) this.filterTypes[n.filter_type] = 1;
          else this.filterTypes[n.filter_type]++;
        }

        if (n.guid) this._guidMap[n.guid] = n;

        if (n.highlighted) this._initialHighlights.push(n.id);

        n.cached = n.cached || {};

        n.cached.parent = p;
        n.cached.depth = p ? p.cached.depth + 1 : 0;
        n.cached.visible = n.hasOwnProperty('visible') ? n.visible : true;
        n.cached.visibleInTree = true;
        n.cached.enabled = true;
        n.cached.enabledInTree = true;
        n.cached.indexInSiblings = p ? p.children.indexOf(n) : 0;

        const xform = GeomtryUtilities.getTransform(n, this.swapYZ);
        GeomtryUtilities.deleteTransform(n); // save memory, avoid GC

        const pos = new THREE.Vector3(xform.translation.x, xform.translation.y, xform.translation.z);
        const rot = new THREE.Quaternion(xform.rotation.x, xform.rotation.y, xform.rotation.z, xform.rotation.w);
        const sca = new THREE.Vector3(xform.scale.x, xform.scale.y, xform.scale.z);

        //root rotation is typically identity, but in some models we use it to set a default orientation for the model
        //e.g. for m2020 rover models we typically import them with a flipZ option

        //root scale is often non-identity as our import pipeline uses it to convert the original model units to meters

        n.cached.nodeToParent = new THREE.Matrix4().compose(
          pos,
          rot,
          sca
        );

        // Count Triangles
        let coarsestLOD = 0;
        n.geometry.forEach(mi => (coarsestLOD = Math.max(coarsestLOD, mi.lod)));
        coarsestLOD = Math.min(coarsestLOD, this._options.maxLod);

        n.cached.ownTriangles = 0;
        n.cached.pendingMeshLoads = 0;

        const coarsestGeometry = [];
        n.geometry.forEach(mi => {
          let coarsest = mi.lod === coarsestLOD;

          if (coarsest) {
            mi.cached = mi.cached || {};
            mi.cached.triangles = this._meshStats[`mesh_${mi.mesh_id}`].triangles;

            // mi.cached.threejsGeometry will be set when the mesh is loaded

            const m2n = GeomtryUtilities.getTransform(mi, this.swapYZ);
            GeomtryUtilities.deleteTransform(mi); // save memory, avoid GC

            // TODO: post process
            const meshToNode = new THREE.Matrix4().compose(
              new THREE.Vector3(m2n.translation.x, m2n.translation.y, m2n.translation.z),
              new THREE.Quaternion(m2n.rotation.x, m2n.rotation.y, m2n.rotation.z, m2n.rotation.w),
              new THREE.Vector3(m2n.scale.x, m2n.scale.y, m2n.scale.z)
            );
            // this won't be used so don't waste memory on it
            // mi.cached.meshToParent = meshToNode

            mi.cached.meshToNode = meshToNode;
            mi.cached.transformDirty = false;

            n.cached.ownTriangles += mi.cached.triangles;
            n.cached.pendingMeshLoads++;

            coarsestGeometry.push(mi);
          }
        });

        let side = THREE.FrontSide;
        if (n.backface_pixel_ratio > this._options.invertedThreshold) side = THREE.BackSide;
        else if (n.backface_pixel_ratio > 1 - this._options.invertedThreshold) side = THREE.DoubleSide;

        n.cached.depthOnly = false;
        n.cached.alphaBlended = false;

        coarsestGeometry.forEach(mi => {
          const vertexColored = this._meshStats[`mesh_${mi.mesh_id}`].has_rgb;
          const mat = MeshLoader.getMaterial({
            color: vertexColored ? { r: 1, g: 1, b: 1, a: 1 } : mi.color,
            side,
            depthOnly: mi.depth_only,
            ignoreVertexColors: mi.ignore_vertex_colors,
          });
          if (mat.depthOnly) n.cached.depthOnly = true;
          if (mat.transparent) n.cached.alphaBlended = true;
          mi.cached.threejsMaterial = mat;
        });

        // Save memory, avoid GC
        if (coarsestGeometry.length === 0) delete n.geometry;
        else n.geometry = coarsestGeometry;

        n.cached.origGeometry = n.geometry;

        // Check if this node is a leaf by checking geometry and by checking
        // to see if all children are subnodes
        n.cached.leafPart = n.cached.ownTriangles > 0 && n.children.length === 0;

        if (!n.cached.leafPart && !n.jt_subnode && n.children.length > 0) {
          let childrenAreSubnodes = false;
          for (const c of n.children) {
            if (c.jt_subnode) {
              childrenAreSubnodes = true;
              break;
            }
          }
          if (childrenAreSubnodes) n.cached.leafPart = true;
        }

        // save memory, avoid GC
        if (n.impostor) delete n.impostor;
        if (n.jt_properties) delete n.jt_properties;

        // Kick off any geometry loads
        if (n.geometry) {
          totalLoads++;
          remainingLoads++;

          n.geometry.forEach(mi => {
            meshLoader.fetchGeometry('mesh_' + mi.mesh_id + '.ply', 'lod_' + mi.lod + '_archive', this.swapYZ, g => {
              mi.cached.threejsGeometry = g;
              n.cached.pendingMeshLoads--;
              if (n.cached.pendingMeshLoads === 0) loaded.push(n);
            });
          });
        }

        const obb = GeomtryUtilities.getOBB(n, this.swapYZ);
        n.cached.threejsOBB = new THREE.Box3(
          new THREE.Vector3(obb.min.x, obb.min.y, obb.min.z),
          new THREE.Vector3(obb.max.x, obb.max.y, obb.max.z)
        );
        n.cached.origThreejsOBB = n.cached.threejsOBB;

        n.cached.obbToNode = new THREE.Matrix4();
        if (obb.rotation) {
          n.cached.obbToNode.makeRotationFromQuaternion(
            new THREE.Quaternion(obb.rotation.x, obb.rotation.y, obb.rotation.z, obb.rotation.w)
          );
        }

        if (!n.cached.parent) {
          // save memory, avoid GC
          n.cached.obb = obb;
          n.cached.aabb = GeomtryUtilities.getAABB(n, this.swapYZ);
        }

        this._updateModelMatrices(n, true);

        // save memory, avoid GC
        if (n.bounds) delete n.bounds;
        if (n.bounds_min) delete n.bounds_min;
        if (n.bounds_max) delete n.bounds_max;
        if (n.oriented_bounds) delete n.oriented_bounds;
        if (n.oriented_bounds_rotation) delete n.oriented_bounds_rotation;
      },
      300,
      () => {
        this.iterateOverHierarchy(null, n => {
          // post-order callback
          n.cached.trianglesInTree = n.cached.ownTriangles;
          n.children.forEach(c => (n.cached.trianglesInTree += c.cached.trianglesInTree));
          n.cached.enabledTrianglesInTree = n.cached.trianglesInTree;
        });
        this._refreshHierarchy();
        this._dispatch('preprocess-complete');
        this.preprocessDone = true;
      },
      numProcessed => this._dispatch('preprocessing', { count: numProcessed })
    );
  }

  // Iterates over the hierarchy to synchronize the
  // visibility of a node with its parents, etc
  _refreshHierarchy(force) {
    const update = (n, p) => {
      n.cached.visibleInTree = n.cached.visible && (!p || p.cached.visibleInTree);
      n.cached.enabledInTree = n.cached.enabled && (!p || p.cached.enabledInTree);

      if (n.children) n.children.forEach(c => update(c, n));

      let tris = 0;
      n.cached.depthOnly = n.cached.alphaBlended = false;
      (n.geometry || []).forEach(mi => {
        tris += mi.cached.triangles;
        n.cached.depthOnly = n.cached.depthOnly || mi.cached.threejsMaterial.depthOnly;
        n.cached.alphaBlended = n.cached.alphaBlended || mi.cached.threejsMaterial.transparent;
      });
      (n.children || []).forEach(c => {
        tris += c.cached.enabledInTree ? c.cached.enabledTrianglesInTree : 0;
      });

      // TODO: Possibly rename this property because it includes nodes that are not visible, but exist in the tree
      n.cached.enabledTrianglesInTree = n.cached.enabledInTree ? tris : 0;
    };

    const doUpdate = () => {
      update(this._hierarchy);
      this._sortedNodes = this._sortedGeometryNodes = this._sortedVisibleNodes = null;
    };

    const doEvent = () => this._dispatch('hierarchy-refreshed');

    if (force) {
      doUpdate();
      this.debounce('refresh-hierarchy', doEvent, 0);
    } else {
      this.debounce(
        'refresh-hierarchy',
        () => {
          doUpdate();
          doEvent();
        },
        0
      );
    }
  }
}
