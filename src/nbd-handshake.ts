const handshakeMagic = Buffer.from('NBDMAGIC', 'ascii')
const optionMagic = Buffer.from('IHAVEOPT', 'ascii')
const serverHandshake = Buffer.concat([handshakeMagic, optionMagic])
const serverHandshakeLength = serverHandshake.length + 2

const serverExportMetaLength = 8 + 2

const NBD_OPT_EXPORT_NAME = 1
const NBD_FLAG_NO_ZEROES = 1 << 1

const magicExport = Buffer.concat([optionMagic, uint32Be(NBD_OPT_EXPORT_NAME)])
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

export class NbdHandshake {
    private buffer = Buffer.alloc(0)
    private serverFlags: null | number = null
    private metaLength = 0

    constructor(private readonly exportName: string) {}

    public append(buffer: Buffer) {
        this.buffer = Buffer.concat([this.buffer, buffer])

        return this.update()
    }

    private update(): HandshakeResult {
        const { buffer } = this

        if (this.serverFlags === null) {
            if (buffer.length >= serverHandshakeLength) {
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

                const name = Buffer.from(this.exportName, 'utf-8')

                return {
                    done: false,
                    send: Buffer.concat([
                        supportsNonZero ? magicWithoutZeros : magicWithZeros,
                        uint32Be(name.length),
                        name,
                    ]),
                }
            }
        } else {
            if (buffer.length === this.metaLength) {
                return {
                    done: true,
                    export: {
                        size: buffer.readBigUInt64BE(0),
                        flags: buffer.readUint16BE(8),
                    },
                }
            } else if (buffer.length > this.metaLength) {
                throw new Error(
                    `Excess data received during handshake: ${buffer.toString(
                        'hex',
                    )}`,
                )
            }
        }

        return { done: false }
    }
}

function uint32Be(value: number) {
    const buffer = Buffer.alloc(4)

    buffer.writeUint32BE(value, 0)

    return buffer
}
