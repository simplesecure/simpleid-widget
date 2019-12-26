import React, { setGlobal } from 'reactn';
import { getTxDetails } from '../actions/postMessage';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import { handleHash, returnSignedMessage, closeWidget, approveSignIn, signIn } from '../actions/postMessage';
const Tx = require('ethereumjs-tx').Transaction;
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
    //FOR DEBUGGING AND TESTING: 
    const { txDetails } = this.global;
    const gasFee = await web3.eth.estimateGas(txDetails.tx);
    this.setState({ gasFee });
    //console.log("THE FEE: ", ethers.utils.formatEther(gasFee));
  }

  //TODO: change this to a proper descriptive name
  submitPassword = async (e) => {
    e.preventDefault();
    const { txDetails, config, subaction, type } = this.global;
    const { gasFee } = this.state;
    const approval = await approveSignIn();
    console.log(approval);

    const address = approval.signingKey.address;
    console.log("ADDRESS: ", address);
    const provider = ethers.getDefaultProvider(config.network);

    if(subaction === "approve-msg") {
      if(approval.signingKey) {
        // const message = web3.utils.toUtf8(txDetails.tx.data);
        // console.log(message);
        const wallet = ethers.Wallet.fromMnemonic(approval.signingKey.mnemonic).connect(provider);
        const binaryData = ethers.utils.arrayify(txDetails.tx.data);

        const signPromise = await wallet.signMessage(binaryData)
        
        returnSignedMessage(signPromise);
      } else {
        setGlobal({ error: "Please verify your password is correct", password: "" });
      }
    } else {
      try {
        //console.log(keychain.toString(CryptoJS.enc.Utf8));
        if(approval.signingKey) {
          //Let's broadcast this transaction!
          setGlobal({ action: "loading" });
          txDetails.tx["nonce"] = await provider.getTransactionCount(address);
          console.log("TXDETAILS: ", txDetails.tx)
          //Now sign the tx
          let txx = new Tx(txDetails.tx, {chain: config.network })
          const privateKey = Buffer.from(approval.signingKey.keyPair.privateKey.substring(2), 'hex');
          console.log("PRIVATE KEY: ", privateKey);
          txx.sign(privateKey);
          const sTx = txx.serialize();
          console.log("STX: ", sTx);
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
                }                          
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
  }

  handlePassword = (e) => {
    setGlobal({ password: e.target.value });
  }

  connectWebThree = () => {
    const { config } = this.global;
    web3 = new Web3(new Web3.providers.HttpProvider(`https://${config.network}.infura.io/v3/${INFURA_KEY}`));
    this.setState({ web3Connected: true });
  }

  approveTransaction = async (type) => {
    console.log("APPROVE IT!")
    //For now, let's hardcode the email: 
    const email = "justin@simpleid.xyz";
    //Updating state to reflect the approval screen
    await setGlobal({ subaction: type, error: "", email, nonSignInEvent: true })
    //Here we are firing off an approval token to the user's email
    signIn();
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
              {
                subaction !== 'approve-tx' ? 
                <div>
                  <div className="text-left">
                    <p>App: <mark>{txDetails.appName}</mark></p>
                    {
                      txDetails && txDetails.tx && txDetails.tx.value ? 
                      <p>Amount (in eth): <mark>{txDetails && txDetails.tx ? ethers.utils.formatEther(ethers.utils.bigNumberify(txDetails.tx.value).toString()) : ""}</mark></p>: 
                      <p></p>
                    }
                    <p>Est. Fee (in eth): <mark>{ethers.utils.formatEther(gasFee)}</mark></p>
                  </div>
                </div> : 
                <div />
              }              
              {
                subaction === "approve-tx" ? 
                <div>
                  <h5>Enter the code you received via email to continue</h5>
                  <p>If you didn't receive a code, <span className="a-span" onClick={() => setGlobal({ auth: true, action: "sign-in"})}>try sending it again.</span></p>
                  <Form onSubmit={this.submitPassword}>
                    <Form.Group controlId="formBasicEmail">
                      <Form.Control onChange={(e) => setGlobal({ token: e.target.value})} type="text" placeholder="123456" />
                    </Form.Group>
                    <Button variant="primary" type="submit">
                      Approve
                    </Button>
                  </Form>
                </div>
                : 
                <Button variant="primary" onClick={() => this.approveTransaction("approve-tx")}>
                  Approve
                </Button>
              }
              
              <Button onClick={() => closeWidget(false)} variant="seconday" type="">
                Reject
              </Button>
              <p className="text-danger error-message">{error}</p>
            
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
                      <Form.Control onChange={(e) => setGlobal({ token: e.target.value})} type="text" placeholder="123456" />
                    </Form.Group>
                    <Button variant="primary" type="submit">
                      Approve
                    </Button>
                  </Form>
                </div> : 
                <Button variant="primary" onClick={() => this.approveTransaction("approve-msg")}>
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