import { join } from 'path'
import { spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { readFile, stat, writeFile } from 'fs/promises'

import { NBD } from '../..'

const device = '/dev/nbd0'
const mountPoint = '/mnt/test'
const testFile = join(mountPoint, 'test-file')
const connectionCounts = [0, 1, 2, 4, 8, 16]

for (const connections of connectionCounts) {
    describe(`${connections} connections`, () => {
        const testContent = randomBytes(1024 * 1024).toString('hex')

        test('export not found', async () => {
            await expect(
                async () => await testHarness({ name: 'doesnt exist' }),
            ).rejects.toThrow('Export not found')
        })

        test('write and read file', async () => {
            expect(await fileExists(testFile)).toBe(false)

            await testHarness({
                async attached() {
                    await writeFile(testFile, testContent)
                },
            })

            expect(await fileExists(testFile)).toBe(false)

            await testHarness({
                async attached() {
                    expect(await readFile(testFile, 'utf-8')).toBe(testContent)
                },
            })
        })
    })

    async function testHarness(
        options: {
            name?: string
            attached?(nbd: NBD): void | Promise<void>
            connected?(nbd: NBD): void | Promise<void>
        } = {},
    ) {
        const attached = jest.fn()
        const connected = jest.fn()

        expect(await NBD.check(device)).toBe(false)

        return new Promise<void>((resolve, reject) => {
            connected.mockImplementation(() => options.connected?.(nbd))
            attached.mockImplementation(() =>
                Promise.resolve()
                    .then(
                        async () =>
                            await Promise.all([
                                exec('mount', device, mountPoint).then(() =>
                                    options.attached?.(nbd),
                                ),
                                Promise.resolve().then(async () =>
                                    expect(await NBD.check(device)).toBe(true),
                                ),
                                Promise.resolve().then(async () =>
                                    expect(await nbd.size()).toBe(
                                        BigInt(1024 * 1024 * 1024),
                                    ),
                                ),
                            ]),
                    )
                    .catch(reject)
                    .finally(async () => await exec('umount', device))
                    .finally(() => nbd.stop()),
            )

            const nbd = new NBD({
                device,
                attached,
                connected,
                connections,
                name: options.name ?? 'test-disk.img',
                socket: { host: 'nbdkit', port: 8000 },
            })

            nbd.start()
                .then(async () => {
                    expect(await NBD.check(device)).toBe(false)
                })
                .then(resolve, reject)
        }).then(() => {
            expect(connected).toHaveBeenCalledTimes(1)
            expect(attached).toHaveBeenCalledTimes(1)
        })
    }
}

async function exec(command: string, ...args: string[]) {
    return new Promise<void>((resolve, reject) => {
        const child = spawn(command, args)

        child.on('error', reject).on('close', (code, signal) => {
            if (signal) {
                reject(
                    new Error(`Process ${command} quit with signal ${signal}`),
                )
            } else if (code !== 0) {
                reject(new Error(`Process ${command} quit with code ${code}`))
            } else {
                resolve()
            }
        })
    })
}

async function fileExists(path: string) {
    try {
        const file = await stat(path)

        expect(file.isFile()).toBe(true)

        return true
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            return false
        } else {
            throw error
        }
    }
}
