import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { createRequire } from 'node:module'
import { setTimeout } from 'node:timers/promises'
import { chromium } from 'playwright'

const api = createRequire(
  new URL('../../apps/application-registry-api/package.json', import.meta.url)
)
const worker = createRequire(
  new URL(
    '../../apps/application-registry-pdf-worker/package.json',
    import.meta.url
  )
)
const events = createRequire(
  new URL(
    '../../libs/application-registry/events-nats/package.json',
    import.meta.url
  )
)
const cv = createRequire(new URL('../../apps/cv/package.json', import.meta.url))
const { PDFDocument } = await import(worker.resolve('pdf-lib'))
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } =
  await import(api.resolve('@aws-sdk/client-s3'))
const { connect } = await import(events.resolve('@nats-io/transport-node'))
const { jetstreamManager } = await import(events.resolve('@nats-io/jetstream'))
const authorization = `Bearer ${process.env.REGISTRY_API_TOKEN}`

const health = await fetch('http://api:3001/api/registry/health', {
  headers: { authorization },
})
assert.equal(health.status, 200)
assert.equal((await fetch('http://api:3001/api/registry/health')).status, 401)
assert.equal(
  (
    await fetch('http://api:3001/api/registry/applications', {
      headers: { authorization },
    })
  ).status,
  200
)
// Vite permits IP addresses and localhost; Docker's service name is not a
// browser hostname. Resolve the internal address without relaxing allowedHosts.
const { address: registryAddress } = await lookup('registry', { family: 4 })
assert.equal(
  (await fetch(`http://${registryAddress}:${process.env.REGISTRY_PORT}/`))
    .status,
  200
)
console.log('API authentication, database-backed listing, and Registry UI: OK')

const migrations = execFileSync(
  'psql',
  [
    '--no-psqlrc',
    '-tAc',
    'select count(*) from application_registry_schema_migrations',
  ],
  {
    env: {
      ...process.env,
      PGHOST: process.env.POSTGRES_HOST,
      PGPORT: process.env.POSTGRES_PORT,
      PGDATABASE: process.env.POSTGRES_DATABASE,
      PGUSER: process.env.POSTGRES_USER,
      PGPASSWORD: process.env.POSTGRES_PASSWORD,
    },
    encoding: 'utf8',
  }
)
assert.ok(Number(migrations.trim()) >= 2)
console.log('Checked-in PostgreSQL migrations: OK')

const nats = await connect({
  servers: process.env.NATS_SERVER,
  user: process.env.NATS_USER,
  pass: process.env.NATS_PASSWORD,
})
try {
  const manager = await jetstreamManager(nats)
  const stream = await manager.streams.info('REGISTRY_EVENTS')
  assert.equal(stream.config.storage, 'file')
  const consumer = await manager.consumers.info(
    'REGISTRY_EVENTS',
    'registry-pdf-worker'
  )
  assert.equal(consumer.config.max_ack_pending, 1)
  assert.equal(consumer.config.max_deliver, 5)
  console.log('Persistent JetStream stream and PDF consumer: OK')
} finally {
  await nats.drain()
}

// An isolated fixture server checks real A4 rendering without altering the live
// CV server or importing someone else's personal facts into the registry.
const fixturePort = 14381
const fixture = spawn(
  process.execPath,
  [
    cv.resolve('next/dist/bin/next'),
    'dev',
    '--hostname',
    '127.0.0.1',
    '--port',
    String(fixturePort),
  ],
  {
    cwd: '/workspace/apps/cv',
    env: {
      ...process.env,
      CV_FIXTURE_MODE: '1',
      CV_FIXTURE_PUBLIC_URL: `http://localhost:${fixturePort}/c/fixture`,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  }
)
let diagnostics = ''
fixture.stderr.on('data', (chunk) => {
  diagnostics = (diagnostics + chunk).slice(-4000)
})
let browser
try {
  const url = `http://127.0.0.1:${fixturePort}/c/_internal/health`
  let ready = false
  for (let attempt = 0; attempt < 90; attempt++) {
    if (fixture.exitCode !== null)
      throw new Error(`Fixture server exited: ${diagnostics}`)
    try {
      ready = (await fetch(url)).ok
    } catch {
      /* Server is starting. */
    }
    if (ready) break
    await setTimeout(1000)
  }
  assert.ok(ready, `Fixture server did not start: ${diagnostics}`)
  browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    const response = await page.goto(
      `http://localhost:${fixturePort}/c/_render/fixture?access=fixture-preview`,
      { waitUntil: 'networkidle', timeout: 90000 }
    )
    assert.equal(
      response.status(),
      200,
      diagnostics || (await page.textContent('body'))
    )
    await page.emulateMedia({ media: 'print' })
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    assert.ok(await page.locator('[data-cv-pdf-document]').count())
    const bytes = await page.pdf({
      format: 'A4',
      preferCSSPageSize: true,
      printBackground: true,
    })
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
    const document = await PDFDocument.load(bytes)
    assert.ok(document.getPageCount() >= 1)
    const s3 = new S3Client({
      endpoint: process.env.MINIO_ENDPOINT,
      region: process.env.MINIO_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY_ID,
        secretAccessKey: process.env.MINIO_SECRET_ACCESS_KEY,
      },
    })
    const key = `local-smoke/${randomUUID()}.pdf`
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.MINIO_OBJECTS_BUCKET,
          Key: key,
          Body: bytes,
          ContentType: 'application/pdf',
        })
      )
      const stored = await s3.send(
        new GetObjectCommand({
          Bucket: process.env.MINIO_OBJECTS_BUCKET,
          Key: key,
        })
      )
      assert.deepEqual(
        Buffer.from(await stored.Body.transformToByteArray()),
        bytes
      )
    } finally {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: process.env.MINIO_OBJECTS_BUCKET,
          Key: key,
        })
      )
      s3.destroy()
    }
    console.log(
      `Chromium CDP, fixture CV, PDF (${document.getPageCount()} pages), MinIO round trip: OK`
    )
  } finally {
    await context.close()
  }
} finally {
  if (browser) await browser.close()
  fixture.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => fixture.once('exit', resolve)),
    setTimeout(5000),
  ])
  if (fixture.exitCode === null) fixture.kill('SIGKILL')
}
console.log('Local Compose smoke check passed')
