import { createRequire } from 'node:module'
import { setTimeout } from 'node:timers/promises'

const api = createRequire(
  new URL('../../apps/application-registry-api/package.json', import.meta.url)
)
const events = createRequire(
  new URL(
    '../../libs/application-registry/events-nats/package.json',
    import.meta.url
  )
)
const { S3Client, HeadBucketCommand, CreateBucketCommand } = await import(
  api.resolve('@aws-sdk/client-s3')
)
const { connect } = await import(events.resolve('@nats-io/transport-node'))
const {
  jetstreamManager,
  StorageType,
  RetentionPolicy,
  DiscardPolicy,
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
} = await import(events.resolve('@nats-io/jetstream'))

async function retry(label, action) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await action()
    } catch (error) {
      if (attempt >= 30) throw error
      console.log(`Waiting for ${label} (${attempt}/30)`)
      await setTimeout(1000)
    }
  }
}

const s3 = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT,
  region: process.env.MINIO_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY_ID,
    secretAccessKey: process.env.MINIO_SECRET_ACCESS_KEY,
  },
})
try {
  for (const bucket of [
    process.env.MINIO_FACTS_BUCKET,
    process.env.MINIO_OBJECTS_BUCKET,
  ]) {
    await retry('MinIO', async () => {
      try {
        await s3.send(new HeadBucketCommand({ Bucket: bucket }))
      } catch (error) {
        if (error.$metadata?.httpStatusCode !== 404) throw error
        await s3.send(new CreateBucketCommand({ Bucket: bucket }))
      }
    })
    console.log(`Bucket ready: ${bucket}`)
  }
} finally {
  s3.destroy()
}

const connection = await retry('NATS', () =>
  connect({
    servers: process.env.NATS_SERVER,
    user: process.env.NATS_USER,
    pass: process.env.NATS_PASSWORD,
    timeout: 3000,
  })
)
try {
  const manager = await jetstreamManager(connection)
  const stream = 'REGISTRY_EVENTS'
  try {
    const existing = await manager.streams.info(stream)
    if (
      existing.config.storage !== StorageType.File ||
      JSON.stringify(existing.config.subjects) !==
        JSON.stringify(['registry.events.>'])
    ) {
      throw new Error(
        'Existing REGISTRY_EVENTS stream does not match the local configuration.'
      )
    }
  } catch (error) {
    if (error.status !== 404 || error.code !== 10059) throw error
    await manager.streams.add({
      name: stream,
      subjects: ['registry.events.>'],
      storage: StorageType.File,
      retention: RetentionPolicy.Limits,
      discard: DiscardPolicy.Old,
      num_replicas: 1,
      max_age: 7 * 24 * 60 * 60 * 1e9,
      max_bytes: 256 * 1024 * 1024,
      max_msgs: 50000,
      max_msg_size: 64 * 1024,
      duplicate_window: 24 * 60 * 60 * 1e9,
    })
  }
  const consumer = 'registry-pdf-worker'
  try {
    const existing = await manager.consumers.info(stream, consumer)
    if (
      existing.config.max_ack_pending !== 1 ||
      existing.config.max_deliver !== 5
    ) {
      throw new Error(
        'Existing PDF consumer does not match the local configuration.'
      )
    }
  } catch (error) {
    if (error.status !== 404 || error.code !== 10014) throw error
    await manager.consumers.add(stream, {
      name: consumer,
      durable_name: consumer,
      ack_policy: AckPolicy.Explicit,
      ack_wait: 120 * 1e9,
      deliver_policy: DeliverPolicy.All,
      replay_policy: ReplayPolicy.Instant,
      filter_subjects: [
        'registry.events.cv.publication-availability-changed.v1',
        'registry.events.cv.pdf-generation-requested.v1',
      ],
      max_ack_pending: 1,
      max_deliver: 5,
      max_waiting: 4,
      max_expires: 30 * 1e9,
    })
  }
  console.log('JetStream stream and PDF consumer ready')
} finally {
  await connection.drain()
}
