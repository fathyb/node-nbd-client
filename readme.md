# node-nbd-client

Linux NBD client and library for Node.js. Built to automate block storage systems.

## Features

-   Fast: `node-nbd-client` can attach an NBD device in ~10ms and does all I/O in parallel. `nbd-client` does all I/O serially. Transmission is handled by the kernel so it performs exactly the same.
-   Persistent connections: will always reconnect, even if `nbd-client -disconnect` is used. `nbd-client` will stop if the server crashes, even with `-persist`.
-   Built for containers:
    -   `ioctl` interface by default. `nbd-client` defaults to the `netlink` interface which requires `--network=host` on Docker.
    -   `node-nbd-client` uses threads and never calls `fork()`, which keep sockets in the calling PID. `nbd-client` will fork even with `-nofork` (it is intended per the man page), causing a kernel deadlock if `SIGKILL` is sent to a container: main process waits for file descriptors to close, which cannot close because the forked process is opened, but the forked process won't quit until the Docker init process quits, which is blocked by the main process, making Docker show a zoombie process error, requiring a machine restart to unlock resources.

## Usage

### CLI

```console
$ npm install nbd-client --global
$ node-nbd-client --help
Usage: node-nbd-client [options] <device>
```

#### **`<device>`**

> Full path to the block device the client should use, example: `/dev/nbd5`.

#### **`-H, --host <host>`**

> Server hostname or IP address, defaults to `localhost`.

#### **`-P, --port <port>`**

> Server port, defaults to `10809`, the IANA-assigned port number for the NBD protocol.

#### **`-u, --unix <path>`**

> UNIX domain socket path, overrides TCP options.

#### **`-b, --block-size <size>`**

> Block-size in bytes, defaults to `1024`; allowed values are either `512`, `1024`, `2048` or `4096`.

#### **`-C, --connections <number>`**

> Number of connections to the server, increasing throughput and reducing latency at the cost of higher resource usage. Requires Linux 4.9+.

#### **`-N, --name <name>`**

> Configure the export name, defaults to `default`.

#### **`-p, --persist`**

> Configure if the client should always reconnect if the connection is unexpectedly dropped.

#### **`-c, --check`**

> Configure if the client should quit with an exit code of `0` if the NBD device is attached or `1` if the NBD device is not attached.

#### **`-h, --help`**

> Display help.

### Library

> Install using `npm install nbd-client`

```js
import { NBD } from 'nbd-client'

const device = '/dev/nbd0'

if (await NBD.check(device)) {
    throw new Error(`${device} is already attached`)
}

const client = new NBD({
    device,

    name: 'my-disk', // same as nbd-client --name
    socket: { path: 'nbd-server.sock' }, // same options as net.createConnection()
    persist: true, // same as nbd-client --persist
    connections: 4, // same as nbd-client --connections

    connected() {
        console.log('Client connected')
    },
})

// Stop the client after 5 seconds
setTimeout(() => client.stop(), 5000)

console.log('Connecting to NBD..')

// Start the client
await client.start()

console.log('Client stopped')
```

## Not implemented

-   `netlink` interface
-   Old-style negotiation
