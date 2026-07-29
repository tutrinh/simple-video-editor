interface ConnectableNode {
  connect(destination: ConnectableNode): unknown;
  disconnect(): void;
}

interface NoiseFilterNode extends ConnectableNode {
  destroy(): void;
}

interface NoiseDestinationNode extends ConnectableNode {
  stream: MediaStream;
}

interface NoiseAudioContext {
  state: AudioContextState;
  audioWorklet: { addModule(url: string): Promise<void> };
  createMediaStreamSource(stream: MediaStream): ConnectableNode;
  createMediaStreamDestination(): NoiseDestinationNode;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export interface NoiseCleanupRuntime {
  createContext(): NoiseAudioContext;
  addWorklet(context: NoiseAudioContext): Promise<void>;
  loadBinary(): Promise<ArrayBuffer>;
  createFilter(context: NoiseAudioContext, wasmBinary: ArrayBuffer, maxChannels: number): NoiseFilterNode;
}

export interface PreparedVoiceStream {
  stream: MediaStream;
  active: boolean;
  warning: string | null;
  cleanup(): void;
}

let rnnoiseBinaryPromise: Promise<ArrayBuffer> | null = null;

async function createBrowserRuntime(): Promise<NoiseCleanupRuntime> {
  const [
    { RnnoiseWorkletNode, loadRnnoise },
    { default: rnnoiseWorkletUrl },
    { default: rnnoiseWasmUrl },
    { default: rnnoiseSimdWasmUrl },
  ] = await Promise.all([
    import("@sapphi-red/web-noise-suppressor"),
    import("@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url"),
    import("@sapphi-red/web-noise-suppressor/rnnoise.wasm?url"),
    import("@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url"),
  ]);

  const loadBinary = () => {
    if (!rnnoiseBinaryPromise) {
      rnnoiseBinaryPromise = loadRnnoise({
        url: rnnoiseWasmUrl,
        simdUrl: rnnoiseSimdWasmUrl,
      }).catch((error) => {
        rnnoiseBinaryPromise = null;
        throw error;
      });
    }
    return rnnoiseBinaryPromise;
  };

  return {
    createContext: () => new AudioContext({ sampleRate: 48_000 }) as unknown as NoiseAudioContext,
    addWorklet: (context) => context.audioWorklet.addModule(rnnoiseWorkletUrl),
    loadBinary,
    createFilter: (context, wasmBinary, maxChannels) => new RnnoiseWorkletNode(
      context as unknown as AudioContext,
      { maxChannels, wasmBinary },
    ) as unknown as NoiseFilterNode,
  };
}

function noCleanup(stream: MediaStream, warning: string | null = null): PreparedVoiceStream {
  return { stream, active: false, warning, cleanup: () => {} };
}

/**
 * Routes a microphone stream through RNNoise without taking ownership of the
 * original stream. The recorder remains responsible for stopping microphone
 * tracks; this adapter owns only its AudioContext and processed output.
 */
export async function prepareVoiceStream(
  microphoneStream: MediaStream,
  enabled: boolean,
  runtime?: NoiseCleanupRuntime,
): Promise<PreparedVoiceStream> {
  if (!enabled) return noCleanup(microphoneStream);

  let context: NoiseAudioContext | null = null;
  try {
    const selectedRuntime = runtime ?? await createBrowserRuntime();
    context = selectedRuntime.createContext();
    const [wasmBinary] = await Promise.all([
      selectedRuntime.loadBinary(),
      selectedRuntime.addWorklet(context),
    ]);
    if (context.state === "suspended") await context.resume();

    const source = context.createMediaStreamSource(microphoneStream);
    const filter = selectedRuntime.createFilter(context, wasmBinary, 2);
    const destination = context.createMediaStreamDestination();
    source.connect(filter);
    filter.connect(destination);

    // Keep echo cancellation and automatic gain, but avoid stacking the
    // browser's denoiser on top of RNNoise when the device supports changing it.
    await Promise.allSettled(
      microphoneStream.getAudioTracks().map((track) => track.applyConstraints({ noiseSuppression: false })),
    );

    let cleanedUp = false;
    return {
      stream: destination.stream,
      active: true,
      warning: null,
      cleanup: () => {
        if (cleanedUp) return;
        cleanedUp = true;
        destination.stream.getTracks().forEach((track) => track.stop());
        source.disconnect();
        filter.disconnect();
        destination.disconnect();
        filter.destroy();
        void context?.close();
      },
    };
  } catch {
    if (context) void context.close();
    return noCleanup(
      microphoneStream,
      "Noise cleanup could not start, so this take used the browser’s microphone processing.",
    );
  }
}
