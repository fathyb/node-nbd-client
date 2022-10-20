# node-nbd-client

Linux NBD client and library for Node.js. Built to run on Linux containers like Docker.

## Features

-   Parallel negotiations: `node-nbd-client` opens connections in parallel. `nbd-client` opens them serially.
-   Built for containers:
    -   `ioctl` interface by default. `nbd-client` defaults to the `netlink` interface which requires `--network=host` on Docker.
    -   `SIGKILL` will disconnect the NBD block device. `nbd-client` will dead-lock a privileged container on `SIGKILL`, requiring a restart.
-   Persistent connections: will always reconnect, even if `nbd-client -disconnect` is used. `nbd-client` will stop if the server crashes, even with `-persist`.

## Not implemented

-   Old-style negotiation
-   Not using an `export` name

## Performance

Transmission should be exactly the same as `nbd-client`: both use the NBD driver to offload transmission to the kernel.
Negociation should be faster on `node-nbd-client`.

## Reconnection

The Linux kernel does not differentiate between a connection closed (ie. server crash) and a user disconnect (ie. `nbd-client -disconnect`).
