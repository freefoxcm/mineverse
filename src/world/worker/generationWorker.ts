/**
 * Column generation worker (module worker, bundled by Vite through
 * `new Worker(new URL('./generationWorker.ts', import.meta.url))`).
 *
 * Receives `GenerateJobMessage`, runs the deterministic `TerrainGenerator` and
 * transfers the raw column arrays back. It never touches the DOM or the live world.
 */
import { TerrainGenerator } from '../worldgen';
import { generateColumnRaw, type WorkerScope } from './local';
import {
  generationResultTransferables,
  isGenerateJob,
  type GenerateResultMessage,
  type WorkerErrorMessage,
} from './protocol';

const scope = self as unknown as WorkerScope;
const generator = new TerrainGenerator(0);

scope.addEventListener('message', (event) => {
  const data = event.data;
  if (!isGenerateJob(data)) return;
  try {
    const raw = generateColumnRaw(generator, data.seedHash, data.cx, data.cz);
    const result: GenerateResultMessage = {
      kind: 'generate-result',
      jobId: data.jobId,
      cx: data.cx,
      cz: data.cz,
      version: data.version,
      blocks: raw.blocks,
      meta: raw.meta,
      heightMap: raw.heightMap,
    };
    scope.postMessage(result, generationResultTransferables(result));
  } catch (error) {
    const failure: WorkerErrorMessage = {
      kind: 'error',
      jobId: data.jobId,
      message: error instanceof Error ? error.message : String(error),
    };
    scope.postMessage(failure);
  }
});
