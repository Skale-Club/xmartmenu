// tests/unit/blog/cover-image.test.ts
// Auto-blog parity XM-05 — as capas dos posts gerados.
//
// O contrato que este arquivo defende é "uma capa nunca pode custar um post":
// todo modo de falha abaixo tem que devolver null em vez de lançar, porque
// quem chama trata um throw como geração falhada.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const upload = vi.fn()
vi.mock('@/lib/storage', () => ({
  getStorageClient: () => ({ upload }),
}))

import { generateCoverImage } from '@/lib/blog/cover-image'

/** Um PNG de verdade, para o sharp ter bytes reais para recortar e codificar. */
async function pngBytes(width: number, height: number): Promise<Buffer> {
  const { default: sharp } = await import('sharp')
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 60 } },
  })
    .png()
    .toBuffer()
}

function imageResponse(bytes: Buffer, mime = 'image/png') {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { images: [{ image_url: { url: `data:${mime};base64,${bytes.toString('base64')}` } }] } }],
    }),
  } as unknown as Response
}

const ARGS = {
  apiKey: 'sk-or-test',
  model: 'test/image-model',
  title: 'Como precificar o seu cardápio',
  focusKeyword: 'precificação de cardápio',
  slug: 'como-precificar-o-seu-cardapio',
}

describe('generateCoverImage', () => {
  beforeEach(() => {
    upload.mockReset()
    upload.mockImplementation(async (_bucket: string, path: string) => `https://cdn.test/${path}`)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('não gasta nada quando não há modelo ou chave', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await generateCoverImage({ ...ARGS, model: '   ' })).toBeNull()
    expect(await generateCoverImage({ ...ARGS, apiKey: null })).toBeNull()
    // Sem modelo é sem requisição, não "gera e descarta".
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sobe WebP sob o prefixo _platform, com chave imutável', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => imageResponse(await pngBytes(1600, 900))))

    const result = await generateCoverImage(ARGS)
    // A URL que volta é a que o storage devolveu, não uma remontada aqui: se
    // este módulo reconstruísse a URL, ela sairia errada no dia em que o
    // provedor de storage mudar.
    expect(result?.url).toMatch(/^https:\/\/cdn\.test\/_platform\/blog\/\d+-como-precificar-o-seu-cardapio\.webp$/)

    const [bucket, path, body, opts] = upload.mock.calls[0]
    expect(bucket).toBe('tenant-assets')
    // _platform/ é a convenção deste repo para asset da própria plataforma — o
    // blog não é de nenhum tenant.
    expect(path).toMatch(/^_platform\/blog\/\d+-como-precificar-o-seu-cardapio\.webp$/)
    // upsert false + timestamp: uma chave reaproveitada deixaria presa toda
    // cópia já cacheada na borda.
    expect(opts).toMatchObject({ contentType: 'image/webp', upsert: false })
    expect(body.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(body.subarray(8, 12).toString('ascii')).toBe('WEBP')
  })

  it('recorta para 16:9 uma imagem quadrada que o modelo devolveu', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => imageResponse(await pngBytes(1000, 1000))))

    await generateCoverImage(ARGS)

    const { default: sharp } = await import('sharp')
    const meta = await sharp(upload.mock.calls[0][2]).metadata()
    // Recorta o lado maior em vez de escalar — nunca inventar pixels.
    expect(meta.width).toBe(1000)
    expect(meta.height).toBe(563)
  })

  it('deixa intacta uma imagem que já veio em 16:9', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => imageResponse(await pngBytes(1600, 900))))

    await generateCoverImage(ARGS)

    const { default: sharp } = await import('sharp')
    const meta = await sharp(upload.mock.calls[0][2]).metadata()
    expect(meta.width).toBe(1600)
    expect(meta.height).toBe(900)
  })

  it('devolve null quando o modelo responde sem imagem', async () => {
    // Vários modelos com saída de imagem fazem isso num prompt que recusam.
    // É um desfecho normal, não um erro.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: {} }] }) }) as unknown as Response))

    expect(await generateCoverImage(ARGS)).toBeNull()
    expect(upload).not.toHaveBeenCalled()
  })

  it('devolve null — nunca lança — quando a API falha', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, text: async () => 'busy' }) as unknown as Response))
    await expect(generateCoverImage(ARGS)).resolves.toBeNull()
  })

  it('devolve null — nunca lança — quando o upload falha', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => imageResponse(await pngBytes(1600, 900))))
    upload.mockRejectedValueOnce(new Error('bucket fora do ar'))
    // O post está prestes a ser escrito. Uma instabilidade de storage não pode
    // derrubá-lo.
    await expect(generateCoverImage(ARGS)).resolves.toBeNull()
  })

  it('pede ao modelo composição 16:9 e nenhum texto', async () => {
    const fetchSpy = vi.fn(async () => imageResponse(await pngBytes(1600, 900)))
    vi.stubGlobal('fetch', fetchSpy)

    await generateCoverImage(ARGS)

    // `vi.fn(async () => ...)` infers a zero-arg signature, so the recorded
    // call tuple is typed empty. The cast is on the ARGUMENT shape only — the
    // assertions below still read the real recorded request.
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.modalities).toEqual(['image', 'text'])
    const prompt: string = body.messages[0].content
    // Texto queimado numa capa gerada não tem conserto depois e lê como erro
    // de digitação para todo visitante.
    expect(prompt).toMatch(/sem texto/i)
    expect(prompt).toMatch(/16:9/)
    expect(prompt).toContain(ARGS.title)
  })
})
