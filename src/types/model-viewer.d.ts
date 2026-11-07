/**
 * JSX typing for Google's <model-viewer> web component (@google/model-viewer),
 * used by src/components/ar/ModelViewer.tsx. Only the attributes this app
 * sets are listed; see https://modelviewer.dev/docs for the rest.
 */
import type { DetailedHTMLProps, HTMLAttributes } from 'react'

type ModelViewerAttributes = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  src?: string
  'ios-src'?: string
  poster?: string
  alt?: string
  ar?: boolean
  'ar-modes'?: string
  'ar-scale'?: 'auto' | 'fixed'
  'ar-placement'?: 'floor' | 'wall'
  'camera-controls'?: boolean
  'touch-action'?: 'pan-y' | 'pan-x' | 'none'
  'auto-rotate'?: boolean
  'rotation-per-second'?: string
  'interaction-prompt'?: 'auto' | 'none'
  'shadow-intensity'?: string
  'shadow-softness'?: string
  exposure?: string
  'environment-image'?: string
  loading?: 'auto' | 'lazy' | 'eager'
  reveal?: 'auto' | 'manual'
  'camera-orbit'?: string
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': ModelViewerAttributes
    }
  }
}
