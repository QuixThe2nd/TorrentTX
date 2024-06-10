import fs from 'fs'
import readline from 'readline'
import { initGlob } from './src/glob.js'
import Wallet from './src/wallet.js'
import Transaction from './src/transaction.js'
import Transactions from './src/transactions.js'
import WebTorrent from 'webtorrent'
import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import QRCode from 'qrcode'
import Mine from './src/mine.js'

const currentPath = process.cwd()

if (!fs.existsSync('infohashes.txt')) fs.writeFileSync('infohashes.txt', '')

const base64encode = str => Buffer.from(str).toString('base64')

const glob = initGlob()

glob.version = '0.0.11'
glob.contractStore = {}
glob.contractMeta = {}
glob.difficulty = 5
glob.prevBlock = 'Genesis'

function createWindow () {
  glob.browserWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: { preload: path.join(currentPath, 'ui', 'preload.js') }
  })

  glob.browserWindow.loadFile('ui/index.html')
}

(async () => {
  // Open App
  await app.whenReady()
  createWindow()

  // Logging
  console.fallback = console.error
  console.verbose = console.log
  for (const type of ['info', 'log', 'verbose', 'warn', 'error']) {
    console[type] = function () {
      if (glob.browserWindow && (arguments.length === 0 || Array.from(arguments).every(arg => typeof arg === 'string' || typeof arg === 'number'))) glob.browserWindow.webContents.send('log', JSON.stringify({ type, message: base64encode(Array.from(arguments).join(' ')) }))
      else console.fallback('Invalid Arguments', arguments)
    }
  }

  // WebTorrent
  if (!WebTorrent.WEBRTC_SUPPORT) console.error('WebRTC Not Supported')
  glob.webtorrent = new WebTorrent({ maxConns: 250 })
  glob.webtorrent.on('error', console.error)
  glob.webtorrent.on('listening', () => console.info(`Torrent client listening 0.0.0.0:${(glob.webtorrent.address()).port}`))

  let wsTrackers = ''
  try {
    wsTrackers = await (await fetch('https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_all_ws.txt')).text()
  } catch (e) {}
  let bestTrackers = ''
  try {
    bestTrackers = await (await fetch('https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt')).text()
  } catch (e) {}
  glob.trackers = (wsTrackers + '\n' + bestTrackers).split('\n').filter(Boolean)

  glob.genesisHash = fs.readFileSync('genesis.txt').toString().trim()

  // Wallet
  glob.wallet = new Wallet()

  // Transactions
  glob.transactions = new Transactions(glob)
  glob.transactions.loadSavedTransactions()

  if (!fs.existsSync(`ui/${glob.wallet.address}.webp`)) {
    QRCode.toFile(`ui/${glob.wallet.address}.webp`, glob.wallet.address,
      {
        color: {
          dark: '#000',
          light: '#fff'
        },
        width: 200,
        type: 'image/webp'
      },
      (err) => { if (err) throw err }
    )
  }

  const proofs = fs.readdirSync('proofs')
  if (proofs.length > 0) {
    for (const i in proofs) {
      const hash = proofs[i].split('.')[0]
      if (!fs.existsSync(`transactions/${hash}.json`)) {
        glob._ = new Transaction(glob, { torrentPath: `proofs/${proofs[i]}` })
      }
    }
  }

  const userInput = async function (prompt) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    return new Promise((resolve, reject) => {
      rl.question(`\n============\n${prompt}\n============\n\n`, input => {
        rl.close()
        resolve(input)
      })
    })
  }

  Mine(glob)

  setInterval(() => {
    if (glob.browserWindow) {
      const connections = glob.webtorrent.torrents.flatMap(torrent => {
        const wires = torrent.wires.map(wire => {
          return {
            isMe: wire.peerId === glob.webtorrent.peerId,
            peerId: wire.peerId,
            address: `${wire.remoteAddress}:${wire.remotePort}`,
            amChoking: wire.amChoking,
            amInterested: wire.amInterested,
            peerChoking: wire.peerChoking,
            peerInterested: wire.peerInterested,
            uploaded: wire.uploaded,
            downloaded: wire.downloaded,
            type: wire.type,
            uploadSpeed: wire.uploadSpeed(),
            downloadSpeed: wire.downloadSpeed(),
            version: wire.torrenttx ? wire.torrenttx.version : 'L1 Client',
            state: wire.torrenttx ? wire.torrenttx.state : ''
          }
        })
        return wires.length > 0 ? wires : []
      }).sort((a, b) => a.address.localeCompare(b.address))
      glob.browserWindow.webContents.send(
        'message',
        base64encode(
          JSON.stringify({
            address: glob.wallet.address,
            balances: glob.transactions?.balances,
            transactions: JSON.stringify(
              Object.values(glob.transactions.transactions).map(tx => {
                return {
                  ...tx.content,
                  infohash: tx.torrent?.infoHash ?? '',
                  references: tx.references.map(ref => ref.hash)
                }
              })
            ),
            infohashes: fs.readFileSync('infohashes.txt').toString().split('\n'),
            connections,
            seeding: glob.webtorrent.torrents.filter(torrent => torrent.done).map(torrent => torrent.infoHash),
            leeching: glob.webtorrent.torrents.filter(torrent => !torrent.done).map(torrent => torrent.infoHash),
            ratio: glob.webtorrent.ratio,
            downloadSpeed: glob.webtorrent.downloadSpeed,
            uploadSpeed: glob.webtorrent.uploadSpeed,
            progress: glob.webtorrent.progress,
            utxos: glob.transactions.remaining_utxos,
            state: glob.transactions.balanceState,
            version: glob.version,
            contractMeta: glob.contractMeta,
            contractStore: glob.contractStore
          })
        )
      )
    }
  }, 1000)

  const main = async () => {
    const input = (await userInput('S = Search\nP = Proof\nD = Delete Transactions')).toLowerCase()
    if (input === 's') {
      const query = await userInput('Search')
      console.info(glob.transactions.search(glob, { query }))
    } else if (input === 'p') {
      const query = await userInput('Transaction Hash')
      const torrent = await glob.transactions.search(glob, { query }).transactions.torrent
      console.info('Proof:', torrent.infoHash)
      fs.writeFileSync(`proofs/${query}.torrent`, torrent.torrentFile)
    }
    main()
  }
  main()
})()

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.on('message-from-renderer', (event, message) => {
  const data = JSON.parse(message)
  if (data.type === 'getTransaction') {
    const transaction = glob.transactions.transactions[data.hash]
    if (transaction) {
      glob.browserWindow.webContents.send(
        'message',
        base64encode(
          JSON.stringify({
            ...transaction.content,
            infohash: transaction.torrent ? transaction.torrent.infoHash : ''
          })
        )
      )
    }
  } else if (data.type === 'transfer') {
    const transaction = new Transaction(glob, {
      from: glob.wallet.address,
      to: data.to,
      amount: data.amount,
      message: data.message
    })
    console.log('Created Transaction:', transaction.content.hash)
  } else if (data.type === 'deploySmartContract') {
    const transaction = new Transaction(glob, {
      from: glob.wallet.address,
      to: glob.wallet.address,
      amount: 1,
      message: '',
      contract: data.code
    })
    console.log('Created Transaction:', transaction.content.hash)
  } else if (data.type === 'submitInstructions') {
    const transaction = new Transaction(glob, {
      from: glob.wallet.address,
      to: glob.wallet.address,
      amount: 1,
      message: '',
      instructions: data.instructions
    })
    console.log('Created Transaction:', transaction.content.hash)
  } else console.error('Invalid Message', data)
})

/*
TODO: (idea)
Instead of staking, users can create "bonds" with other users.
Technically, the protocol allows multiple tx json's in a single torrent file.
A bond is when 2 different addresses back eachother's funds 1:1.
This means, both nodes sign their own transactions to themselves, but they are both put in the same torrent file.
After a bond is made, either party can cancel the bond by re-signing the transaction with an added notice that the bond is cancelled.
The person who initiated the cancellation looses 5%, while the other party makes 5%.
People can form bonds to increase the chances of their funds being stored safely. But bonds are ultra-long term.
Because if you break a bond, you pay the other person 5%.

If a transaction is "lost". Someone can issue a request for the block, and someone else can re-seed the transaction.
The request can have a signed transfer attached, with the previous block marked as a UTXO.
This will mean your money is only valid if you can broadcast the original transaction.
*/
