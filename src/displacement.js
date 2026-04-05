import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { computeUV, getDominantCubicAxis, getCubicBlendWeights } from './mapping.js';

/**
 * Apply displacement to every vertex of a non-indexed BufferGeometry.
 *
 * @param {THREE.BufferGeometry} geometry  – non-indexed (from subdivide())
 * @param {ImageData}            imageData – raw pixel data from Canvas2D
 * @param {number}               imgWidth
 * @param {number}               imgHeight
 * @param {object}               settings  – { mappingMode, scaleU, scaleV, amplitude, offsetU, offsetV, rotation, symmetricDisplacement, bottomAngleLimit, topAngleLimit, mappingBlend, seamBandWidth }
 * @param {object}               bounds    – { min, max, center, size } (THREE.Vector3)
 * @param {function}             [onProgress]
 * @param {Int32Array}           [uniqueIDs] – from weldVertices, required for boundary distance clamping
 * @param {Float32Array}         [minDistToBnd] – from displacement.worker.js BFS, required for clamp
 * @param {Uint8Array}           [isBoundaryVertex]
 * @param {Float32Array}         [smoothNormalsAccum]
 * @returns {THREE.BufferGeometry}  new non-indexed geometry with displaced positions
 */
export function applyDisplacement(geometry, imageData, imgWidth, imgHeight, settings, bounds, onProgress, uniqueIDs = null, isBoundaryVertex = null, smoothNormalsAccum = null, minDistToBnd = null) {
  const posAttr = geometry.attributes.position;
  const nrmAttr = geometry.attributes.normal;
  const count   = posAttr.count;

  const newPos = new Float32Array(count * 3);
  const newNrm = new Float32Array(count * 3);

  const tmpPos  = new THREE.Vector3();
  const tmpNrm  = new THREE.Vector3();
  const vA      = new THREE.Vector3();
  const vB      = new THREE.Vector3();
  const vC      = new THREE.Vector3();
  const edge1   = new THREE.Vector3();
  const edge2   = new THREE.Vector3();
  const faceNrm = new THREE.Vector3();

  const QUANT = 1e4;
  const posKey = (x, y, z) =>
    `${Math.round(x * QUANT)}_${Math.round(y * QUANT)}_${Math.round(z * QUANT)}`;

  // ── Pass 1: accumulate area-weighted smooth normals per unique position ───
  const smoothNrmMap = new Map();
  const zoneAreaMap = new Map();
  const maskedFracMap = new Map();

  // Folder A uses "selection" or "fs_selection" array (1 = selected, 0 = unselected).
  const selAttr = geometry.attributes.selection || geometry.attributes.fs_selection || null;
  const userExcludedFaces = selAttr ? new Uint8Array(count / 3) : null;
  const excludedPosSet = selAttr ? new Set() : null;

  for (let t = 0; t < count; t += 3) {
    vA.fromBufferAttribute(posAttr, t);
    vB.fromBufferAttribute(posAttr, t + 1);
    vC.fromBufferAttribute(posAttr, t + 2);
    edge1.subVectors(vB, vA);
    edge2.subVectors(vC, vA);
    faceNrm.crossVectors(edge1, edge2);

    const faceArea   = faceNrm.length();
    const faceNzNorm = faceArea > 1e-12 ? faceNrm.z / faceArea : 0;
    const faceAngle  = Math.acos(Math.abs(faceNzNorm)) * (180 / Math.PI);
    const angleMasked = faceNzNorm < 0
      ? (settings.bottomAngleLimit > 0 && faceAngle <= settings.bottomAngleLimit)
      : (settings.topAngleLimit    > 0 && faceAngle <= settings.topAngleLimit);

    // In Folder A, a face is SELECTED if ANY vertex > 0.5.
    // Therefore, it is EXCLUDED if NO vertex > 0.5.
    const userExcluded = selAttr
      ? (selAttr.getX(t) <= 0.5 && selAttr.getX(t + 1) <= 0.5 && selAttr.getX(t + 2) <= 0.5)
      : false;

    const faceMasked = angleMasked;
    if (userExcluded && userExcludedFaces) userExcludedFaces[t / 3] = 1;

    let czX = 0, czY = 0, czZ = 0;
    if (settings.mappingMode === 6 && faceArea > 1e-12) {
      const cubicBlend = settings.mappingBlend ?? 0;
      const cubicBandWidth = settings.seamBandWidth ?? 0.35;
      const unitFaceNrm = { x: faceNrm.x / faceArea, y: faceNrm.y / faceArea, z: faceNrm.z / faceArea };
      const w = getCubicBlendWeights(unitFaceNrm, cubicBlend, cubicBandWidth);
      czX = w.x * faceArea;
      czY = w.y * faceArea;
      czZ = w.z * faceArea;
    }

    for (let v = 0; v < 3; v++) {
      tmpPos.fromBufferAttribute(posAttr, t + v);
      const k = posKey(tmpPos.x, tmpPos.y, tmpPos.z);
      if (userExcluded && excludedPosSet) excludedPosSet.add(k);
      
      tmpNrm.fromBufferAttribute(nrmAttr, t + v);
      const existing = smoothNrmMap.get(k);
      if (existing) {
        existing[0] += tmpNrm.x * faceArea;
        existing[1] += tmpNrm.y * faceArea;
        existing[2] += tmpNrm.z * faceArea;
      } else {
        smoothNrmMap.set(k, [tmpNrm.x * faceArea, tmpNrm.y * faceArea, tmpNrm.z * faceArea]);
      }
      if (czX > 1e-12 || czY > 1e-12 || czZ > 1e-12) {
        const za = zoneAreaMap.get(k);
        if (za) { za[0] += czX; za[1] += czY; za[2] += czZ; }
        else { zoneAreaMap.set(k, [czX, czY, czZ]); }
      }
      const mf = maskedFracMap.get(k);
      if (mf) {
        if (faceMasked) mf[0] += faceArea;
        mf[1] += faceArea;
      } else {
        maskedFracMap.set(k, [faceMasked ? faceArea : 0, faceArea]);
      }
    }
  }

  smoothNrmMap.forEach((n) => {
    const len = Math.sqrt(n[0]*n[0] + n[1]*n[1] + n[2]*n[2]) || 1;
    n[0] /= len; n[1] /= len; n[2] /= len;
  });

  // ── Pass 2: sample displacement texture once per unique position ──────────
  const dispCache = new Map();

  for (let i = 0; i < count; i++) {
    tmpPos.fromBufferAttribute(posAttr, i);
    const k = posKey(tmpPos.x, tmpPos.y, tmpPos.z);
    if (dispCache.has(k)) continue;

    const sn = smoothNrmMap.get(k);

    if (settings.mappingMode === 6) {
      const za = zoneAreaMap.get(k);
      const total = za ? za[0] + za[1] + za[2] : 0;
      if (total > 0) {
        const md = Math.max(bounds.size.x, bounds.size.y, bounds.size.z, 1e-6);
        const rotRad = (settings.rotation ?? 0) * Math.PI / 180;
        let grey = 0;
        if (za[0] > 0) {
          const uv = _cubicUV((tmpPos.y-bounds.min.y)/md, (tmpPos.z-bounds.min.z)/md, settings, rotRad);
          grey += sampleBilinear(imageData.data, imgWidth, imgHeight, uv.u, uv.v) * (za[0]/total);
        }
        if (za[1] > 0) {
          const uv = _cubicUV((tmpPos.x-bounds.min.x)/md, (tmpPos.z-bounds.min.z)/md, settings, rotRad);
          grey += sampleBilinear(imageData.data, imgWidth, imgHeight, uv.u, uv.v) * (za[1]/total);
        }
        if (za[2] > 0) {
          const uv = _cubicUV((tmpPos.x-bounds.min.x)/md, (tmpPos.y-bounds.min.y)/md, settings, rotRad);
          grey += sampleBilinear(imageData.data, imgWidth, imgHeight, uv.u, uv.v) * (za[2]/total);
        }
        dispCache.set(k, grey);
        continue;
      }
    }

    tmpNrm.set(sn[0], sn[1], sn[2]);

    const alignedPos = tmpPos.clone();
    const alignedNrm = tmpNrm.clone();
    if (settings.matrixWorld && settings.planarProjMat) {
        alignedPos.applyMatrix4(settings.matrixWorld).applyMatrix4(settings.planarProjMat);
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(settings.matrixWorld);
        const alignNormalMat = new THREE.Matrix3().getNormalMatrix(settings.planarProjMat);
        alignedNrm.applyMatrix3(normalMatrix).applyMatrix3(alignNormalMat).normalize();
    }

    const uvResult = computeUV(alignedPos, alignedNrm, settings.mappingMode, settings, bounds);
    let grey;
    if (uvResult.triplanar) {
      grey = 0;
      for (const s of uvResult.samples) {
        grey += sampleBilinear(imageData.data, imgWidth, imgHeight, s.u, s.v) * s.w;
      }
    } else {
      grey = sampleBilinear(imageData.data, imgWidth, imgHeight, uvResult.u, uvResult.v);
    }
    dispCache.set(k, grey);
  }

  // ── Pass 3: displace every vertex copy ────────────────────────────────────
  const REPORT_EVERY = 5000;

  for (let i = 0; i < count; i++) {
    tmpPos.fromBufferAttribute(posAttr, i);
    tmpNrm.fromBufferAttribute(nrmAttr, i);

    const k    = posKey(tmpPos.x, tmpPos.y, tmpPos.z);
    
    let sn;
    if (uniqueIDs && smoothNormalsAccum) {
        const uid = uniqueIDs[i];
        const uix = uid * 3;
        sn = [smoothNormalsAccum[uix], smoothNormalsAccum[uix+1], smoothNormalsAccum[uix+2]];
        // Fallback if worker array had zero normal
        if (sn[0]===0 && sn[1]===0 && sn[2]===0) sn = smoothNrmMap.get(k);
    } else {
        sn = smoothNrmMap.get(k);
    }
    
    let grey = dispCache.get(k);
    if (isNaN(grey)) grey = 0;

    const isFaceExcluded = userExcludedFaces && userExcludedFaces[Math.floor(i / 3)];
    const isSealedBoundary = (!isFaceExcluded && excludedPosSet && excludedPosSet.has(k)) || 
                             (uniqueIDs && isBoundaryVertex && isBoundaryVertex[uniqueIDs[i]] === 1);
                             
    const mf         = maskedFracMap.get(k) || [0, 1];
    const maskedFrac = mf[1] > 0 ? mf[0] / mf[1] : 0;
    
    // In Folder A's displacement worker, centeredGrey is used explicitly for displacement (without 0.5 subtraction).
    const centeredGrey = settings.symmetricDisplacement ? (grey - 0.5) : grey;
    
    // F-HardCut: We remove the '(1 - maskedFrac)' smooth blend multiplier entirely. 
    // Vertices strictly receive full displacement up to the boundary, and we rely purely 
    // on distance field clamping and strict face exclusion/vertex sealing to maintain a crisp edge.
    // If a vertex is mostly associated with excluded faces (maskedFrac >= 0.5), it shouldn't be displaced.
    const isFullyMasked = (maskedFrac >= 0.5);
    let disp = (isFaceExcluded || isSealedBoundary || isFullyMasked) ? 0 : centeredGrey * (settings.amplitude || 0);

    // Apply strict Folder A Distance Field Clamping
    if (uniqueIDs && minDistToBnd && !isFaceExcluded && !isSealedBoundary && !isFullyMasked) {
        const uid = uniqueIDs[i];
        const maxDist = minDistToBnd[uid];
        const intendedMag = Math.abs(disp);
        if (intendedMag > maxDist) {
            disp = disp * (maxDist / (intendedMag || 1e-6));
        }
    }

    const newX = tmpPos.x + sn[0] * disp;
    const newY = tmpPos.y + sn[1] * disp;
    let   newZ = tmpPos.z + sn[2] * disp;

    if (maskedFrac > 0) {
      if (settings.bottomAngleLimit > 0 && newZ < tmpPos.z) newZ = tmpPos.z;
      if (settings.topAngleLimit    > 0 && newZ > tmpPos.z) newZ = tmpPos.z;
    }

    newPos[i*3]   = newX;
    newPos[i*3+1] = newY;
    newPos[i*3+2] = newZ;

    newNrm[i*3]   = tmpNrm.x;
    newNrm[i*3+1] = tmpNrm.y;
    newNrm[i*3+2] = tmpNrm.z;

    if (onProgress && i % REPORT_EVERY === 0) onProgress(i / count);
  }

  const eA = new THREE.Vector3();
  const eB = new THREE.Vector3();
  const fn = new THREE.Vector3();
  for (let t = 0; t < count; t += 3) {
    const ax = newPos[t*3],   ay = newPos[t*3+1],   az = newPos[t*3+2];
    const bx = newPos[t*3+3], by = newPos[t*3+4],   bz = newPos[t*3+5];
    const cx = newPos[t*3+6], cy = newPos[t*3+7],   cz = newPos[t*3+8];
    eA.set(bx - ax, by - ay, bz - az);
    eB.set(cx - ax, cy - ay, cz - az);
    fn.crossVectors(eA, eB).normalize();
    for (let v = 0; v < 3; v++) {
      newNrm[(t + v) * 3]     = fn.x;
      newNrm[(t + v) * 3 + 1] = fn.y;
      newNrm[(t + v) * 3 + 2] = fn.z;
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
  out.setAttribute('normal',   new THREE.BufferAttribute(newNrm, 3));
  if (selAttr) {
      out.setAttribute('selection', new THREE.BufferAttribute(new Float32Array(selAttr.array), 1));
  }
  return out;
}

function sampleBilinear(data, w, h, u, v) {
  u = ((u % 1) + 1) % 1;
  v = ((v % 1) + 1) % 1;

  const fx = u * (w - 1);
  const fy = v * (h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const tx = fx - x0;
  const ty = fy - y0;

  const v00 = data[(y0 * w + x0) * 4] / 255;
  const v10 = data[(y0 * w + x1) * 4] / 255;
  const v01 = data[(y1 * w + x0) * 4] / 255;
  const v11 = data[(y1 * w + x1) * 4] / 255;

  return v00 * (1-tx) * (1-ty)
       + v10 * tx * (1-ty)
       + v01 * (1-tx) * ty
       + v11 * tx * ty;
}

function _cubicUV(rawU, rawV, settings, rotRad) {
  let u = rawU / (settings.scaleU || 1) + (settings.offsetU || 0);
  let v = rawV / (settings.scaleV || 1) + (settings.offsetV || 0);
  if (rotRad !== 0) {
    const c = Math.cos(rotRad), s = Math.sin(rotRad);
    u -= 0.5; v -= 0.5;
    const ru = c*u - s*v, rv = s*u + c*v;
    u = ru + 0.5; v = rv + 0.5;
  }
  return { u: u - Math.floor(u), v: v - Math.floor(v) };
}
