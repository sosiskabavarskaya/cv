import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { loadConfigFromFile } from 'vite'

const configFile = fileURLToPath(
  new URL('../../vite.config.ts', import.meta.url)
)

const loadWith = async (
  mode: string,
  localDevelopment: string | undefined,
  origin = 'http://localhost:4381'
) => {
  const previousFlag = process.env.CV_LOCAL_DEVELOPMENT
  const previousOrigin = process.env.VITE_CV_WEB_ORIGIN
  if (localDevelopment === undefined) delete process.env.CV_LOCAL_DEVELOPMENT
  else process.env.CV_LOCAL_DEVELOPMENT = localDevelopment
  process.env.VITE_CV_WEB_ORIGIN = origin
  try {
    return await loadConfigFromFile(
      { command: 'build', mode },
      configFile,
      undefined,
      'silent'
    )
  } finally {
    if (previousFlag === undefined) delete process.env.CV_LOCAL_DEVELOPMENT
    else process.env.CV_LOCAL_DEVELOPMENT = previousFlag
    if (previousOrigin === undefined) delete process.env.VITE_CV_WEB_ORIGIN
    else process.env.VITE_CV_WEB_ORIGIN = previousOrigin
  }
}

describe('Registry Vite build configuration', () => {
  test('permits loopback for both builds in the local desktop dependency chain', async () => {
    for (const mode of ['production', 'desktop']) {
      const result = await loadWith(mode, '1')
      expect(result?.config.base).toBe(mode === 'desktop' ? './' : '/')
    }
  })

  test('requires explicit local opt-in for production and desktop builds', async () => {
    for (const mode of ['production', 'desktop']) {
      for (const flag of [undefined, '0']) {
        await expect(loadWith(mode, flag)).rejects.toThrow('must use HTTPS')
      }
    }
  })

  test('rejects remote HTTP origins even with local development enabled', async () => {
    await expect(
      loadWith('production', '1', 'http://cv.example.test')
    ).rejects.toThrow('must use HTTPS')
  })
})
