/**
 * Section mesh worker (module worker, bundled by Vite).
 *
 * The main thread sends an 18^3 padded block/light payload; the worker reproduces
 * the atlas layer mapping from a one-time `init-layers` message, meshes the section
 * with the same `meshSection` function the main thread uses, and transfers the
 * result vertex buffers back.
 */
import { getTintResolver } from './local';
import { meshSectionFromPayload, type WorkerScope } from './local';
import {
  isInitLayers,
  isMeshJob,
  meshResultTransferables,
  type MeshResultMessage,
  type WorkerErrorMessage,
} from './protocol';

const scope = self as unknown as WorkerScope;
const layers = new Map<string, number>();
const layerOf = (tile: string): number => layers.get(tile) ?? 0;

scope.addEventListener('message', (event) => {
  const data = event.data;

  if (isInitLayers(data)) {
    layers.clear();
    for (const [name, layer] of data.layers) layers.set(name, layer);
    return;
  }

  if (!isMeshJob(data)) return;
  try {
    const tintOf = getTintResolver(data.seedHash);
    const mesh = meshSectionFromPayload(data.payload, data.cx, data.cy, data.cz, layerOf, tintOf);
    const result: MeshResultMessage = {
      kind: 'mesh-result',
      jobId: data.jobId,
      cx: data.cx,
      cy: data.cy,
      cz: data.cz,
      version: data.version,
      data: mesh,
    };
    scope.postMessage(result, meshResultTransferables(mesh));
  } catch (error) {
    const failure: WorkerErrorMessage = {
      kind: 'error',
      jobId: data.jobId,
      message: error instanceof Error ? error.message : String(error),
    };
    scope.postMessage(failure);
  }
});
