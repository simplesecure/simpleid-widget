import { tableGet,
         tableBatchGet,
         tablePut,
         tableQuerySpecificItem,
         tableGetBySecondaryIndex,
         tableUpdateListAppend,
         tableUpdateAppendNestedObjectProperty } from './dynamoBasics.js'

// TODO: This func will go away and go into our EC2/Lambda Mail service machine
//
export async function userDataTableGetEmailsFromUuid(uuid) {
  return tableGetBySecondaryIndex(
    process.env.REACT_APP_UD_TABLE,
    process.env.REACT_APP_UD_TABLE_INDEX,
    process.env.REACT_APP_UD_TABLE_SK,
    uuid
  )
}

export async function walletAnalyticsDataTableGet(anAppId) {
  return tableGet(
    process.env.REACT_APP_AD_TABLE,
    process.env.REACT_APP_AD_TABLE_PK,
    anAppId
  )
}

export async function walletAnalyticsDataTablePut(anWalletAnalyticsRowObj) {
  return tablePut(
    process.env.REACT_APP_AD_TABLE,
    anWalletAnalyticsRowObj
  )
}

export async function walletAnalyticsDataTableGetAppPublicKey(anAppId) {
  let walletAnalyticsRowObjs = undefined
  try {
    walletAnalyticsRowObjs = await tableQuerySpecificItem(
      process.env.REACT_APP_AD_TABLE,
      process.env.REACT_APP_AD_TABLE_PK,
      anAppId,
      'public_key'
    )

    const appPublicKey = walletAnalyticsRowObjs.Items[0].public_key
    return appPublicKey
  } catch (suppressedError) {
    console.log(`ERROR(Suppressed): Failed to fetch public key for app ${anAppId}.\n${suppressedError}`)
  }

  return undefined
}

export async function walletToUuidMapTableGet(aWalletAddress) {
  return tableGet(
    process.env.REACT_APP_UUID_TABLE,
    process.env.REACT_APP_UUID_TABLE_PK,
    aWalletAddress
  )
}

export async function walletToUuidMapTablePut(aWalletToUuidMapRowObj) {
  return tablePut(
    process.env.REACT_APP_UUID_TABLE,
    aWalletToUuidMapRowObj
  )
}

export async function organizationDataTableGet(anOrgId) {
  return tableGet(
    process.env.REACT_APP_ORG_TABLE,
    process.env.REACT_APP_ORG_TABLE_PK,
    anOrgId
  )
}

export async function organizationDataTablePut(aOrganizationDataRowObj) {
  return tablePut(
    process.env.REACT_APP_ORG_TABLE,
    aOrganizationDataRowObj
  )
}

export async function unauthenticatedUuidTableQueryByEmail(anEmail) {
  return tableGetBySecondaryIndex(
    process.env.REACT_APP_UNAUTH_UUID_TABLE,
    process.env.REACT_APP_UNAUTH_UUID_TABLE_INDEX,
    process.env.REACT_APP_UNAUTH_UUID_TABLE_SK,
    anEmail
  )
}

export async function unauthenticatedUuidTableGetByUuid(aUuid) {
  return tableGet(
    process.env.REACT_APP_UNAUTH_UUID_TABLE,
    process.env.REACT_APP_UNAUTH_UUID_TABLE_PK,
    aUuid
  )
}

// TODO: change this to use the Cognito unauthenticated role perhaps.
//       - look into ramifications / sensibility of that move
export async function unauthenticatedUuidTablePut(anUnauthenticatedUuidRowObj) {
  return tablePut(
    process.env.REACT_APP_UNAUTH_UUID_TABLE,
    anUnauthenticatedUuidRowObj
  )
}

export async function unauthenticatedUuidTableAppendAppId(aUuid, anAppId) {
  return tableUpdateListAppend(
    process.env.REACT_APP_UNAUTH_UUID_TABLE,
    { [ process.env.REACT_APP_UNAUTH_UUID_TABLE_PK ] : aUuid },
    'apps',
    anAppId
  )
}

export async function walletToUuidMapTableAddCipherTextUuidForAppId(
  aWalletAddress, aCipherTextUuid, anAppId) {

  return tableUpdateAppendNestedObjectProperty(
    process.env.REACT_APP_UUID_TABLE,
    { [ process.env.REACT_APP_UUID_TABLE_PK ] : aWalletAddress },
    'app_to_enc_uuid_map',
    anAppId,
    aCipherTextUuid
  )
}

export async function walletAnalyticsDataTableAddWalletForAnalytics(
  aWalletAddress, anAppId) {

  return tableUpdateAppendNestedObjectProperty(
    process.env.REACT_APP_AD_TABLE,
    { [ process.env.REACT_APP_AD_TABLE_PK] : anAppId },
    'analytics',
    aWalletAddress,
    {}
  )
}

export async function walletToUuidMapTableGetUuids(anArrayOfWalletAddrs) {
  if (anArrayOfWalletAddrs.length > 100) {
    throw new Error('Segments larger than 100 are not presently supported.')
  }

  const arrOfKeyValuePairs = []
  for (const walletAddress of anArrayOfWalletAddrs) {
    arrOfKeyValuePairs.push({
      [ process.env.REACT_APP_UUID_TABLE_PK ] : walletAddress
    })
  }

  const rawDataResults = await tableBatchGet(
    process.env.REACT_APP_UUID_TABLE, arrOfKeyValuePairs)

  let walletToUuids = undefined
  try {
    walletToUuids = rawDataResults.Responses[process.env.REACT_APP_UUID_TABLE]
  } catch (error) {
    throw new Error(`Unable to access wallet to UUID maps in db response.\n${error}`);
  }
  return walletToUuids
}
