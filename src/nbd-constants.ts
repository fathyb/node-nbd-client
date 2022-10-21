export const BLKGETSIZE64 = 2148012658

export const NBD_SET_SOCK = 0xab00
export const NBD_SET_BLKSIZE = 0xab01
export const NBD_SET_SIZE = 0xab02
export const NBD_DO_IT = 0xab03
export const NBD_CLEAR_SOCK = 0xab04
export const NBD_CLEAR_QUE = 0xab05
export const NBD_PRINT_DEBUG = 0xab06
export const NBD_SET_SIZE_BLOCKS = 0xab07
export const NBD_DISCONNECT = 0xab08
export const NBD_SET_TIMEOUT = 0xab09
export const NBD_SET_FLAGS = 0xab0a

export const NBD_FLAG_NO_ZEROES = 1 << 1
export const NBD_OPT_EXPORT_NAME = 1
export const NBD_MAGIC_HANDSHAKE = Buffer.from('NBDMAGIC', 'ascii')
export const NBD_MAGIC_OPTION = Buffer.from('IHAVEOPT', 'ascii')
