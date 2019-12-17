import React, { setGlobal } from 'reactn';
import { getTxDetails } from '../actions/postMessage';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import { handlePassword, handleHash, returnSignedMessage, closeWidget } from '../actions/postMessage';
const Tx = require('ethereumjs-tx').Transaction;
const CryptoJS = require("crypto-js");
const ethers = require('ethers');
const Web3 = require('web3');
const keys = require('../utils/keys.json');
const INFURA_KEY = keys.INFURA_KEY;
let web3;

export default class Approve extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      gasFee: "0", 
      web3Connected: false
    }
  }

  async componentDidMount() {
    await getTxDetails();
  }

  estimateGas = async () => {
    const { txDetails } = this.global;
    const gasFee = await web3.eth.estimateGas(txDetails.tx);
    this.setState({ gasFee });
    //console.log("THE FEE: ", ethers.utils.formatEther(gasFee));
  }

  submitPassword = async (e) => {
    const { txDetails, config, subaction, type } = this.global;
    const { gasFee } = this.state;
    const keychain = await handlePassword(e, 'tx');
    const parsedKeychain = JSON.parse(keychain.toString(CryptoJS.enc.Utf8));
    const address = parsedKeychain.signingKey.address;
    const provider = ethers.getDefaultProvider(config.network);

    if(subaction === "approve-msg") {
      if(parsedKeychain.signingKey) {
        // const message = web3.utils.toUtf8(txDetails.tx.data);
        // console.log(message);
        const wallet = ethers.Wallet.fromMnemonic(parsedKeychain.signingKey.mnemonic).connect(provider);
        const binaryData = ethers.utils.arrayify(txDetails.tx.data);

        const signPromise = await wallet.signMessage(binaryData)
        
        returnSignedMessage(signPromise);
      } else {
        setGlobal({ error: "Please verify your password is correct", password: "" });
      }
    } else {
      try {
        //console.log(keychain.toString(CryptoJS.enc.Utf8));
        if(parsedKeychain.signingKey) {
          //Let's broadcast this transaction!
          setGlobal({ action: "loading" });
          txDetails.tx["nonce"] = await provider.getTransactionCount(address);
          console.log("TXDETAILS: ", txDetails.tx)
          //Now sign the tx
          let txx = new Tx(txDetails.tx, {chain: config.network })
          const privateKey = Buffer.from(parsedKeychain.signingKey.keyPair.privateKey.substring(2), 'hex');
          //console.log(privateKey);
          txx.sign(privateKey);
          const sTx = txx.serialize();
          //console.log("STX: ", sTx);
          //Send the transaction  
          const balance = await provider.getBalance(address);
          const etherBalance = ethers.utils.formatEther(balance);
          const fee = txDetails && txDetails.tx && txDetails.tx.value ? ethers.utils.formatEther(ethers.utils.bigNumberify(txDetails.tx.value).toString()) : "0";
          if(fee > etherBalance) {
            setGlobal({ action: "subaction", error: "Insufficient funds. Please make sure you have enough ether for this action.", password: "" })
          } else {
            const formattedGasFee = ethers.utils.formatEther(gasFee);
            const totalFee = parseFloat(formattedGasFee) + parseFloat(fee);
            if(totalFee > etherBalance) {
              setGlobal({ subaction: "", error: "Insufficient funds. Please make sure you have enough ether for this action.", password: "" })
            } else {
              try {
                if(type === "eth_signTransaction") {
                  handleHash('0x' + sTx.toString('hex'));
                } else {
                  //handleHash('0x' + sTx.toString('hex'));
                  web3.eth.sendSignedTransaction('0x' + sTx.toString('hex'))
                  .on('transactionHash', (hash) => {
                    console.log("Yo yo yo: ", hash);
                    handleHash(hash);
                  })
                  // .on('receipt', (receipt) => {
                  //   console.log("Bam Bam Bam: ", receipt);
                  //   handleHash(receipt);
                  //   // setTimeout(() => {
                  //   //   console.log("Sending...");
                  //   //   //console.log(sent);
                  //   //   //const hash = `0x${txx.hash().toString('hex')}`; 
                  //   //   //console.log(hash);               
                  //   //   handleHash(receipt);
                  //   // }, 1500)
                  // })                                 
                }                
                // web3.eth.sendSignedTransaction('0x' + sTx.toString('hex'));
                //   setTimeout(() => {
                //     console.log("Sending...");
                //     //console.log(sent);
                //     //const hash = `0x${txx.hash().toString('hex')}`; 
                //     //console.log(hash);               
                //     handleHash(JSON.stringify(txx));
                //   }, 1500)
                // if(type === "eth_signTransaction") {
                //   handleHash(sTx);
                // } else {
                //   web3.eth.sendSignedTransaction('0x' + sTx.toString('hex'));
                //   setTimeout(() => {
                //     console.log("Sending...");
                //     //console.log(sent);
                //     //const hash = `0x${txx.hash().toString('hex')}`; 
                //     //console.log(hash);               
                //     handleHash(JSON.stringify(txx));
                //   }, 1500)
                // }
              } catch(e) {
                console.log("TX ERROR: ", e);
              }              
            }
          }
        } else {
          //something went wrong
          console.log("Error")
          setGlobal({ error: "Please verify your password is correct", password: "" });
        }
      } catch(err) {
        console.log("ERROR ", err);
        setGlobal({ subaction: "", error: "Please verify your password is correct", password: "" });
      }
    }
    //debugger;
  }

  handlePassword = (e) => {
    setGlobal({ password: e.target.value });
  }

  connectWebThree = () => {
    const { config } = this.global;
    web3 = new Web3(new Web3.providers.HttpProvider(`https://${config.network}.infura.io/v3/${INFURA_KEY}`));
    this.setState({ web3Connected: true });
  }

  render() {
    const { txDetails, config, action, error, subaction } = this.global;
    const { gasFee, web3Connected } = this.state;
    //console.log("CONFIG: ", config);
    if(!web3Connected && config.network) {
      this.connectWebThree();
    }
    //console.log(txDetails && txDetails.tx ? await web3.eth.estimateGas(txDetails.tx) : "Not ready yet")
    if(txDetails && txDetails.tx) {
      this.estimateGas();
    }
    //console.log(txDetails && txDetails.tx ? ethers.utils.formatEther(ethers.utils.bigNumberify(txDetails.tx.value).toString()) : "Blamo");
    return (
      <div>
        <div className="container text-center">
          {
            action === "loading" ? 
            <div>
              <h5>Processing...</h5>
              <div className="loader">
                <div className="loading-animation"></div>
              </div>
            </div> :
            action === "transaction" ?
            <div>
              <h5>Approve Action?</h5>
              <div className="text-left">
              <p>App: <mark>{txDetails.appName}</mark></p>
              {
                txDetails && txDetails.tx && txDetails.tx.value ? 
                <p>Amount (in eth): <mark>{txDetails && txDetails.tx ? ethers.utils.formatEther(ethers.utils.bigNumberify(txDetails.tx.value).toString()) : ""}</mark></p>: 
                <p></p>
              }
              <p>Est. Fee (in eth): <mark>{ethers.utils.formatEther(gasFee)}</mark></p>
              {
                subaction === "approve-tx" ? 
                <div>
                  <Form onSubmit={this.submitPassword}>
                    <Form.Group controlId="formBasicEmail">
                      <Form.Control onChange={this.handlePassword} type="password" placeholder="Your password" />
                    </Form.Group>              
                    <Button variant="primary" type="submit">
                      Approve
                    </Button>                  
                  </Form>
                </div> : 
                <Button variant="primary" onClick={() => setGlobal({ subaction: 'approve-tx', error: ""})}>
                  Approve
                </Button>
              }
              
              <Button onClick={() => closeWidget(false)} variant="seconday" type="">
                Reject
              </Button>
              <p className="text-danger error-message">{error}</p>
            </div>
            </div> : 
            <div>
              <h5>Approve Action</h5>
              <div className="text-left">
              <p>App: <mark>{txDetails.appName}</mark></p>
              <p>Message To Sign: <mark>{txDetails && txDetails.tx && web3Connected ? web3.utils.toUtf8(txDetails.tx.data) : ""}</mark></p>
              {
                subaction === "approve-msg" ? 
                <div>
                  <Form onSubmit={this.submitPassword}>
                    <Form.Group controlId="formBasicEmail">
                      <Form.Control onChange={this.handlePassword} type="password" placeholder="Your password" />
                    </Form.Group>              
                    <Button variant="primary" type="submit">
                      Approve
                    </Button>                  
                  </Form>
                </div> : 
                <Button variant="primary" onClick={() => setGlobal({ subaction: 'approve-msg', error: ""})}>
                  Approve
                </Button>
              }
              <Button onClick={() => closeWidget(false)} variant="seconday" type="">
                Reject
              </Button>
              <p className="text-danger error-message">{error}</p>
            </div>
          </div>
          }
        </div>
      </div>
    )
  }
}