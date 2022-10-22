#!/usr/bin/env node

const { NBDCli } = require('..')

NBDCli()
    .parseAsync()
    .catch((error) => {
        console.error(error)

        process.exit(1)
    })
