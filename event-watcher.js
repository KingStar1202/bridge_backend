const Web3 = require('web3')

//load env file
require('dotenv').config()

const {
  mintTokens,
  approveForBurn,
  burnTokens,
  transferToEthWallet,
} = require('./contract-methods.js')
const connectDB = require('./db.js');


const BSC_TOKEN_ADDRESS = process.env.BSC_TOKEN_ADDRESS
const ETH_TOKEN_ADDRESS = process.env.ETH_TOKEN_ADDRESS
const BRIDGE_WALLET = process.env.BRIDGE_WALLET

const BSC_BANK_ADDRESS = process.env.BSC_BANK_ADDRESS
const ETH_BANK_ADDRESS = process.env.ETH_BANK_ADDRESS
const NEXT_BANK_ADDRESS = process.env.NEXT_BANK_ADDRESS

const BSC_BRIDGE_ADDRESS = process.env.BSC_BRIDGE_ADDRESS
const ETH_BRIDGE_ADDRESS = process.env.ETH_BRIDGE_ADDRESS
const NEXT_BRIDGE_ADDRESS = process.env.NEXT_BRIDGE_ADDRESS

const BRIDGE_WALLET_KEY = process.env.BRIDGE_PRIV_KEY
const ABI = require('./abi.json')
const BRIDGE_ABI = ABI.bridge;
const BANK_ABI = ABI.bank;
const TOKEN_ABI = ABI.token;
const ETHChain = process.env.ETH;
const BSCChain = process.env.BSC;
const BSC_LAST_BLOCK = process.env.BSC_LAST_BLOCK
const ETH_LAST_BLOCK = process.env.ETH_LAST_BLOCK
const NEXT_LAST_BLOCK = process.env.NEXT_LAST_BLOCK
const Block = require('./Block.js');

const init = async () => {
  const newPost = new Block({
    chain: 'Next',
    last: '12412414'
  });

  const post = await newPost.save();
}


connectDB();





const handleEthEvent = async (event, provider, contract) => {
  console.log('handleEthEvent')
  const { from, to, value } = event.returnValues
  console.log('to :>> ', to)
  console.log('from :>> ', from)
  console.log('value :>> ', value)
  console.log('============================')

  if (from == BRIDGE_WALLET) {
    console.log('Transfer is a bridge back')
    return
  }
  if (to == BRIDGE_WALLET && to != from) {
    console.log('Tokens received on bridge from ETH chain! Time to bridge!')

    try {
      const tokensMinted = await mintTokens(provider, contract, value, from)
      if (!tokensMinted) return
      console.log('Bridge to destination completed')
    } catch (err) {
      console.error('Error processing transaction', err)
      // TODO: return funds
    }
  } else {
    console.log('Another transfer')
  }
}

const handleDestinationEvent = async (
  event,
  provider,
  contract,
  providerDest,
  contractDest
) => {
  const { from, to, value } = event.returnValues
  console.log('handleDestinationEvent')
  console.log('to :>> ', to)
  console.log('from :>> ', from)
  console.log('value :>> ', value)
  console.log('============================')

  if (from == process.env.WALLET_ZERO) {
    console.log('Tokens minted')
    return
  }

  if (to == BRIDGE_WALLET && to != from) {
    console.log(
      'Tokens received on bridge from destination chain! Time to bridge back!'
    )

    try {
      // we need to approve burn, then burn
      const tokenBurnApproved = await approveForBurn(
        providerDest,
        contractDest,
        value
      )
      if (!tokenBurnApproved) return
      console.log('Tokens approved to be burnt')
      const tokensBurnt = await burnTokens(providerDest, contractDest, value)

      if (!tokensBurnt) return
      console.log(
        'Tokens burnt on destination, time to transfer tokens in ETH side'
      )
      const transferBack = await transferToEthWallet(
        provider,
        contract,
        value,
        from
      )
      if (!transferBack) return

      console.log('Tokens transfered to ETH wallet')
      console.log('Bridge back operation completed')
    } catch (err) {
      console.error('Error processing transaction', err)
      // TODO: return funds
    }
  } else {
    console.log('Something else triggered Transfer event')
  }
}

