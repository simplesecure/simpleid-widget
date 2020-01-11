import { tableGet,
         tablePut,
         tableGetBySecondaryIndex,
         tableUpdateListAppend,
         tableUpdateAppendNestedObjectProperty } from './dynamoBasics.js'

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

  const primKeyObj = {}
  primKeyObj[ process.env.REACT_APP_UNAUTH_UUID_TABLE_PK ] = aUuid

  return tableUpdateListAppend(
    process.env.REACT_APP_UNAUTH_UUID_TABLE,
    primKeyObj,
    'apps',
    anAppId
  )
}

export async function walletToUuidMapTableAddCipherTextUuidForAppId(
  aWalletAddress, aCipherTextUuid, anAppId) {

  const primKeyObj = {}
  primKeyObj[ process.env.REACT_APP_UUID_TABLE_PK ] = aWalletAddress

  return tableUpdateAppendNestedObjectProperty(
    process.env.REACT_APP_UUID_TABLE,
    primKeyObj,
    'app_to_enc_uuid_map',
    anAppId,
    aCipherTextUuid
  )
}

export async function walletAnalyticsDataTableAddWalletForAnalytics(
  aWalletAddress, anAppId) {

  const primKeyObj = {}
  primKeyObj[ process.env.REACT_APP_AD_TABLE_PK] = anAppId

  return tableUpdateAppendNestedObjectProperty(
    process.env.REACT_APP_AD_TABLE,
    primKeyObj,
    'analytics',
    aWalletAddress,
    {}
  )
}
