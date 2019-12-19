import { Auth } from 'aws-amplify'
import Amplify from 'aws-amplify';
import { CognitoUser } from 'amazon-cognito-identity-js'
const AWS = require('aws-sdk')

// TODO: clean up for security best practices
//       currently pulled from .env
//       see: https://create-react-app.dev/docs/adding-custom-environment-variables/
Amplify.configure({
  Auth: {
    region: process.env.REACT_APP_REGION,
    userPoolId: process.env.REACT_APP_USER_POOL_ID,
    userPoolWebClientId: process.env.REACT_APP_USER_POOL_WEB_CLIENT_ID,
    identityPoolId: process.env.REACT_APP_IDENTITY_POOL_ID
  }
});

// TODO: move these to dynamo / lambda system in milestone 2
const KEY_FARM_IDS = [
  '66d158b8-ecbd-4962-aedb-15d5dd4024ee',   // Key 0
  '2fe4d745-6685-4581-93ca-6fd7aff92426',   // Key 1
  'ba920788-7c6a-4553-b804-958870279f53'    // Key 2
]

export class SidServices
{
  constructor() {
    this.cognitoUser = undefined
  }

  // Psuedo code for sign in / up operations (TODO):
  // 1. Test to see if new user or existing user, call signUp or signIn as
  //    appropriate.
  // 2. If signUp:
  //    a) Call signUp and wait for code to be entered
  //      - for now choose keys here as part of sign up, next milestone move those to lambda for immutability
  //    b) When code is entered generate keychain
  //    c) split keychain into secrets
  //    d) encrypt two secrets using two different user KMS keys
  //    e) store the two secrets in database (keyed to email?)
  //    f) store the wallet address in another database
  //    g) [next milestone] store a mapping from wallet to email in a database
  //       accessible only to this developer (used for analytics) (AWS write only cognito)
  // 3. If signIn:
  //    a) Fetch encrypted secrets
  //    b) Decrypt encrypted secrets
  //    c) Merge into keychain
  //    d) [next milestone] Analytics
  //


  // TODO: do we want to expand this to use phone numbers?
  // See: https://aws-amplify.github.io/docs/js/authentication#lambda-triggers for more error handling etc.
  signInOrUp = async (anEmail) => {
    console.log('DBG: Forcing sign out ...')
    try {
      await Auth.signOut()
      console.log('DBG: success')
    } catch (error) {
      console.log('DBG: failure')
      console.log(error)
    }

    try {
      this.cognitoUser = await Auth.signIn(anEmail)
      console.log('DBG: sidServices::signIn succeeded.')
      return
    } catch (error) {
      if (error.code !== 'UserNotFoundException') {
        throw `ERROR: Sign in attempt has failed.\n${error}`
      }
    }

    // The error code was 'UserNotFoundException' indicating anEmail is not in
    // our user pool. Sign them up:
    try {
      // TODO: move this to dynamo / lambda system in milestone 2 (the max keys value so it's dynamic)
      const MAX_KEYS = 3

      // TODO: - always ensure key selection isn't repeated (i.e. KFA1 !== KFA2)
      //       - consider using crypto's getRandomValues method as below
      const KFA1 = Math.floor(Math.random() * MAX_KEYS)
      const KFA2 = Math.floor(Math.random() * MAX_KEYS)

      const params = {
        username: anEmail,
        password: SidServices._getRandomString(30),
        attributes: {
          "custom:kfa1" : KEY_FARM_IDS[KFA1],
          "custom:kfa2" : KEY_FARM_IDS[KFA2]
        }
      }

      await Auth.signUp(params)
      console.log('DBG: sidServices::signUp succeeded.')
      this.cognitoUser = await Auth.signIn(anEmail)
      console.log('DBG: sidServices::signIn succeeded.')
    } catch (error) {
      throw `ERROR: Sign up attempt has failed.\n${error}`
    }
  }

  signOut = async () => {
    try {
      await Auth.signOut()
    } catch (error) {
      console.log(`ERROR: Signing out encounted an error.\n${error}`)
    }
  }

  answerCustomChallenge = async (anAnswer) => {
    const FN = 'sidServices::answerCustomChallenge'
    console.log(`DBG: ${FN}`)
    console.log('DBG: ---------------------------------------------------------------')
    console.log(`DBG: ${FN} this.cognitoUser:`)
    console.log(this.cognitoUser)
    console.log(`DBG: ${FN} answer:`)
    console.log(anAnswer)
    console.log(typeof anAnswer)
    console.log(`DBG: Setting window log level to DEBUG from ${window.LOG_LEVEL}`)
    window.LOG_LEVEL = 'DEBUG'
    try {
      console.log(`DBG: ${FN} Callign sendCustomChallengeAnswer:`)
      AWS.config.maxRetries = 10
      console.log(`DBG: ${FN} Set AWS maxRetries to ${AWS.config.maxRetries}:`)
      this.cognitoUser = await Auth.sendCustomChallengeAnswer(this.cognitoUser, anAnswer)
      console.log(`DBG: ${FN} succeeded`)
    } catch (error) {
      console.log(`DBG: ${FN} failed`)
      console.log(error)
      throw error
    }
    console.log('DBG: ${FN} after sending custom challenge answer this.cognitoUser:')
    return this.isAuthenticated()
  }

  isAuthenticated = async () => {
    try {
      await Auth.currentSession();
      return true;
    } catch {
      return false;
    }
  }



  //
  // Private Methods
  //////////////////////////////////////////////////////////////////////////////

  static _getRandomString(numBytes) {
    const randomValues = new Uint8Array(numBytes)
    // TODO: any environments where window will not be available?
    if (!window) {
      throw `ERROR: SID Services unable to access window.`
    }
    window.crypto.getRandomValues(randomValues)
    return Array.from(randomValues).map(SidServices._intToHex).join('');
  }

  static _intToHex(aNumber) {
    return aNumber.toString(16).padStart(2, '0');
  }

}
