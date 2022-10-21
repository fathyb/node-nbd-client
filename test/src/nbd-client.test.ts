import { join } from 'path'
import { spawnSync } from 'child_process'
import { randomBytes } from 'crypto'
import { readFile, stat, writeFile } from 'fs/promises'

import { NBD } from '../..'

const device = '/dev/nbd0'
const mountPoint = '/mnt/test'
const testFile = join(mountPoint, 'test-file')
const connectionCounts = Array(16)
    .fill(0)
    .map((_, i) => i + 1)

for (const connections of connectionCounts) {
    describe(`${connections} connections`, () => {
        const testContent = randomBytes(1024 * 1024).toString('hex')

        test('write and read file', async () => {
            await testHarness(
                async () => await writeFile(testFile, testContent),
            )

            expect(await fileExists(testFile)).toBe(false)

            await testHarness(async () => {
                expect(await readFile(testFile, 'utf-8')).toBe(testContent)
            })
        })
    })

    async function testHarness(connected: (nbd: NBD) => void | Promise<void>) {
        const callback = jest.fn()

        return new Promise<void>((resolve, reject) => {
            callback.mockImplementation(() => {
                Promise.resolve()
                    .then(async () => {
                        const expectedSize = BigInt(1024 * 1024 * 1024)

                        for (let i = 0; i < 1000; i++) {
                            const size = await nbd.size()

                            if (size === 0n) {
                                await new Promise<void>((resolve) =>
                                    setTimeout(resolve, 10),
                                )
                            } else if (size === expectedSize) {
                                break
                            } else {
                                throw new Error(
                                    `Unexpected block device size: ${size}, expected: ${expectedSize}`,
                                )
                            }
                        }

                        spawnSync('mount', [device, mountPoint])

                        await connected(nbd)
                    })
                    .catch(reject)
                    .finally(() => spawnSync('umount', [device]))
                    .finally(() => nbd.stop())
            })
            const nbd = new NBD({
                device,
                connections,
                export: 'test-disk.img',
                socket: { host: 'nbdkit', port: 8000 },
                connected: callback,
            })

            nbd.start().then(resolve, reject)
        }).then(() => {
            expect(callback).toHaveBeenCalledTimes(1)
        })
    }
}

async function fileExists(path: string) {
    try {
        const file = await stat(path)

        return file.isFile()
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            return false
        } else {
            throw error
        }
    }
}
