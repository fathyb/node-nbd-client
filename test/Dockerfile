FROM ubuntu:22.04 AS base

RUN apt-get update && \
    apt-get install -y curl build-essential

FROM base AS test

RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    npm install --global yarn

RUN mkdir -p /app /mnt/test
WORKDIR /app
COPY package.json yarn.lock ./

RUN yarn

COPY tsconfig.json ./
COPY src ./src
COPY test ./test

RUN yarn build test

CMD ["yarn", "jest", "--verbose"]

FROM base AS nbdkit

RUN curl https://download.libguestfs.org/nbdkit/1.32-stable/nbdkit-1.32.2.tar.gz | tar xvz && \
    mv /nbdkit-* /nbdkit && \
    cd /nbdkit && \
    ./configure \
        --without-iso \
        --without-ssh \
        --without-ext2 \
        --without-curl \
        --without-zlib \
        --without-libnbd \
        --without-libvirt \
        --without-liblzma \
        --without-libguestfs \
        --disable-linuxdisk \
        --disable-perl \
        --disable-ocaml \
        --disable-rust \
        --disable-ruby \
        --disable-tcl \
        --disable-lua \
        --disable-golang \
        --disable-torrent \
        --disable-vddk && \
    make -j4 && \
    make -j4 install && \
    mkdir /storage && \
    truncate -s 1G /storage/test-disk.img && \
    mkfs --type ext4 /storage/test-disk.img

CMD ["nbdkit", "--exit-with-parent", "--port", "8000", "file", "dir=/storage"]
