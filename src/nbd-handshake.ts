import {
    NBD_MAGIC_OPTION,
    NBD_FLAG_NO_ZEROES,
    NBD_OPT_EXPORT_NAME,
    NBD_MAGIC_HANDSHAKE,
} from './nbd-constants'

const serverHandshake = Buffer.concat([NBD_MAGIC_HANDSHAKE, NBD_MAGIC_OPTION])
const serverHandshakeLength = serverHandshake.length + 2
const serverExportMetaLength = 8 + 2
const magicExport = Buffer.concat([
    NBD_MAGIC_OPTION,
    uint32Be(NBD_OPT_EXPORT_NAME),
])
const magicWithZeros = Buffer.concat([uint32Be(0), magicExport])
const magicWithoutZeros = Buffer.concat([
    uint32Be(NBD_FLAG_NO_ZEROES),
    magicExport,
])

export type HandshakeExport = {
    size: bigint
    flags: number
}

export type HandshakeResult =
    | { done: true; export: HandshakeExport }
    | { done: false; send?: Buffer }

export class Handshake {
    private buffer = Buffer.alloc(0)
    private serverFlags: null | number = null
    private metaLength = 0

    constructor(private readonly name: string) {}

    /** Process negotation data. **/
    public append(buffer: Buffer) {
        this.buffer = Buffer.concat([this.buffer, buffer])

        return this.update()
    }

    /**
     * Stop the negotation.
     * @returns `true` if the export was not found, or `false` if this was unexpected.
     **/
    public close() {
        // If the server gracefully closes the connection right after sending the export name,
        // it's very likely the export doesn't exist.
        if (this.serverFlags !== null && !this.buffer.length) {
            return true
        }

        return false
    }

    /** Process the current negotation buffer. */
    private update(): HandshakeResult {
        const { buffer } = this

        // Server negotation: get the server info
        if (this.serverFlags === null) {
            // Wait for more if we don't have enough data
            if (buffer.length < serverHandshakeLength) {
                return { done: false }
            }

            const magic = buffer.subarray(0, serverHandshake.length)

            if (!magic.equals(serverHandshake)) {
                const actual = magic.toString('hex')
                const expected = serverHandshake.toString('hex')

                throw new Error(
                    `Invalid handshake value: ${actual}, expected: ${expected}`,
                )
            }

            const flags = buffer.readUInt16BE(serverHandshake.length)
            const supportsNonZero = (flags & NBD_FLAG_NO_ZEROES) != 0

            this.buffer = buffer.subarray(serverHandshakeLength)
            this.serverFlags = flags
            this.metaLength = supportsNonZero
                ? serverExportMetaLength
                : serverExportMetaLength + 124

            const name = Buffer.from(this.name, 'utf-8')

            return {
                done: false,
                send: Buffer.concat([
                    supportsNonZero ? magicWithoutZeros : magicWithZeros,
                    uint32Be(name.length),
                    name,
                ]),
            }
        }

        // Wait for more if we don't have enough data
        if (buffer.length < this.metaLength) {
            return { done: false }
        }

        // Client negotation: send the server info
        if (buffer.length === this.metaLength) {
            return {
                done: true,
                export: {
                    size: buffer.readBigUInt64BE(0),
                    flags: buffer.readUint16BE(8),
                },
            }
        }

        // We've received too much data
        throw new Error(
            `Excess data received during handshake: ${buffer.toString('hex')}`,
        )
    }
}

function uint32Be(value: number) {
    const buffer = Buffer.alloc(4)

    buffer.writeUint32BE(value, 0)

    return buffer
}
