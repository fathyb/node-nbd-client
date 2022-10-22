export const NBD_MAGIC_OPTION = Buffer.from('IHAVEOPT', 'ascii')
export const NBD_MAGIC_HANDSHAKE = Buffer.from('NBDMAGIC', 'ascii')
export const NBD_FLAG_NO_ZEROES = 1 << 1
export const NBD_OPT_EXPORT_NAME = 1

export const IOCTL_CODES = {
    BLKGETSIZE64: 0x80081272,
    NBD_SET_SOCK: 0xab00,
    NBD_SET_BLKSIZE: 0xab01,
    NBD_SET_SIZE: 0xab02,
    NBD_DO_IT: 0xab03,
    NBD_CLEAR_SOCK: 0xab04,
    NBD_CLEAR_QUE: 0xab05,
    NBD_PRINT_DEBUG: 0xab06,
    NBD_SET_SIZE_BLOCKS: 0xab07,
    NBD_DISCONNECT: 0xab08,
    NBD_SET_TIMEOUT: 0xab09,
    NBD_SET_FLAGS: 0xab0a,
}
