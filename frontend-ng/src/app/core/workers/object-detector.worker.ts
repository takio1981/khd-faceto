/// <reference lib="webworker" />

// This worker runs COCO-SSD completely isolated from the main thread.
// face-api.js (with its own bundled TF.js) lives only on the main thread.
// By keeping COCO-SSD here, the two TF.js instances never share globalThis
// kernel registries — no "kernel already registered" warnings.

let model: any = null;

async function initModel(): Promise<void> {
  // CPU backend is safe in a Worker (no WebGL / OffscreenCanvas dependency).
  await import('@tensorflow/tfjs-backend-cpu');
  const tf = await import('@tensorflow/tfjs-core');
  await (tf as any).setBackend('cpu');
  await (tf as any).ready();

  const cocoMod = await import('@tensorflow-models/coco-ssd');
  // esbuild wraps CJS modules: exports land on .default in ESM namespace.
  const cocoSsd: { load: (cfg?: object) => Promise<any> } =
    (cocoMod as any).default ?? (cocoMod as any);
  model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
}

self.addEventListener('message', async ({ data }: MessageEvent) => {
  try {
    switch (data.type) {
      case 'init':
        await initModel();
        self.postMessage({ type: 'ready' });
        break;

      case 'detect': {
        if (!model) {
          self.postMessage({ type: 'detections', id: data.id, predictions: [] });
          break;
        }
        // Reconstruct ImageData from the transferred buffer (zero-copy transfer).
        const imgData = new ImageData(
          new Uint8ClampedArray(data.buffer),
          data.width,
          data.height,
        );
        // model.detect() calls tf.browser.fromPixels(ImageData) internally.
        // The CPU backend reads pixel bytes directly — no canvas/WebGL needed,
        // so this works fine in a Web Worker context.
        const predictions = await model.detect(imgData);
        self.postMessage({ type: 'detections', id: data.id, predictions });
        break;
      }
    }
  } catch (e: any) {
    if (data?.type === 'init') {
      self.postMessage({ type: 'error', message: e?.message ?? String(e) });
    } else {
      self.postMessage({ type: 'detections', id: data?.id, predictions: [] });
    }
  }
});
