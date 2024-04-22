import fs from 'fs'
import ethUtil from 'ethereumjs-util'
import bip39 from 'bip39'
import HDWallet from 'ethereumjs-wallet'

const hdkey = HDWallet.hdkey

export default class Wallet {
  constructor (clients, walletFilePath = 'wallet.json') {
    this.clients = clients
    this.walletFilePath = walletFilePath

    const keys = fs.existsSync(this.walletFilePath)
      ? this.loadKeys()
      : this.createKeys()
    for (const key in keys) {
      this[key] = keys[key]
    }

    this.generateAddress()

    this.address = this.wallet.getAddressString()
  }

  generateAddress (path = "m/44'/60'/0'/0/0") {
    this.seed = bip39.mnemonicToSeedSync(this.mnemonic)
    this.hdWallet = hdkey.fromMasterSeed(this.seed)
    this.key = this.hdWallet.derivePath(path)
    this.wallet = this.key.getWallet()
  }

  createKeys () {
    console.log('Creating Keys')
    this.mnemonic = bip39.generateMnemonic()

    const walletData = {
      mnemonic: this.mnemonic
    }

    fs.writeFileSync(this.walletFilePath, JSON.stringify(walletData, null, 4))
    return walletData
  }

  loadKeys () {
    console.log('Loading Keys')
    return JSON.parse(fs.readFileSync(this.walletFilePath))
  }

  signHash (message) {
    // Ensure the message is a Buffer
    const messageBuffer = Buffer.from(message)
    // Hash the message to get a fixed-length hash
    const messageHash = ethUtil.keccak256(messageBuffer)
    // Get the private key from the wallet in Buffer format
    const privateKeyBuffer = this.wallet.getPrivateKey()
    // Sign the message hash using the private key
    const signatureObject = ethUtil.ecsign(messageHash, privateKeyBuffer)
    // Convert the signature to a hex string format
    const signatureHex = ethUtil.toRpcSig(signatureObject.v, signatureObject.r, signatureObject.s)
    return signatureHex
  }

  verifySignature (message, signature, walletAddress) {
    const messageBuffer = Buffer.from(message)
    const messageHash = ethUtil.keccak256(messageBuffer)

    // Split the signature into its components
    const signatureBuffer = ethUtil.toBuffer(signature)
    const signatureParams = ethUtil.fromRpcSig(signatureBuffer)

    // Use ecrecover to obtain the public key that made the signature
    const publicKey = ethUtil.ecrecover(messageHash, signatureParams.v, signatureParams.r, signatureParams.s)

    // Get the wallet address from the public key
    const addressBuffer = ethUtil.pubToAddress(publicKey)
    const address = ethUtil.bufferToHex(addressBuffer)

    // Now, compare this address with the expected address
    // Assuming `walletAddress` is the address you expect the signature to come from
    return address.toLowerCase() === walletAddress.toLowerCase()
  }
}
