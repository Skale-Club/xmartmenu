import { ImageResponse } from 'next/og'

export const alt = 'XmartMenu | Digital menus built for service'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#18181b',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '80px',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            color: '#ffffff',
            letterSpacing: '-2px',
            lineHeight: 1.1,
            textAlign: 'center',
          }}
        >
          XmartMenu
        </div>
        <div
          style={{
            fontSize: 32,
            fontWeight: 400,
            color: '#a1a1aa',
            marginTop: 24,
            textAlign: 'center',
            lineHeight: 1.4,
          }}
        >
          Digital menus built for service
        </div>
        <div
          style={{
            marginTop: 48,
            background: '#ffffff',
            color: '#18181b',
            fontSize: 22,
            fontWeight: 700,
            padding: '14px 40px',
            borderRadius: 12,
          }}
        >
          Get started free
        </div>
      </div>
    ),
    { ...size }
  )
}