const detectNext = async (nextProvider, ethProvider, bscProvider, ethContract, bscContract) => {
  var interval = setInterval(async () => {

    const BankNEXTContract = new nextProvider.eth.Contract(BANK_ABI, NEXT_BANK_ADDRESS);
    let lastBlock = 0;
    const chain = 'Next'
    let saveLastBlock = await Block.findOne({ chain });
    if (saveLastBlock == null) {
      saveLastBlock = new Block({
        chain: chain,
        last: NEXT_LAST_BLOCK
      })
      await saveLastBlock.save();
    }

    if (saveLastBlock.last) {
      lastBlock = saveLastBlock.last;
    } else {
      lastBlock = NEXT_LAST_BLOCK;
    }
    let blockNumber = await nextProvider.eth.getBlockNumber();
    let events = await BankNEXTContract.getPastEvents('Deposited', { fromBlock: lastBlock, toBlock: 'latest' });
    let BankBSCContract = new bscProvider.eth.Contract(BANK_ABI, BSC_BANK_ADDRESS);
    let BankETHContract = new ethProvider.eth.Contract(BANK_ABI, ETH_BANK_ADDRESS);

    try {
      for (let element of events) {
        let balance = element.returnValues[2];
        let sender = element.returnValues[1];
        let chain = element.returnValues[3];
        if (chain == BSCChain) {
          const trx = BankBSCContract.methods.withdrawERC20(BSC_TOKEN_ADDRESS, sender, balance)
          const gas = await trx.estimateGas({ from: BRIDGE_WALLET })
          const gasPrice = await BankBSCContract.eth.getGasPrice()
          let result = await BankBSCContract.methods.withdrawERC20(BSC_TOKEN_ADDRESS, sender, balance).send({ from: BRIDGE_WALLET, gas: Math.ceil(gas * 1.2), gasPrice: gasPrice });

        } else {

          const trx = await BankETHContract.methods.withdrawERC20(ETH_TOKEN_ADDRESS, sender, balance)
          const gas = await trx.estimateGas({ from: BRIDGE_WALLET })
          const nonce = await ethProvider.eth.getTransactionCount(BRIDGE_WALLET)
          const gasPrice = await ethProvider.eth.getGasPrice()
          let result = await BankETHContract.methods.withdrawERC20(ETH_TOKEN_ADDRESS, sender, balance).send({ from: BRIDGE_WALLET, gas: Math.ceil(gas * 1.2), gasPrice, gasPrice: '20000000000' });
        }
      }
    } catch (e) {
      console.log(e)
    }
    if (events.length > 0) {
      console.log('Detect Next')
      saveLastBlock.last = (blockNumber + 1);
      await saveLastBlock.save();
    }






  }, 1000 * 30);


}

const detectBSC = async (nextProvider, ethProvider, bscProvider, ethContract, bscContract) => {
  var interval = setInterval(async () => {

    const BankBSCContract = new bscProvider.eth.Contract(BANK_ABI, BSC_BANK_ADDRESS);
    let lastBlock = 0;
    const chain = 'BSC'
    let saveLastBlock = await Block.findOne({ chain });
    if (saveLastBlock == null) {
      saveLastBlock = new Block({
        chain: chain,
        last: BSC_LAST_BLOCK
      })
      await saveLastBlock.save();
    }

    if (saveLastBlock.last) {
      lastBlock = saveLastBlock.last;
    } else {
      lastBlock = BSC_LAST_BLOCK;
    }
    let blockNumber = await bscProvider.eth.getBlockNumber();
    let events = await BankBSCContract.getPastEvents('ERC20Deposited', { fromBlock: lastBlock, toBlock: 'latest' });
    let BankNEXTContract = new nextProvider.eth.Contract(BANK_ABI, NEXT_BANK_ADDRESS);
    try {
      for (let element of events) {
        let balance = element.returnValues[3];
        let sender = element.returnValues[2];
        const trx = await BankNEXTContract.methods.withdraw(ETH_TOKEN_ADDRESS, sender, balance)
        const gas = await trx.estimateGas({ from: BRIDGE_WALLET })
        const nonce = await nextProvider.eth.getTransactionCount(BRIDGE_WALLET)
        const gasPrice = await nextProvider.eth.getGasPrice()
        await BankNEXTContract.methods.withdraw(BRIDGE_WALLET, sender, balance).send({ from: BRIDGE_WALLET, gas: Math.ceil(gas * 1.2), gasPrice, gasPrice: '20000000000', nonce: nonce });;
        
      };
      if (events.length > 0) {
        console.log('Detect BSC')
        saveLastBlock.last = (blockNumber + 1);
        await saveLastBlock.save();
      }
    } catch {

    }

    
  }, 1000 * 40);



}

