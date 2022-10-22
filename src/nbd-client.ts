import { cpus } from 'os'
import { ioctl } from 'async-ioctl'
import { setMaxListeners } from 'events'
import { FileHandle, open, readFile } from 'fs/promises'
import { NetConnectOpts, Socket, createConnection } from 'net'

import { IOCTL_CODES } from './nbd-constants'
import { HandshakeExport, Handshake } from './nbd-handshake'

export interface NBDOptions {
    device: string

    name?: string
    socket?: NetConnectOpts
    persist?: boolean
    blockSize?: number
    connections?: number

    attached?(): void | Promise<void>
    connected?(): void | Promise<void>
}

export class NBD {
    /** Return `true` if a device is attached, `false` otherwise. */
    public static async check(device: string) {
        const pid = await this.pid(device)

        return pid !== null
    }

    /** Return the pid associated to a device, or `null` if the device is not attached.  */
    public static async pid(device: string) {
        const name = device.replace(/^\/dev\//, '')
        const pid = await readFile(`/sys/block/${name}/pid`, 'utf-8').catch(
            (error) => {
                if (error?.code === 'ENOENT') {
                    return null
                } else {
                    throw error
                }
            },
        )

        return pid ? parseInt(pid, 10) : null
    }

    private device: null | FileHandle = null
    private promise: null | Promise<void> = null
    private readonly abort = new AbortController()

    constructor(private readonly options: NBDOptions) {}

    /** Stop the NBD client. */
    public stop() {
        this.abort.abort()
    }

    /** Start the NBD client. */
    public async start() {
        if (this.promise) {
            throw new Error('NBD client already started')
        }

        this.promise = this.run()

        return await this.promise
    }

    /** Get the underlying block device size. */
    public async size() {
        const { device } = this

        if (!device) {
            throw new Error('NBD client not started')
        }

        const buffer = new BigUint64Array(1)

        await this.handle(
            async () =>
                await ioctl(device.fd, IOCTL_CODES.BLKGETSIZE64, buffer),
        )

        return buffer[0]
    }

    /** Reconnection loop. */
    private async run() {
        let attempts = 0
        const { abort, options } = this

        this.device = await open(options.device, 'r+')

        try {
            while (true) {
                try {
                    await this.handle(async () => await this.attach())
                } catch (error) {
                    if (!(error instanceof AbortError)) {
                        throw error
                    }
                }

                if (!options.persist || abort?.signal.aborted) {
                    return
                }

                const attempt = ++attempts
                const delay = backoff(attempt)

                console.error(
                    'NBD connection closed, reconnecting in %ss, attempt=%s',
                    Math.round(delay) / 1000,
                    attempt,
                )

                await sleep(delay, abort)
            }
        } finally {
            await this.device.close()
        }
    }

    /** Open connections and attach the NBD device. */
    private async attach() {
        const { abort, device, options } = this

        if (!device) {
            throw new Error('NBD device missing')
        }

        const connections: Connection[] = []
        const connectionsCount = Math.max(
            1,
            options.connections ?? cpus().length,
        )
        const teardown = () => {
            abort?.signal.removeEventListener('abort', teardown)

            for (const { socket } of connections) {
                restoreSocket(socket).end()
            }
        }

        setMaxListeners(connectionsCount, abort.signal)

        try {
            const results = await Promise.allSettled(
                Array(connectionsCount)
                    .fill(0)
                    .map(async () => {
                        connections.push(await this.connect())
                    }),
            )

            for (const result of results) {
                if (result.status === 'rejected') {
                    throw result.reason
                }
            }

            const [
                {
                    export: { size, flags },
                },
            ] = connections

            for (const connection of connections) {
                if (connection.export.size !== size) {
                    throw new Error(
                        `Invalid size for connection: ${connection.export.size}, expected: ${size}`,
                    )
                }

                if (connection.export.flags !== flags) {
                    throw new Error(
                        `Invalid flags for connection: ${connection.export.flags}, expected: ${flags}`,
                    )
                }
            }

            abort?.signal.addEventListener('abort', teardown)

            const { fd } = device
            const blockSize = options.blockSize ?? 1024

            // Setup the NBD parameters for this block device
            await ioctl.batch(
                [fd, IOCTL_CODES.NBD_SET_BLKSIZE, blockSize],
                [fd, IOCTL_CODES.NBD_SET_SIZE_BLOCKS, size / BigInt(blockSize)],
                [fd, IOCTL_CODES.NBD_SET_FLAGS, flags],
                [fd, IOCTL_CODES.NBD_CLEAR_SOCK],
                ...connections.map(
                    (connection) =>
                        [fd, IOCTL_CODES.NBD_SET_SOCK, connection.fd] as [
                            number,
                            number,
                            number,
                        ],
                ),
            )

            if (abort?.signal.aborted) {
                throw new AbortError()
            }

            await options.connected?.()

            if (abort?.signal.aborted) {
                throw new AbortError()
            }

            let running = true

            await Promise.all([
                // Give ownership of the sockets to the kernel and attach the NBD device
                ioctl.blocking(fd, IOCTL_CODES.NBD_DO_IT).finally(() => {
                    running = false
                }),
                Promise.resolve().then(async () => {
                    const start = Date.now()

                    while (running) {
                        const blockDeviceSize = await this.size()

                        if (blockDeviceSize === 0n) {
                            const duration = Date.now() - start

                            await sleep(
                                // Variable poll timing for best results
                                duration < 25
                                    ? 1 // poll every ms the first 25ms
                                    : duration < 500
                                    ? 10 // poll every 10ms the first 500ms
                                    : duration < 1000
                                    ? 50 // poll every 50ms the first 1s
                                    : 500, // poll every 500ms after that
                            )
                        } else if (blockDeviceSize === size) {
                            return await options.attached?.()
                        } else {
                            throw new Error(
                                `NBD size mismatch on ${options.device}: expected=${size}, actual=${blockDeviceSize}`,
                            )
                        }
                    }
                }),
            ])
        } finally {
            teardown()
        }
    }

    /** Open a connection to the NBD server. */
    private async connect() {
        const { abort, options } = this
        const { socket: socketOptions, name } = options

        if (abort?.signal.aborted) {
            throw new AbortError()
        }

        const socket = createConnection({
            ...(socketOptions ?? { port: 10809 }),
            noDelay: true,
        })
        const onAbort = () => socket.destroy(new AbortError())
        const handshake = new Handshake(name ?? 'default')

        abort?.signal.addEventListener('abort', onAbort, { once: true })

        return await new Promise<Connection>((resolve, reject) => {
            const close = () =>
                fail(
                    handshake.close()
                        ? new Error('Export not found')
                        : new Error('Connection closed during negotiation'),
                )
            const teardown = () =>
                socket
                    .off('data', receive)
                    .off('error', fail)
                    .off('close', close)
            const fail = (error: Error) => {
                teardown()
                reject(error)
            }
            const receive = (data: Buffer) => {
                const result = handshake.append(data)

                if (result.done) {
                    teardown()
                    resolve({
                        socket,
                        export: result.export,
                        fd: captureSocket(socket),
                    })
                } else if (result.send) {
                    socket.write(result.send)
                }
            }

            socket.on('data', receive).on('error', fail).on('close', close)
        })
            .catch((error) => {
                socket.destroy(error)

                throw error
            })
            .finally(() => {
                abort?.signal.removeEventListener('abort', onAbort)
            })
    }

    private async handle<T>(run: () => Promise<T>) {
        try {
            return await run()
        } catch (error) {
            if (error instanceof ioctl.Error) {
                const name = ioctlNames.get(error.request)

                if (name) {
                    const desc =
                        typeof error.code === 'number'
                            ? error.code
                            : `${error.code} (${error.errno})`

                    error.message = `Error running ${name} ioctl on NBD device ${this.options.device}: ${desc}`
                }
            }

            throw error
        }
    }
}

interface Connection {
    fd: number
    socket: Socket
    export: HandshakeExport
}

/** Thrown when the user aborts. Caught and silenced by the library. */
class AbortError extends Error {
    constructor() {
        super('Aborted')
    }
}

async function sleep(delay: number, abort?: AbortController) {
    await new Promise<void>((resolve, reject) => {
        if (abort?.signal.aborted) {
            throw new AbortError()
        }

        const teardown = () => {
            clearTimeout(timeout)
            abort?.signal.removeEventListener('abort', onAbort)
        }
        const timeout = setTimeout(() => {
            teardown()
            resolve()
        }, delay)
        const onAbort = () => {
            teardown()
            reject(new AbortError())
        }

        abort?.signal.addEventListener('abort', onAbort)
    })
}

function backoff(attempt: number, delay = 250) {
    return randomNumberBetween(0, delay * 2 ** (attempt - 1))
}

function randomNumberBetween(start: number, end: number) {
    return start + Math.random() * (end - start)
}

const ioctlNames = new Map(
    Object.entries(IOCTL_CODES).map(([name, value]) => [BigInt(value), name]),
)

function restoreSocket(socket: Socket) {
    const anySocket = socket as any
    const handle = anySocket._nbd_client_handle

    if (!handle) {
        if (anySocket._handle) {
            return socket
        } else {
            throw new Error('File descriptor missing from socket')
        }
    }

    anySocket._handle = handle

    return socket
}

// Remove Node.js' ownership over socket file descritor
function captureSocket(socket: Socket) {
    const anySocket = socket as any
    const handle = anySocket._handle
    const fd = handle?.fd

    if (typeof fd !== 'number') {
        throw new Error('File descriptor missing from socket')
    }

    socket.pause()
    handle.readStop()

    anySocket._handle = null
    anySocket._nbd_client_handle = handle

    return fd
}
