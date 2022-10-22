import { program } from 'commander'

import { NBD } from './nbd-client'

export function NBDCli() {
    return program
        .name('node-nbd-client')
        .showHelpAfterError()
        .showSuggestionAfterError()
        .argument(
            '<device>',
            'Full path to the block device the client should use, example: /dev/nbd5.',
        )
        .option(
            '-H, --host <host>',
            'Server hostname or IP address, defaults to localhost.',
        )
        .option(
            '-P, --port <port>',
            'Server port, defaults to 10809, the IANA-assigned port number for the NBD protocol.',
        )
        .option(
            '-u, --unix <path>',
            'UNIX domain socket path, overrides TCP options.',
        )
        .option(
            '-b, --block-size <size>',
            'Block-size in bytes, defaults to 1024; allowed values are either 512, 1024, 2048 or 4096.',
        )
        .option(
            '-C, --connections <number>',
            'Number of connections to the server, increasing throughput and reducing latency at the cost of higher resource usage. Requires Linux 4.9+.',
        )
        .option('-N, --name <name>', 'Export name, defaults to `default`.')
        .option(
            '-p, --persist',
            'Configure if the client should always reconnect if the connection is unexpectedly dropped.',
        )
        .option(
            '-c, --check',
            'Configure if the client should quit with an exit code of 0 if the NBD device is attached or 1 if the NBD device is not attached.',
        )
        .action(
            async (
                device,
                {
                    host,
                    port,
                    unix,
                    name,
                    check,
                    persist,
                    blockSize,
                    connections,
                },
            ) => {
                if (check) {
                    try {
                        if (await NBD.check(device)) {
                            process.exitCode = 0
                        } else {
                            process.exitCode = 1
                        }
                    } catch (error) {
                        console.error(error)

                        process.exitCode = 2
                    }

                    return
                }

                const nbd = new NBD({
                    name,
                    device,
                    persist,
                    blockSize,
                    connections,
                    socket: unix
                        ? { path: unix }
                        : { host, port: parseInt(port, 10) },

                    connected() {
                        console.log('Connected, attaching..')
                    },
                    attached() {
                        console.log('Attached')
                    },
                })

                for (const signal of ['SIGINT', 'SIGTERM']) {
                    let signals = 0

                    process.on(signal, () => {
                        signals++
                        nbd.stop()

                        if (signals === 1) {
                            console.log('Closing client..')
                        } else if (signals === 2) {
                            console.log(
                                'Received second termination signal, will force quit on thrid',
                            )
                        } else {
                            console.log(
                                'Force quitting after third termination signal',
                            )

                            process.exit(1)
                        }
                    })
                }

                console.log('Connecting..')

                await nbd.start()
            },
        )
}
