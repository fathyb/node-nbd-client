# node-nbd-client

Linux NBD client and library for Node.js. Built to automate block storage systems using container runtimes like Docker.

## Features

-   Parallel negotiations: `node-nbd-client` opens connections in parallel. `nbd-client` opens them serially.
-   Persistent connections: will always reconnect, even if `nbd-client -disconnect` is used. `nbd-client` will stop if the server crashes, even with `-persist`.
-   Built for containers:
    -   `ioctl` interface by default. `nbd-client` defaults to the `netlink` interface which requires `--network=host` on Docker.
    -   `SIGKILL` will disconnect the NBD block device. `nbd-client` will dead-lock a privileged container on `SIGKILL`, requiring a machine restart.

## Usage

### CLI

> Install using `npm install --global nbd-client`. Binary is called `node-nbd-client` to prevent conflicting with `nbd-client`.

```console
$ node-nbd-client --help
Usage: node-nbd-client [options] <device>
```

#### **`<device>`**

> The block special file (/dev entry) which this nbd-client should connect to, specified as a full path.

#### **`-H, --host <host>`**

> The hostname or IP address of the machine running nbd-server.

#### **`-P, --port <port>`**

> The TCP port on which nbd-server is running at the server. The port number defaults to 10809, the IANA-assigned port number for the NBD protocol.

#### **`-b, --block-size <size>`**

> Use a blocksize of "block size". Default is 1024; allowed values are either 512, 1024, 2048 or 4096.

#### **`-C, --connections <number>`**

> Use num connections to the server, to allow speeding up request handling, at the cost of higher resource usage on the server. Use of this option requires kernel support available first with Linux 4.9.

#### **`-p, --persist`**

> When this option is specified, nbd-client will immediately try to reconnect an nbd device if the connection ever drops unexpectedly due to a lost server or something similar.

#### **`-N, --name <name>`**

> Specifies the name of the export that we want to use. If not specified, nbd-client will ask for a "default" export, if one exists on the server.

#### **`-u, --unix <path>`**

> Connect to the server over a unix domain socket at path, rather than to a server over a TCP socket. The server must be listening on the given socket.

#### **`-h, --help`**

> Display help.

### Library

> Install using `npm install nbd-client`

```js
import { NBD } from 'nbd-client'

const client = new NBD({
    name: 'my-disk', // same as nbd-client --name
    device: '/dev/nbd0',
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
```

## Not implemented

-   Netlink interface
-   Old-style negotiation

## Performance

Transmission should be exactly the same as `nbd-client`: both use the NBD driver to offload transmission to the kernel.
Negociation should be faster on `node-nbd-client`.
