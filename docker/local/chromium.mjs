import { chromium } from 'playwright'

// All three processes share the CV service's network namespace. Chromium can
// therefore render the exact http://localhost URL shared with the host browser.
const browser = await chromium.launch({
  headless: true,
  args: [
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9222',
  ],
})
console.log('Local Chromium CDP listening on 127.0.0.1:9222')
browser.on('disconnected', () => process.exit(0))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await browser.close()
    process.exit(0)
  })
}
