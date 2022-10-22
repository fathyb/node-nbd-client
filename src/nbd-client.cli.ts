import { program } from 'commander'

import { NBD } from './nbd-client'

program
    .name('node-nbd-client')
    .argument(
        '<device>',
        'The block special file (/dev entry) which this nbd-client should connect to, specified as a full path.',
    )
    .option(
        '-H, --host <host>',
        'The hostname or IP address of the machine running nbd-server.',
    )
    .option(
        '-P, --port <port>',
        'The TCP port on which nbd-server is running at the server. The port number defaults to 10809, the IANA-assigned port number for the NBD protocol.',
    )
    .option(
        '-b, --block-size <size>',
        'Use a blocksize of "block size". Default is 1024; allowed values are either 512, 1024, 2048 or 4096.',
    )
    .option(
        '-C, --connections <number>',
        'Use num connections to the server, to allow speeding up request handling, at the cost of higher resource usage on the server. Use of this option requires kernel support available first with Linux 4.9.',
    )
    .option(
        '-p, --persist',
        'When this option is specified, nbd-client will immediately try to reconnect an nbd device if the connection ever drops unexpectedly due to a lost server or something similar.',
    )
    .option(
        '-N, --name <name>',
        'Specifies the name of the export that we want to use. If not specified, nbd-client will ask for a "default" export, if one exists on the server.',
    )
    .option(
        '-u, --unix <path>',
        'Connect to the server over a unix domain socket at path, rather than to a server over a TCP socket. The server must be listening on the given socket.',
    )
    .action(
        async (
            host,
            port,
            device,
            { name, unix, persist, blockSize, connections },
        ) => {
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
                    console.log('Connected')
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
    .parseAsync()
    .catch((error) => {
        console.error(error)

        process.exit(1)
    })
