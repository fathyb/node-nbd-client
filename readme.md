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

```console
$ node-nbd-client --unix nbd-socket.sock --name my-disk --connections 4
```

### Library

```js
import { NBD } from 'nbd-client'

const client = new NBD({
    socket: { path: 'nbd-server.sock' }, // same options as net.createConnection()
    export: 'my-disk', // same as nbd-client --name
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
