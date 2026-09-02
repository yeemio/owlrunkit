import {
  SUPPORTED_QUICK_CORE_IDENTITIES,
  attestQuickReceiptDetailsFromBytesWithCoreCatalog,
} from "../../packages/attest/src/quick.mjs";
import { currentCoreIdentity } from "./core-contract.mjs";

export {
  attestQuickReceipt,
  attestQuickReceiptDetails,
  attestQuickReceiptDetailsFromBytes,
  validQuickReceiptShape,
} from "../../packages/attest/src/quick.mjs";

function coreBoundCatalog() {
  const current = currentCoreIdentity();
  return [
    current,
    ...SUPPORTED_QUICK_CORE_IDENTITIES.filter((identity) => (
      identity.coreVersion !== current.coreVersion
    )),
  ];
}

export function attestCoreBoundQuickReceiptDetailsFromBytes(options) {
  return attestQuickReceiptDetailsFromBytesWithCoreCatalog(
    options,
    coreBoundCatalog(),
  );
}
