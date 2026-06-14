// Tipos de la API nativa `BarcodeDetector` (Chrome/Android). No viene en
// lib.dom todavía, así que la declaramos a mano. Se accede en runtime vía
// `window.BarcodeDetector` (puede no existir → fallback a carga manual).
export {}

declare global {
  interface DetectedBarcode {
    rawValue: string
    format: string
    boundingBox: DOMRectReadOnly
    cornerPoints: ReadonlyArray<{ x: number; y: number }>
  }

  interface BarcodeDetectorOptions {
    formats: string[]
  }

  class BarcodeDetector {
    constructor(options?: BarcodeDetectorOptions)
    static getSupportedFormats(): Promise<string[]>
    detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>
  }

  interface Window {
    BarcodeDetector?: typeof BarcodeDetector
  }
}
