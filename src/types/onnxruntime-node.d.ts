// Declaração mínima para o onnxruntime-node — o pacote referencia
// dist/index.d.ts no seu package.json, mas o arquivo não é publicado nesta
// versão. Só declaramos o que o app usa (InferenceSession + Tensor).
declare module "onnxruntime-node" {
  export interface OnnxValue {
    readonly data: Float32Array | Uint8Array | Int32Array | Float64Array | BigInt64Array;
    readonly dims: readonly number[];
    readonly type: string;
  }

  export class Tensor implements OnnxValue {
    constructor(
      type: string,
      data: Float32Array | Uint8Array | Int32Array | number[],
      dims: readonly number[],
    );
    readonly data: Float32Array | Uint8Array | Int32Array | Float64Array | BigInt64Array;
    readonly dims: readonly number[];
    readonly type: string;
  }

  export interface InferenceSession {
    readonly inputNames: string[];
    readonly outputNames: string[];
    run(feeds: Record<string, OnnxValue>): Promise<Record<string, OnnxValue>>;
  }

  export namespace InferenceSession {
    interface SessionOptions {
      intraOpNumThreads?: number;
      interOpNumThreads?: number;
      graphOptimizationLevel?: "disabled" | "basic" | "extended" | "all";
      [key: string]: unknown;
    }
    function create(path: string, options?: SessionOptions): Promise<InferenceSession>;
  }
}
