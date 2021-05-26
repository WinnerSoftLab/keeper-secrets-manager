import {KeeperHttpResponse, KeyValueStorage, Platform} from '../platform'
import {request, RequestOptions} from 'https';
import {
    createCipheriv,
    createDecipheriv,
    createECDH,
    createHash,
    createPrivateKey,
    createSign,
    generateKeyPair,
    randomBytes
} from 'crypto';

const bytesToBase64 = (data: Uint8Array): string => Buffer.from(data).toString('base64');

const base64ToBytes = (data: string): Uint8Array => Buffer.from(data, 'base64');

const bytesToString = (data: Uint8Array): string => Buffer.from(data).toString();

const stringToBytes = (data: string): Uint8Array => Buffer.from(data);

const getRandomBytes = (length: number): Uint8Array => randomBytes(length);

const keyCache: Record<string, Uint8Array> = {}

const loadKey = async (keyId: string, storage?: KeyValueStorage): Promise<Uint8Array> => {
    const cachedKey = keyCache[keyId]
    if (cachedKey) {
        return cachedKey
    }
    const keyString = storage
        ? await storage.getValue<string>(keyId)
        : undefined
    if (!keyString) {
        throw new Error(`Unable to load the key ${keyId}`)
    }
    const keyBytes = base64ToBytes(keyString)
    keyCache[keyId] = keyBytes
    return keyBytes
}

const generateKeeperKeyPair = async (): Promise<Uint8Array> => new Promise<Uint8Array>((resolve, reject) => {
    generateKeyPair('ec', {
        namedCurve: 'prime256v1'
    }, (err, publicKey, privateKey) => {
        if (err) {
            reject(err)
        } else {
            resolve(privateKey.export({
                format: 'der',
                type: 'pkcs8'
            }))
        }
    });
});

const generatePrivateKey = async (keyId: string, storage: KeyValueStorage): Promise<void> => {
    const privateKeyDer = await generateKeeperKeyPair()
    keyCache[keyId] = privateKeyDer
    await storage.saveValue(keyId, bytesToBase64(privateKeyDer))
};

// extracts public raw from private key for prime256v1 curve in der/pkcs8
// privateKey: key.slice(36, 68)
const privateDerToPublicRaw = (key: Uint8Array): Uint8Array => key.slice(73)

const exportPublicKey = async (keyId: string, storage: KeyValueStorage): Promise<Uint8Array> => {
    const privateKeyDer = await loadKey(keyId, storage)
    return privateDerToPublicRaw(privateKeyDer)
};

const sign = async (data: Uint8Array, keyId: string, storage: KeyValueStorage): Promise<Uint8Array> => {
    const privateKeyDer = await loadKey(keyId, storage)
    const key = createPrivateKey({
        key: Buffer.from(privateKeyDer),
        format: 'der',
        type: 'pkcs8',
    })
    const sign = createSign('SHA256')
    sign.update(data)
    const sig = sign.sign(key)
    return Promise.resolve(sig)
};

const importKey = async (keyId: string, key: Uint8Array, storage?: KeyValueStorage): Promise<void> => {
    keyCache[keyId] = key
    if (storage) {
        await storage.saveValue(keyId, key)
    }
}

const encrypt = async (data: Uint8Array, keyId: string, storage?: KeyValueStorage): Promise<Uint8Array> => {
    const key = await loadKey(keyId, storage)
    const iv = getRandomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, encrypted, tag])
};

const _encrypt = (data: Uint8Array, key: Uint8Array): Promise<Uint8Array> => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    const result = Buffer.concat([iv, encrypted, tag]);
    return Promise.resolve(result);
};

const _decrypt = (data: Uint8Array, key: Uint8Array): Uint8Array => {
    const iv = data.subarray(0, 12);
    const encrypted = data.subarray(12, data.length - 16);
    const tag = data.subarray(data.length - 16);
    const cipher = createDecipheriv('aes-256-gcm', key, iv);
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(encrypted), cipher.final()]);
};

const unwrap = async (key: Uint8Array, keyId: string, unwrappingKeyId: string, storage?: KeyValueStorage, memoryOnly?: boolean): Promise<void> => {
    const unwrappingKey = await loadKey(unwrappingKeyId, storage)
    const unwrappedKey = _decrypt(key, unwrappingKey)
    keyCache[keyId] = unwrappedKey
    if (memoryOnly) {
        return
    }
    if (storage) {
        await storage.saveValue(keyId, unwrappedKey)
    }
}

const decrypt = async (data: Uint8Array, keyId: string, storage?: KeyValueStorage): Promise<Uint8Array> => {
    const key = await loadKey(keyId, storage)
    return _decrypt(data, key)
};

function hash(data: Uint8Array): Promise<Uint8Array> {
    const hash = createHash('SHA256').update(data).digest()
    return Promise.resolve(hash)
}

const publicEncrypt = async (data: Uint8Array, key: Uint8Array, id?: Uint8Array): Promise<Uint8Array> => {
    const ecdh = createECDH('prime256v1')
    ecdh.generateKeys()
    const ephemeralPublicKey = ecdh.getPublicKey()
    const sharedSecret = ecdh.computeSecret(key)
    const sharedSecretCombined = Buffer.concat([sharedSecret, id || new Uint8Array()])
    const symmetricKey = createHash('SHA256').update(sharedSecretCombined).digest()
    const encryptedData = await _encrypt(data, symmetricKey)
    return Buffer.concat([ephemeralPublicKey, encryptedData])
};

const fetchData = (res, resolve) => {
    const retVal = {
        statusCode: res.statusCode,
        headers: res.headers,
        data: null
    }
    res.on('data', data => {
        retVal.data = retVal.data
            ? Buffer.concat([retVal.data, data])
            : data
    })
    res.on('end', () => {
        resolve(retVal)
    })
};

const get = (
    url: string,
    headers?: { [key: string]: string }
): Promise<KeeperHttpResponse> => new Promise<KeeperHttpResponse>((resolve) => {
    const get = request(url, {
        method: 'get',
        headers: {
            'User-Agent': `Node/${process.version}`,
            ...headers
        }
    }, (res) => {
        fetchData(res, resolve)
    });
    get.end()
});

const post = (
    url: string,
    payload: Uint8Array,
    headers?: { [key: string]: string }
): Promise<KeeperHttpResponse> => new Promise<KeeperHttpResponse>((resolve) => {
    const options: RequestOptions = {
        rejectUnauthorized: false
    }
    const post = request(url, {
        method: 'post',
        ...options,
        headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': payload.length,
            'User-Agent': `Node/${process.version}`,
            ...headers,
        },
    }, (res) => {
        fetchData(res, resolve)
    });
    post.write(payload)
    post.end()
});

export const nodePlatform: Platform = {
    bytesToBase64: bytesToBase64,
    base64ToBytes: base64ToBytes,
    bytesToString: bytesToString,
    stringToBytes: stringToBytes,
    getRandomBytes: getRandomBytes,
    generatePrivateKey: generatePrivateKey,
    exportPublicKey: exportPublicKey,
    importKey: importKey,
    unwrap: unwrap,
    encrypt: encrypt,
    decrypt: decrypt,
    hash: hash,
    publicEncrypt: publicEncrypt,
    sign: sign,
    get: get,
    post: post
}