const detectETH = async (nextProvider, ethProvider, bscProvider, ethContract, bscContract) => {
  var interval = setInterval(async () => {

    const BankETHContract = new ethProvider.eth.Contract(BANK_ABI, ETH_BANK_ADDRESS);
    let lastBlock = 0;
    const chain = 'ETH'
    let saveLastBlock = await Block.findOne({ chain });
    if (saveLastBlock == null) {
      saveLastBlock = new Block({
        chain: chain,
        last: ETH_LAST_BLOCK
      })
      await saveLastBlock.save();
    }

    if (saveLastBlock.last) {
      lastBlock = saveLastBlock.last;
    } else {
      lastBlock = ETH_LAST_BLOCK;
    }
    let blockNumber = await ethProvider.eth.getBlockNumber();
    let events = await BankETHContract.getPastEvents('ERC20Deposited', { fromBlock: lastBlock, toBlock: 'latest' });
    let BankNEXTContract = new nextProvider.eth.Contract(BANK_ABI, NEXT_BANK_ADDRESS);
    try {
      for (let element of events) {

        let balance = element.returnValues[3];
        let sender = element.returnValues[2];
        console.log('balance', balance)
        const trx = await BankNEXTContract.methods.withdraw(ETH_TOKEN_ADDRESS, sender, balance)
        const gas = await trx.estimateGas({ from: BRIDGE_WALLET })
        const nonce = await nextProvider.eth.getTransactionCount(BRIDGE_WALLET)
        const gasPrice = await nextProvider.eth.getGasPrice()
        await BankNEXTContract.methods.withdraw(BRIDGE_WALLET, sender, balance).send({ from: BRIDGE_WALLET, gas: Math.ceil(gas * 1.2), gasPrice, gasPrice: '20000000000', nonce: nonce });;
      };
      if (events.length > 0) {
        console.log('Detect ETH')
        saveLastBlock.last = (blockNumber + 1);
        await saveLastBlock.save();
      }
    } catch (e) {
      console.log(e);
    }
    
  }, 1000 * 32);

}

const main = async () => {

  const nextChainProvider = new Web3(process.env.NEXT_HTTP_ENDPOINT);
  const bscChainProvider = new Web3(process.env.BSC_HTTP_ENDPOINT);
  const ethChainProvider = new Web3(process.env.ETH_HTTP_ENDPOINT);
  nextChainProvider.eth.accounts.wallet.add(BRIDGE_WALLET_KEY)
  bscChainProvider.eth.accounts.wallet.add(BRIDGE_WALLET_KEY)
  ethChainProvider.eth.accounts.wallet.add(BRIDGE_WALLET_KEY)

  const nextNetworkId = await nextChainProvider.eth.net.getId()
  const bscNetworkId = await bscChainProvider.eth.net.getId()
  const ethNetworkId = await ethChainProvider.eth.net.getId()

  console.log('nextNetworkId :>> ', nextNetworkId)
  console.log('bscNetworkId :>> ', bscNetworkId)
  console.log('ethNetworkId :>> ', ethNetworkId)



  const bscTokenContract = new bscChainProvider.eth.Contract(
    TOKEN_ABI,
    BSC_TOKEN_ADDRESS
  )

  const ethTokenContract = new ethChainProvider.eth.Contract(
    TOKEN_ABI,
    ETH_TOKEN_ADDRESS
  )

  //console.log(nextChainProvider.eth);

  await detectNext(nextChainProvider, ethChainProvider, bscChainProvider, ethTokenContract, bscTokenContract)

  await detectBSC(nextChainProvider, ethChainProvider, bscChainProvider, ethTokenContract, bscTokenContract)

  await detectETH(nextChainProvider, ethChainProvider, bscChainProvider, ethTokenContract, bscTokenContract)



}

main()
