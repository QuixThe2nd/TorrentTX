type Balances = {
  [key: string]: number
}

type Instruction = {
  contract: string
  amount: number
  method: string
  from: string
  args?: any[]
}

type Store = {
  [key: string]: any
}

// State
const balances: Balances = { // This should be the on-chain balances
  '0x001': 100
}

const store: Store = {} // Needs a universal store for contract state

// Normally we would import contract, but hardcoded for test:

const contract = (contractGateway: ContractGateway, instruction: Instruction) => {
  if (instruction.method === 'deposit') {
    if (!contractGateway.store[instruction.from]) contractGateway.store[instruction.from] = 0
    contractGateway.store[instruction.from] += instruction.amount
  } else if (instruction.method === 'withdraw') {
    if (contractGateway.store[instruction.from] < instruction.amount) return console.error('Insufficient funds')
    contractGateway.store[instruction.from] -= instruction.amount
    contractGateway.send(instruction.from, instruction.amount)
  } else console.error('Method not found')
}

// Contract Gateway
class ContractGateway {
  constructor (public contract: string, public store: Store) {
    this.contract = contract
    this.store = store
  }

  execute(instruction: Instruction) {
    // TODO: validate signature
    if (instruction.method === 'deposit') {
      if (instruction.amount > balances[instruction.from]) return console.error('Insufficient funds')
      if (!balances[instruction.contract]) balances[instruction.contract] = 0
      balances[instruction.contract] += instruction.amount
      balances[instruction.from] -= instruction.amount
    }
    contract(this, instruction)
  }

  send(to: string, amount: number) {
    if (!balances[to]) balances[to] = 0
    balances[to] += amount
    balances[this.contract] -= amount
  }
}

const contractGateway = new ContractGateway('myFancySmartContract', store);

// Execute it
console.log('Store', store)
console.log('Balances', balances)
console.log('')

const instruction = { // Instructions need to be broadcasted on-chain
  contract: 'myFancySmartContract',
  method: 'deposit',
  amount: 2,
  from: '0x001'
}
contractGateway.execute(instruction)
console.log('Store', store)
console.log('Balances', balances)
console.log('')

const instruction2 = {
  contract: 'myFancySmartContract',
  method: 'withdraw',
  amount: 2,
  from: '0x001'
}
contractGateway.execute(instruction2)
console.log('Store', store)
console.log('Balances', balances)
