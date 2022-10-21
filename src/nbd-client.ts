import { ioctl } from 'async-ioctl'
import { FileHandle, open } from 'fs/promises'
import { NetConnectOpts, Socket, createConnection } from 'net'

import { HandshakeExport, Handshake } from './nbd-handshake'
import {
    NBD_DO_IT,
    NBD_SET_SOCK,
    NBD_SET_FLAGS,
    NBD_CLEAR_SOCK,
    NBD_SET_BLKSIZE,
    NBD_SET_SIZE_BLOCKS,
    BLKGETSIZE64,
} from './nbd-constants'
import { setMaxListeners } from 'events'

export interface NBDOptions {
    socket: NetConnectOpts
    device: string
    export: string

    persist?: boolean
    blockSize?: number
    connections?: number

    connected?(): void
}

export class NBD {
    private device: null | FileHandle = null
    private promise: null | Promise<void> = null
    private readonly abort = new AbortController()

    constructor(private readonly options: NBDOptions) {}

    public async size() {
        if (!this.device) {
            throw new Error('NBD client not started')
        }

        const buffer = Buffer.alloc(8)

        await ioctl(this.device.fd, BLKGETSIZE64, buffer)

        return buffer.readBigUint64LE(0)
    }

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

    /** Reconnection loop. */
    private async run() {
        let attempts = 0
        const { abort, options } = this
        const { persist } = options

        this.device = await open(options.device, 'r+')

        try {
            while (true) {
                try {
                    await this.attach()
                } catch (error) {
                    if (!(error instanceof AbortError)) {
                        throw error
                    }
                }

                if (persist === false || abort?.signal.aborted) {
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

        const connectionsCount = options.connections ?? 1

        if (connectionsCount < 1) {
            throw new Error('NBD client needs at least 1 connection')
        }

        const connections: Connection[] = []
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

            const { size, flags } = connections[0].export

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
            const blockSize = options.blockSize ?? 4096

            // Setup the NBD parameters for this block device
            await ioctl.batch(
                [fd, NBD_SET_BLKSIZE, blockSize],
                [fd, NBD_SET_SIZE_BLOCKS, size / BigInt(blockSize)],
                [fd, NBD_SET_FLAGS, flags],
                [fd, NBD_CLEAR_SOCK],
                ...connections.map(
                    (connection) =>
                        [fd, NBD_SET_SOCK, connection.fd] as [
                            number,
                            number,
                            number,
                        ],
                ),
            )

            if (abort?.signal.aborted) {
                throw new AbortError()
            }

            options.connected?.()

            // Give ownership of the socket to the kernel and ask it to attach the NBD device
            await ioctl.blocking(fd, NBD_DO_IT)
        } finally {
            teardown()
        }
    }

    /** Open a connection to the NBD server. */
    private async connect() {
        const { abort, options } = this
        const { socket: socketOptions, export: exportName } = options

        if (abort?.signal.aborted) {
            throw new AbortError()
        }

        const socket = createConnection({ ...socketOptions, noDelay: true })
        const handshake = new Handshake(exportName)
        const onAbort = () => socket.destroy(new AbortError())

        abort?.signal.addEventListener('abort', onAbort, { once: true })

        return await new Promise<Connection>((resolve, reject) => {
            const close = () => error(new Error('Connection closed'))
            const teardown = () =>
                socket
                    .off('data', receive)
                    .off('error', reject)
                    .off('close', close)
            const error = (error: Error) => {
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

            socket.on('data', receive).on('error', reject).on('close', close)
        })
            .catch((error) => {
                socket.destroy(error)

                throw error
            })
            .finally(() => {
                abort?.signal.removeEventListener('abort', onAbort)
            })
    }
}

interface Connection {
    fd: number
    socket: Socket
    export: HandshakeExport
}

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
