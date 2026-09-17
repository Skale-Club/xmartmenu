// =============================================================================
// src/lib/blog/cover-image.ts
//
// Imagens de capa para os posts gerados (autoblog-parity XM-05, MASTER §8).
//
// SOURCE OF TRUTH da forma: xtimator/lib/blog/cover-image.ts — sincronize as
// mudanças de volta.
//
// Três etapas, e nenhuma delas pode derrubar o post: pedir a imagem ao modelo,
// normalizar para 16:9 WebP, subir. Um post sem capa é um post pior; uma
// geração que MORREU porque o modelo de imagem estava ocupado é uma publicação
// perdida, o que é pior ainda. Todo caminho aqui devolve null em vez de lançar.
//
// Os bytes vão para `tenant-assets` sob o prefixo `_platform/`, que já é a
// convenção deste repo para assets da própria plataforma (ver
// src/app/api/superadmin/platform/upload/route.ts). O blog é da plataforma, não
// de nenhum tenant, então não existe prefixo de tenant sob o qual guardá-lo.
// =============================================================================
import { getStorageClient } from '@/lib/storage'

/** Medido nos produtos irmãos: uma capa PNG de 1433 KB virou 94 KB em q82,
 *  sem diferença visível. */
const WEBP_QUALITY = 82

/** 16:9. O card do blog e o preview de OG recortam para isso de qualquer jeito;
 *  entregar outra proporção só move o recorte para o browser, diferente em cada
 *  superfície. */
const TARGET_WIDTH = 16
const TARGET_HEIGHT = 9

/** Um modelo que respeita a proporção pedida dentro disso não precisa recorte. */
const ASPECT_TOLERANCE = 0.05

const IMAGE_TIMEOUT_MS = 90_000
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

export interface CoverImageResult {
  url: string
  durationMs: number
}

function coverPrompt(title: string, focusKeyword: string | null): string {
  return [
    `Imagem de capa fotográfica e profissional para um artigo intitulado "${title}".`,
    focusKeyword ? `O assunto é ${focusKeyword}.` : '',
    'Fotografia editorial para donos de restaurante: cozinhas reais, pratos reais, salão real.',
    'Composição 16:9 ampla, clara e limpa, com espaço para um título por cima.',
    'Absolutamente sem texto, sem palavras, sem letras, sem números, sem marca d\'água, sem logotipos.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * Pede a imagem ao modelo. Devolve null quando o modelo responde sem imagem —
 * vários modelos com saída de imagem fazem isso para um prompt que recusam, e
 * isso é um desfecho normal aqui, não um erro.
 */
async function requestImage(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'https://xmartmenu.com',
      'X-Title': 'XmartMenu',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      // Modelos com saída de imagem devolvem data URLs em base64 sob
      // choices[0].message.images[].image_url.url.
      modalities: ['image', 'text'],
    }),
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenRouter image request failed (${res.status}): ${body.slice(0, 300)}`)
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>
  }
  const dataUrl = json.choices?.[0]?.message?.images?.[0]?.image_url?.url
  if (typeof dataUrl !== 'string') return null

  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i)
  if (!match) return null
  return { bytes: Buffer.from(match[2], 'base64'), mime: match[1].toLowerCase() }
}

/**
 * Recorta para 16:9 quando o modelo ignorou a proporção pedida, depois codifica
 * WebP.
 *
 * Recorta o lado maior em vez de escalar — nunca inventar pixels — e usa o
 * posicionamento `attention` do sharp para que uma foto quadrada não seja
 * decapitada por um recorte central ingênuo.
 *
 * Nunca lança: um recorte ou uma codificação que falha degrada para os bytes
 * originais. Uma capa apenas não otimizada ainda é melhor que capa nenhuma.
 */
async function normaliseTo16x9(
  bytes: Buffer,
  mime: string,
): Promise<{ buffer: Buffer; mime: string; extension: string }> {
  let working = bytes
  try {
    const { default: sharp } = await import('sharp')
    const image = sharp(bytes)
    const { width, height } = await image.metadata()
    if (width && height) {
      const target = TARGET_WIDTH / TARGET_HEIGHT
      const actual = width / height
      if (Math.abs(actual - target) / target > ASPECT_TOLERANCE) {
        const [cropWidth, cropHeight] =
          actual > target ? [Math.round(height * target), height] : [width, Math.round(width / target)]
        working = await image
          .resize({ width: cropWidth, height: cropHeight, fit: 'cover', position: 'attention' })
          .toBuffer()
      }
    }
  } catch {
    // Metadata ruim, bytes corrompidos, sharp indisponível — codifica o que há.
  }

  try {
    const { default: sharp } = await import('sharp')
    const webp = await sharp(working).webp({ quality: WEBP_QUALITY }).toBuffer()
    return { buffer: webp, mime: 'image/webp', extension: 'webp' }
  } catch {
    // A extensão precisa descrever o que está REALMENTE no buffer, nunca uma
    // suposição fixa — servir bytes WebP como .png (ou o contrário) é como um
    // upload "bem-sucedido" vira uma imagem quebrada.
    return { buffer: working, mime, extension: mime.split('/')[1] || 'png' }
  }
}

/**
 * Gera, normaliza e armazena a capa de um post.
 *
 * `null` significa sem capa desta vez, por qualquer motivo. Quem chama registra
 * o tempo da etapa e segue — o post é publicado de todo jeito.
 */
export async function generateCoverImage(args: {
  apiKey: string | null
  model: string
  title: string
  focusKeyword: string | null
  slug: string
}): Promise<CoverImageResult | null> {
  const model = args.model?.trim()
  if (!model || !args.apiKey) return null

  const started = Date.now()
  try {
    const image = await requestImage(args.apiKey, model, coverPrompt(args.title, args.focusKeyword))
    if (!image) return null

    const normalised = await normaliseTo16x9(image.bytes, image.mime)

    // O slug já é a forma segura do título; o timestamp é o que torna a chave
    // imutável, então uma republicação nunca sobrescreve uma capa que já está
    // em cache na borda.
    const safeSlug = args.slug.replace(/[^a-z0-9-]/gi, '').slice(0, 60) || 'post'
    const path = `_platform/blog/${Date.now()}-${safeSlug}.${normalised.extension}`

    const url = await getStorageClient().upload('tenant-assets', path, normalised.buffer, {
      contentType: normalised.mime,
      upsert: false,
    })

    return { url, durationMs: Date.now() - started }
  } catch (err) {
    console.warn('[blog] capa falhou, publicando sem ela:', (err as Error).message)
    return null
  }
}
