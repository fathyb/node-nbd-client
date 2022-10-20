import { ioctl } from 'async-ioctl'
import { FileHandle, open } from 'fs/promises'
import { NetConnectOpts, Socket, createConnection } from 'net'

import { HandshakeExport, NbdHandshake } from './nbd-handshake'

export interface NbdConnectOptions {
    socket: NetConnectOpts
    device: string
    export: string

    abort?: AbortController
    persist?: boolean
    blockSize?: number
    connections?: number

    connected?(): void
}

export async function nbd(options: NbdConnectOptions) {
    let attempts = 0

    while (true) {
        try {
            const client = new NbdClient(options)

            await client.start()

            if (options.persist === false) {
                return
            } else {
                throw new Error('Connection closed')
            }
        } catch (error) {
            if (options.abort?.signal.aborted) {
                return
            }

            const attempt = ++attempts
            const delay = backoff(attempt)

            console.error(
                'NBD failure, reconnecting in %ss, attempt=%s',
                Math.round(delay) / 1000,
                attempt,
                error,
            )

            await sleep(delay, options.abort)
        }
    }
}

class NbdClient {
    constructor(private readonly options: NbdConnectOptions) {}

    /** Start the NBD client. */
    public async start() {
        // Start by opening the block device and the network connections
        const { options } = this
        const { abort } = options
        const [device, connections] = await Promise.all([
            open(options.device, 'r+'),
            Promise.all(
                Array(options.connections ?? 1)
                    .fill(0)
                    .map(() => this.connect()),
            ),
        ])
        const sockets = connections.map((c) => c.socket)
        const fds = sockets.map((s) => captureSocket(s))
        const onAbort = () => {
            for (const socket of sockets) {
                restoreSocket(socket).resume().destroy(new AbortError())
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

        options.connected?.()

        if (abort?.signal.aborted) {
            onAbort()
        }

        abort?.signal.addEventListener('abort', onAbort)

        const { fd } = device
        const blockSize = options.blockSize ?? 4096

        try {
            // Setup the NBD parameters for this block device
            await ioctl.batch(
                [fd, NBD_SET_BLKSIZE, blockSize],
                [fd, NBD_SET_SIZE_BLOCKS, size / BigInt(blockSize)],
                [fd, NBD_SET_FLAGS, flags],
                [fd, NBD_CLEAR_SOCK],
                ...fds.map(
                    (socket) =>
                        [fd, NBD_SET_SOCK, socket] as [number, number, number],
                ),
            )

            // Give ownership of the socket to the kernel and ask it to attach the NBD device
            await ioctl.blocking(fd, NBD_DO_IT)
        } finally {
            try {
                await device.close()
            } finally {
                abort?.signal.removeEventListener('abort', onAbort)

                for (const socket of sockets) {
                    restoreSocket(socket).destroy()
                }
            }
        }
    }

    /** Open a connection to the NBD server. */
    private async connect() {
        const {
            abort,
            socket: socketOptions,
            export: exportName,
        } = this.options

        if (abort?.signal.aborted) {
            throw new AbortError()
        }

        const socket = createConnection({ ...socketOptions, noDelay: true })
        const handshake = new NbdHandshake(exportName)
        const onAbort = () => socket.destroy(new AbortError())

        abort?.signal.addEventListener('abort', onAbort)

        return await new Promise<{ export: HandshakeExport; socket: Socket }>(
            (resolve, reject) => {
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
                        resolve({ socket, export: result.export })
                    } else if (result.send) {
                        socket.write(result.send)
                    }
                }

                socket
                    .on('data', receive)
                    .on('error', reject)
                    .on('close', close)
            },
        )
            .catch((error) => {
                socket.destroy(error)

                throw error
            })
            .finally(() => {
                abort?.signal.removeEventListener('abort', onAbort)
            })
    }
}

const NBD_SET_SOCK = 43776
const NBD_SET_BLKSIZE = 43777
const NBD_SET_SIZE = 43778
const NBD_DO_IT = 43779
const NBD_CLEAR_SOCK = 43780
const NBD_CLEAR_QUE = 43781
const NBD_PRINT_DEBUG = 43782
const NBD_SET_SIZE_BLOCKS = 43783
const NBD_DISCONNECT = 43784
const NBD_SET_TIMEOUT = 43785
const NBD_SET_FLAGS = 43786

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
    handle.readStop = () => {}
    handle.readStart = () => {}

    anySocket._handle = null
    anySocket._nbd_client_handle = handle

    return fd
}
